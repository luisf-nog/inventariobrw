import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOperador, clearOperador } from "@/lib/operador-session";
import { beepSuccess, beepWarn, beepError } from "@/lib/feedback";
import { normalizeCode, isValidCode, parseQuantidade } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { LogOut, Trash2, FileText, MapPin, Barcode, Hash, Wifi, WifiOff } from "lucide-react";
import { PosicaoJaContadaModal, type AcaoPosicao, type LeituraExistente } from "@/components/PosicaoJaContadaModal";
import { enqueueLeitura, getQueueForInventario, removeFromQueue } from "@/lib/offline-queue";
import { useOfflineSync } from "@/hooks/use-offline-sync";

export const Route = createFileRoute("/inventario/$id/contagem")({
  component: TelaContagem,
});

type Etapa = "posicao" | "produto" | "quantidade";

type LeituraSessao = {
  id: string;
  codigo_posicao: string;
  codigo_produto: string;
  quantidade: number;
  numero_contagem: number;
  lido_em: string;
};

function TelaContagem() {
  const { id: inventarioId } = Route.useParams();
  const navigate = useNavigate();
  const [op, setOp] = useState<{ id: string; nome: string } | null>(null);
  const [inv, setInv] = useState<{ nome: string; status: string } | null>(null);
  const { online, pending } = useOfflineSync();

  const [etapa, setEtapa] = useState<Etapa>("posicao");
  const [posicao, setPosicao] = useState("");
  const [produto, setProduto] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [numeroContagem, setNumeroContagem] = useState(1);

  const [leiturasSessao, setLeiturasSessao] = useState<LeituraSessao[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LeituraSessao | null>(null);

  const [modalDup, setModalDup] = useState<{ leituras: LeituraExistente[]; contagemAtual: number } | null>(null);

  const refPos = useRef<HTMLInputElement>(null);
  const refProd = useRef<HTMLInputElement>(null);
  const refQtd = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const o = getOperador();
    if (!o) { navigate({ to: "/" }); return; }
    setOp(o);
    supabase.from("inventarios").select("nome, status").eq("id", inventarioId).single()
      .then(({ data, error }) => {
        if (error || !data) { toast.error("Inventário não encontrado"); navigate({ to: "/inventarios" }); return; }
        if (data.status !== "aberto") { toast.error("Inventário encerrado"); navigate({ to: "/inventarios" }); return; }
        setInv(data);
      });
  }, [inventarioId, navigate]);

  useEffect(() => {
    if (etapa === "posicao") refPos.current?.focus();
    else if (etapa === "produto") refProd.current?.focus();
    else if (etapa === "quantidade") refQtd.current?.focus();
  }, [etapa]);

  const checarPosicao = useCallback(async (codPos: string): Promise<LeituraExistente[] | null> => {
    const locais: LeituraExistente[] = getQueueForInventario(inventarioId)
      .filter((q) => q.codigo_posicao === codPos)
      .map((q) => ({
        codigo_produto: q.codigo_produto,
        quantidade: q.quantidade,
        numero_contagem: q.numero_contagem,
        lido_em: q.lido_em,
        operador_nome: q.operador_nome ?? null,
      }));
    if (!navigator.onLine) return locais;
    const { data, error } = await supabase
      .from("leituras")
      .select("codigo_produto, quantidade, numero_contagem, lido_em, operador_id, operadores(nome)")
      .eq("inventario_id", inventarioId)
      .eq("codigo_posicao", codPos)
      .order("lido_em", { ascending: false });
    if (error) {
      // se rede falhar, usa só locais
      return locais;
    }
    const remotas: LeituraExistente[] = (data ?? []).map((d: any) => ({
      codigo_produto: d.codigo_produto,
      quantidade: Number(d.quantidade),
      numero_contagem: d.numero_contagem,
      lido_em: d.lido_em,
      operador_nome: d.operadores?.nome ?? null,
    }));
    return [...locais, ...remotas].sort((a, b) => b.lido_em.localeCompare(a.lido_em));
  }, [inventarioId]);

  async function confirmarPosicao() {
    const cod = normalizeCode(posicao);
    if (!isValidCode(cod)) { beepError(); toast.error("Posição inválida (mínimo 3 caracteres)"); return; }
    setPosicao(cod);
    const existentes = await checarPosicao(cod);
    if (existentes === null) return;
    if (existentes.length > 0) {
      beepWarn();
      const maxContagem = Math.max(...existentes.map((e) => e.numero_contagem));
      setModalDup({ leituras: existentes, contagemAtual: maxContagem });
      return;
    }
    setNumeroContagem(1);
    setEtapa("produto");
  }

  function escolherAcaoDup(acao: AcaoPosicao) {
    if (!modalDup) return;
    const atual = modalDup.contagemAtual;
    setModalDup(null);
    if (acao === "pular") {
      setPosicao("");
      setEtapa("posicao");
      return;
    }
    setNumeroContagem(acao === "nova_contagem" ? atual + 1 : atual);
    setEtapa("produto");
  }

  function confirmarProduto() {
    const cod = normalizeCode(produto);
    if (!isValidCode(cod)) { beepError(); toast.error("Produto inválido (mínimo 3 caracteres)"); return; }
    setProduto(cod);
    setQuantidade("");
    setEtapa("quantidade");
  }

  async function gravar() {
    const qtd = parseQuantidade(quantidade);
    if (qtd === null) { beepError(); toast.error("Quantidade inválida"); return; }
    if (!op) return;
    setSalvando(true);
    const { data, error } = await supabase
      .from("leituras")
      .insert({
        inventario_id: inventarioId,
        codigo_posicao: posicao,
        codigo_produto: produto,
        quantidade: qtd,
        numero_contagem: numeroContagem,
        operador_id: op.id,
      })
      .select("id, lido_em")
      .single();
    setSalvando(false);
    if (error || !data) { beepError(); toast.error("Erro: " + (error?.message ?? "?")); return; }
    beepSuccess();
    setLeiturasSessao((prev) => [
      { id: data.id, codigo_posicao: posicao, codigo_produto: produto, quantidade: qtd, numero_contagem: numeroContagem, lido_em: data.lido_em },
      ...prev,
    ].slice(0, 50));
    // mantém posição e numeroContagem, limpa produto/qtd
    setProduto("");
    setQuantidade("");
    setEtapa("produto");
  }

  async function excluirUltima() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    const { error } = await supabase.from("leituras").delete().eq("id", id);
    if (error) { toast.error("Erro: " + error.message); return; }
    setLeiturasSessao((prev) => prev.filter((l) => l.id !== id));
    toast.success("Leitura removida");
  }

  function trocarPosicao() {
    setPosicao(""); setProduto(""); setQuantidade("");
    setNumeroContagem(1);
    setEtapa("posicao");
  }

  function sair() {
    clearOperador();
    navigate({ to: "/" });
  }

  const ultimaId = leiturasSessao[0]?.id;

  return (
    <div className="min-h-screen pb-4">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{inv?.nome ?? "..."}</p>
          <p className="text-sm font-semibold truncate">{op?.nome}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="text-xs">{leiturasSessao.length} nesta sessão</Badge>
          <Link to="/inventario/$id/resumo" params={{ id: inventarioId }}>
            <Button variant="ghost" size="icon" aria-label="Resumo"><FileText className="h-4 w-4" /></Button>
          </Link>
          <Button variant="ghost" size="icon" onClick={sair} aria-label="Sair"><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>

      <main className="px-4 py-4 max-w-2xl mx-auto space-y-3">
        {/* POSIÇÃO */}
        <div className={`rounded-xl border p-4 ${etapa === "posicao" ? "bg-card border-primary" : "bg-card/50 border-border"}`}>
          <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <MapPin className="h-4 w-4" /> Posição
            {numeroContagem > 1 && etapa !== "posicao" && (
              <Badge className="bg-warning text-warning-foreground">{numeroContagem}ª contagem</Badge>
            )}
          </label>
          {etapa === "posicao" ? (
            <Input
              ref={refPos}
              autoFocus
              value={posicao}
              onChange={(e) => setPosicao(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmarPosicao(); } }}
              placeholder="Bipe a posição"
              className="h-16 text-2xl font-mono tracking-wider"
              autoComplete="off"
              autoCapitalize="characters"
            />
          ) : (
            <button onClick={trocarPosicao} className="w-full text-left text-2xl font-mono font-bold py-2 hover:text-primary">
              {posicao}
              <span className="ml-2 text-xs text-muted-foreground font-sans">(tocar para trocar)</span>
            </button>
          )}
        </div>

        {/* PRODUTO */}
        {etapa !== "posicao" && (
          <div className={`rounded-xl border p-4 ${etapa === "produto" ? "bg-card border-primary" : "bg-card/50 border-border"}`}>
            <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Barcode className="h-4 w-4" /> Produto
            </label>
            {etapa === "produto" ? (
              <Input
                ref={refProd}
                autoFocus
                value={produto}
                onChange={(e) => setProduto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmarProduto(); } }}
                placeholder="Bipe o produto"
                className="h-16 text-2xl font-mono tracking-wider"
                autoComplete="off"
                autoCapitalize="characters"
              />
            ) : (
              <p className="text-2xl font-mono font-bold py-2">{produto}</p>
            )}
          </div>
        )}

        {/* QUANTIDADE */}
        {etapa === "quantidade" && (
          <div className="rounded-xl border border-primary bg-card p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Hash className="h-4 w-4" /> Quantidade
            </label>
            <Input
              ref={refQtd}
              autoFocus
              inputMode="decimal"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); gravar(); } }}
              placeholder="0"
              className="h-20 text-4xl text-center font-bold"
              autoComplete="off"
            />
            <div className="grid grid-cols-4 gap-2">
              {[1, 5, 10].map((n) => (
                <Button key={n} variant="secondary" size="lg" className="h-12 text-base"
                  onClick={() => setQuantidade(String((parseQuantidade(quantidade) ?? 0) + n))}>
                  +{n}
                </Button>
              ))}
              <Button variant="outline" size="lg" className="h-12" onClick={() => setQuantidade("")}>Limpar</Button>
            </div>
            <Button
              onClick={gravar}
              disabled={salvando}
              size="lg"
              className="w-full h-16 text-xl font-bold bg-primary hover:bg-primary/90"
            >
              {salvando ? "Salvando..." : "✓ CONFIRMAR"}
            </Button>
          </div>
        )}

        {/* Últimas leituras */}
        {leiturasSessao.length > 0 && (
          <div className="rounded-xl border border-border bg-card/50 p-4 mt-6">
            <p className="text-sm text-muted-foreground mb-2">Últimas leituras</p>
            <div className="space-y-1.5 font-mono text-sm">
              {leiturasSessao.slice(0, 5).map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-0">
                  <div className="min-w-0 flex-1">
                    <span className="text-muted-foreground">{l.codigo_posicao}</span>
                    <span className="mx-1.5 text-muted-foreground/50">›</span>
                    <span className="truncate">{l.codigo_produto}</span>
                  </div>
                  <span className="shrink-0">{l.quantidade} <span className="text-xs text-muted-foreground">(c{l.numero_contagem})</span></span>
                  {l.id === ultimaId && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setConfirmDelete(l)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {modalDup && (
        <PosicaoJaContadaModal
          open
          posicao={posicao}
          contagemAtual={modalDup.contagemAtual}
          leituras={modalDup.leituras}
          onClose={() => { setModalDup(null); setPosicao(""); setEtapa("posicao"); }}
          onEscolher={escolherAcaoDup}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta leitura?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.codigo_posicao} › {confirmDelete?.codigo_produto} — {confirmDelete?.quantidade}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={excluirUltima} className="bg-destructive">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
