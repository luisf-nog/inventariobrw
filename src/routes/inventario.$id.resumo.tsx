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
  Trash2, Users, Package, CheckCircle2, BarChart2,
  RefreshCw, MapPin, RotateCcw, ClipboardCheck, Pencil, Check, X,
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

type WmsRow = { codigo_posicao: string; sku: string; qtde_unidades: number };

type ItemAnalise = {
  sku: string;
  descricao: string;
  pickingWms: number;
  pblWms: number;
  pickingContagens: Map<number, number>;
  pblContagens: Map<number, number>;
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

function secaoInfo(contagens: Map<number, number>, wms: number, wmsLoaded: boolean) {
  const vals = Array.from(contagens.values());
  const confirmed = contagens.size > 0 && vals.every((v) => v === vals[0]) ? vals[0] : null;
  const delta = wmsLoaded && confirmed !== null ? confirmed - wms : null;
  return { confirmed, delta, divergente: contagens.size > 1 && confirmed === null };
}

async function fetchWmsSnapshot(inventarioId: string): Promise<WmsRow[]> {
  const PAGE = 1000;
  const out: WmsRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("estoque_wms_snapshot")
      .select("codigo_posicao, sku, qtde_unidades")
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

function TelaResumo() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const sincronizarWms = useServerFn(sincronizarEstoqueWms);

  const [inv, setInv] = useState<{ nome: string; status: string; wms_sincronizado_em: string | null } | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [wmsMap, setWmsMap] = useState<Map<string, number>>(new Map());
  const [skuPositions, setSkuPositions] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);

  // Filtros da aba Consolidado
  const [filtroConsPos, setFiltroConsPos] = useState("");
  const [filtroConsProd, setFiltroConsProd] = useState("");
  const [filtroConsStatus, setFiltroConsStatus] = useState<"todos" | "ok" | "divergentes">("todos");

  // Filtros da aba Leituras Brutas
  const [filtroPos, setFiltroPos] = useState("");
  const [filtroProd, setFiltroProd] = useState("");
  const [filtroOp, setFiltroOp] = useState("");
  const [soDivergentes, setSoDivergentes] = useState(false);
  const [filtroItemProd, setFiltroItemProd] = useState("");
  const [apenasComplementar, setApenasComplementar] = useState(false);

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

      const wm = new Map<string, number>();
      const sp = new Map<string, Set<string>>();
      for (const w of wmsData) {
        const k = `${w.codigo_posicao}|${w.sku}`;
        wm.set(k, (wm.get(k) ?? 0) + Number(w.qtde_unidades ?? 0));
        const set = sp.get(w.sku) ?? new Set<string>();
        set.add(w.codigo_posicao);
        sp.set(w.sku, set);
      }
      setWmsMap(wm);
      setSkuPositions(sp);

      const codigosLidos: string[] = Array.from(new Set(((data ?? []) as any[]).map((d: any) => d.codigo_produto as string)));
      const eanToSku = await traduzirEansParaSkus(codigosLidos);
      const skuPorCodigo = (codigo: string) => eanToSku[codigo.replace(/\D/g, "")] ?? codigo;
      const descricoes = await buscarDescricoesPorSku(codigosLidos.map(skuPorCodigo));
      if (cancelado) return;

      const ls: Linha[] = (data ?? []).map((d: any) => ({
        id: d.id,
        codigo_posicao: d.codigo_posicao,
        codigo_produto: d.codigo_produto,
        sku: skuPorCodigo(d.codigo_produto),
        descricao: descricoes[skuPorCodigo(d.codigo_produto)] ?? "",
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
      if (item.contagens.size > 1) {
        const vals = Array.from(item.contagens.values());
        item.divergente = vals.some((v) => v !== vals[0]);
      }
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
        const e = getOrCreate(sku);
        if (isPosicaoPbl(pos)) e.pblWms += qtd;
        else e.pickingWms += qtd;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));
  }, [linhasAnalisadas, wmsMap]);

  const analisePorItemFiltrado = useMemo(() => {
    const wmsLoaded = wmsMap.size > 0;
    return analisePorItem.filter((item) => {
      if (filtroItemProd) {
        const f = filtroItemProd.trim().toUpperCase();
        if (!item.sku.toUpperCase().includes(f) && !item.descricao.toUpperCase().includes(f)) return false;
      }
      if (apenasComplementar) {
        const pick = secaoInfo(item.pickingContagens, item.pickingWms, wmsLoaded);
        const pbl = secaoInfo(item.pblContagens, item.pblWms, wmsLoaded);
        const compl = pick.delta !== null && pbl.delta !== null && pick.delta !== 0 && pbl.delta !== 0 && Math.sign(pick.delta) !== Math.sign(pbl.delta);
        if (!compl) return false;
      }
      return true;
    });
  }, [analisePorItem, filtroItemProd, apenasComplementar, wmsMap]);

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
      const vals = Array.from(m.values());
      const convergente = vals.every((v) => v === vals[0]);
      out.set(k, { qtd: vals[0] ?? 0, convergente });
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

  const stats = useMemo(() => {
    const totalUnidades = consolidado
      .filter((i) => !i.divergente)
      .reduce((sum, i) => sum + Array.from(i.contagens.values())[0], 0);

    return {
      posicoes: new Set(linhasAnalisadas.map((l) => l.codigo_posicao)).size,
      produtos: new Set(linhasAnalisadas.map((l) => l.sku)).size,
      totalUnidades,
      operadores: new Set(linhasAnalisadas.map((l) => l.operador_id).filter(Boolean)).size,
      divergencias: divergencias.length,
      divergenciasWms: divergenciasWms.size,
      foraDoLugar: foraDoLugar.size,
    };
  }, [linhasAnalisadas, consolidado, divergencias, divergenciasWms, foraDoLugar]);

  const statsPorOperador = useMemo(() => {
    const map = new Map<string, { nome: string; count: number }>();
    for (const l of linhasAnalisadas) {
      const nome = l.operador_nome ?? "Desconhecido";
      const ex = map.get(nome) ?? { nome, count: 0 };
      map.set(nome, { nome, count: ex.count + 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [linhas]);

  /* ── Filtros ────────────────────────────────────────────────────── */

  const consolidadoFiltrado = useMemo(() => {
    const fp = filtroConsPos.trim().toUpperCase();
    const fr = filtroConsProd.trim().toUpperCase();
    return consolidado.filter((item) => {
      if (fp && !item.codigo_posicao.includes(fp)) return false;
      if (fr && !(item.sku.includes(fr) || item.descricao.toUpperCase().includes(fr))) return false;
      if (filtroConsStatus === "ok" && item.divergente) return false;
      if (filtroConsStatus === "divergentes" && !item.divergente) return false;
      return true;
    });
  }, [consolidado, filtroConsPos, filtroConsProd, filtroConsStatus]);

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

  /* ── Ações ──────────────────────────────────────────────────────── */

  async function sincronizar() {
    if (sincronizando) return;
    setSincronizando(true);
    try {
      const r = await sincronizarWms({ data: { inventarioId: id } });
      toast.success(`WMS sincronizado: ${r.posicoes} posições, ${r.total_inserido} registros`);
      const wmsData = await fetchWmsSnapshot(id);
      const wm = new Map<string, number>();
      const sp = new Map<string, Set<string>>();
      for (const w of wmsData) {
        const k = `${w.codigo_posicao}|${w.sku}`;
        wm.set(k, (wm.get(k) ?? 0) + Number(w.qtde_unidades ?? 0));
        const set = sp.get(w.sku) ?? new Set<string>();
        set.add(w.codigo_posicao);
        sp.set(w.sku, set);
      }
      setWmsMap(wm);
      setSkuPositions(sp);
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

  const maxOpCount = statsPorOperador[0]?.count ?? 1;
  const colunasCons = 3 + maxContagem + 2;

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
            <Button onClick={() => navigate({ to: "/inventario/$id/analise", params: { id } })} variant="default" size="sm" className="gap-1.5" title="Análise final por posição">
              <ClipboardCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Análise</span>
            </Button>
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
              <BarChart2 className="h-3.5 w-3.5" /> Posições
            </p>
            <p className="text-3xl font-bold tabular-nums">{stats.posicoes}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" /> Produtos
            </p>
            <p className="text-3xl font-bold tabular-nums">{stats.produtos}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {stats.totalUnidades.toLocaleString("pt-BR")} unidades confirmadas
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Operadores
            </p>
            <p className="text-3xl font-bold tabular-nums">{stats.operadores}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{linhasAnalisadas.length} leituras</p>
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
          <Tabs defaultValue="consolidado">
            <TabsList className="flex-wrap h-auto gap-1 mb-4">
              <TabsTrigger value="consolidado">
                Consolidado
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">{consolidado.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="itens">
                Por Item
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">{analisePorItem.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="divergencias">
                Divergências
                {stats.divergencias > 0 ? (
                  <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">{stats.divergencias}</Badge>
                ) : (
                  <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">0</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="operadores">Operadores</TabsTrigger>
              <TabsTrigger value="leituras">Leituras Brutas</TabsTrigger>
            </TabsList>

            {/* ── Consolidado ────────────────────────────────────── */}
            <TabsContent value="consolidado" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Uma linha por combinação posição + produto. Colunas de contagem mostram a quantidade registrada em cada rodada.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input placeholder="Filtrar posição" value={filtroConsPos} onChange={(e) => setFiltroConsPos(e.target.value)} />
                <Input placeholder="Filtrar produto / descrição" value={filtroConsProd} onChange={(e) => setFiltroConsProd(e.target.value)} />
                <Select value={filtroConsStatus} onValueChange={(v) => setFiltroConsStatus(v as typeof filtroConsStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="ok">Apenas confirmados</SelectItem>
                    <SelectItem value="divergentes">Apenas divergentes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {consolidadoFiltrado.length !== consolidado.length && (
                <p className="text-[11px] text-muted-foreground">Exibindo {consolidadoFiltrado.length} de {consolidado.length}</p>
              )}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/50 border-b border-border">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Posição</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Produto</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Descrição</th>
                        {Array.from({ length: maxContagem }, (_, i) => i + 1).map((ctg) => (
                          <th key={ctg} className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                            {ctg}ª Ctg
                          </th>
                        ))}
                        <th className="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Operador(es)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {consolidadoFiltrado.map((item) => (
                        <tr key={`${item.codigo_posicao}|${item.sku}`} className={item.divergente ? "bg-destructive/8" : "hover:bg-muted/20"}>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatPosicaoDisplay(item.codigo_posicao)}</td>
                          <td className="px-3 py-2 font-mono text-xs font-medium">{item.sku}</td>
                          <td className="px-3 py-2 text-xs max-w-[200px] truncate text-muted-foreground hidden md:table-cell" title={item.descricao}>
                            {item.descricao || <span className="italic">—</span>}
                          </td>
                          {Array.from({ length: maxContagem }, (_, i) => i + 1).map((ctg) => (
                            <td key={ctg} className="px-3 py-2 text-right tabular-nums font-semibold">
                              {item.contagens.has(ctg) ? item.contagens.get(ctg) : <span className="text-muted-foreground/40">—</span>}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-center">
                            {item.divergente ? (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 gap-1">
                                <AlertTriangle className="h-2.5 w-2.5" /> Divergente
                              </Badge>
                            ) : (
                              <Badge className="text-[10px] px-1.5 py-0 h-4 gap-1 text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400 hover:bg-emerald-50">
                                <CheckCircle2 className="h-2.5 w-2.5" /> OK
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell truncate max-w-[140px]">
                            {item.operadores.join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                      {consolidadoFiltrado.length === 0 && (
                        <tr>
                          <td colSpan={colunasCons} className="px-3 py-10 text-center text-muted-foreground text-sm">Nenhum resultado</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

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
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={apenasComplementar}
                    onChange={(e) => setApenasComplementar(e.target.checked)}
                    className="h-3.5 w-3.5 accent-violet-500"
                  />
                  Só complementares
                </label>
                {analisePorItemFiltrado.length !== analisePorItem.length && (
                  <span className="text-[11px] text-muted-foreground">
                    Exibindo {analisePorItemFiltrado.length} de {analisePorItem.length}
                  </span>
                )}
              </div>
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/50">
                      <tr>
                        <th rowSpan={2} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide align-bottom border-b border-border">Produto</th>
                        <th rowSpan={2} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide align-bottom border-b border-border max-w-[160px]">Descrição</th>
                        <th
                          colSpan={wmsMap.size > 0 ? maxContagem + 2 : maxContagem}
                          className="px-3 py-1.5 text-center text-[11px] font-semibold text-blue-700 dark:text-blue-400 border-l border-border border-b border-border/40 bg-blue-50/50 dark:bg-blue-950/20 uppercase tracking-wide"
                        >
                          Picking
                        </th>
                        <th
                          colSpan={wmsMap.size > 0 ? maxContagem + 2 : maxContagem}
                          className="px-3 py-1.5 text-center text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 border-l border-border border-b border-border/40 bg-emerald-50/50 dark:bg-emerald-950/20 uppercase tracking-wide"
                        >
                          PBL (995)
                        </th>
                      </tr>
                      <tr className="border-b border-border">
                        {wmsMap.size > 0 && (
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground whitespace-nowrap border-l border-border bg-blue-50/30 dark:bg-blue-950/10">Esp.</th>
                        )}
                        {Array.from({ length: maxContagem }, (_, i) => i + 1).map((c) => (
                          <th key={c} className={`px-3 py-2 text-right text-[11px] font-medium text-muted-foreground whitespace-nowrap bg-blue-50/30 dark:bg-blue-950/10 ${wmsMap.size === 0 && c === 1 ? "border-l border-border" : ""}`}>
                            {c}ª Ctg
                          </th>
                        ))}
                        {wmsMap.size > 0 && (
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground bg-blue-50/30 dark:bg-blue-950/10">Δ</th>
                        )}
                        {wmsMap.size > 0 && (
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground whitespace-nowrap border-l border-border bg-emerald-50/30 dark:bg-emerald-950/10">Esp.</th>
                        )}
                        {Array.from({ length: maxContagem }, (_, i) => i + 1).map((c) => (
                          <th key={c} className={`px-3 py-2 text-right text-[11px] font-medium text-muted-foreground whitespace-nowrap bg-emerald-50/30 dark:bg-emerald-950/10 ${wmsMap.size === 0 && c === 1 ? "border-l border-border" : ""}`}>
                            {c}ª Ctg
                          </th>
                        ))}
                        {wmsMap.size > 0 && (
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground bg-emerald-50/30 dark:bg-emerald-950/10">Δ</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {analisePorItemFiltrado.map((item) => {
                        const wmsLoaded = wmsMap.size > 0;
                        const pick = secaoInfo(item.pickingContagens, item.pickingWms, wmsLoaded);
                        const pbl = secaoInfo(item.pblContagens, item.pblWms, wmsLoaded);
                        const complementar = pick.delta !== null && pbl.delta !== null && pick.delta !== 0 && pbl.delta !== 0 && Math.sign(pick.delta) !== Math.sign(pbl.delta);
                        const deltaCell = (delta: number | null, divergente: boolean, semContagem: boolean) => {
                          if (semContagem) return <span className="text-muted-foreground/30 text-xs">—</span>;
                          if (divergente) return <AlertTriangle className="inline h-3.5 w-3.5 text-amber-500" title="Contagens divergentes" />;
                          if (delta === null) return <span className="text-muted-foreground/40 text-xs">—</span>;
                          if (delta === 0) return <span className="text-emerald-600 dark:text-emerald-400 font-bold">0</span>;
                          return <span className={`font-bold ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{delta > 0 ? `+${delta}` : delta}</span>;
                        };
                        return (
                          <tr key={item.sku} className={complementar ? "bg-violet-500/8 hover:bg-violet-500/12" : "hover:bg-muted/20"}>
                            <td className="px-3 py-2 font-mono text-xs font-medium">
                              <div className="flex items-center gap-1">
                                {item.sku}
                                {complementar && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-sans font-semibold">⇄</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px] truncate" title={item.descricao}>
                              {item.descricao || <span className="italic">—</span>}
                            </td>
                            {/* Picking */}
                            {wmsLoaded && (
                              <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground border-l border-border">
                                {item.pickingWms > 0 ? item.pickingWms : <span className="text-muted-foreground/40">—</span>}
                              </td>
                            )}
                            {Array.from({ length: maxContagem }, (_, i) => i + 1).map((c) => (
                              <td key={c} className={`px-3 py-2 text-right tabular-nums font-semibold ${!wmsLoaded && c === 1 ? "border-l border-border" : ""} ${pick.divergente ? "text-amber-600 dark:text-amber-400" : ""}`}>
                                {item.pickingContagens.has(c) ? item.pickingContagens.get(c) : <span className="text-muted-foreground/25">—</span>}
                              </td>
                            ))}
                            {wmsLoaded && (
                              <td className="px-3 py-2 text-right tabular-nums">
                                {deltaCell(pick.delta, pick.divergente, item.pickingContagens.size === 0)}
                              </td>
                            )}
                            {/* PBL */}
                            {wmsLoaded && (
                              <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground border-l border-border">
                                {item.pblWms > 0 ? item.pblWms : <span className="text-muted-foreground/40">—</span>}
                              </td>
                            )}
                            {Array.from({ length: maxContagem }, (_, i) => i + 1).map((c) => (
                              <td key={c} className={`px-3 py-2 text-right tabular-nums font-semibold ${!wmsLoaded && c === 1 ? "border-l border-border" : ""} ${pbl.divergente ? "text-amber-600 dark:text-amber-400" : ""}`}>
                                {item.pblContagens.has(c) ? item.pblContagens.get(c) : <span className="text-muted-foreground/25">—</span>}
                              </td>
                            ))}
                            {wmsLoaded && (
                              <td className="px-3 py-2 text-right tabular-nums">
                                {deltaCell(pbl.delta, pbl.divergente, item.pblContagens.size === 0)}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {analisePorItemFiltrado.length === 0 && (
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
            </TabsContent>

            {/* ── Divergências ───────────────────────────────────── */}
            <TabsContent value="divergencias">
              {divergencias.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Nenhuma divergência encontrada</p>
                  <p className="text-xs text-muted-foreground mt-1">Todas as posições contadas em múltiplas rodadas apresentam a mesma quantidade.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {divergencias.length} posição+produto com contagens divergentes — revise e decida qual valor é o correto antes de encerrar.
                  </p>
                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-secondary/50 border-b border-border">
                          <tr>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Posição</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Produto</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Descrição</th>
                            {Array.from({ length: maxContagem }, (_, i) => i + 1).map((ctg) => (
                              <th key={ctg} className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                                {ctg}ª Ctg
                              </th>
                            ))}
                            <th className="px-3 py-2.5 text-right text-xs font-medium text-destructive uppercase tracking-wide">Diferença</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {divergencias.map((item) => {
                            const vals = Array.from(item.contagens.values());
                            const diff = Math.max(...vals) - Math.min(...vals);
                            return (
                              <tr key={`${item.codigo_posicao}|${item.sku}`} className="bg-destructive/8">
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
                </div>
              )}
            </TabsContent>

            {/* ── Operadores ─────────────────────────────────────── */}
            <TabsContent value="operadores">
              <div className="rounded-xl border border-border bg-card p-4 space-y-3 max-w-lg">
                {statsPorOperador.map((op) => (
                  <div key={op.nome}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate max-w-[60%]">{op.nome}</span>
                      <span className="text-sm font-bold tabular-nums">{op.count} leituras</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((op.count / maxOpCount) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {statsPorOperador.length === 0 && <p className="text-xs text-muted-foreground">Sem dados</p>}
              </div>
            </TabsContent>

            {/* ── Leituras Brutas ────────────────────────────────── */}
            <TabsContent value="leituras" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Registros brutos — uma linha por scan. Use a aba Consolidado para a visão analítica.
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
              {filtrados.length !== linhas.length && (
                <p className="text-[11px] text-muted-foreground">Exibindo {filtrados.length} de {linhas.length} leituras</p>
              )}
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
                      {filtrados.map((l) => {
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
