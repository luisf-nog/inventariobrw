import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { sincronizarEstoqueWms } from "@/lib/wms.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Download, FileSpreadsheet, Lock, AlertTriangle,
  Trash2, CheckCircle2, BarChart2, PackageX, Layers,
  RefreshCw, MapPin, RotateCcw, Pencil, Check, X,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { buscarDescricoesPorSku, traduzirEansParaSkus } from "@/lib/produtos";
import { formatPosicaoDisplay } from "@/lib/validation";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/inventario/$id/resumo")({
  component: TelaResumo,
});

type Linha = {
  id: string;
  codigo_posicao: string;
  codigo_produto: string;
  sku: string;
  descricao: string;
  numero_contagem: number;
  quantidade: number;
  operador_id: string | null;
  operador_nome: string | null;
  lido_em: string;
};

type ConsolidadoItem = {
  codigo_posicao: string;
  sku: string;
  descricao: string;
  contagens: Map<number, number>;
  operadores: string[];
  divergente: boolean;
};

type WmsRow = { codigo_posicao: string; sku: string; qtde_unidades: number; qtde_embal?: number | null; descricao?: string | null };

type ItemAnalise = {
  sku: string;
  descricao: string;
  pickingWms: number;
  pblWms: number;
  pickingContagens: Map<number, number>;
  pblContagens: Map<number, number>;
};

type SecaoInfo = { confirmed: number | null; delta: number | null; divergente: boolean };
type ItemRow = {
  item: ItemAnalise;
  pick: SecaoInfo;
  pbl: SecaoInfo;
  complementar: boolean;
  naoContado: boolean;
  temPicking: boolean;
  temPbl: boolean;
  magnitude: number;
};

// Regras de classificação de posição (12 chars):
//   ruas 001–899, nível 01 → estoque normal (picking porta-pallet)
//   rua 995                → PBL (flowrack) — sem restrição de nível
//   ruas técnicas 990+ (exceto PBL) e qualquer nível ≠ 01 em ruas normais são IGNORADOS.
export const RUA_PBL = "995";
export function isPosicaoNormal(c: string) {
  if (c.length !== 12) return false;
  const rua = Number(c.slice(2, 5));
  if (!Number.isInteger(rua) || rua < 1 || rua > 899) return false;
  return c.slice(8, 10) === "01"; // nível 01 = térreo; nível 02+ = aéreo
}
export function isPosicaoPbl(c: string) {
  return c.length === 12 && c.slice(2, 5) === RUA_PBL;
}
export function isPosicaoConsiderada(c: string) {
  return isPosicaoNormal(c) || isPosicaoPbl(c);
}

// Valor confirmado de uma série de contagens pela regra da MAIORIA (moda):
// - 0 contagens → nulo
// - 1 contagem → o próprio valor (a falta de 2ª contagem é tratada à parte)
// - 2+ contagens → o valor que mais se repete, desde que apareça ≥ 2 vezes e
//   não haja empate na maior frequência. Senão, nulo (= divergente).
function valorConfirmado(contagens: Map<number, number>): number | null {
  const vals = Array.from(contagens.values());
  if (vals.length === 0) return null;
  if (vals.length === 1) return vals[0];
  const freq = new Map<number, number>();
  for (const v of vals) freq.set(v, (freq.get(v) ?? 0) + 1);
  let melhor: number | null = null;
  let melhorFreq = 0;
  let empate = false;
  for (const [v, f] of freq) {
    if (f > melhorFreq) { melhor = v; melhorFreq = f; empate = false; }
    else if (f === melhorFreq) { empate = true; }
  }
  return melhorFreq >= 2 && !empate ? melhor : null;
}

function secaoInfo(contagens: Map<number, number>, wms: number, wmsLoaded: boolean) {
  const confirmed = valorConfirmado(contagens);
  const delta = wmsLoaded && confirmed !== null ? confirmed - wms : null;
  return { confirmed, delta, divergente: contagens.size > 1 && confirmed === null };
}

async function fetchWmsSnapshot(inventarioId: string): Promise<WmsRow[]> {
  const PAGE = 1000;
  const out: WmsRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("estoque_wms_snapshot")
      .select("codigo_posicao, sku, qtde_unidades, qtde_embal, descricao")
      .eq("inventario_id", inventarioId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as WmsRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.filter((r) => isPosicaoConsiderada(r.codigo_posicao));
}

// Monta os mapas derivados do snapshot WMS (usado no carregamento e na sincronização)
function construirMapasWms(rows: WmsRow[]) {
  const wm = new Map<string, number>();
  const sp = new Map<string, Set<string>>();
  const embal = new Map<string, number>(); // pos|sku -> qtde da master (caixa)
  const desc = new Map<string, string>(); // sku -> descricao do WMS
  for (const w of rows) {
    const k = `${w.codigo_posicao}|${w.sku}`;
    wm.set(k, (wm.get(k) ?? 0) + Number(w.qtde_unidades ?? 0));
    const set = sp.get(w.sku) ?? new Set<string>();
    set.add(w.codigo_posicao);
    sp.set(w.sku, set);
    embal.set(k, Math.max(embal.get(k) ?? 0, Number(w.qtde_embal ?? 0)));
    const d = (w.descricao ?? "").trim();
    if (d && !desc.has(w.sku)) desc.set(w.sku, d);
  }
  return { wm, sp, embal, desc };
}

function Paginacao({ page, pageSize, total, onPage, onPageSize }: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(page, pageCount - 1);
  const from = total === 0 ? 0 : p * pageSize + 1;
  const to = Math.min(total, (p + 1) * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-muted-foreground">
      <span className="tabular-nums">
        {total === 0 ? "Nenhum registro" : `Mostrando ${from}–${to} de ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="50">50 / página</SelectItem>
            <SelectItem value="100">100 / página</SelectItem>
            <SelectItem value="200">200 / página</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={p <= 0} onClick={() => onPage(p - 1)} title="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular-nums whitespace-nowrap">{p + 1} / {pageCount}</span>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={p >= pageCount - 1} onClick={() => onPage(p + 1)} title="Próxima página">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function TelaResumo() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const sincronizarWms = useServerFn(sincronizarEstoqueWms);

  const [inv, setInv] = useState<{ nome: string; status: string; wms_sincronizado_em: string | null } | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [wmsMap, setWmsMap] = useState<Map<string, number>>(new Map());
  const [skuPositions, setSkuPositions] = useState<Map<string, Set<string>>>(new Map());
  const [wmsEmbal, setWmsEmbal] = useState<Map<string, number>>(new Map());
  const [wmsDesc, setWmsDesc] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);

  // Filtros da aba Leituras Brutas
  const [filtroPos, setFiltroPos] = useState("");
  const [filtroProd, setFiltroProd] = useState("");
  const [filtroOp, setFiltroOp] = useState("");
  const [soDivergentes, setSoDivergentes] = useState(false);

  // Filtros da aba Por Item
  const [filtroItemProd, setFiltroItemProd] = useState("");
  const [filtroItemStatus, setFiltroItemStatus] = useState<
    "todos" | "complementar" | "sobra" | "falta" | "divergente" | "diferenca" | "naocontado"
  >("todos");
  const [filtroItemLocal, setFiltroItemLocal] = useState<"ambos" | "picking" | "pbl">("ambos");
  const [ordemItem, setOrdemItem] = useState<"sku" | "diferenca" | "dif_picking" | "dif_pbl" | "dif_total">("sku");

  // Paginação (render) — dados continuam carregados inteiros para os agregados
  const [pageLeituras, setPageLeituras] = useState(0);
  const [sizeLeituras, setSizeLeituras] = useState(100);
  const [pageItens, setPageItens] = useState(0);
  const [sizeItens, setSizeItens] = useState(100);

  const [isAdmin, setIsAdmin] = useState(false);
  const [confirmandoEncerrar, setConfirmandoEncerrar] = useState(false);
  const [confirmTexto, setConfirmTexto] = useState("");
  const [deletandoId, setDeletandoId] = useState<string | null>(null);
  const [recontagens, setRecontagens] = useState<Array<{ id: string; codigo_posicao: string; codigo_produto: string; numero_contagem_origem: number }>>([]);
  const [solicitandoId, setSolicitandoId] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editValor, setEditValor] = useState<string>("");
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setIsAdmin(!!data.user));

    let cancelado = false;
    const carregar = async () => {
      const { data: invData } = await supabase
        .from("inventarios")
        .select("nome, status, wms_sincronizado_em")
        .eq("id", id)
        .single();
      if (cancelado) return;
      setInv(invData as any);

      const fetchAllLeituras = async () => {
        const PAGE = 1000;
        const out: any[] = [];
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await supabase
            .from("leituras")
            .select("id, codigo_posicao, codigo_produto, numero_contagem, quantidade, operador_id, lido_em, operadores(nome)")
            .eq("inventario_id", id)
            .order("codigo_posicao")
            .order("lido_em", { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (error) return { data: null as any, error };
          const rows = data ?? [];
          out.push(...rows);
          if (rows.length < PAGE) break;
        }
        return { data: out, error: null as any };
      };

      const [{ data, error }, wmsData, { data: recData }] = await Promise.all([
        fetchAllLeituras(),
        fetchWmsSnapshot(id),
        supabase
          .from("recontagens_solicitadas")
          .select("id, codigo_posicao, codigo_produto, numero_contagem_origem")
          .eq("inventario_id", id),
      ]);
      setRecontagens((recData ?? []) as any);

      if (cancelado) return;
      if (error) { toast.error(error.message); setLoading(false); return; }

      const { wm, sp, embal, desc: wmsDescMap } = construirMapasWms(wmsData);
      setWmsMap(wm);
      setSkuPositions(sp);
      setWmsEmbal(embal);
      setWmsDesc(wmsDescMap);

      const codigosLidos: string[] = Array.from(new Set(((data ?? []) as any[]).map((d: any) => d.codigo_produto as string)));
      const eanToSku = await traduzirEansParaSkus(codigosLidos);
      const skuPorCodigo = (codigo: string) => eanToSku[codigo.replace(/\D/g, "")] ?? codigo;
      const skusLidos = codigosLidos.map(skuPorCodigo);
      const todosSkus = Array.from(new Set([...skusLidos, ...wmsDescMap.keys(), ...Array.from(sp.keys())]));
      const descricoes = await buscarDescricoesPorSku(todosSkus);
      if (cancelado) return;

      const resolverDesc = (sku: string) => {
        const d = (descricoes[sku] ?? "").trim();
        if (d) return d;
        return wmsDescMap.get(sku) ?? "";
      };

      const ls: Linha[] = (data ?? []).map((d: any) => ({
        id: d.id,
        codigo_posicao: d.codigo_posicao,
        codigo_produto: d.codigo_produto,
        sku: skuPorCodigo(d.codigo_produto),
        descricao: resolverDesc(skuPorCodigo(d.codigo_produto)),
        numero_contagem: d.numero_contagem,
        quantidade: Number(d.quantidade),
        operador_id: d.operador_id,
        operador_nome: d.operadores?.nome ?? null,
        lido_em: d.lido_em,
      }));

      setLinhas(ls);
      setLoading(false);
    };

    carregar();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const agendarRecarga = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { carregar(); }, 400);
    };

    const channel = supabase
      .channel(`resumo-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leituras", filter: `inventario_id=eq.${id}` }, agendarRecarga)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "inventarios", filter: `id=eq.${id}` }, agendarRecarga)
      .on("postgres_changes", { event: "*", schema: "public", table: "recontagens_solicitadas", filter: `inventario_id=eq.${id}` }, agendarRecarga)
      .subscribe();

    return () => {
      cancelado = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [id]);

  /* ── Exclui posições aéreas (nível ≠ 01) de toda a análise ─────── */
  const linhasAnalisadas = useMemo(
    () => linhas.filter((l) => isPosicaoConsiderada(l.codigo_posicao)),
    [linhas],
  );

  /* ── Consolidado: uma linha por posição+produto ─────────────────── */

  const consolidado = useMemo((): ConsolidadoItem[] => {
    const map = new Map<string, ConsolidadoItem>();
    for (const l of linhasAnalisadas) {
      const key = `${l.codigo_posicao}|${l.sku}`;
      if (!map.has(key)) {
        map.set(key, {
          codigo_posicao: l.codigo_posicao,
          sku: l.sku,
          descricao: l.descricao,
          contagens: new Map(),
          operadores: [],
          divergente: false,
        });
      }
      const item = map.get(key)!;
      item.contagens.set(l.numero_contagem, (item.contagens.get(l.numero_contagem) ?? 0) + l.quantidade);
      if (l.operador_nome && !item.operadores.includes(l.operador_nome)) {
        item.operadores.push(l.operador_nome);
      }
    }
    for (const item of map.values()) {
      item.divergente = item.contagens.size > 1 && valorConfirmado(item.contagens) === null;
    }
    return Array.from(map.values()).sort((a, b) => a.codigo_posicao.localeCompare(b.codigo_posicao));
  }, [linhas]);

  const maxContagem = useMemo(
    () => linhasAnalisadas.reduce((m, l) => Math.max(m, l.numero_contagem), 1),
    [linhasAnalisadas],
  );

  const divergencias = useMemo(
    () => consolidado.filter((i) => i.divergente),
    [consolidado],
  );

  const divergenciasSet = useMemo(
    () => new Set(divergencias.map((i) => `${i.codigo_posicao}|${i.sku}`)),
    [divergencias],
  );

  const analisePorItem = useMemo((): ItemAnalise[] => {
    const map = new Map<string, ItemAnalise>();
    const getOrCreate = (sku: string, descricao = ""): ItemAnalise => {
      if (!map.has(sku)) {
        map.set(sku, { sku, descricao, pickingWms: 0, pblWms: 0, pickingContagens: new Map(), pblContagens: new Map() });
      }
      return map.get(sku)!;
    };
    for (const l of linhasAnalisadas) {
      const e = getOrCreate(l.sku, l.descricao);
      if (!e.descricao && l.descricao) e.descricao = l.descricao;
      const ctgs = isPosicaoPbl(l.codigo_posicao) ? e.pblContagens : e.pickingContagens;
      ctgs.set(l.numero_contagem, (ctgs.get(l.numero_contagem) ?? 0) + l.quantidade);
    }
    if (wmsMap.size > 0) {
      for (const [k, qtd] of wmsMap) {
        const sep = k.indexOf("|");
        const pos = k.slice(0, sep);
        const sku = k.slice(sep + 1);
        const e = getOrCreate(sku, wmsDesc.get(sku) ?? "");
        if (!e.descricao) e.descricao = wmsDesc.get(sku) ?? "";
        if (isPosicaoPbl(pos)) e.pblWms += qtd;
        else e.pickingWms += qtd;
      }
    }
    for (const item of map.values()) {
      if (!item.descricao) item.descricao = wmsDesc.get(item.sku) ?? "";
    }
    return Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));
  }, [linhasAnalisadas, wmsMap, wmsDesc]);

  // Saldo do mesmo SKU encontrado em posições onde o WMS NÃO o espera.
  // Usa `linhas` cru (não `linhasAnalisadas`) de propósito: assim captura também as
  // posições aéreas/técnica descartadas — é justamente onde o saldo "perdido" costuma estar.
  const outrasPosicoesPorSku = useMemo(() => {
    const out = new Map<string, { total: number; totalForaAnalise: number; posicoes: { pos: string; qtd: number; foraAnalise: boolean }[] }>();
    if (skuPositions.size === 0) return out;
    const byKey = new Map<string, Map<number, number>>(); // sku|pos -> contagem -> qtd
    for (const l of linhas) {
      const esperadas = skuPositions.get(l.sku);
      if (esperadas && esperadas.has(l.codigo_posicao)) continue; // posição esperada → não é "outra"
      const k = `${l.sku}|${l.codigo_posicao}`;
      const m = byKey.get(k) ?? new Map<number, number>();
      m.set(l.numero_contagem, (m.get(l.numero_contagem) ?? 0) + l.quantidade);
      byKey.set(k, m);
    }
    for (const [k, rounds] of byKey) {
      const sep = k.indexOf("|");
      const sku = k.slice(0, sep);
      const pos = k.slice(sep + 1);
      const qtd = Math.max(...Array.from(rounds.values())); // melhor representação do que havia ali
      if (qtd <= 0) continue;
      const foraAnalise = !isPosicaoConsiderada(pos);
      const entry = out.get(sku) ?? { total: 0, totalForaAnalise: 0, posicoes: [] };
      entry.posicoes.push({ pos, qtd, foraAnalise });
      entry.total += qtd;
      if (foraAnalise) entry.totalForaAnalise += qtd;
      out.set(sku, entry);
    }
    for (const e of out.values()) e.posicoes.sort((a, b) => a.pos.localeCompare(b.pos));
    return out;
  }, [linhas, skuPositions]);

  // Cada item já com seus indicadores calculados (reusado por filtro, ordenação, render e export)
  const itensComputados = useMemo((): ItemRow[] => {
    const wmsLoaded = wmsMap.size > 0;
    return analisePorItem.map((item) => {
      const pick = secaoInfo(item.pickingContagens, item.pickingWms, wmsLoaded);
      const pbl = secaoInfo(item.pblContagens, item.pblWms, wmsLoaded);
      const complementar = pick.delta !== null && pbl.delta !== null && pick.delta !== 0 && pbl.delta !== 0 && Math.sign(pick.delta) !== Math.sign(pbl.delta);
      const semContagem = item.pickingContagens.size === 0 && item.pblContagens.size === 0;
      const naoContado = semContagem && (item.pickingWms > 0 || item.pblWms > 0);
      const temPicking = item.pickingWms > 0 || item.pickingContagens.size > 0;
      const temPbl = item.pblWms > 0 || item.pblContagens.size > 0;
      const divergente = pick.divergente || pbl.divergente;
      // Magnitude para ordenar: divergências sem resolução vão para o topo.
      const magnitude = divergente ? Number.POSITIVE_INFINITY : Math.abs(pick.delta ?? 0) + Math.abs(pbl.delta ?? 0);
      return { item, pick, pbl, complementar, naoContado, temPicking, temPbl, magnitude };
    });
  }, [analisePorItem, wmsMap]);

  const itensFiltrados = useMemo((): ItemRow[] => {
    const f = filtroItemProd.trim().toUpperCase();
    const rows = itensComputados.filter(({ item, pick, pbl, complementar, naoContado, temPicking, temPbl }) => {
      if (f && !item.sku.toUpperCase().includes(f) && !item.descricao.toUpperCase().includes(f)) return false;
      if (filtroItemLocal === "picking" && !temPicking) return false;
      if (filtroItemLocal === "pbl" && !temPbl) return false;
      switch (filtroItemStatus) {
        case "todos":
          return true;
        case "naocontado":
          return naoContado;
        case "complementar":
          return complementar;
        case "sobra":
          return (pick.delta ?? 0) > 0 || (pbl.delta ?? 0) > 0;
        case "falta":
          return (pick.delta ?? 0) < 0 || (pbl.delta ?? 0) < 0;
        case "divergente":
          return pick.divergente || pbl.divergente;
        case "diferenca":
          return (pick.delta !== null && pick.delta !== 0) || (pbl.delta !== null && pbl.delta !== 0) || pick.divergente || pbl.divergente;
        default:
          return true;
      }
    });
    return [...rows].sort((a, b) => {
      const aPick = Math.abs(a.pick.delta ?? 0);
      const bPick = Math.abs(b.pick.delta ?? 0);
      const aPbl = Math.abs(a.pbl.delta ?? 0);
      const bPbl = Math.abs(b.pbl.delta ?? 0);
      if (ordemItem === "diferenca" && a.magnitude !== b.magnitude) return b.magnitude - a.magnitude;
      if (ordemItem === "dif_picking" && aPick !== bPick) return bPick - aPick;
      if (ordemItem === "dif_pbl" && aPbl !== bPbl) return bPbl - aPbl;
      if (ordemItem === "dif_total" && (aPick + aPbl) !== (bPick + bPbl)) return (bPick + bPbl) - (aPick + aPbl);
      return a.item.sku.localeCompare(b.item.sku);
    });
  }, [itensComputados, filtroItemProd, filtroItemStatus, filtroItemLocal, ordemItem]);

  // Volta para a 1ª página quando o filtro/tamanho muda
  useEffect(() => { setPageItens(0); }, [filtroItemProd, filtroItemStatus, filtroItemLocal, ordemItem, sizeItens]);

  const itensPagina = useMemo((): ItemRow[] => {
    const pageCount = Math.max(1, Math.ceil(itensFiltrados.length / sizeItens));
    const p = Math.min(pageItens, pageCount - 1);
    return itensFiltrados.slice(p * sizeItens, p * sizeItens + sizeItens);
  }, [itensFiltrados, pageItens, sizeItens]);

  // Quantidade convergente por (posicao, sku) — base para comparação WMS
  const contadoPorPS = useMemo(() => {
    const byPP = new Map<string, Map<number, number>>();
    for (const l of linhasAnalisadas) {
      const k = `${l.codigo_posicao}|${l.sku}`;
      const m = byPP.get(k) ?? new Map();
      m.set(l.numero_contagem, (m.get(l.numero_contagem) ?? 0) + l.quantidade);
      byPP.set(k, m);
    }
    const out = new Map<string, { qtd: number; convergente: boolean }>();
    for (const [k, m] of byPP) {
      const confirmado = valorConfirmado(m);
      out.set(k, { qtd: confirmado ?? 0, convergente: confirmado !== null });
    }
    return out;
  }, [linhasAnalisadas]);

  // Divergências vs WMS: contado convergente ≠ WMS, ou posição não existe no WMS
  const divergenciasWms = useMemo(() => {
    const set = new Set<string>();
    if (wmsMap.size === 0) return set;
    for (const [k, info] of contadoPorPS) {
      const wms = wmsMap.get(k);
      if (wms === undefined) { set.add(k); continue; }
      if (info.convergente && info.qtd !== wms) set.add(k);
    }
    return set;
  }, [contadoPorPS, wmsMap]);

  // SKU bipado em posição onde WMS não tem este SKU, mas tem em posição compatível
  const foraDoLugar = useMemo(() => {
    const map = new Map<string, string[]>();
    if (skuPositions.size === 0) return map;
    for (const [k, info] of contadoPorPS) {
      const [pos, sku] = k.split("|");
      const wmsPosicoes = skuPositions.get(sku);
      if (!wmsPosicoes || wmsPosicoes.size === 0) continue;
      if (wmsPosicoes.has(pos)) continue;
      if (info.qtd === 0) continue;
      const contadaPbl = isPosicaoPbl(pos);
      const compativeis = Array.from(wmsPosicoes).filter((p) =>
        contadaPbl ? isPosicaoPbl(p) : isPosicaoNormal(p),
      );
      if (compativeis.length === 0) continue;
      map.set(k, compativeis.sort());
    }
    return map;
  }, [contadoPorPS, skuPositions]);

  // Fracionamento em picking de caixa fechada: posições de picking cuja qtd confirmada
  // NÃO é múltiplo do master (embal). Caixa fechada = WMS guarda caixas inteiras (un % embal == 0).
  const fracionamentoPicking = useMemo(() => {
    const out: { pos: string; sku: string; descricao: string; qtd: number; embal: number; caixas: number; fracao: number }[] = [];
    if (wmsEmbal.size === 0) return out;
    const desc = new Map<string, string>();
    for (const l of linhasAnalisadas) if (!desc.has(l.sku) && l.descricao) desc.set(l.sku, l.descricao);
    for (const [k, info] of contadoPorPS) {
      if (!info.convergente || info.qtd <= 0) continue; // só quantidades confirmadas/positivas
      const sep = k.indexOf("|");
      const pos = k.slice(0, sep);
      const sku = k.slice(sep + 1);
      if (!isPosicaoNormal(pos)) continue; // só picking (rua 001–899, nível 01)
      const embal = wmsEmbal.get(k) ?? 0;
      if (embal <= 1) continue;
      const wmsUn = wmsMap.get(k);
      if (wmsUn === undefined || wmsUn <= 0 || wmsUn % embal !== 0) continue; // caixa fechada confirmada pelo WMS
      if (info.qtd % embal === 0) continue; // múltiplo do master → ok
      out.push({ pos, sku, descricao: desc.get(sku) ?? "", qtd: info.qtd, embal, caixas: Math.floor(info.qtd / embal), fracao: info.qtd % embal });
    }
    return out.sort((a, b) => a.pos.localeCompare(b.pos));
  }, [contadoPorPS, wmsEmbal, wmsMap, linhasAnalisadas]);

  const skusFracionados = useMemo(() => new Set(fracionamentoPicking.map((f) => f.sku)), [fracionamentoPicking]);


  // Recontagens pendentes: solicitação ainda não atendida
  const recontagensPendentes = useMemo(() => {
    const maxContPorPS = new Map<string, number>();
    for (const l of linhasAnalisadas) {
      const k = `${l.codigo_posicao}|${l.sku}`;
      maxContPorPS.set(k, Math.max(maxContPorPS.get(k) ?? 0, l.numero_contagem));
    }
    const pend = new Map<string, { id: string; numero_contagem_origem: number }>();
    for (const r of recontagens) {
      const k = `${r.codigo_posicao}|${r.codigo_produto}`;
      const max = maxContPorPS.get(k) ?? 0;
      if (max <= r.numero_contagem_origem) pend.set(k, { id: r.id, numero_contagem_origem: r.numero_contagem_origem });
    }
    return pend;
  }, [recontagens, linhas]);

  /* ── Cobertura: posições não contadas / falta 2ª contagem ──────── */
  const cobertura = useMemo(() => {
    // rodadas de contagem presentes por posição
    const roundsPorPosicao = new Map<string, Set<number>>();
    for (const l of linhasAnalisadas) {
      const s = roundsPorPosicao.get(l.codigo_posicao) ?? new Set<number>();
      s.add(l.numero_contagem);
      roundsPorPosicao.set(l.codigo_posicao, s);
    }
    // SKUs esperados por posição (do WMS)
    const wmsPorPosicao = new Map<string, { sku: string; qtd: number }[]>();
    for (const [k, qtd] of wmsMap) {
      const sep = k.indexOf("|");
      const pos = k.slice(0, sep);
      const sku = k.slice(sep + 1);
      const arr = wmsPorPosicao.get(pos) ?? [];
      arr.push({ sku, qtd });
      wmsPorPosicao.set(pos, arr);
    }
    const universo = new Set<string>([...wmsPorPosicao.keys(), ...roundsPorPosicao.keys()]);

    type PosPend = { pos: string; rounds: number[]; itensWms: { sku: string; qtd: number }[]; pbl: boolean };
    const naoContadas: PosPend[] = [];
    const faltaSegunda: PosPend[] = [];
    for (const pos of universo) {
      const rounds = Array.from(roundsPorPosicao.get(pos) ?? []).sort((a, b) => a - b);
      const maxRound = rounds.length ? rounds[rounds.length - 1] : 0;
      const itensWms = (wmsPorPosicao.get(pos) ?? []).sort((a, b) => a.sku.localeCompare(b.sku));
      const entry: PosPend = { pos, rounds, itensWms, pbl: isPosicaoPbl(pos) };
      if (maxRound === 0) {
        // Ignora posições cujo saldo esperado no WMS é 0 — nada a contar
        const saldo = itensWms.reduce((s, i) => s + i.qtd, 0);
        if (saldo > 0) naoContadas.push(entry);
      } else if (maxRound < 2) faltaSegunda.push(entry);
    }
    const sortPos = (a: PosPend, b: PosPend) => a.pos.localeCompare(b.pos);
    return {
      naoContadas: naoContadas.sort(sortPos),
      faltaSegunda: faltaSegunda.sort(sortPos),
      universo: universo.size,
      wmsConhecido: wmsMap.size > 0,
    };
  }, [linhasAnalisadas, wmsMap]);

  const stats = useMemo(() => {
    const totalUnidades = consolidado
      .filter((i) => !i.divergente)
      .reduce((sum, i) => sum + (valorConfirmado(i.contagens) ?? 0), 0);

    return {
      posicoes: new Set(linhasAnalisadas.map((l) => l.codigo_posicao)).size,
      produtos: new Set(linhasAnalisadas.map((l) => l.sku)).size,
      totalUnidades,
      naoContadas: cobertura.naoContadas.length,
      faltaSegunda: cobertura.faltaSegunda.length,
      divergencias: divergencias.length,
      divergenciasWms: divergenciasWms.size,
      foraDoLugar: foraDoLugar.size,
      fracionamento: fracionamentoPicking.length,
    };
  }, [linhasAnalisadas, consolidado, cobertura, divergencias, divergenciasWms, foraDoLugar, fracionamentoPicking]);

  /* ── Filtros ────────────────────────────────────────────────────── */

  const filtrados = useMemo(() => {
    return linhas.filter((l) => {
      const fp = filtroPos.trim().toUpperCase();
      const fr = filtroProd.trim().toUpperCase();
      const fo = filtroOp.trim().toLowerCase();
      if (fp && !l.codigo_posicao.includes(fp)) return false;
      if (fr && !(l.sku.includes(fr) || l.descricao.toUpperCase().includes(fr) || l.codigo_produto.includes(fr))) return false;
      if (fo && !(l.operador_nome ?? "").toLowerCase().includes(fo)) return false;
      if (soDivergentes) {
        const k = `${l.codigo_posicao}|${l.sku}`;
        if (!divergenciasSet.has(k) && !divergenciasWms.has(k) && !foraDoLugar.has(k)) return false;
      }
      return true;
    });
  }, [linhas, filtroPos, filtroProd, filtroOp, soDivergentes, divergenciasSet, divergenciasWms, foraDoLugar]);

  useEffect(() => { setPageLeituras(0); }, [filtroPos, filtroProd, filtroOp, soDivergentes, sizeLeituras]);

  const leiturasPagina = useMemo(() => {
    const pageCount = Math.max(1, Math.ceil(filtrados.length / sizeLeituras));
    const p = Math.min(pageLeituras, pageCount - 1);
    return filtrados.slice(p * sizeLeituras, p * sizeLeituras + sizeLeituras);
  }, [filtrados, pageLeituras, sizeLeituras]);

  /* ── Ações ──────────────────────────────────────────────────────── */

  async function sincronizar() {
    if (sincronizando) return;
    setSincronizando(true);
    try {
      const r = await sincronizarWms({ data: { inventarioId: id } });
      toast.success(`WMS sincronizado: ${r.posicoes} posições, ${r.total_inserido} registros`);
      const wmsData = await fetchWmsSnapshot(id);
      const { wm, sp, embal } = construirMapasWms(wmsData);
      setWmsMap(wm);
      setSkuPositions(sp);
      setWmsEmbal(embal);
      setInv((p) => p ? { ...p, wms_sincronizado_em: r.sincronizado_em } : p);
    } catch (err: any) {
      toast.error(`Falha ao sincronizar WMS: ${err.message ?? err}`);
    } finally {
      setSincronizando(false);
    }
  }

  async function deletarLeitura(leituraId: string) {
    const { error } = await supabase.from("leituras").delete().eq("id", leituraId);
    if (error) { toast.error(error.message); return; }
    setLinhas((prev) => prev.filter((l) => l.id !== leituraId));
    setDeletandoId(null);
    toast.success("Leitura removida");
  }

  function iniciarEdicao(l: Linha) {
    if (!isAdmin) { toast.error("Faça login como supervisor para editar"); return; }
    setEditandoId(l.id);
    setEditValor(String(l.quantidade));
    setDeletandoId(null);
  }

  async function salvarEdicao(l: Linha) {
    const cleaned = editValor.replace(",", ".").trim();
    const novo = Number(cleaned);
    if (!Number.isFinite(novo) || novo < 0) { toast.error("Quantidade inválida"); return; }
    if (novo === l.quantidade) { setEditandoId(null); return; }
    setSalvandoId(l.id);
    const { error } = await supabase.from("leituras").update({ quantidade: novo }).eq("id", l.id);
    setSalvandoId(null);
    if (error) { toast.error(error.message); return; }
    setLinhas((prev) => prev.map((x) => x.id === l.id ? { ...x, quantidade: novo } : x));
    setEditandoId(null);
    toast.success(`Quantidade atualizada: ${l.quantidade} → ${novo}`);
  }

  async function solicitarRecontagem(l: Linha) {
    if (!isAdmin) { toast.error("Faça login como supervisor"); return; }
    setSolicitandoId(l.id);
    const { data, error } = await supabase
      .from("recontagens_solicitadas")
      .insert({
        inventario_id: id,
        codigo_posicao: l.codigo_posicao,
        codigo_produto: l.sku,
        numero_contagem_origem: l.numero_contagem,
      })
      .select("id, codigo_posicao, codigo_produto, numero_contagem_origem")
      .single();
    setSolicitandoId(null);
    if (error) { toast.error(error.message); return; }
    if (data) setRecontagens((prev) => [...prev, data as any]);
    toast.success("Recontagem solicitada — operador verá no coletor");
  }

  function exportarCSV() {
    const header = ["posicao", "produto", "descricao", "contagem", "quantidade", "qtd_wms", "diferenca", "operador", "lido_em"];
    const rows = filtrados.map((l) => {
      const k = `${l.codigo_posicao}|${l.sku}`;
      const wms = wmsMap.get(k);
      const dif = wms !== undefined ? l.quantidade - wms : "";
      return [l.codigo_posicao, l.sku, l.descricao, l.numero_contagem, l.quantidade, wms ?? "", dif, l.operador_nome ?? "", l.lido_em];
    });
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventario-${inv?.nome ?? id}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportarXLSX() {
    const nome = `inventario-${inv?.nome ?? id}-${new Date().toISOString().slice(0, 10)}`;
    const dados = filtrados.map((l) => {
      const k = `${l.codigo_posicao}|${l.sku}`;
      const wms = wmsMap.get(k);
      return {
        Posição: l.codigo_posicao,
        "Posição (formatada)": formatPosicaoDisplay(l.codigo_posicao),
        Produto: l.sku,
        Descrição: l.descricao,
        Contagem: l.numero_contagem,
        Quantidade: l.quantidade,
        "Qtd WMS": wms ?? "",
        Diferença: wms !== undefined ? l.quantidade - wms : "",
        "Status WMS": wms === undefined ? "Não está no WMS" : wms === l.quantidade ? "OK" : l.quantidade > wms ? "Sobra" : "Falta",
        Operador: l.operador_nome ?? "",
        "Lido em": new Date(l.lido_em).toLocaleString("pt-BR"),
        "Divergência entre contagens": divergenciasSet.has(k) ? "Sim" : "",
        "Fora do lugar (posição correta WMS)": foraDoLugar.get(k)?.map(formatPosicaoDisplay).join(" | ") ?? "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leituras");
    XLSX.writeFile(wb, `${nome}.xlsx`);
  }

  function statusItem(r: ItemRow): string {
    if (r.naoContado) return "Não contado";
    if (r.pick.divergente || r.pbl.divergente) return "Contagens divergentes";
    if (r.complementar) return "Complementar (sobra ⇄ falta)";
    const dp = r.pick.delta ?? 0;
    const db = r.pbl.delta ?? 0;
    if (dp === 0 && db === 0) return "OK";
    if ((dp > 0 || db > 0) && (dp < 0 || db < 0)) return "Sobra e falta";
    if (dp > 0 || db > 0) return "Sobra";
    return "Falta";
  }

  function exportarItensXLSX() {
    const wmsLoaded = wmsMap.size > 0;
    // Espelha exatamente as colunas da tabela "Por Item" (incluindo Δ Total).
    const dados = itensFiltrados.map((r) => {
      const { item, pick, pbl } = r;
      const row: Record<string, string | number> = {
        Produto: item.sku,
        Descrição: item.descricao,
      };
      if (wmsLoaded) row["Picking esperado (WMS)"] = item.pickingWms;
      for (let c = 1; c <= maxContagem; c++) row[`Picking ${c}ª ctg`] = item.pickingContagens.get(c) ?? "";
      if (wmsLoaded) row["Picking Δ"] = pick.divergente ? "divergente" : pick.delta ?? "";
      if (wmsLoaded) row["PBL esperado (WMS)"] = item.pblWms;
      for (let c = 1; c <= maxContagem; c++) row[`PBL ${c}ª ctg`] = item.pblContagens.get(c) ?? "";
      if (wmsLoaded) row["PBL Δ"] = pbl.divergente ? "divergente" : pbl.delta ?? "";
      if (wmsLoaded) {
        const semQualquer = item.pickingContagens.size === 0 && item.pblContagens.size === 0;
        row["Δ Total"] = semQualquer
          ? ""
          : pick.divergente || pbl.divergente
            ? "divergente"
            : (pick.delta ?? 0) + (pbl.delta ?? 0);
        const outras = outrasPosicoesPorSku.get(item.sku);
        row["Outras posições (qtd)"] = outras?.total ?? "";
        row["Outras posições (fora da análise)"] = outras?.totalForaAnalise ?? "";
        row["Outras posições (detalhe)"] = outras
          ? outras.posicoes.map((p) => `${formatPosicaoDisplay(p.pos)}: ${p.qtd}${p.foraAnalise ? " (fora)" : ""}`).join(" | ")
          : "";
      }
      row["Status"] = statusItem(r);
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Por Item");
    XLSX.writeFile(wb, `analise-itens-${inv?.nome ?? id}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportarNaoContadas() {
    const dados = cobertura.naoContadas.map((p) => ({
      Posição: formatPosicaoDisplay(p.pos),
      "Posição (código)": p.pos,
      Local: p.pbl ? "PBL" : "Picking",
      "Itens esperados (WMS)": p.itensWms.map((i) => i.sku).join(", "),
    }));
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pendentes 1a contagem");
    XLSX.writeFile(wb, `pendentes-1a-contagem-${inv?.nome ?? id}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportarFaltaSegunda() {
    const dados = cobertura.faltaSegunda.map((p) => ({
      Posição: formatPosicaoDisplay(p.pos),
      "Posição (código)": p.pos,
      Local: p.pbl ? "PBL" : "Picking",
      "Contagens feitas": p.rounds.map((r) => `${r}ª`).join(", "),
      "Itens esperados (WMS)": p.itensWms.map((i) => i.sku).join(", "),
    }));
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Falta 2a contagem");
    XLSX.writeFile(wb, `falta-2a-contagem-${inv?.nome ?? id}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportarDivergentes() {
    // Só endereço e código do produto — relatório vai para os operadores recontarem.
    const dados = divergencias.map((item) => ({
      Posição: formatPosicaoDisplay(item.codigo_posicao),
      "Posição (código)": item.codigo_posicao,
      Produto: item.sku,
      Descrição: item.descricao,
    }));
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contagens divergentes");
    XLSX.writeFile(wb, `contagens-divergentes-${inv?.nome ?? id}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportarFracionamento() {
    const dados = fracionamentoPicking.map((f) => ({
      Posição: formatPosicaoDisplay(f.pos),
      "Posição (código)": f.pos,
      Produto: f.sku,
      Descrição: f.descricao,
      "Qtd contada": f.qtd,
      "Master (caixa)": f.embal,
      "Caixas cheias": f.caixas,
      "Fração (sobra solta)": f.fracao,
    }));
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fracionamento picking");
    XLSX.writeFile(wb, `fracionamento-picking-${inv?.nome ?? id}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function encerrar() {
    if (confirmTexto.trim().toUpperCase() !== "ENCERRAR") { toast.error("Digite ENCERRAR para confirmar"); return; }
    const { error } = await supabase
      .from("inventarios")
      .update({ status: "encerrado", encerrado_em: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Inventário encerrado");
    setConfirmandoEncerrar(false);
    setInv((p) => p ? { ...p, status: "encerrado" } : p);
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate({ to: "/inventarios" })}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate leading-tight">{inv?.nome}</p>
            <div className="flex items-center gap-2">
              {inv?.status === "encerrado" && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Encerrado</Badge>}
              {inv?.wms_sincronizado_em && (
                <span className="text-[10px] text-muted-foreground">
                  WMS: {new Date(inv.wms_sincronizado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
              <Button onClick={sincronizar} disabled={sincronizando} variant="outline" size="sm" className="gap-1.5" title="Sincronizar estoque do WMS">
                <RefreshCw className={`h-4 w-4 ${sincronizando ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">WMS</span>
              </Button>
            )}
            <Button onClick={exportarXLSX} variant="outline" size="sm" className="gap-1.5 hidden sm:flex">
              <FileSpreadsheet className="h-4 w-4" /> XLSX
            </Button>
            <Button onClick={exportarCSV} variant="outline" size="sm" className="gap-1.5 hidden sm:flex">
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button onClick={exportarXLSX} variant="outline" size="icon" className="h-8 w-8 sm:hidden">
              <FileSpreadsheet className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* ── KPIs ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <BarChart2 className="h-3.5 w-3.5" /> Posições contadas
            </p>
            <p className="text-3xl font-bold tabular-nums">{stats.posicoes}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {stats.produtos} produtos · {stats.totalUnidades.toLocaleString("pt-BR")} un.
            </p>
          </div>

          <div className={`rounded-xl border p-4 ${stats.naoContadas > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card"}`}>
            <p className={`text-xs mb-1 flex items-center gap-1.5 ${stats.naoContadas > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
              <PackageX className="h-3.5 w-3.5" /> Não contadas
            </p>
            <p className={`text-3xl font-bold tabular-nums ${stats.naoContadas > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {cobertura.wmsConhecido ? stats.naoContadas : "—"}
            </p>
            {!cobertura.wmsConhecido && <p className="text-[10px] text-muted-foreground mt-1">Sincronize o WMS</p>}
          </div>

          <div className={`rounded-xl border p-4 ${stats.faltaSegunda > 0 ? "border-sky-500/40 bg-sky-500/5" : "border-border bg-card"}`}>
            <p className={`text-xs mb-1 flex items-center gap-1.5 ${stats.faltaSegunda > 0 ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}`}>
              <Layers className="h-3.5 w-3.5" /> Falta 2ª contagem
            </p>
            <p className={`text-3xl font-bold tabular-nums ${stats.faltaSegunda > 0 ? "text-sky-600 dark:text-sky-400" : ""}`}>
              {stats.faltaSegunda}
            </p>
          </div>

          <div className={`rounded-xl border p-4 ${stats.divergencias > 0 ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}>
            <p className={`text-xs mb-1 flex items-center gap-1.5 ${stats.divergencias > 0 ? "text-destructive" : "text-muted-foreground"}`}>
              <AlertTriangle className="h-3.5 w-3.5" /> Entre contagens
            </p>
            <p className={`text-3xl font-bold tabular-nums ${stats.divergencias > 0 ? "text-destructive" : ""}`}>
              {stats.divergencias}
            </p>
            {stats.divergencias === 0 && consolidado.length > 0 && (
              <p className="text-[10px] text-emerald-600 mt-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Tudo confirmado
              </p>
            )}
          </div>

          <div className={`rounded-xl border p-4 ${stats.divergenciasWms > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card"}`}>
            <p className={`text-xs mb-1 flex items-center gap-1.5 ${stats.divergenciasWms > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
              <AlertTriangle className="h-3.5 w-3.5" /> vs WMS
            </p>
            <p className={`text-3xl font-bold tabular-nums ${stats.divergenciasWms > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {wmsMap.size === 0 ? "—" : stats.divergenciasWms}
            </p>
          </div>

          <div className={`rounded-xl border p-4 ${stats.foraDoLugar > 0 ? "border-violet-500/40 bg-violet-500/5" : "border-border bg-card"}`}>
            <p className={`text-xs mb-1 flex items-center gap-1.5 ${stats.foraDoLugar > 0 ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"}`}>
              <MapPin className="h-3.5 w-3.5" /> Fora do lugar
            </p>
            <p className={`text-3xl font-bold tabular-nums ${stats.foraDoLugar > 0 ? "text-violet-600 dark:text-violet-400" : ""}`}>
              {wmsMap.size === 0 ? "—" : stats.foraDoLugar}
            </p>
          </div>
        </div>

        {/* ── Tabs de análise ────────────────────────────────────── */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <Tabs defaultValue="itens">
            <TabsList className="flex-wrap h-auto gap-1 mb-4">
              <TabsTrigger value="itens">
                Por Item
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">{analisePorItem.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pendencias">
                Pendências
                {stats.naoContadas + stats.faltaSegunda + stats.divergencias + stats.fracionamento > 0 ? (
                  <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">
                    {stats.naoContadas + stats.faltaSegunda + stats.divergencias + stats.fracionamento}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">0</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="leituras">Leituras Brutas</TabsTrigger>
            </TabsList>

            {/* ── Por Item (Picking vs PBL) ──────────────────────── */}
            <TabsContent value="itens" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Totais por SKU separados por local. Linhas em roxo indicam divergência complementar — sobra num local que pode corresponder à falta no outro.
              </p>
              <div className="flex gap-3 flex-wrap items-center">
                <Input
                  placeholder="Filtrar produto / descrição"
                  value={filtroItemProd}
                  onChange={(e) => setFiltroItemProd(e.target.value)}
                  className="max-w-xs h-8 text-sm"
                />
                <Button
                  onClick={() => setFiltroItemStatus(filtroItemStatus === "divergente" ? "todos" : "divergente")}
                  variant={filtroItemStatus === "divergente" ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 h-8"
                  title="Mostrar só itens com divergência entre contagens"
                >
                  <AlertTriangle className="h-4 w-4" /> Entre contagens
                  <Badge variant="secondary" className="ml-0.5 text-[10px] px-1.5 py-0 h-4">
                    {itensComputados.filter((r) => r.pick.divergente || r.pbl.divergente).length}
                  </Badge>
                </Button>
                <Select value={filtroItemStatus} onValueChange={(v) => setFiltroItemStatus(v as typeof filtroItemStatus)}>
                  <SelectTrigger className="h-8 w-[210px] text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os itens</SelectItem>
                    <SelectItem value="diferenca">Com qualquer diferença</SelectItem>
                    <SelectItem value="complementar">Complementares (sobra ⇄ falta)</SelectItem>
                    <SelectItem value="sobra">Com sobra (vs WMS)</SelectItem>
                    <SelectItem value="falta">Com falta (vs WMS)</SelectItem>
                    <SelectItem value="divergente">Entre contagens (divergentes)</SelectItem>
                    <SelectItem value="naocontado">Não contados (esperados no WMS)</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filtroItemLocal} onValueChange={(v) => setFiltroItemLocal(v as typeof filtroItemLocal)}>
                  <SelectTrigger className="h-8 w-[140px] text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ambos">Picking e PBL</SelectItem>
                    <SelectItem value="picking">Só Picking</SelectItem>
                    <SelectItem value="pbl">Só PBL</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={ordemItem} onValueChange={(v) => setOrdemItem(v as typeof ordemItem)}>
                  <SelectTrigger className="h-8 w-[220px] text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sku">Ordenar por produto</SelectItem>
                    <SelectItem value="diferenca">Maior diferença (geral)</SelectItem>
                    <SelectItem value="dif_total">Maior Δ total (|pick|+|pbl|)</SelectItem>
                    <SelectItem value="dif_picking">Maior Δ no Picking</SelectItem>
                    <SelectItem value="dif_pbl">Maior Δ no PBL</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={exportarItensXLSX} variant="outline" size="sm" className="gap-1.5 h-8" title="Exporta todos os itens filtrados (não só a página)">
                  <FileSpreadsheet className="h-4 w-4" /> Exportar
                </Button>
              </div>
              <Paginacao page={pageItens} pageSize={sizeItens} total={itensFiltrados.length} onPage={setPageItens} onPageSize={setSizeItens} />
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm table-fixed">
                    <thead className="bg-secondary/60">
                      <tr>
                        <th rowSpan={2} className="px-2 py-2 text-left text-xs font-semibold text-foreground/90 uppercase tracking-wide align-bottom border-b border-border w-[110px]">Produto</th>
                        <th rowSpan={2} className="px-2 py-2 text-left text-xs font-semibold text-foreground/90 uppercase tracking-wide align-bottom border-b border-border w-[180px]">Descrição</th>
                        <th
                          colSpan={wmsMap.size > 0 ? maxContagem + 2 : maxContagem}
                          className="px-2 py-1.5 text-center text-[11px] font-bold text-blue-600 dark:text-blue-300 border-l border-border border-b border-border/40 uppercase tracking-wider"
                        >
                          Picking
                        </th>
                        <th
                          colSpan={wmsMap.size > 0 ? maxContagem + 2 : maxContagem}
                          className="px-2 py-1.5 text-center text-[11px] font-bold text-emerald-600 dark:text-emerald-300 border-l border-border border-b border-border/40 uppercase tracking-wider"
                        >
                          PBL (995)
                        </th>
                        {wmsMap.size > 0 && (
                          <th
                            rowSpan={2}
                            className="px-1.5 py-2 text-center text-[11px] font-bold text-violet-600 dark:text-violet-300 border-l-2 border-border border-b border-border align-bottom uppercase tracking-wider w-[64px]"
                          >
                            Δ Total
                          </th>
                        )}
                        {wmsMap.size > 0 && (
                          <th
                            rowSpan={2}
                            title="Saldo deste SKU contado em posições onde o WMS não o espera (inclui aéreas/técnica fora da análise)"
                            className="px-1.5 py-2 text-center text-[11px] font-bold text-fuchsia-600 dark:text-fuchsia-300 border-l border-border border-b border-border align-bottom uppercase tracking-wider w-[92px]"
                          >
                            Outras pos.
                          </th>
                        )}
                      </tr>
                      <tr className="border-b border-border">
                        {wmsMap.size > 0 && (
                          <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-foreground/60 uppercase whitespace-nowrap border-l border-border w-[52px]">Esp</th>
                        )}
                        {Array.from({ length: maxContagem }, (_, i) => i + 1).map((c) => (
                          <th key={c} className={`px-1.5 py-1.5 text-right text-[10px] font-semibold text-foreground/60 uppercase whitespace-nowrap w-[48px] ${wmsMap.size === 0 && c === 1 ? "border-l border-border" : ""}`}>
                            {c}ª
                          </th>
                        ))}
                        {wmsMap.size > 0 && (
                          <th className="px-1.5 py-1.5 text-right text-[10px] font-bold text-blue-500 dark:text-blue-300 uppercase w-[54px]">Δ</th>
                        )}
                        {wmsMap.size > 0 && (
                          <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-foreground/60 uppercase whitespace-nowrap border-l border-border w-[52px]">Esp</th>
                        )}
                        {Array.from({ length: maxContagem }, (_, i) => i + 1).map((c) => (
                          <th key={c} className={`px-1.5 py-1.5 text-right text-[10px] font-semibold text-foreground/60 uppercase whitespace-nowrap w-[48px] ${wmsMap.size === 0 && c === 1 ? "border-l border-border" : ""}`}>
                            {c}ª
                          </th>
                        ))}
                        {wmsMap.size > 0 && (
                          <th className="px-1.5 py-1.5 text-right text-[10px] font-bold text-emerald-500 dark:text-emerald-300 uppercase w-[54px]">Δ</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {itensPagina.map(({ item, pick, pbl, complementar, naoContado }) => {
                        const wmsLoaded = wmsMap.size > 0;
                        const deltaCell = (delta: number | null, divergente: boolean, semContagem: boolean) => {
                          if (semContagem) return <span className="text-muted-foreground/50 text-xs">—</span>;
                          if (divergente) return <span title="Contagens divergentes"><AlertTriangle className="inline h-3.5 w-3.5 text-amber-500" /></span>;
                          if (delta === null) return <span className="text-muted-foreground/50 text-xs">—</span>;
                          if (delta === 0) return <span className="text-emerald-500 font-bold">0</span>;
                          return <span className={`font-bold ${delta > 0 ? "text-emerald-500" : "text-destructive"}`}>{delta > 0 ? `+${delta}` : delta}</span>;
                        };
                        const deltaTotal = (pick.delta ?? 0) + (pbl.delta ?? 0);
                        const semQualquer = item.pickingContagens.size === 0 && item.pblContagens.size === 0;
                        return (
                          <tr key={item.sku} className={complementar ? "bg-violet-500/10 hover:bg-violet-500/15" : "hover:bg-muted/30"}>
                            <td className="px-2 py-1.5 font-mono text-[11px] font-semibold text-foreground truncate" title={item.sku}>
                              <div className="flex items-center gap-1">
                                <span className="truncate">{item.sku}</span>
                                {complementar && (
                                  <span className="text-[9px] px-1 rounded bg-violet-500/20 text-violet-300 font-sans font-semibold shrink-0">⇄</span>
                                )}
                                {naoContado && (
                                  <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 font-sans font-medium shrink-0">novo</span>
                                )}
                                {skusFracionados.has(item.sku) && (
                                  <span title="Quantidade em picking de caixa fechada não é múltiplo do master (produto fracionado — corrigir)" className="text-[9px] px-1 rounded bg-rose-500/20 text-rose-400 font-sans font-semibold shrink-0">fração</span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-[11px] text-foreground/70 truncate" title={item.descricao}>
                              {item.descricao || <span className="italic text-muted-foreground/50">—</span>}
                            </td>
                            {/* Picking */}
                            {wmsLoaded && (
                              <td className="px-1.5 py-1.5 text-right tabular-nums text-[11px] text-foreground/60 border-l border-border">
                                {item.pickingWms > 0 ? item.pickingWms : <span className="text-muted-foreground/40">—</span>}
                              </td>
                            )}
                            {Array.from({ length: maxContagem }, (_, i) => i + 1).map((c) => (
                              <td key={c} className={`px-1.5 py-1.5 text-right tabular-nums text-xs font-semibold ${!wmsLoaded && c === 1 ? "border-l border-border" : ""} ${pick.divergente ? "text-amber-500" : "text-foreground"}`}>
                                {item.pickingContagens.has(c) ? item.pickingContagens.get(c) : <span className="text-muted-foreground/40 font-normal">—</span>}
                              </td>
                            ))}
                            {wmsLoaded && (
                              <td className="px-1.5 py-1.5 text-right tabular-nums text-xs bg-blue-500/10">
                                {deltaCell(pick.delta, pick.divergente, item.pickingContagens.size === 0)}
                              </td>
                            )}
                            {/* PBL */}
                            {wmsLoaded && (
                              <td className="px-1.5 py-1.5 text-right tabular-nums text-[11px] text-foreground/60 border-l border-border">
                                {item.pblWms > 0 ? item.pblWms : <span className="text-muted-foreground/40">—</span>}
                              </td>
                            )}
                            {Array.from({ length: maxContagem }, (_, i) => i + 1).map((c) => (
                              <td key={c} className={`px-1.5 py-1.5 text-right tabular-nums text-xs font-semibold ${!wmsLoaded && c === 1 ? "border-l border-border" : ""} ${pbl.divergente ? "text-amber-500" : "text-foreground"}`}>
                                {item.pblContagens.has(c) ? item.pblContagens.get(c) : <span className="text-muted-foreground/40 font-normal">—</span>}
                              </td>
                            ))}
                            {wmsLoaded && (
                              <td className="px-1.5 py-1.5 text-right tabular-nums text-xs bg-emerald-500/10">
                                {deltaCell(pbl.delta, pbl.divergente, item.pblContagens.size === 0)}
                              </td>
                            )}
                            {/* Δ Total */}
                            {wmsLoaded && (
                              <td className="px-1.5 py-1.5 text-right tabular-nums text-xs border-l-2 border-border bg-violet-500/10">
                                {semQualquer ? (
                                  <span className="text-muted-foreground/50 text-xs">—</span>
                                ) : pick.divergente || pbl.divergente ? (
                                  <span title="Contagens divergentes"><AlertTriangle className="inline h-3.5 w-3.5 text-amber-500" /></span>
                                ) : deltaTotal === 0 ? (
                                  <span className="text-emerald-500 font-bold">0</span>
                                ) : (
                                  <span className={`font-bold ${deltaTotal > 0 ? "text-emerald-500" : "text-destructive"}`}>
                                    {deltaTotal > 0 ? `+${deltaTotal}` : deltaTotal}
                                  </span>
                                )}
                              </td>
                            )}
                            {/* Saldo em outras posições (não esperadas pelo WMS) */}
                            {wmsLoaded && (() => {
                              const outras = outrasPosicoesPorSku.get(item.sku);
                              if (!outras || outras.total <= 0) {
                                return <td className="px-1.5 py-1.5 text-right text-xs border-l border-border text-muted-foreground/40">—</td>;
                              }
                              const detalhe = outras.posicoes
                                .map((p) => `${formatPosicaoDisplay(p.pos)}: ${p.qtd}${p.foraAnalise ? " (fora da análise)" : ""}`)
                                .join("\n");
                              return (
                                <td className="px-1.5 py-1.5 text-right tabular-nums text-xs border-l border-border" title={detalhe}>
                                  <span className="font-bold text-fuchsia-600 dark:text-fuchsia-400">+{outras.total}</span>
                                  {outras.totalForaAnalise > 0 && (
                                    <span className="block text-[9px] text-fuchsia-500/80 leading-tight" title="Quantidade em posições aéreas/técnica, descartadas da análise">
                                      {outras.totalForaAnalise} fora
                                    </span>
                                  )}
                                </td>
                              );
                            })()}
                          </tr>
                        );
                      })}
                      {itensFiltrados.length === 0 && (
                        <tr>
                          <td colSpan={99} className="px-3 py-10 text-center text-muted-foreground text-sm">
                            Nenhum item encontrado
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <Paginacao page={pageItens} pageSize={sizeItens} total={itensFiltrados.length} onPage={setPageItens} onPageSize={setSizeItens} />
            </TabsContent>

            {/* ── Pendências ─────────────────────────────────────── */}
            <TabsContent value="pendencias" className="space-y-6">
              {stats.naoContadas === 0 && stats.faltaSegunda === 0 && stats.divergencias === 0 && stats.fracionamento === 0 ? (
                <div className="rounded-xl border border-border bg-card p-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Nenhuma pendência</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Todas as posições foram contadas ao menos duas vezes e as contagens batem.
                  </p>
                </div>
              ) : (
                <>
                  {/* Não contadas */}
                  <section className="space-y-2">
                    <div className="flex items-center gap-2">
                      <PackageX className="h-4 w-4 text-amber-500" />
                      <h3 className="text-sm font-semibold">Posições não contadas</h3>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{cobertura.naoContadas.length}</Badge>
                      <Button
                        onClick={exportarNaoContadas}
                        disabled={cobertura.naoContadas.length === 0}
                        variant="outline" size="sm" className="ml-auto gap-1.5 h-8"
                        title="Exporta pendentes de 1ª contagem (ignora saldo WMS 0)"
                      >
                        <FileSpreadsheet className="h-4 w-4" /> Exportar
                      </Button>
                    </div>
                    {!cobertura.wmsConhecido ? (
                      <p className="text-xs text-muted-foreground">
                        Sincronize o WMS para saber quais posições com estoque ainda não foram contadas.
                      </p>
                    ) : cobertura.naoContadas.length === 0 ? (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">Todas as posições do WMS foram visitadas.</p>
                    ) : (
                      <div className="rounded-xl border border-amber-500/30 overflow-hidden">
                        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-amber-500/10 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Posição</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Local</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Esperado no WMS</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {cobertura.naoContadas.map((p) => (
                                <tr key={p.pos} className="hover:bg-amber-500/5">
                                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatPosicaoDisplay(p.pos)}</td>
                                  <td className="px-3 py-2 text-xs">
                                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 h-4 ${p.pbl ? "text-emerald-700 dark:text-emerald-400" : "text-blue-700 dark:text-blue-400"}`}>
                                      {p.pbl ? "PBL" : "Picking"}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-muted-foreground">
                                    {p.itensWms.length === 0 ? <span className="italic">—</span> : p.itensWms.map((i) => `${i.sku} (${i.qtd})`).join(", ")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Falta 2ª contagem */}
                  <section className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-sky-500" />
                      <h3 className="text-sm font-semibold">Falta 2ª contagem</h3>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{cobertura.faltaSegunda.length}</Badge>
                      <Button
                        onClick={exportarFaltaSegunda}
                        disabled={cobertura.faltaSegunda.length === 0}
                        variant="outline" size="sm" className="ml-auto gap-1.5 h-8"
                        title="Exporta a listagem de posições que faltam 2ª contagem"
                      >
                        <FileSpreadsheet className="h-4 w-4" /> Exportar
                      </Button>
                    </div>
                    {cobertura.faltaSegunda.length === 0 ? (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">Todas as posições contadas têm pelo menos 2 contagens.</p>
                    ) : (
                      <div className="rounded-xl border border-sky-500/30 overflow-hidden">
                        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-sky-500/10 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Posição</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Local</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Contagens feitas</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {cobertura.faltaSegunda.map((p) => (
                                <tr key={p.pos} className="hover:bg-sky-500/5">
                                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatPosicaoDisplay(p.pos)}</td>
                                  <td className="px-3 py-2 text-xs">
                                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 h-4 ${p.pbl ? "text-emerald-700 dark:text-emerald-400" : "text-blue-700 dark:text-blue-400"}`}>
                                      {p.pbl ? "PBL" : "Picking"}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-muted-foreground">
                                    {p.rounds.map((r) => `${r}ª`).join(", ")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Divergentes entre contagens */}
                  <section className="space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <h3 className="text-sm font-semibold">Contagens divergentes</h3>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{divergencias.length}</Badge>
                      <Button
                        onClick={exportarDivergentes}
                        disabled={divergencias.length === 0}
                        variant="outline" size="sm" className="ml-auto gap-1.5 h-8"
                        title="Exporta as posições com contagens divergentes entre rodadas"
                      >
                        <FileSpreadsheet className="h-4 w-4" /> Exportar
                      </Button>
                    </div>
                    {divergencias.length === 0 ? (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">Nenhuma divergência entre rodadas de contagem.</p>
                    ) : (
                      <div className="rounded-xl border border-destructive/30 overflow-hidden">
                        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-destructive/10 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Posição</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Produto</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Descrição</th>
                                {Array.from({ length: maxContagem }, (_, i) => i + 1).map((ctg) => (
                                  <th key={ctg} className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                                    {ctg}ª Ctg
                                  </th>
                                ))}
                                <th className="px-3 py-2 text-right text-[11px] font-medium text-destructive uppercase tracking-wide">Dif.</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {divergencias.map((item) => {
                                const vals = Array.from(item.contagens.values());
                                const diff = Math.max(...vals) - Math.min(...vals);
                                return (
                                  <tr key={`${item.codigo_posicao}|${item.sku}`} className="bg-destructive/5">
                                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatPosicaoDisplay(item.codigo_posicao)}</td>
                                    <td className="px-3 py-2 font-mono text-xs font-medium">{item.sku}</td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate hidden md:table-cell" title={item.descricao}>
                                      {item.descricao || <span className="italic">—</span>}
                                    </td>
                                    {Array.from({ length: maxContagem }, (_, i) => i + 1).map((ctg) => (
                                      <td key={ctg} className="px-3 py-2 text-right tabular-nums font-bold">
                                        {item.contagens.has(ctg) ? item.contagens.get(ctg) : <span className="text-muted-foreground/40">—</span>}
                                      </td>
                                    ))}
                                    <td className="px-3 py-2 text-right font-bold tabular-nums text-destructive">±{diff}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Fracionamento em picking de caixa fechada */}
                  <section className="space-y-2">
                    <div className="flex items-center gap-2">
                      <PackageX className="h-4 w-4 text-rose-500" />
                      <h3 className="text-sm font-semibold">Fracionamento (picking caixa fechada)</h3>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{fracionamentoPicking.length}</Badge>
                      <Button
                        onClick={exportarFracionamento}
                        disabled={fracionamentoPicking.length === 0}
                        variant="outline" size="sm" className="ml-auto gap-1.5 h-8"
                        title="Exporta posições de picking caixa-fechada cuja quantidade não é múltiplo do master"
                      >
                        <FileSpreadsheet className="h-4 w-4" /> Exportar
                      </Button>
                    </div>
                    {wmsMap.size === 0 ? (
                      <p className="text-xs text-muted-foreground">Sincronize o WMS para identificar fracionamento.</p>
                    ) : fracionamentoPicking.length === 0 ? (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">Nenhum fracionamento em picking de caixa fechada.</p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Quantidade contada que <strong>não é múltiplo do master</strong> — proibido em caixa fechada. Corrigir sistemicamente ou fisicamente.
                        </p>
                        <div className="rounded-xl border border-rose-500/30 overflow-hidden">
                          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-rose-500/10 sticky top-0">
                                <tr>
                                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Posição</th>
                                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Produto</th>
                                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Descrição</th>
                                  <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Qtd</th>
                                  <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">Master</th>
                                  <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">Caixas</th>
                                  <th className="px-3 py-2 text-right text-[11px] font-medium text-rose-600 dark:text-rose-400 uppercase tracking-wide whitespace-nowrap">Fração</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/50">
                                {fracionamentoPicking.map((f) => (
                                  <tr key={`${f.pos}|${f.sku}`} className="bg-rose-500/5">
                                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatPosicaoDisplay(f.pos)}</td>
                                    <td className="px-3 py-2 font-mono text-xs font-medium">{f.sku}</td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate hidden md:table-cell" title={f.descricao}>
                                      {f.descricao || <span className="italic">—</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums font-bold">{f.qtd}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{f.embal}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{f.caixas}</td>
                                    <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-600 dark:text-rose-400">+{f.fracao}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    )}
                  </section>
                </>
              )}
            </TabsContent>

            {/* ── Leituras Brutas ────────────────────────────────── */}
            <TabsContent value="leituras" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Registros brutos — uma linha por scan. Use a aba Por Item para a visão analítica.
              </p>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 flex-1">
                  <Input placeholder="Filtrar posição" value={filtroPos} onChange={(e) => setFiltroPos(e.target.value)} />
                  <Input placeholder="Filtrar produto" value={filtroProd} onChange={(e) => setFiltroProd(e.target.value)} />
                  <Input placeholder="Filtrar operador" value={filtroOp} onChange={(e) => setFiltroOp(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none shrink-0">
                  <input
                    type="checkbox"
                    checked={soDivergentes}
                    onChange={(e) => setSoDivergentes(e.target.checked)}
                    className="h-3.5 w-3.5 accent-destructive"
                  />
                  Só divergentes
                </label>
              </div>
              <Paginacao page={pageLeituras} pageSize={sizeLeituras} total={filtrados.length} onPage={setPageLeituras} onPageSize={setSizeLeituras} />
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/50 border-b border-border">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Posição</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Produto</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Descrição</th>
                        <th className="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">Ctg</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Qtd</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">WMS</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Δ</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Operador</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Horário</th>
                        <th className="px-3 py-2.5 w-20" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {leiturasPagina.map((l) => {
                        const k = `${l.codigo_posicao}|${l.sku}`;
                        const div = divergenciasSet.has(k);
                        const wms = wmsMap.get(k);
                        const dif = wms !== undefined ? l.quantidade - wms : null;
                        const divWms = divergenciasWms.has(k);
                        const posCorretas = foraDoLugar.get(k);
                        const fora = !!posCorretas;
                        const confirmando = deletandoId === l.id;
                        const recPend = recontagensPendentes.has(k);
                        const solicitando = solicitandoId === l.id;
                        const editando = editandoId === l.id;
                        const salvando = salvandoId === l.id;
                        return (
                          <tr
                            key={l.id}
                            className={`${div ? "bg-destructive/8" : fora ? "bg-violet-500/8" : divWms ? "bg-amber-500/8" : "hover:bg-muted/20"} ${confirmando ? "bg-destructive/15" : ""} ${recPend ? "ring-1 ring-inset ring-sky-500/30" : ""}`}
                          >
                            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatPosicaoDisplay(l.codigo_posicao)}</td>
                            <td className="px-3 py-2 font-mono text-xs font-medium">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span>{l.sku}</span>
                                {fora && (
                                  <span
                                    className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-violet-500/15 text-violet-700 dark:text-violet-300 font-sans font-medium cursor-help"
                                    title={`WMS diz que este SKU está em: ${posCorretas!.map(formatPosicaoDisplay).join(", ")}`}
                                  >
                                    <MapPin className="h-2.5 w-2.5" /> fora do lugar
                                  </span>
                                )}
                                {recPend && (
                                  <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 font-sans font-medium">
                                    <RotateCcw className="h-2.5 w-2.5" /> recontagem pedida
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs max-w-[200px] truncate text-muted-foreground hidden md:table-cell" title={l.descricao}>
                              {l.descricao || <span className="italic">—</span>}
                            </td>
                            <td className="px-3 py-2 text-center text-xs">{l.numero_contagem}</td>
                            <td className="px-3 py-2 text-right font-semibold">
                              {editando ? (
                                <div className="flex items-center gap-1 justify-end">
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    autoFocus
                                    value={editValor}
                                    onChange={(e) => setEditValor(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") { e.preventDefault(); void salvarEdicao(l); }
                                      if (e.key === "Escape") { e.preventDefault(); setEditandoId(null); }
                                    }}
                                    className="h-7 w-20 text-right text-xs px-1"
                                    disabled={salvando}
                                  />
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" disabled={salvando} onClick={() => void salvarEdicao(l)} title="Salvar">
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" disabled={salvando} onClick={() => setEditandoId(null)} title="Cancelar">
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  {l.quantidade}
                                  {div && <AlertTriangle className="inline h-3 w-3 ml-1 text-destructive" />}
                                </>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {wmsMap.size === 0 ? <span className="text-[10px]">—</span> : wms === undefined ? <span className="text-[10px] italic">não há</span> : wms}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums font-medium ${dif === null ? "" : dif === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                              {dif === null ? "" : dif > 0 ? `+${dif}` : dif}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">{l.operador_nome ?? "—"}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums hidden lg:table-cell">
                              {new Date(l.lido_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td className="px-2 py-1 text-right">
                              {confirmando ? (
                                <div className="flex items-center gap-1 justify-end">
                                  <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" onClick={() => deletarLeitura(l.id)}>Excluir</Button>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => setDeletandoId(null)}>✕</Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-0.5 justify-end">
                                  <Button
                                    size="icon" variant="ghost"
                                    className={`h-7 w-7 ${recPend ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground hover:text-sky-600"}`}
                                    title={recPend ? "Recontagem já solicitada (aguardando operador)" : isAdmin ? "Solicitar recontagem deste item" : "Faça login como supervisor"}
                                    disabled={recPend || solicitando}
                                    onClick={() => {
                                      if (!isAdmin) { toast.error("Faça login como supervisor para solicitar recontagem"); return; }
                                      void solicitarRecontagem(l);
                                    }}
                                  >
                                    <RotateCcw className={`h-3.5 w-3.5 ${solicitando ? "animate-spin" : ""}`} />
                                  </Button>
                                  <Button
                                    size="icon" variant="ghost"
                                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                                    title={isAdmin ? "Editar quantidade" : "Faça login como supervisor para editar"}
                                    onClick={() => iniciarEdicao(l)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="icon" variant="ghost"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    title={isAdmin ? "Excluir leitura" : "Faça login como supervisor para excluir"}
                                    onClick={() => {
                                      if (!isAdmin) { toast.error("Faça login como supervisor para excluir leituras"); return; }
                                      setDeletandoId(l.id);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {filtrados.length === 0 && (
                        <tr>
                          <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground text-sm">Nenhuma leitura</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <Paginacao page={pageLeituras} pageSize={sizeLeituras} total={filtrados.length} onPage={setPageLeituras} onPageSize={setSizeLeituras} />
            </TabsContent>
          </Tabs>
        )}

        {/* ── Encerrar ───────────────────────────────────────────── */}
        {isAdmin && inv?.status === "aberto" && (
          <div className="pt-2 flex items-center gap-3">
            <Button variant="destructive" size="lg" className="gap-2" onClick={() => { setConfirmandoEncerrar(true); setConfirmTexto(""); }}>
              <Lock className="h-4 w-4" /> Encerrar inventário
            </Button>
          </div>
        )}

        {!isAdmin && (
          <p className="text-xs text-muted-foreground">
            Para encerrar, faça login como <Link to="/admin" className="text-primary underline">supervisor</Link>.
          </p>
        )}
      </main>

      <AlertDialog open={confirmandoEncerrar} onOpenChange={setConfirmandoEncerrar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar inventário</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação impede novas leituras. Digite <strong>ENCERRAR</strong> para confirmar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={confirmTexto} onChange={(e) => setConfirmTexto(e.target.value)} placeholder="ENCERRAR" className="font-mono" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={encerrar} className="bg-destructive hover:bg-destructive/90">
              Confirmar encerramento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
