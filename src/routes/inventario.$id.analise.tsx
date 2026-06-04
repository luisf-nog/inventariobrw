import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, FileSpreadsheet, CheckCircle2, AlertTriangle,
  Circle, PlusCircle, Package, Layers, ArrowRightLeft, MapPin, Boxes,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { buscarDescricoesPorSku, traduzirEansParaSkus } from "@/lib/produtos";
import { formatPosicaoDisplay } from "@/lib/validation";
import {
  isPosicaoNormal, isPosicaoPbl, isPosicaoConsiderada,
} from "./inventario.$id.resumo";

export const Route = createFileRoute("/inventario/$id/analise")({
  component: TelaAnalise,
});

type WmsRow = { codigo_posicao: string; sku: string; descricao: string | null; qtde_unidades: number };
type LeituraRow = { codigo_posicao: string; codigo_produto: string; numero_contagem: number; quantidade: number };

type StatusItem = "ok" | "divergente_wms" | "divergente_contagens" | "nao_contado" | "extra";

type LinhaAnalise = {
  codigo_posicao: string;
  sku: string;
  descricao: string;
  qtd_wms: number | null;        // null = não estava no WMS (extra)
  qtd_contada: number | null;    // null = não contado
  diferenca: number | null;
  status: StatusItem;
  categoria: "normal" | "pbl";
  convergente: boolean;          // todas contagens iguais
  num_contagens: number;
};

async function fetchAllWms(inventarioId: string): Promise<WmsRow[]> {
  const PAGE = 1000;
  const out: WmsRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("estoque_wms_snapshot")
      .select("codigo_posicao, sku, descricao, qtde_unidades")
      .eq("inventario_id", inventarioId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as WmsRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchAllLeituras(inventarioId: string): Promise<LeituraRow[]> {
  const PAGE = 1000;
  const out: LeituraRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("leituras")
      .select("codigo_posicao, codigo_produto, numero_contagem, quantidade")
      .eq("inventario_id", inventarioId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as LeituraRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function TelaAnalise() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [inv, setInv] = useState<{ nome: string; status: string } | null>(null);
  const [linhas, setLinhas] = useState<LinhaAnalise[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoria, setCategoria] = useState<"todas" | "normal" | "pbl">("todas");
  const [statusFiltro, setStatusFiltro] = useState<"todos" | StatusItem>("todos");
  const [filtroPos, setFiltroPos] = useState("");
  const [filtroProd, setFiltroProd] = useState("");
  const [viewMode, setViewMode] = useState<"posicao" | "produto">("posicao");
  const [filtroCompensacao, setFiltroCompensacao] = useState(false);

  useEffect(() => {
    let cancelado = false;

    const carregar = async () => {
      const [{ data: invData }, wmsRaw, leiturasRaw] = await Promise.all([
        supabase.from("inventarios").select("nome, status").eq("id", id).single(),
        fetchAllWms(id),
        fetchAllLeituras(id),
      ]);
      if (cancelado) return;
      setInv(invData as any);

      // Filtra apenas posições consideradas (normal + PBL)
      const wmsFilt = wmsRaw.filter((w) => isPosicaoConsiderada(w.codigo_posicao));

      // Agrega WMS por (pos, sku)
      const wmsAgg = new Map<string, { qtd: number; descricao: string | null }>();
      for (const w of wmsFilt) {
        const k = `${w.codigo_posicao}|${w.sku}`;
        const ex = wmsAgg.get(k);
        wmsAgg.set(k, {
          qtd: (ex?.qtd ?? 0) + Number(w.qtde_unidades ?? 0),
          descricao: ex?.descricao ?? w.descricao,
        });
      }

      // Traduz EAN→SKU nas leituras
      const codigosLidos = Array.from(new Set(leiturasRaw.map((l) => l.codigo_produto)));
      const eanToSku = await traduzirEansParaSkus(codigosLidos);
      const skuPorCodigo = (c: string) => eanToSku[c.replace(/\D/g, "")] ?? c;

      // Agrega leituras por (pos, sku, num_contagem)
      const leiturasAgg = new Map<string, Map<number, number>>();
      const posicoesVazias = new Map<string, number>(); // pos → numero_contagem mais alto
      for (const l of leiturasRaw) {
        if (!isPosicaoConsiderada(l.codigo_posicao)) continue;
        const sku = skuPorCodigo(l.codigo_produto);
        // Marcador "VAZIO": operador confirmou posição sem produtos
        if (sku === "VAZIO") {
          const atual = posicoesVazias.get(l.codigo_posicao) ?? 0;
          posicoesVazias.set(l.codigo_posicao, Math.max(atual, l.numero_contagem));
          continue;
        }
        const k = `${l.codigo_posicao}|${sku}`;
        const m = leiturasAgg.get(k) ?? new Map<number, number>();
        m.set(l.numero_contagem, (m.get(l.numero_contagem) ?? 0) + Number(l.quantidade));
        leiturasAgg.set(k, m);
      }

      // Expande "posição vazia": para cada SKU do WMS naquela posição que ainda não foi contado, registra 0
      for (const [pos, numCont] of posicoesVazias) {
        for (const w of wmsFilt) {
          if (w.codigo_posicao !== pos) continue;
          const k = `${pos}|${w.sku}`;
          if (leiturasAgg.has(k)) continue;
          const m = new Map<number, number>();
          m.set(numCont, 0);
          leiturasAgg.set(k, m);
        }
        // Se posição vazia não tem nada no WMS, ainda assim conta como contada
        const semWms = !wmsFilt.some((w) => w.codigo_posicao === pos);
        if (semWms) {
          leiturasAgg.set(`${pos}|VAZIO`, new Map([[numCont, 0]]));
          wmsAgg.set(`${pos}|VAZIO`, { qtd: 0, descricao: "Posição vazia" });
        }
      }

      // União de chaves
      const todasChaves = new Set<string>([...wmsAgg.keys(), ...leiturasAgg.keys()]);

      // Busca descrições para SKUs que não temos
      const skusSemDesc = new Set<string>();
      for (const k of todasChaves) {
        const [, sku] = k.split("|");
        const wms = wmsAgg.get(k);
        if (!wms?.descricao) skusSemDesc.add(sku);
      }
      const descricoes = await buscarDescricoesPorSku(Array.from(skusSemDesc));
      if (cancelado) return;

      const out: LinhaAnalise[] = [];
      for (const k of todasChaves) {
        const [pos, sku] = k.split("|");
        const wms = wmsAgg.get(k);
        const cnt = leiturasAgg.get(k);

        const qtd_wms = wms ? wms.qtd : null;
        const vals = cnt ? Array.from(cnt.values()) : [];
        const convergente = vals.length > 0 && vals.every((v) => v === vals[0]);
        const qtd_contada = vals.length === 0 ? null : convergente ? vals[0] : Math.max(...vals);

        let status: StatusItem;
        if (qtd_contada === null) status = "nao_contado";
        else if (qtd_wms === null) status = "extra";
        else if (vals.length > 1 && !convergente) status = "divergente_contagens";
        else if (qtd_contada !== qtd_wms) status = "divergente_wms";
        else status = "ok";

        out.push({
          codigo_posicao: pos,
          sku,
          descricao: wms?.descricao ?? descricoes[sku] ?? "",
          qtd_wms,
          qtd_contada,
          diferenca: qtd_wms === null || qtd_contada === null ? null : qtd_contada - qtd_wms,
          status,
          categoria: isPosicaoPbl(pos) ? "pbl" : "normal",
          convergente,
          num_contagens: vals.length,
        });
      }

      out.sort((a, b) => a.codigo_posicao.localeCompare(b.codigo_posicao) || a.sku.localeCompare(b.sku));
      setLinhas(out);
      setLoading(false);
    };

    carregar();

    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => { if (t) clearTimeout(t); t = setTimeout(carregar, 500); };
    const channel = supabase
      .channel(`analise-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leituras", filter: `inventario_id=eq.${id}` }, debounced)
      .subscribe();

    return () => {
      cancelado = true;
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [id]);

  /* ── Filtros e métricas ─────────────────────────────────────────── */

  const linhasFiltradas = useMemo(() => linhas.filter((l) => {
    if (categoria !== "todas" && l.categoria !== categoria) return false;
    if (statusFiltro !== "todos" && l.status !== statusFiltro) return false;
    const fp = filtroPos.trim().toUpperCase();
    const fr = filtroProd.trim().toUpperCase();
    if (fp && !l.codigo_posicao.includes(fp) && !formatPosicaoDisplay(l.codigo_posicao).includes(fp)) return false;
    if (fr && !(l.sku.toUpperCase().includes(fr) || l.descricao.toUpperCase().includes(fr))) return false;
    return true;
  }), [linhas, categoria, statusFiltro, filtroPos, filtroProd]);

  // Stats por categoria selecionada (baseadas no filtro categoria + busca, ignorando filtro status)
  const baseStats = useMemo(() => linhas.filter((l) => categoria === "todas" || l.categoria === categoria), [linhas, categoria]);

  const stats = useMemo(() => {
    const por = (s: StatusItem) => baseStats.filter((l) => l.status === s).length;
    const posicoesTotal = new Set(baseStats.map((l) => l.codigo_posicao)).size;
    const posicoesContadas = new Set(baseStats.filter((l) => l.status !== "nao_contado").map((l) => l.codigo_posicao)).size;
    return {
      itens: baseStats.length,
      posicoesTotal,
      posicoesContadas,
      ok: por("ok"),
      divergente_wms: por("divergente_wms"),
      divergente_contagens: por("divergente_contagens"),
      nao_contado: por("nao_contado"),
      extra: por("extra"),
    };
  }, [baseStats]);

  const progresso = stats.posicoesTotal > 0
    ? Math.round((stats.posicoesContadas / stats.posicoesTotal) * 100)
    : 0;

  /* ── Agregação por produto (Picking x PBL) ──────────────────────── */
  type LinhaProduto = {
    sku: string;
    descricao: string;
    wms_picking: number;
    contado_picking: number;
    dif_picking: number;
    pendente_picking: number;       // posições do SKU no picking sem contagem
    wms_pbl: number;
    contado_pbl: number;
    dif_pbl: number;
    pendente_pbl: number;
    dif_total: number;
    compensa: boolean;              // sobra num lado e falta no outro
    posicoes_picking: string[];
    posicoes_pbl: string[];
  };

  const linhasPorProduto = useMemo<LinhaProduto[]>(() => {
    const map = new Map<string, LinhaProduto>();
    for (const l of linhas) {
      if (l.sku === "VAZIO") continue;
      let p = map.get(l.sku);
      if (!p) {
        p = {
          sku: l.sku, descricao: l.descricao,
          wms_picking: 0, contado_picking: 0, dif_picking: 0, pendente_picking: 0,
          wms_pbl: 0, contado_pbl: 0, dif_pbl: 0, pendente_pbl: 0,
          dif_total: 0, compensa: false,
          posicoes_picking: [], posicoes_pbl: [],
        };
        map.set(l.sku, p);
      }
      if (!p.descricao && l.descricao) p.descricao = l.descricao;
      const naoContado = l.qtd_contada === null;
      if (l.categoria === "pbl") {
        p.wms_pbl += l.qtd_wms ?? 0;
        p.contado_pbl += l.qtd_contada ?? 0;
        if (naoContado && (l.qtd_wms ?? 0) > 0) p.pendente_pbl += 1;
        if (!p.posicoes_pbl.includes(l.codigo_posicao)) p.posicoes_pbl.push(l.codigo_posicao);
      } else {
        p.wms_picking += l.qtd_wms ?? 0;
        p.contado_picking += l.qtd_contada ?? 0;
        if (naoContado && (l.qtd_wms ?? 0) > 0) p.pendente_picking += 1;
        if (!p.posicoes_picking.includes(l.codigo_posicao)) p.posicoes_picking.push(l.codigo_posicao);
      }
    }
    const out = Array.from(map.values());
    for (const p of out) {
      p.dif_picking = p.contado_picking - p.wms_picking;
      p.dif_pbl = p.contado_pbl - p.wms_pbl;
      p.dif_total = p.dif_picking + p.dif_pbl;
      p.compensa =
        (p.dif_picking > 0 && p.dif_pbl < 0) ||
        (p.dif_picking < 0 && p.dif_pbl > 0);
    }
    out.sort((a, b) => {
      // Prioriza compensações, depois |dif_total| maior
      if (a.compensa !== b.compensa) return a.compensa ? -1 : 1;
      return Math.abs(b.dif_total) - Math.abs(a.dif_total);
    });
    return out;
  }, [linhas]);

  const linhasProdutoFiltradas = useMemo(() => linhasPorProduto.filter((p) => {
    if (filtroCompensacao && !p.compensa) return false;
    const fr = filtroProd.trim().toUpperCase();
    if (fr && !(p.sku.toUpperCase().includes(fr) || p.descricao.toUpperCase().includes(fr))) return false;
    // se categoria == normal/pbl, mostra só produtos com presença nessa categoria
    if (categoria === "normal" && p.wms_picking === 0 && p.contado_picking === 0) return false;
    if (categoria === "pbl" && p.wms_pbl === 0 && p.contado_pbl === 0) return false;
    return true;
  }), [linhasPorProduto, filtroCompensacao, filtroProd, categoria]);

  const compensacoesCount = useMemo(() => linhasPorProduto.filter((p) => p.compensa).length, [linhasPorProduto]);


  function exportar() {
    const wb = XLSX.utils.book_new();
    if (viewMode === "posicao") {
      const dados = linhasFiltradas.map((l) => ({
        Categoria: l.categoria === "pbl" ? "PBL" : "Picking Normal",
        Posição: formatPosicaoDisplay(l.codigo_posicao),
        "Posição (raw)": l.codigo_posicao,
        SKU: l.sku,
        Descrição: l.descricao,
        "Qtd WMS": l.qtd_wms ?? "",
        "Qtd Contada": l.qtd_contada ?? "",
        Diferença: l.diferenca ?? "",
        "Nº contagens": l.num_contagens,
        Status: rotuloStatus(l.status),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), "Por posição");
    } else {
      const dados = linhasProdutoFiltradas.map((p) => ({
        SKU: p.sku,
        Descrição: p.descricao,
        "WMS Picking": p.wms_picking,
        "Contado Picking": p.contado_picking,
        "Δ Picking": p.dif_picking,
        "Pendente Picking": p.pendente_picking,
        "WMS PBL": p.wms_pbl,
        "Contado PBL": p.contado_pbl,
        "Δ PBL": p.dif_pbl,
        "Pendente PBL": p.pendente_pbl,
        "Δ Total": p.dif_total,
        "Compensa?": p.compensa ? "SIM" : "",
        Posições: [...p.posicoes_picking, ...p.posicoes_pbl].map(formatPosicaoDisplay).join(" | "),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), "Por produto");
    }
    XLSX.writeFile(wb, `analise-${inv?.nome ?? id}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Planilha exportada");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"
            onClick={() => navigate({ to: "/inventario/$id/resumo", params: { id } })}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Análise final</p>
            <p className="font-semibold truncate leading-tight">{inv?.nome}</p>
          </div>
          <Button onClick={exportar} variant="outline" size="sm" className="gap-1.5">
            <FileSpreadsheet className="h-4 w-4" /> <span className="hidden sm:inline">Exportar</span>
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* View mode toggle */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {([
              { v: "posicao", label: "Por posição", icon: MapPin },
              { v: "produto", label: "Por produto", icon: Boxes },
            ] as const).map(({ v, label, icon: Icon }) => (
              <button key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
                  viewMode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          {viewMode === "produto" && (
            <button
              onClick={() => setFiltroCompensacao((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border flex items-center gap-1.5 transition-colors ${
                filtroCompensacao
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}>
              <ArrowRightLeft className="h-3.5 w-3.5" /> Possível compensação
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-background/60 tabular-nums">{compensacoesCount}</span>
            </button>
          )}
        </div>

        {/* Tabs categoria */}
        <div className="flex gap-2 flex-wrap">
          {([
            { v: "todas", label: "Todas", icon: Layers },
            { v: "normal", label: "Picking Normal", icon: Package },
            { v: "pbl", label: "PBL", icon: Package },
          ] as const).map(({ v, label, icon: Icon }) => (
            <button key={v}
              onClick={() => setCategoria(v)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center gap-2 ${
                categoria === v
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>


        {/* Progresso */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Progresso de contagem</p>
              <p className="text-2xl font-bold tabular-nums">
                {stats.posicoesContadas} <span className="text-muted-foreground text-base font-normal">de {stats.posicoesTotal} posições</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-primary tabular-nums">{progresso}%</p>
            </div>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progresso}%` }} />
          </div>
        </div>

        {/* KPIs por status */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard active={statusFiltro === "ok"} onClick={() => setStatusFiltro(statusFiltro === "ok" ? "todos" : "ok")}
            icon={CheckCircle2} label="OK (bate WMS)" value={stats.ok}
            color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-500/5 border-emerald-500/30" />
          <KpiCard active={statusFiltro === "divergente_wms"} onClick={() => setStatusFiltro(statusFiltro === "divergente_wms" ? "todos" : "divergente_wms")}
            icon={AlertTriangle} label="Divergência WMS" value={stats.divergente_wms}
            color="text-amber-600 dark:text-amber-400" bg="bg-amber-500/5 border-amber-500/30" />
          <KpiCard active={statusFiltro === "divergente_contagens"} onClick={() => setStatusFiltro(statusFiltro === "divergente_contagens" ? "todos" : "divergente_contagens")}
            icon={AlertTriangle} label="Entre contagens" value={stats.divergente_contagens}
            color="text-destructive" bg="bg-destructive/5 border-destructive/30" />
          <KpiCard active={statusFiltro === "nao_contado"} onClick={() => setStatusFiltro(statusFiltro === "nao_contado" ? "todos" : "nao_contado")}
            icon={Circle} label="Não contado" value={stats.nao_contado}
            color="text-muted-foreground" bg="bg-secondary/40 border-border" />
          <KpiCard active={statusFiltro === "extra"} onClick={() => setStatusFiltro(statusFiltro === "extra" ? "todos" : "extra")}
            icon={PlusCircle} label="Extra (não há WMS)" value={stats.extra}
            color="text-violet-600 dark:text-violet-400" bg="bg-violet-500/5 border-violet-500/30" />
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input placeholder="Filtrar posição" value={filtroPos} onChange={(e) => setFiltroPos(e.target.value)} />
          <Input placeholder="Filtrar SKU ou descrição" value={filtroProd} onChange={(e) => setFiltroProd(e.target.value)} />
        </div>

        {/* Tabela */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : viewMode === "posicao" ? (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 border-b border-border">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Cat</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Posição</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">SKU</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Descrição</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">WMS</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Contado</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Δ</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {linhasFiltradas.map((l, i) => (
                    <tr key={`${l.codigo_posicao}|${l.sku}|${i}`}
                      className={`${corLinha(l.status)} hover:bg-muted/20`}>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                          {l.categoria === "pbl" ? "PBL" : "Picking"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatPosicaoDisplay(l.codigo_posicao)}</td>
                      <td className="px-3 py-2 font-mono text-xs font-medium">{l.sku}</td>
                      <td className="px-3 py-2 text-xs max-w-[260px] truncate text-muted-foreground hidden md:table-cell" title={l.descricao}>
                        {l.descricao || <span className="italic">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.qtd_wms === null ? <span className="text-[10px] italic text-muted-foreground">—</span> : l.qtd_wms}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {l.qtd_contada === null
                          ? <span className="text-[10px] italic text-muted-foreground">não contado</span>
                          : (
                            <span>
                              {l.qtd_contada}
                              {l.num_contagens > 1 && (
                                <span className="text-[10px] text-muted-foreground ml-1">({l.num_contagens}x)</span>
                              )}
                            </span>
                          )}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                        l.diferenca === null ? "" : l.diferenca === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                      }`}>
                        {l.diferenca === null ? "" : l.diferenca > 0 ? `+${l.diferenca}` : l.diferenca}
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                    </tr>
                  ))}
                  {linhasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground text-sm">
                        Nenhum item para os filtros selecionados
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t border-border bg-secondary/30 text-xs text-muted-foreground">
              {linhasFiltradas.length} {linhasFiltradas.length === 1 ? "item" : "itens"} listado{linhasFiltradas.length === 1 ? "" : "s"}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 border-b border-border">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">SKU</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Descrição</th>
                    <th colSpan={3} className="px-3 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300 border-l border-border">Picking</th>
                    <th colSpan={3} className="px-3 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-fuchsia-700 dark:text-fuchsia-300 border-l border-border">PBL</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide border-l border-border">Δ Total</th>
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">Comp.</th>
                  </tr>
                  <tr className="bg-secondary/30 border-b border-border text-[10px]">
                    <th></th>
                    <th className="hidden md:table-cell"></th>
                    <th className="px-2 py-1.5 text-right text-muted-foreground border-l border-border">WMS</th>
                    <th className="px-2 py-1.5 text-right text-muted-foreground">Cont.</th>
                    <th className="px-2 py-1.5 text-right text-muted-foreground">Δ</th>
                    <th className="px-2 py-1.5 text-right text-muted-foreground border-l border-border">WMS</th>
                    <th className="px-2 py-1.5 text-right text-muted-foreground">Cont.</th>
                    <th className="px-2 py-1.5 text-right text-muted-foreground">Δ</th>
                    <th className="border-l border-border"></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {linhasProdutoFiltradas.map((p) => (
                    <tr key={p.sku} className={`hover:bg-muted/20 ${p.compensa ? "bg-amber-500/8" : ""}`}>
                      <td className="px-3 py-2 font-mono text-xs font-medium whitespace-nowrap">{p.sku}</td>
                      <td className="px-3 py-2 text-xs max-w-[240px] truncate text-muted-foreground hidden md:table-cell" title={p.descricao}>
                        {p.descricao || <span className="italic">—</span>}
                      </td>
                      {/* Picking */}
                      <td className="px-2 py-2 text-right tabular-nums border-l border-border">
                        {p.wms_picking || <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold">
                        {p.contado_picking || <span className="text-muted-foreground/50">—</span>}
                        {p.pendente_picking > 0 && (
                          <div className="text-[9px] text-muted-foreground italic">{p.pendente_picking} pend.</div>
                        )}
                      </td>
                      <td className={`px-2 py-2 text-right tabular-nums font-medium ${
                        p.dif_picking === 0 ? "text-muted-foreground" : p.dif_picking > 0 ? "text-violet-600 dark:text-violet-400" : "text-destructive"
                      }`}>
                        {p.dif_picking > 0 ? `+${p.dif_picking}` : p.dif_picking}
                      </td>
                      {/* PBL */}
                      <td className="px-2 py-2 text-right tabular-nums border-l border-border">
                        {p.wms_pbl || <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold">
                        {p.contado_pbl || <span className="text-muted-foreground/50">—</span>}
                        {p.pendente_pbl > 0 && (
                          <div className="text-[9px] text-muted-foreground italic">{p.pendente_pbl} pend.</div>
                        )}
                      </td>
                      <td className={`px-2 py-2 text-right tabular-nums font-medium ${
                        p.dif_pbl === 0 ? "text-muted-foreground" : p.dif_pbl > 0 ? "text-violet-600 dark:text-violet-400" : "text-destructive"
                      }`}>
                        {p.dif_pbl > 0 ? `+${p.dif_pbl}` : p.dif_pbl}
                      </td>
                      {/* Total */}
                      <td className={`px-3 py-2 text-right tabular-nums font-bold border-l border-border ${
                        p.dif_total === 0 ? "text-emerald-600 dark:text-emerald-400" : p.dif_total > 0 ? "text-violet-600 dark:text-violet-400" : "text-destructive"
                      }`}>
                        {p.dif_total > 0 ? `+${p.dif_total}` : p.dif_total}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {p.compensa && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium" title="Sobra em um tipo e falta no outro — pode ser troca entre picking e PBL">
                            <ArrowRightLeft className="h-3 w-3" />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {linhasProdutoFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground text-sm">
                        Nenhum produto para os filtros selecionados
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t border-border bg-secondary/30 text-xs text-muted-foreground flex items-center justify-between flex-wrap gap-2">
              <span>{linhasProdutoFiltradas.length} produto{linhasProdutoFiltradas.length === 1 ? "" : "s"}</span>
              <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <ArrowRightLeft className="h-3 w-3" />
                {compensacoesCount} com possível compensação picking ↔ PBL
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function KpiCard({ active, onClick, icon: Icon, label, value, color, bg }: {
  active: boolean; onClick: () => void; icon: any; label: string; value: number; color: string; bg: string;
}) {
  return (
    <button onClick={onClick}
      className={`text-left rounded-xl border p-4 transition-all ${bg} ${active ? "ring-2 ring-primary" : "hover:opacity-90"}`}>
      <p className={`text-xs mb-1 flex items-center gap-1.5 ${color}`}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className={`text-3xl font-bold tabular-nums ${color}`}>{value}</p>
    </button>
  );
}

function rotuloStatus(s: StatusItem) {
  switch (s) {
    case "ok": return "OK";
    case "divergente_wms": return "Divergência WMS";
    case "divergente_contagens": return "Divergência entre contagens";
    case "nao_contado": return "Não contado";
    case "extra": return "Extra (sem WMS)";
  }
}

function corLinha(s: StatusItem) {
  switch (s) {
    case "ok": return "bg-emerald-500/5";
    case "divergente_wms": return "bg-amber-500/8";
    case "divergente_contagens": return "bg-destructive/8";
    case "nao_contado": return "";
    case "extra": return "bg-violet-500/8";
  }
}

function StatusBadge({ status }: { status: StatusItem }) {
  const cls = {
    ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    divergente_wms: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    divergente_contagens: "bg-destructive/15 text-destructive",
    nao_contado: "bg-secondary text-muted-foreground",
    extra: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  }[status];
  return (
    <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>
      {rotuloStatus(status)}
    </span>
  );
}

// Avoid unused warnings
void isPosicaoNormal;
