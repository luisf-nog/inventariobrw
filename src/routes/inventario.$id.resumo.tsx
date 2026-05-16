import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download, Lock } from "lucide-react";
import { toast } from "sonner";
import { buscarDescricoesPorSku, traduzirEansParaSkus } from "@/lib/produtos";
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

  // Detecta divergências: mesma posição+produto com contagens diferentes em quantidades diferentes
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

  const stats = useMemo(() => {
    const posicoes = new Set(linhas.map((l) => l.codigo_posicao));
    const operadores = new Set(linhas.map((l) => l.operador_id).filter(Boolean));
    return { posicoes: posicoes.size, leituras: linhas.length, operadores: operadores.size };
  }, [linhas]);

  function exportarCSV() {
    const header = ["posicao", "produto", "descricao", "contagem", "quantidade", "operador", "lido_em"];
    const rows = filtrados.map((l) => [l.codigo_posicao, l.sku, l.descricao, l.numero_contagem, l.quantidade, l.operador_nome ?? "", l.lido_em]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventario-${inv?.nome ?? id}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
    <div className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/inventarios" })}><ArrowLeft className="h-5 w-5" /></Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{inv?.nome}</h1>
          {inv?.status === "encerrado" && <Badge variant="secondary">Encerrado</Badge>}
        </div>
        <Button onClick={exportarCSV} variant="outline" size="sm"><Download className="h-4 w-4 mr-1" /> CSV</Button>
      </header>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border"><p className="text-xs text-muted-foreground">Posições</p><p className="text-2xl font-bold">{stats.posicoes}</p></div>
        <div className="bg-card rounded-xl p-4 border border-border"><p className="text-xs text-muted-foreground">Leituras</p><p className="text-2xl font-bold">{stats.leituras}</p></div>
        <div className="bg-card rounded-xl p-4 border border-border"><p className="text-xs text-muted-foreground">Operadores</p><p className="text-2xl font-bold">{stats.operadores}</p></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
        <Input placeholder="Filtrar posição" value={filtroPos} onChange={(e) => setFiltroPos(e.target.value)} />
        <Input placeholder="Filtrar produto" value={filtroProd} onChange={(e) => setFiltroProd(e.target.value)} />
        <Input placeholder="Filtrar operador" value={filtroOp} onChange={(e) => setFiltroOp(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr className="text-left">
                  <th className="px-3 py-2">Posição</th>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2 text-center">Contagem</th>
                  <th className="px-3 py-2 text-right">Quantidade</th>
                  <th className="px-3 py-2">Operadores</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((l) => {
                  const div = divergencias.has(`${l.codigo_posicao}|${l.sku}`);
                  return (
                    <tr key={l.id} className={`border-t border-border ${div ? "bg-destructive/10" : ""}`}>
                      <td className="px-3 py-2 font-mono">{l.codigo_posicao}</td>
                      <td className="px-3 py-2 font-mono">{l.sku}</td>
                      <td className="px-3 py-2 text-xs max-w-xs truncate" title={l.descricao}>
                        {l.descricao || <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">{l.numero_contagem}</td>
                      <td className="px-3 py-2 text-right font-semibold">{l.quantidade} {div && <span className="text-destructive">⚠</span>}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.operador_nome ?? "—"}</td>
                    </tr>
                  );
                })}
                {filtrados.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Nenhuma leitura</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isAdmin && inv?.status === "aberto" && (
        <div className="mt-6">
          <Button variant="destructive" size="lg" onClick={() => { setConfirmandoEncerrar(true); setConfirmTexto(""); }}>
            <Lock className="h-4 w-4 mr-2" /> Encerrar inventário
          </Button>
        </div>
      )}

      {!isAdmin && (
        <p className="mt-6 text-xs text-muted-foreground">
          Para encerrar o inventário, faça login como <Link to="/admin" className="text-primary underline">supervisor</Link>.
        </p>
      )}

      <AlertDialog open={confirmandoEncerrar} onOpenChange={setConfirmandoEncerrar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar inventário</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação impede novas leituras. Digite <strong>ENCERRAR</strong> para confirmar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={confirmTexto} onChange={(e) => setConfirmTexto(e.target.value)} placeholder="ENCERRAR" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={encerrar} className="bg-destructive">Confirmar encerramento</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
