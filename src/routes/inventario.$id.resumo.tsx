import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { sincronizarEstoqueWms } from "@/lib/wms.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Download, FileSpreadsheet, Lock, AlertTriangle,
  Trash2, Users, Clock, Activity, BarChart2, RefreshCw,
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

function tempoRelativo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function TelaResumo() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const sincronizarWms = useServerFn(sincronizarEstoqueWms);
  const [inv, setInv] = useState<{ nome: string; status: string; wms_sincronizado_em: string | null } | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [wmsMap, setWmsMap] = useState<Map<string, number>>(new Map()); // key = "pos|sku" => qtde WMS
  const [loading, setLoading] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [filtroPos, setFiltroPos] = useState("");
  const [filtroProd, setFiltroProd] = useState("");
  const [filtroOp, setFiltroOp] = useState("");
  const [soDivergentes, setSoDivergentes] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [confirmandoEncerrar, setConfirmandoEncerrar] = useState(false);
  const [confirmTexto, setConfirmTexto] = useState("");
  const [deletandoId, setDeletandoId] = useState<string | null>(null);


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

      const [{ data, error }, { data: wmsData }] = await Promise.all([
        supabase
          .from("leituras")
          .select("id, codigo_posicao, codigo_produto, numero_contagem, quantidade, operador_id, lido_em, operadores(nome)")
          .eq("inventario_id", id)
          .order("codigo_posicao")
          .order("lido_em", { ascending: true }),
        supabase
          .from("estoque_wms_snapshot")
          .select("codigo_posicao, sku, qtde_unidades")
          .eq("inventario_id", id),
      ]);

      if (cancelado) return;
      if (error) { toast.error(error.message); setLoading(false); return; }

      // Agrega WMS por (posicao, sku)
      const wm = new Map<string, number>();
      for (const w of wmsData ?? []) {
        const k = `${(w as any).codigo_posicao}|${(w as any).sku}`;
        wm.set(k, (wm.get(k) ?? 0) + Number((w as any).qtde_unidades ?? 0));
      }
      setWmsMap(wm);

      const codigosLidos = Array.from(new Set((data ?? []).map((d: any) => d.codigo_produto)));
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

    // Realtime: recarrega ao detectar mudanças nas leituras deste inventário
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const agendarRecarga = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { carregar(); }, 400);
    };

    const channel = supabase
      .channel(`resumo-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leituras", filter: `inventario_id=eq.${id}` },
        agendarRecarga,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "inventarios", filter: `id=eq.${id}` },
        agendarRecarga,
      )
      .subscribe();

    return () => {
      cancelado = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [id]);

  /* ── Métricas derivadas ─────────────────────────────────────────── */

  const divergencias = useMemo(() => {
    const set = new Set<string>();
    const byPP = new Map<string, Map<number, number>>();
    for (const l of linhas) {
      const k = `${l.codigo_posicao}|${l.sku}`;
      const m = byPP.get(k) ?? new Map();
      m.set(l.numero_contagem, (m.get(l.numero_contagem) ?? 0) + l.quantidade);
      byPP.set(k, m);
    }
    for (const [k, m] of byPP) {
      if (m.size > 1) {
        const vals = Array.from(m.values());
        if (vals.some((v) => v !== vals[0])) set.add(k);
      }
    }
    return set;
  }, [linhas]);

  // Quantidade convergente por (posicao, sku) — soma da última contagem se convergir
  const contadoPorPS = useMemo(() => {
    const byPP = new Map<string, Map<number, number>>();
    for (const l of linhas) {
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
  }, [linhas]);

  // Divergências WMS: contado convergente ≠ WMS, OU posição contada não existe no WMS
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

  const stats = useMemo(() => ({
    posicoes: new Set(linhas.map((l) => l.codigo_posicao)).size,
    leituras: linhas.length,
    operadores: new Set(linhas.map((l) => l.operador_id).filter(Boolean)).size,
    divergencias: divergencias.size,
    divergenciasWms: divergenciasWms.size,
  }), [linhas, divergencias, divergenciasWms]);


  const statsPorOperador = useMemo(() => {
    const map = new Map<string, { nome: string; count: number; ultima: string }>();
    for (const l of linhas) {
      const nome = l.operador_nome ?? "Desconhecido";
      const ex = map.get(nome) ?? { nome, count: 0, ultima: "" };
      map.set(nome, {
        nome,
        count: ex.count + 1,
        ultima: l.lido_em > ex.ultima ? l.lido_em : ex.ultima,
      });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [linhas]);

  const statsPorContagem = useMemo(() => {
    const map = new Map<number, number>();
    for (const l of linhas) map.set(l.numero_contagem, (map.get(l.numero_contagem) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [linhas]);

  const ultimasLeituras = useMemo(() =>
    [...linhas].sort((a, b) => b.lido_em.localeCompare(a.lido_em)).slice(0, 15),
  [linhas]);

  const ritmoUltimaHora = useMemo(() => {
    const corte = new Date(Date.now() - 3_600_000).toISOString();
    return linhas.filter((l) => l.lido_em >= corte).length;
  }, [linhas]);

  /* ── Filtro ─────────────────────────────────────────────────────── */

  const filtrados = linhas.filter((l) => {
    const fp = filtroPos.trim().toUpperCase();
    const fr = filtroProd.trim().toUpperCase();
    const fo = filtroOp.trim().toLowerCase();
    if (fp && !l.codigo_posicao.includes(fp)) return false;
    if (fr && !(l.sku.includes(fr) || l.descricao.toUpperCase().includes(fr) || l.codigo_produto.includes(fr))) return false;
    if (fo && !(l.operador_nome ?? "").toLowerCase().includes(fo)) return false;
    if (soDivergentes) {
      const k = `${l.codigo_posicao}|${l.sku}`;
      if (!divergencias.has(k) && !divergenciasWms.has(k)) return false;
    }
    return true;
  });

  /* ── Ações ──────────────────────────────────────────────────────── */

  async function sincronizar() {
    if (sincronizando) return;
    setSincronizando(true);
    try {
      const r = await sincronizarWms({ data: { inventarioId: id } });
      toast.success(`WMS sincronizado: ${r.posicoes} posições, ${r.total_inserido} registros`);
      // Recarrega snapshot
      const { data: wmsData } = await supabase
        .from("estoque_wms_snapshot")
        .select("codigo_posicao, sku, qtde_unidades")
        .eq("inventario_id", id);
      const wm = new Map<string, number>();
      for (const w of wmsData ?? []) {
        const k = `${(w as any).codigo_posicao}|${(w as any).sku}`;
        wm.set(k, (wm.get(k) ?? 0) + Number((w as any).qtde_unidades ?? 0));
      }
      setWmsMap(wm);
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
        "Divergência entre contagens": divergencias.has(k) ? "Sim" : "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leituras");
    XLSX.writeFile(wb, `${nome}.xlsx`);
  }


  async function encerrar() {
    if (confirmTexto.trim().toUpperCase() !== "ENCERRAR") { toast.error("Digite ENCERRAR para confirmar"); return; }
    const { error } = await supabase.from("inventarios").update({ status: "encerrado", encerrado_em: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Inventário encerrado");
    setConfirmandoEncerrar(false);
    setInv((p) => p ? { ...p, status: "encerrado" } : p);
  }

  const maxOpCount = statsPorOperador[0]?.count ?? 1;

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
              <Button
                onClick={sincronizar}
                disabled={sincronizando}
                variant="outline"
                size="sm"
                className="gap-1.5"
                title="Sincronizar estoque do WMS"
              >
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><BarChart2 className="h-3.5 w-3.5" /> Posições</p>
            <p className="text-3xl font-bold tabular-nums">{stats.posicoes}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Leituras</p>
            <p className="text-3xl font-bold tabular-nums">{stats.leituras}</p>
            {ritmoUltimaHora > 0 && (
              <p className="text-[10px] text-primary mt-1">{ritmoUltimaHora} na última hora</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Operadores</p>
            <p className="text-3xl font-bold tabular-nums">{stats.operadores}</p>
          </div>
          <div className={`rounded-xl border p-4 ${stats.divergencias > 0 ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}>
            <p className={`text-xs mb-1 flex items-center gap-1.5 ${stats.divergencias > 0 ? "text-destructive" : "text-muted-foreground"}`}>
              <AlertTriangle className="h-3.5 w-3.5" /> Entre contagens
            </p>
            <p className={`text-3xl font-bold tabular-nums ${stats.divergencias > 0 ? "text-destructive" : ""}`}>{stats.divergencias}</p>
          </div>
          <div className={`rounded-xl border p-4 ${stats.divergenciasWms > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card"}`}>
            <p className={`text-xs mb-1 flex items-center gap-1.5 ${stats.divergenciasWms > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
              <AlertTriangle className="h-3.5 w-3.5" /> vs WMS
            </p>
            <p className={`text-3xl font-bold tabular-nums ${stats.divergenciasWms > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {wmsMap.size === 0 ? "—" : stats.divergenciasWms}
            </p>
          </div>
        </div>


        {/* ── Dashboard ──────────────────────────────────────────── */}
        {!loading && linhas.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Por operador */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Por operador
              </h3>
              <div className="space-y-3">
                {statsPorOperador.map((op) => (
                  <div key={op.nome}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate max-w-[60%]">{op.nome}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{tempoRelativo(op.ultima)}</span>
                        <span className="text-sm font-bold tabular-nums">{op.count}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((op.count / maxOpCount) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Por contagem + últimas leituras */}
            <div className="space-y-4">
              {/* Distribuição por contagem */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <BarChart2 className="h-3.5 w-3.5" /> Distribuição por contagem
                </h3>
                <div className="flex flex-wrap gap-2">
                  {statsPorContagem.map(([ctg, count]) => (
                    <div key={ctg} className="flex-1 min-w-[80px] rounded-lg border border-border bg-secondary/40 px-3 py-2 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase">
                        {ctg}ª contagem
                      </p>
                      <p className="text-xl font-bold tabular-nums mt-0.5">{count}</p>
                    </div>
                  ))}
                  {statsPorContagem.length === 0 && (
                    <p className="text-xs text-muted-foreground">Sem dados</p>
                  )}
                </div>
              </div>

              {/* Ritmo — leituras por hora (últimas 8h) */}
              <RitmoPorHora linhas={linhas} />
            </div>
          </div>
        )}

        {/* ── Atividade recente ───────────────────────────────────── */}
        {!loading && ultimasLeituras.length > 0 && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Atividade recente</h3>
              <span className="ml-auto text-[10px] text-muted-foreground">últimas {ultimasLeituras.length} leituras</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/30 border-b border-border/50">
                  <tr>
                    <th className="px-3 py-2 text-left text-muted-foreground font-medium">Horário</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-medium">Operador</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-medium">Posição</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-medium">Produto</th>
                    <th className="px-3 py-2 text-right text-muted-foreground font-medium">Qtd</th>
                    <th className="px-3 py-2 text-center text-muted-foreground font-medium">Ctg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {ultimasLeituras.map((l) => (
                    <tr key={l.id} className="hover:bg-muted/10">
                      <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                        {new Date(l.lido_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td className="px-3 py-2 max-w-[100px] truncate">{l.operador_nome ?? "—"}</td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap">{formatPosicaoDisplay(l.codigo_posicao)}</td>
                      <td className="px-3 py-2 font-mono font-medium">{l.sku}</td>
                      <td className="px-3 py-2 text-right font-bold">{l.quantidade}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground">{l.numero_contagem}ª</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Filtros + Tabela completa ───────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Todas as leituras {filtrados.length !== linhas.length && `(${filtrados.length} de ${linhas.length})`}
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input placeholder="Filtrar posição" value={filtroPos} onChange={(e) => setFiltroPos(e.target.value)} />
            <Input placeholder="Filtrar produto" value={filtroProd} onChange={(e) => setFiltroProd(e.target.value)} />
            <Input placeholder="Filtrar operador" value={filtroOp} onChange={(e) => setFiltroOp(e.target.value)} />
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
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
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Operador</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Horário</th>
                      <th className="px-3 py-2.5 w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {filtrados.map((l) => {
                      const div = divergencias.has(`${l.codigo_posicao}|${l.sku}`);
                      const confirmando = deletandoId === l.id;
                      return (
                        <tr key={l.id} className={`${div ? "bg-destructive/8" : "hover:bg-muted/20"} ${confirmando ? "bg-destructive/15" : ""}`}>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatPosicaoDisplay(l.codigo_posicao)}</td>
                          <td className="px-3 py-2 font-mono text-xs font-medium">{l.sku}</td>
                          <td className="px-3 py-2 text-xs max-w-[200px] truncate text-muted-foreground hidden md:table-cell" title={l.descricao}>
                            {l.descricao || <span className="italic">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center text-xs">{l.numero_contagem}</td>
                          <td className="px-3 py-2 text-right font-semibold">
                            {l.quantidade}
                            {div && <AlertTriangle className="inline h-3 w-3 ml-1 text-destructive" />}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">{l.operador_nome ?? "—"}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums hidden lg:table-cell">
                            {new Date(l.lido_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {confirmando ? (
                              <div className="flex items-center gap-1 justify-end">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => deletarLeitura(l.id)}
                                >
                                  Excluir
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-muted-foreground"
                                  onClick={() => setDeletandoId(null)}
                                >
                                  ✕
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                title={isAdmin ? "Excluir leitura" : "Faça login como supervisor para excluir"}
                                onClick={() => {
                                  if (!isAdmin) {
                                    toast.error("Faça login como supervisor para excluir leituras");
                                    return;
                                  }
                                  setDeletandoId(l.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filtrados.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground text-sm">
                          Nenhuma leitura
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Encerrar ───────────────────────────────────────────── */}
        {isAdmin && inv?.status === "aberto" && (
          <div className="pt-2 flex items-center gap-3">
            <Button variant="destructive" size="lg" className="gap-2"
              onClick={() => { setConfirmandoEncerrar(true); setConfirmTexto(""); }}>
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

      {/* AlertDialog de encerramento */}
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

/* ── Gráfico de barras por hora ──────────────────────────────────── */
function RitmoPorHora({ linhas }: { linhas: Linha[] }) {
  const dados = useMemo(() => {
    const agora = Date.now();
    const barras: { hora: string; count: number }[] = [];
    for (let h = 7; h >= 0; h--) {
      const inicio = new Date(agora - (h + 1) * 3_600_000).toISOString();
      const fim = new Date(agora - h * 3_600_000).toISOString();
      const count = linhas.filter((l) => l.lido_em >= inicio && l.lido_em < fim).length;
      const label = new Date(agora - h * 3_600_000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      barras.push({ hora: label, count });
    }
    return barras;
  }, [linhas]);

  const max = Math.max(...dados.map((d) => d.count), 1);
  const total = dados.reduce((s, d) => s + d.count, 0);
  if (total === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" /> Ritmo (últimas 8h)
      </h3>
      <div className="flex items-end gap-1 h-16">
        {dados.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="w-full flex items-end justify-center" style={{ height: 48 }}>
              <div
                className="w-full rounded-sm bg-primary/70 group-hover:bg-primary transition-all"
                style={{ height: `${Math.max((d.count / max) * 48, d.count > 0 ? 3 : 0)}px` }}
                title={`${d.hora}: ${d.count} leituras`}
              />
            </div>
            {d.count > 0 && (
              <span className="text-[9px] text-muted-foreground tabular-nums leading-none">{d.count}</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>{dados[0]?.hora}</span>
        <span>{dados[dados.length - 1]?.hora}</span>
      </div>
    </div>
  );
}
