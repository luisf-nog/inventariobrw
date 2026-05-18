import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOperador, clearOperador } from "@/lib/operador-session";
import { beepSuccess, beepWarn, beepError } from "@/lib/feedback";
import { normalizeCode, isValidCode, parseQuantidade } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LogOut, MapPin, Barcode, Hash, Wifi, WifiOff, CheckCircle2 } from "lucide-react";
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
    } else if (etapa === "posicao") {
      window.requestAnimationFrame(() => refPos.current?.focus({ preventScroll: true }));
    } else if (etapa === "produto") {
      window.requestAnimationFrame(() => refProd.current?.focus({ preventScroll: true }));
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
      .map(({ codigo_posicao: _codigo_posicao, ...l }) => l);
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
    if (acao === "pular") {
      setPosicao("");
      setEtapa("posicao");
      return;
    }
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

  async function gravar() {
    const qtd = parseQuantidade(quantidade);
    if (qtd === null) { beepError(); toast.error("Quantidade inválida"); return; }
    if (!op) return;
    setSalvando(true);
    const lidoEm = new Date().toISOString();
    let offline = false;
    if (!navigator.onLine) {
      enqueueLeitura({
        inventario_id: inventarioId,
        codigo_posicao: posicao,
        codigo_produto: produtoSku,
        quantidade: qtd,
        numero_contagem: numeroContagem,
        operador_id: op.id,
        operador_nome: op.nome,
        lido_em: lidoEm,
      });
      offline = true;
    } else {
      const { error } = await supabase
        .from("leituras")
        .insert({
          inventario_id: inventarioId,
          codigo_posicao: posicao,
          codigo_produto: produtoSku,
          quantidade: qtd,
          numero_contagem: numeroContagem,
          operador_id: op.id,
          lido_em: lidoEm,
        });
      if (error) {
        enqueueLeitura({
          inventario_id: inventarioId,
          codigo_posicao: posicao,
          codigo_produto: produtoSku,
          quantidade: qtd,
          numero_contagem: numeroContagem,
          operador_id: op.id,
          operador_nome: op.nome,
          lido_em: lidoEm,
        });
        offline = true;
      }
    }
    setSalvando(false);
    if (!offline) {
      setLeiturasCache((atuais) => [{
        codigo_posicao: posicao,
        codigo_produto: produtoSku,
        quantidade: qtd,
        numero_contagem: numeroContagem,
        operador_nome: op.nome,
        lido_em: lidoEm,
      }, ...atuais]);
    }
    beepSuccess();
    setUltima({ posicao, sku: produtoSku, desc: produtoDesc, qtd, contagem: numeroContagem });
    if (offline) toast.warning("Salvo offline — será sincronizado");
    // Continua na mesma posição, volta pra etapa de produto
    setProdutoInput("");
    setProdutoSku("");
    setProdutoDesc(null);
    setQuantidade("");
    setEtapa("produto");
  }

  function trocarPosicao() {
    scanBufferRef.current = "";
    setPosicao(""); setProdutoInput(""); setProdutoSku(""); setProdutoDesc(null); setQuantidade("");
    setNumeroContagem(1);
    setEtapa("posicao");
  }

  useEffect(() => {
    if (modalDup || (etapa !== "posicao" && etapa !== "produto")) return;

    const SCANNER_GAP_MS = 50; // intervalo máximo entre teclas pra considerar scanner
    const MIN_SCAN_LEN = 2;

    const onScannerKey = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Ignora se foco está num campo de quantidade ou em outro input editável
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "TEXTAREA" || (ae.tagName === "INPUT" && ae !== refPos.current && ae !== refProd.current))) {
        return;
      }

      const now = performance.now();
      const delta = now - lastKeyTimeRef.current;

      if (e.key === "Enter" || e.key === "Tab") {
        const buffer = scanBufferRef.current;
        if (buffer.length >= MIN_SCAN_LEN) {
          e.preventDefault();
          e.stopPropagation();
          scanBufferRef.current = "";
          setScanDisplay("");
          lastKeyTimeRef.current = 0;
          if (etapa === "posicao") void confirmarPosicao(buffer);
          else void confirmarProduto(buffer);
        }
        return;
      }

      if (e.key.length === 1) {
        // Reseta buffer se intervalo grande (digitação humana ou nova leitura)
        if (delta > SCANNER_GAP_MS && scanBufferRef.current.length > 0) {
          scanBufferRef.current = "";
        }
        scanBufferRef.current += e.key;
        setScanDisplay(scanBufferRef.current);
        lastKeyTimeRef.current = now;
        e.preventDefault();
      } else if (e.key === "Backspace") {
        scanBufferRef.current = scanBufferRef.current.slice(0, -1);
        setScanDisplay(scanBufferRef.current);
      }
    };

    window.addEventListener("keydown", onScannerKey, true);
    return () => window.removeEventListener("keydown", onScannerKey, true);
  }, [etapa, modalDup, confirmarPosicao, confirmarProduto]);

  function sair() {
    clearOperador();
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen pb-2 bg-background">
      <header className="sticky top-0 z-10 bg-background border-b border-border px-2 py-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground truncate leading-tight">{inv?.nome ?? "..."}</p>
          <p className="text-xs font-semibold truncate leading-tight">{op?.nome}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge
            variant={online ? "secondary" : "destructive"}
            className="text-[10px] gap-1 px-1.5 py-0"
            title={online ? "Online" : "Offline"}
          >
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {pending > 0 ? `${pending}` : online ? "on" : "off"}
          </Badge>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={sair} aria-label="Sair"><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>

      <main className="px-2 py-2 max-w-2xl mx-auto space-y-2">
        {/* Toast persistente de confirmação da última leitura */}
        {ultima && (
          <div className="rounded-lg border border-success bg-success/10 px-2 py-1.5 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs leading-tight">
                <span className="text-muted-foreground">{ultima.posicao}</span>
                <span className="mx-1 text-muted-foreground/50">›</span>
                <span className="font-bold">{ultima.sku}</span>
                <span className="ml-1.5 font-bold text-success">{ultima.qtd}</span>
                {ultima.contagem > 1 && <span className="ml-1 text-[10px] text-muted-foreground">(c{ultima.contagem})</span>}
              </p>
              {ultima.desc && <p className="text-[10px] text-muted-foreground truncate leading-tight">{ultima.desc}</p>}
            </div>
          </div>
        )}

        {/* POSIÇÃO */}
        <div className={`rounded-lg border p-2 ${etapa === "posicao" ? "bg-card border-primary" : "bg-card/50 border-border"}`}>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <MapPin className="h-3 w-3" /> Endereço
            {numeroContagem > 1 && etapa !== "posicao" && (
              <Badge className="bg-warning text-warning-foreground text-[10px] px-1.5 py-0">{numeroContagem}ª</Badge>
            )}
          </label>
          {etapa === "posicao" ? (
            <div
              ref={(el) => { /* visual only */ }}
              className="h-12 px-3 rounded-md border border-input bg-background flex items-center text-xl font-mono tracking-wider"
              aria-label="Aguardando leitura da posição"
            >
              <input
                ref={refPos}
                type="text"
                inputMode="none"
                value={scanDisplay}
                onChange={() => {}}
                onBlur={(e) => {
                  const goingToDialog = e.relatedTarget instanceof Element && !!e.relatedTarget.closest('[role="dialog"]');
                  if (!goingToDialog) window.requestAnimationFrame(() => refPos.current?.focus({ preventScroll: true }));
                }}
                className="sr-only"
                tabIndex={0}
                aria-label="Scanner de posição"
              />
              {scanDisplay || <span className="text-muted-foreground/60 text-base">Bipe o endereço…</span>}
              {scanDisplay && <span className="ml-1 animate-pulse">|</span>}
            </div>
          ) : (
            <button onClick={trocarPosicao} className="w-full text-left text-lg font-mono font-bold leading-tight hover:text-primary">
              {posicao}
              <span className="ml-2 text-[10px] text-muted-foreground font-sans">(trocar)</span>
            </button>
          )}
        </div>

        {/* PRODUTO */}
        {etapa !== "posicao" && (
          <div className={`rounded-lg border p-2 ${etapa === "produto" ? "bg-card border-primary" : "bg-card/50 border-border"}`}>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Barcode className="h-3 w-3" /> Produto
            </label>
            {etapa === "produto" ? (
              <div
                className="h-12 px-3 rounded-md border border-input bg-background flex items-center text-xl font-mono tracking-wider"
                aria-label="Aguardando leitura do produto"
              >
                <input
                  ref={refProd}
                  type="text"
                  inputMode="none"
                  value={scanDisplay}
                  onChange={() => {}}
                  onBlur={(e) => {
                    const goingToDialog = e.relatedTarget instanceof Element && !!e.relatedTarget.closest('[role="dialog"]');
                    if (!goingToDialog) window.requestAnimationFrame(() => refProd.current?.focus({ preventScroll: true }));
                  }}
                  className="sr-only"
                  tabIndex={0}
                  aria-label="Scanner de produto"
                />
                {scanDisplay || <span className="text-muted-foreground/60 text-base">Bipe o código…</span>}
                {scanDisplay && <span className="ml-1 animate-pulse">|</span>}
              </div>
            ) : (
              <div>
                <p className="text-lg font-mono font-bold leading-tight">{produtoSku}</p>
                {produtoDesc && <p className="text-[11px] text-muted-foreground leading-tight truncate">{produtoDesc}</p>}
              </div>
            )}
          </div>
        )}

        {/* QUANTIDADE */}
        {etapa === "quantidade" && (
          <div className="rounded-lg border border-primary bg-card p-2 space-y-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Hash className="h-3 w-3" /> Quantidade
            </label>
            <Input
              ref={refQtd}
              type="text"
              autoFocus
              inputMode="decimal"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); gravar(); } }}
              placeholder="0"
              className="h-14 text-3xl text-center font-bold"
              autoComplete="off"
            />
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 5, 10].map((n) => (
                <Button key={n} variant="secondary" size="sm" className="h-9 text-sm"
                  onClick={() => setQuantidade(String((parseQuantidade(quantidade) ?? 0) + n))}>
                  +{n}
                </Button>
              ))}
              <Button variant="outline" size="sm" className="h-9" onClick={() => setQuantidade("")}>Limpar</Button>
            </div>
            <Button
              onClick={gravar}
              disabled={salvando}
              className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90"
            >
              {salvando ? "Salvando..." : "✓ CONFIRMAR"}
            </Button>
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
    </div>
  );
}
