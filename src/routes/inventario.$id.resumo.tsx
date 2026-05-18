import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download, FileSpreadsheet, Lock, AlertTriangle } from "lucide-react";
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

function TelaResumo() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [inv, setInv] = useState<{ nome: string; status: string } | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroPos, setFiltroPos] = useState("");
  const [filtroProd, setFiltroProd] = useState("");
  const [filtroOp, setFiltroOp] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [confirmandoEncerrar, setConfirmandoEncerrar] = useState(false);
  const [confirmTexto, setConfirmTexto] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setIsAdmin(!!data.user));
    (async () => {
      const { data: invData } = await supabase.from("inventarios").select("nome, status").eq("id", id).single();
      setInv(invData);
      const { data, error } = await supabase
        .from("leituras")
        .select("id, codigo_posicao, codigo_produto, numero_contagem, quantidade, operador_id, lido_em, operadores(nome)")
        .eq("inventario_id", id)
        .order("codigo_posicao")
        .order("lido_em", { ascending: true });
      if (error) { toast.error(error.message); setLoading(false); return; }
      const codigosLidos = Array.from(new Set((data ?? []).map((d: any) => d.codigo_produto)));
      const eanToSku = await traduzirEansParaSkus(codigosLidos);
      const skuPorCodigo = (codigo: string) => eanToSku[codigo.replace(/\D/g, "")] ?? codigo;
      const descricoes = await buscarDescricoesPorSku(codigosLidos.map(skuPorCodigo));
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
    })();
  }, [id]);

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

  const filtrados = linhas.filter((l) => {
    const fp = filtroPos.trim().toUpperCase();
    const fr = filtroProd.trim().toUpperCase();
    const fo = filtroOp.trim().toLowerCase();
    if (fp && !l.codigo_posicao.includes(fp)) return false;
    if (fr && !(l.sku.includes(fr) || l.descricao.toUpperCase().includes(fr) || l.codigo_produto.includes(fr))) return false;
    if (fo && !(l.operador_nome ?? "").toLowerCase().includes(fo)) return false;
    return true;
  });

  const stats = useMemo(() => ({
    posicoes: new Set(linhas.map((l) => l.codigo_posicao)).size,
    leituras: linhas.length,
    operadores: new Set(linhas.map((l) => l.operador_id).filter(Boolean)).size,
    divergencias: divergencias.size,
  }), [linhas, divergencias]);

  function exportarCSV() {
    const header = ["posicao", "produto", "descricao", "contagem", "quantidade", "operador", "lido_em"];
    const rows = filtrados.map((l) => [l.codigo_posicao, l.sku, l.descricao, l.numero_contagem, l.quantidade, l.operador_nome ?? "", l.lido_em]);
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
    const dados = filtrados.map((l) => ({
      Posição: l.codigo_posicao,
      "Posição (formatada)": formatPosicaoDisplay(l.codigo_posicao),
      Produto: l.sku,
      Descrição: l.descricao,
      Contagem: l.numero_contagem,
      Quantidade: l.quantidade,
      Operador: l.operador_nome ?? "",
      "Lido em": new Date(l.lido_em).toLocaleString("pt-BR"),
      Divergência: divergencias.has(`${l.codigo_posicao}|${l.sku}`) ? "Sim" : "",
    }));
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate({ to: "/inventarios" })}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate leading-tight">{inv?.nome}</p>
            {inv?.status === "encerrado" && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Encerrado</Badge>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={exportarXLSX} variant="outline" size="sm" className="gap-1.5">
              <FileSpreadsheet className="h-4 w-4" /> XLSX
            </Button>
            <Button onClick={exportarCSV} variant="outline" size="sm" className="gap-1.5">
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Posições", value: stats.posicoes },
            { label: "Leituras", value: stats.leituras },
            { label: "Operadores", value: stats.operadores },
            { label: "Divergências", value: stats.divergencias, warn: stats.divergencias > 0 },
          ].map(({ label, value, warn }) => (
            <div key={label} className={`rounded-xl border p-4 bg-card ${warn && value > 0 ? "border-destructive/40 bg-destructive/5" : "border-border"}`}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className={`text-2xl font-bold ${warn && value > 0 ? "text-destructive" : ""}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input placeholder="Filtrar posição" value={filtroPos} onChange={(e) => setFiltroPos(e.target.value)} />
          <Input placeholder="Filtrar produto" value={filtroProd} onChange={(e) => setFiltroProd(e.target.value)} />
          <Input placeholder="Filtrar operador" value={filtroOp} onChange={(e) => setFiltroOp(e.target.value)} />
        </div>

        {/* Tabela */}
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
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Descrição</th>
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">Ctg</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Qtd</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Operador</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filtrados.map((l) => {
                    const div = divergencias.has(`${l.codigo_posicao}|${l.sku}`);
                    return (
                      <tr key={l.id} className={div ? "bg-destructive/8" : "hover:bg-muted/20"}>
                        <td className="px-3 py-2 font-mono text-xs">{formatPosicaoDisplay(l.codigo_posicao)}</td>
                        <td className="px-3 py-2 font-mono text-xs font-medium">{l.sku}</td>
                        <td className="px-3 py-2 text-xs max-w-[200px] truncate text-muted-foreground" title={l.descricao}>
                          {l.descricao || <span className="italic">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-xs">{l.numero_contagem}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {l.quantidade}
                          {div && <AlertTriangle className="inline h-3 w-3 ml-1 text-destructive" />}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{l.operador_nome ?? "—"}</td>
                      </tr>
                    );
                  })}
                  {filtrados.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground text-sm">Nenhuma leitura</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Encerrar */}
        {isAdmin && inv?.status === "aberto" && (
          <div className="pt-2">
            <Button
              variant="destructive"
              size="lg"
              className="gap-2"
              onClick={() => { setConfirmandoEncerrar(true); setConfirmTexto(""); }}
            >
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
          <Input
            value={confirmTexto}
            onChange={(e) => setConfirmTexto(e.target.value)}
            placeholder="ENCERRAR"
            className="font-mono"
          />
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
