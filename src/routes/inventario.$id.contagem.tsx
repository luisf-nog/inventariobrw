import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOperador, clearOperador } from "@/lib/operador-session";
import { beepSuccess, beepWarn, beepError } from "@/lib/feedback";
import { normalizeCode, isValidCode, parseQuantidade, formatPosicaoDisplay } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LogOut, MapPin, Barcode, Hash, Wifi, WifiOff, CheckCircle2, PackageCheck } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { PosicaoJaContadaModal, type AcaoPosicao, type LeituraExistente } from "@/components/PosicaoJaContadaModal";
import { enqueueLeitura, getQueueForInventario } from "@/lib/offline-queue";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { resolverProdutoPorCodigo } from "@/lib/produtos";

export const Route = createFileRoute("/inventario/$id/contagem")({
  component: TelaContagem,
});

type Etapa = "posicao" | "produto" | "quantidade";
type LeituraCache = LeituraExistente & { codigo_posicao: string };

function TelaContagem() {
  const { id: inventarioId } = Route.useParams();
  const navigate = useNavigate();
  const [op, setOp] = useState<{ id: string; nome: string } | null>(null);
  const [inv, setInv] = useState<{ nome: string; status: string } | null>(null);
  const { online, pending } = useOfflineSync();

  const [etapa, setEtapa] = useState<Etapa>("posicao");
  const [posicao, setPosicao] = useState("");
  const [produtoInput, setProdutoInput] = useState("");
  const [produtoSku, setProdutoSku] = useState("");
  const [produtoDesc, setProdutoDesc] = useState<string | null>(null);
  const [quantidade, setQuantidade] = useState("");
  const [numeroContagem, setNumeroContagem] = useState(1);

  const [salvando, setSalvando] = useState(false);
  const [ultima, setUltima] = useState<{ posicao: string; sku: string; desc: string | null; qtd: number; contagem: number } | null>(null);
  const [confirmandoLeitura, setConfirmandoLeitura] = useState(false);

  const [modalDup, setModalDup] = useState<{ leituras: LeituraExistente[]; contagemAtual: number } | null>(null);
  const [leiturasCache, setLeiturasCache] = useState<LeituraCache[]>([]);

  const refPos = useRef<HTMLInputElement>(null);
  const refProd = useRef<HTMLInputElement>(null);
  const refQtd = useRef<HTMLInputElement>(null);
  const scanBufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const [scanDisplay, setScanDisplay] = useState("");

  const carregarLeiturasExistentes = useCallback(async () => {
    if (!navigator.onLine) return;
    const { data, error } = await supabase
      .from("leituras")
      .select("codigo_posicao, codigo_produto, quantidade, numero_contagem, lido_em, operador_id, operadores(nome)")
      .eq("inventario_id", inventarioId)
      .order("lido_em", { ascending: false });
    if (error) return;
    setLeiturasCache((data ?? []).map((d: any) => ({
      codigo_posicao: d.codigo_posicao,
      codigo_produto: d.codigo_produto,
      quantidade: Number(d.quantidade),
      numero_contagem: d.numero_contagem,
      lido_em: d.lido_em,
      operador_nome: d.operadores?.nome ?? null,
    })));
  }, [inventarioId]);

  useEffect(() => {
    const o = getOperador();
    if (!o) { navigate({ to: "/" }); return; }
    setOp(o);
    supabase.from("inventarios").select("nome, status").eq("id", inventarioId).single()
      .then(({ data, error }) => {
        if (error || !data) { toast.error("Inventário não encontrado"); navigate({ to: "/inventarios" }); return; }
        if (data.status !== "aberto") { toast.error("Inventário encerrado"); navigate({ to: "/inventarios" }); return; }
        setInv(data);
        void carregarLeiturasExistentes();
      });
  }, [inventarioId, navigate, carregarLeiturasExistentes]);

  useEffect(() => {
    scanBufferRef.current = "";
    setScanDisplay("");
    lastKeyTimeRef.current = 0;
    if (etapa === "quantidade") {
      window.requestAnimationFrame(() => refQtd.current?.focus({ preventScroll: true }));
    }
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
    const remotas: LeituraExistente[] = leiturasCache
      .filter((l) => l.codigo_posicao === codPos)
      .map(({ codigo_posicao: _c, ...l }) => l);
    return [...locais, ...remotas].sort((a, b) => b.lido_em.localeCompare(a.lido_em));
  }, [inventarioId, leiturasCache]);

  const confirmarPosicao = useCallback(async (valor?: string) => {
    const cod = normalizeCode(valor ?? posicao);
    scanBufferRef.current = "";
    if (!cod) { beepError(); toast.error("Bipe a posição"); return; }
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
  }, [posicao, checarPosicao]);

  function escolherAcaoDup(acao: AcaoPosicao) {
    if (!modalDup) return;
    const atual = modalDup.contagemAtual;
    setModalDup(null);
    if (acao === "pular") { setPosicao(""); setEtapa("posicao"); return; }
    setNumeroContagem(acao === "nova_contagem" ? atual + 1 : atual);
    setEtapa("produto");
  }

  const confirmarProduto = useCallback(async (valor?: string) => {
    const codRaw = (valor ?? produtoInput).trim();
    scanBufferRef.current = "";
    if (!isValidCode(codRaw)) { beepError(); toast.error("Produto inválido"); return; }
    let sku = normalizeCode(codRaw);
    let desc: string | null = null;
    if (navigator.onLine) {
      const produto = await resolverProdutoPorCodigo(codRaw);
      sku = produto.sku;
      desc = produto.descricao;
    }
    if (!desc) {
      beepWarn();
      toast.warning(`Produto ${sku} não cadastrado — será gravado mesmo assim`);
    }
    setProdutoSku(sku);
    setProdutoDesc(desc);
    setQuantidade("");
    setEtapa("quantidade");
  }, [produtoInput]);

  function pedirConfirmacao() {
    const qtd = parseQuantidade(quantidade);
    if (qtd === null) { beepError(); toast.error("Quantidade inválida"); return; }
    setConfirmandoLeitura(true);
  }

  async function gravar() {
    const qtd = parseQuantidade(quantidade);
    if (qtd === null) return;
    if (!op) return;
    setConfirmandoLeitura(false);
    setSalvando(true);
    const lidoEm = new Date().toISOString();
    let offline = false;
    if (!navigator.onLine) {
      enqueueLeitura({ inventario_id: inventarioId, codigo_posicao: posicao, codigo_produto: produtoSku, quantidade: qtd, numero_contagem: numeroContagem, operador_id: op.id, operador_nome: op.nome, lido_em: lidoEm });
      offline = true;
    } else {
      const { error } = await supabase.from("leituras").insert({ inventario_id: inventarioId, codigo_posicao: posicao, codigo_produto: produtoSku, quantidade: qtd, numero_contagem: numeroContagem, operador_id: op.id, lido_em: lidoEm });
      if (error) {
        enqueueLeitura({ inventario_id: inventarioId, codigo_posicao: posicao, codigo_produto: produtoSku, quantidade: qtd, numero_contagem: numeroContagem, operador_id: op.id, operador_nome: op.nome, lido_em: lidoEm });
        offline = true;
      }
    }
    setSalvando(false);
    if (!offline) {
      setLeiturasCache((prev) => [{ codigo_posicao: posicao, codigo_produto: produtoSku, quantidade: qtd, numero_contagem: numeroContagem, operador_nome: op.nome, lido_em: lidoEm }, ...prev]);
    }
    beepSuccess();
    setUltima({ posicao, sku: produtoSku, desc: produtoDesc, qtd, contagem: numeroContagem });
    if (offline) toast.warning("Salvo offline — será sincronizado");
    setPosicao(""); setProdutoInput(""); setProdutoSku(""); setProdutoDesc(null); setQuantidade(""); setNumeroContagem(1);
    setEtapa("posicao");
  }

  function trocarPosicao() {
    scanBufferRef.current = "";
    setPosicao(""); setProdutoInput(""); setProdutoSku(""); setProdutoDesc(null); setQuantidade(""); setNumeroContagem(1);
    setEtapa("posicao");
  }

  function sair() { clearOperador(); navigate({ to: "/" }); }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate leading-none">{inv?.nome ?? "..."}</p>
            <p className="text-sm font-semibold truncate leading-tight mt-0.5">{op?.nome}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-medium ${
              online
                ? "text-success border-success/30 bg-success/10"
                : "text-destructive border-destructive/30 bg-destructive/10"
            }`}>
              {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {pending > 0 ? `${pending}` : online ? "on" : "off"}
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={sair} aria-label="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Última leitura */}
      {ultima && (
        <div className="bg-success/8 border-b border-success/20">
          <div className="max-w-lg mx-auto px-4 py-2.5 flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-mono leading-snug">
                <span className="text-muted-foreground">{formatPosicaoDisplay(ultima.posicao)}</span>
                <span className="mx-1.5 text-muted-foreground/40">›</span>
                <span className="font-semibold">{ultima.sku}</span>
                <span className="mx-1.5 text-muted-foreground/40">·</span>
                <span className="font-bold text-success">{ultima.qtd}</span>
                {ultima.contagem > 1 && <span className="ml-1.5 text-[10px] text-muted-foreground">{ultima.contagem}ª c.</span>}
              </p>
              {ultima.desc && <p className="text-[10px] text-muted-foreground truncate mt-0.5">{ultima.desc}</p>}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {/* ENDEREÇO */}
        <div className={`rounded-xl overflow-hidden border bg-card ${etapa === "posicao" ? "border-primary" : "border-border"}`}>
          <div className={`px-4 py-2.5 border-b border-border/50 flex items-center gap-2 ${etapa === "posicao" ? "bg-primary/5" : ""}`}>
            <div className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
              etapa === "posicao" ? "bg-primary text-primary-foreground" : "bg-success/20 text-success"
            }`}>
              {etapa === "posicao" ? "1" : "✓"}
            </div>
            <MapPin className={`h-3.5 w-3.5 ${etapa === "posicao" ? "text-primary" : "text-muted-foreground"}`} />
            <span className={`text-xs font-medium uppercase tracking-wide ${etapa === "posicao" ? "text-primary" : "text-muted-foreground"}`}>
              Endereço
            </span>
            {numeroContagem > 1 && etapa !== "posicao" && (
              <Badge className="ml-auto bg-warning/15 text-warning border-warning/25 text-[10px] px-1.5 py-0 h-5">{numeroContagem}ª</Badge>
            )}
          </div>
          <div className="px-4 py-3">
            {etapa === "posicao" ? (
              <input
                ref={refPos}
                type="text"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onChange={(e) => setScanDisplay(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    const val = (refPos.current?.value ?? "").trim();
                    if (refPos.current) refPos.current.value = "";
                    setScanDisplay("");
                    scanBufferRef.current = "";
                    if (val.length >= 2) void confirmarPosicao(val);
                  }
                }}
                onBlur={(e) => {
                  const goingToDialog = e.relatedTarget instanceof Element && !!e.relatedTarget.closest('[role="dialog"]');
                  if (!goingToDialog) window.requestAnimationFrame(() => refPos.current?.focus({ preventScroll: true }));
                }}
                placeholder="Bipe o código de endereço…"
                className="w-full h-14 bg-transparent text-2xl font-mono tracking-widest border-none outline-none ring-0 placeholder:text-muted-foreground/30 placeholder:text-sm placeholder:font-sans placeholder:tracking-normal focus:outline-none"
              />
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xl font-mono font-bold">{formatPosicaoDisplay(posicao)}</span>
                <button
                  onClick={trocarPosicao}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-md hover:bg-primary/10 shrink-0"
                >
                  trocar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* PRODUTO */}
        {etapa !== "posicao" && (
          <div className={`rounded-xl overflow-hidden border bg-card ${etapa === "produto" ? "border-primary" : "border-border"}`}>
            <div className={`px-4 py-2.5 border-b border-border/50 flex items-center gap-2 ${etapa === "produto" ? "bg-primary/5" : ""}`}>
              <div className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                etapa === "produto" ? "bg-primary text-primary-foreground" : "bg-success/20 text-success"
              }`}>
                {etapa === "produto" ? "2" : "✓"}
              </div>
              <Barcode className={`h-3.5 w-3.5 ${etapa === "produto" ? "text-primary" : "text-muted-foreground"}`} />
              <span className={`text-xs font-medium uppercase tracking-wide ${etapa === "produto" ? "text-primary" : "text-muted-foreground"}`}>
                Produto
              </span>
            </div>
            <div className="px-4 py-3">
              {etapa === "produto" ? (
                <input
                  ref={refProd}
                  type="text"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  onChange={(e) => setScanDisplay(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      const val = (refProd.current?.value ?? "").trim();
                      if (refProd.current) refProd.current.value = "";
                      setScanDisplay("");
                      scanBufferRef.current = "";
                      if (val.length >= 2) void confirmarProduto(val);
                    }
                  }}
                  onBlur={(e) => {
                    const goingToDialog = e.relatedTarget instanceof Element && !!e.relatedTarget.closest('[role="dialog"]');
                    if (!goingToDialog) window.requestAnimationFrame(() => refProd.current?.focus({ preventScroll: true }));
                  }}
                  placeholder="Bipe o código do produto…"
                  className="w-full h-14 bg-transparent text-2xl font-mono tracking-widest border-none outline-none ring-0 placeholder:text-muted-foreground/30 placeholder:text-sm placeholder:font-sans placeholder:tracking-normal focus:outline-none"
                />
              ) : (
                <div>
                  <p className="text-xl font-mono font-bold leading-tight">{produtoSku}</p>
                  {produtoDesc && <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{produtoDesc}</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* QUANTIDADE */}
        {etapa === "quantidade" && (
          <div className="rounded-xl overflow-hidden border border-primary bg-card">
            <div className="px-4 py-2.5 border-b border-border/50 flex items-center gap-2 bg-primary/5">
              <div className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center bg-primary text-primary-foreground shrink-0">3</div>
              <Hash className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium uppercase tracking-wide text-primary">Quantidade</span>
            </div>
            <div className="px-4 py-4 space-y-3">
              <Input
                ref={refQtd}
                type="text"
                autoFocus
                inputMode="decimal"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); pedirConfirmacao(); } }}
                placeholder="0"
                className="h-16 text-4xl text-center font-bold font-mono tracking-wider"
                autoComplete="off"
              />
              <div className="grid grid-cols-4 gap-2">
                {[1, 5, 10].map((n) => (
                  <Button key={n} variant="secondary" className="h-10 text-sm font-semibold"
                    onClick={() => setQuantidade(String((parseQuantidade(quantidade) ?? 0) + n))}>
                    +{n}
                  </Button>
                ))}
                <Button variant="outline" className="h-10 text-sm" onClick={() => setQuantidade("")}>
                  Limpar
                </Button>
              </div>
              <Button
                onClick={pedirConfirmacao}
                disabled={salvando || !quantidade.trim()}
                className="w-full h-14 text-base font-bold gap-2"
              >
                <PackageCheck className="h-5 w-5" /> Confirmar
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Popup de confirmação */}
      <Dialog open={confirmandoLeitura} onOpenChange={(open) => !open && setConfirmandoLeitura(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" /> Confirmar leitura
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg overflow-hidden border border-border divide-y divide-border">
            <div className="px-4 py-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Endereço</p>
              <p className="font-mono font-bold text-lg leading-tight">{formatPosicaoDisplay(posicao)}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Produto</p>
              <p className="font-mono font-bold text-lg leading-tight">{produtoSku}</p>
              {produtoDesc && <p className="text-xs text-muted-foreground mt-0.5">{produtoDesc}</p>}
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Quantidade</p>
              <p className="font-bold text-3xl text-primary leading-tight">{quantidade}</p>
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button onClick={gravar} disabled={salvando} className="w-full h-12 text-base font-bold gap-2">
              {salvando
                ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <><CheckCircle2 className="h-5 w-5" /> Confirmar</>}
            </Button>
            <Button variant="outline" onClick={() => setConfirmandoLeitura(false)} className="w-full h-10">
              Corrigir quantidade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
