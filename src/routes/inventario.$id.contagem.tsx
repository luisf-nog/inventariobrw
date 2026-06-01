import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOperador, clearOperador } from "@/lib/operador-session";
import { beepSuccess, beepWarn, beepError } from "@/lib/feedback";
import { normalizeCode, isValidCode, parseQuantidade, formatPosicaoDisplay } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PosicaoJaContadaModal, type AcaoPosicao, type LeituraExistente } from "@/components/PosicaoJaContadaModal";
import { enqueueLeitura, getQueueForInventario } from "@/lib/offline-queue";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { resolverProdutoPorCodigo } from "@/lib/produtos";

export const Route = createFileRoute("/inventario/$id/contagem")({
  component: TelaContagem,
});

type Etapa = "posicao" | "produto" | "quantidade";
type LeituraCache = LeituraExistente & { codigo_posicao: string; operador_id: string | null };

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#11141c",
  color: "#f1f3f7",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
};
const headerStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 20,
  background: "#11141c",
  borderBottom: "1px solid #2b3142",
  padding: "10px 10px 9px",
};
const headerInnerStyle: CSSProperties = { maxWidth: 520, margin: "0 auto" };
const headerTitleStyle: CSSProperties = { margin: 0, color: "#f1f3f7", fontSize: 13, lineHeight: 1.2, fontWeight: 800 };
const headerOpStyle: CSSProperties = { margin: "5px 0 0", color: "#f1f3f7", fontSize: 17, lineHeight: 1.15, fontWeight: 800 };
const headerActionsStyle: CSSProperties = { marginTop: 9, whiteSpace: "nowrap" };
const pillStyle: CSSProperties = {
  display: "inline-block",
  verticalAlign: "middle",
  marginRight: 8,
  padding: "5px 9px",
  borderRadius: 999,
  border: "1px solid #2b3142",
  background: "#1b1f2a",
  color: "#f1f3f7",
  fontSize: 12,
  lineHeight: 1,
  fontWeight: 800,
};
const logoutButtonStyle: CSSProperties = {
  display: "inline-block",
  verticalAlign: "middle",
  width: 36,
  height: 34,
  padding: 0,
  borderRadius: 8,
  border: "1px solid #2b3142",
  background: "#1b1f2a",
  color: "#f1f3f7",
};
const mainStyle: CSSProperties = { maxWidth: 520, margin: "0 auto", padding: "12px 10px 80px", boxSizing: "border-box" };
const lastReadStyle: CSSProperties = { background: "rgba(34,195,154,0.12)", borderBottom: "1px solid rgba(34,195,154,0.35)", padding: "9px 10px" };
const lastReadInnerStyle: CSSProperties = { maxWidth: 520, margin: "0 auto", color: "#f1f3f7", fontSize: 12, lineHeight: 1.35 };
const cardBaseStyle: CSSProperties = { marginBottom: 12, overflow: "hidden", borderRadius: 10, background: "#1b1f2a", color: "#f1f3f7" };
const cardBodyStyle: CSSProperties = { padding: "12px 12px 13px" };
const scanInputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: 58,
  padding: "0 2px",
  boxSizing: "border-box",
  background: "transparent",
  color: "#f1f3f7",
  border: 0,
  outline: "none",
  fontSize: 24,
  lineHeight: "58px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  letterSpacing: 1.5,
};
const readonlyValueStyle: CSSProperties = { margin: 0, color: "#f1f3f7", fontSize: 22, lineHeight: 1.2, fontWeight: 800, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };
const secondaryTextStyle: CSSProperties = { margin: "5px 0 0", color: "#aab2c4", fontSize: 12, lineHeight: 1.25 };
const smallButtonStyle: CSSProperties = { float: "right", marginLeft: 8, padding: "7px 9px", borderRadius: 8, border: "1px solid #2b3142", background: "#232838", color: "#22c39a", fontSize: 12, fontWeight: 800 };
const alertStyle: CSSProperties = { marginBottom: 12, padding: 12, borderRadius: 10, border: "2px solid #a78bfa", background: "#2d2446", color: "#f1f3f7" };
const qtyInputStyle: CSSProperties = { height: 64, textAlign: "center", fontSize: 36, fontWeight: 800, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", letterSpacing: 1, background: "#111827", color: "#f1f3f7", border: "1px solid #4b5875" };
const quickButtonsStyle: CSSProperties = { marginTop: 12, whiteSpace: "nowrap" };
const quickButtonStyle: CSSProperties = { display: "inline-block", width: "23%", height: 42, marginRight: "2%", padding: 0, borderRadius: 8, border: "1px solid #2b3142", background: "#232838", color: "#f1f3f7", fontSize: 14, fontWeight: 800 };
const confirmMainStyle: CSSProperties = { width: "100%", height: 56, marginTop: 12, borderRadius: 8, border: "1px solid #22c39a", background: "#22c39a", color: "#11141c", fontSize: 17, fontWeight: 900 };
const dialogRowStyle: CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #2b3142", background: "#172033" };
const dialogLabelStyle: CSSProperties = { display: "block", marginBottom: 4, color: "#aab2c4", fontSize: 10, textTransform: "uppercase", fontWeight: 800 };

function stepCardStyle(active: boolean): CSSProperties {
  return { ...cardBaseStyle, border: active ? "2px solid #22c39a" : "1px solid #2b3142" };
}

function stepHeaderStyle(active: boolean): CSSProperties {
  return { padding: "10px 12px", borderBottom: "1px solid #2b3142", background: active ? "rgba(34,195,154,0.12)" : "#1b1f2a", color: active ? "#22e6b3" : "#aab2c4" };
}

function stepNumberStyle(active: boolean, done: boolean): CSSProperties {
  return { display: "inline-block", verticalAlign: "middle", width: 22, height: 22, lineHeight: "22px", marginRight: 7, borderRadius: 99, background: active ? "#22c39a" : done ? "rgba(34,195,154,0.22)" : "#2b3142", color: active ? "#11141c" : "#22e6b3", textAlign: "center", fontSize: 11, fontWeight: 900 };
}

function stepLabelStyle(active: boolean): CSSProperties {
  return { display: "inline-block", verticalAlign: "middle", color: active ? "#22e6b3" : "#aab2c4", fontSize: 13, lineHeight: 1, fontWeight: 900, textTransform: "uppercase" };
}

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
  const [wmsAlerta, setWmsAlerta] = useState<{ posicoesCorretas: string[] } | null>(null);

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

  const minhaPos = useMemo(() => {
    if (!op || leiturasCache.length === 0) return null;
    const counts = new Map<string, number>();
    for (const l of leiturasCache) {
      if (!l.operador_id) continue;
      counts.set(l.operador_id, (counts.get(l.operador_id) ?? 0) + 1);
    }
    if (!counts.has(op.id)) return null;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.findIndex(([id]) => id === op.id) + 1;
  }, [leiturasCache, op]);

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
      operador_id: d.operador_id ?? null,
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
    lastKeyTimeRef.current = 0;
    if (etapa === "quantidade") {
      window.requestAnimationFrame(() => refQtd.current?.focus({ preventScroll: true }));
    }
  }, [etapa]);

  const checarPosicao = useCallback(async (codPos: string, codSku?: string): Promise<LeituraExistente[] | null> => {
    const locais: LeituraExistente[] = getQueueForInventario(inventarioId)
      .filter((q) => q.codigo_posicao === codPos && (!codSku || q.codigo_produto === codSku))
      .map((q) => ({
        codigo_produto: q.codigo_produto,
        quantidade: q.quantidade,
        numero_contagem: q.numero_contagem,
        lido_em: q.lido_em,
        operador_nome: q.operador_nome ?? null,
        operador_id: q.operador_id ?? null,
      }));
    const remotas: LeituraExistente[] = leiturasCache
      .filter((l) => l.codigo_posicao === codPos && (!codSku || l.codigo_produto === codSku))
      .map(({ codigo_posicao: _c, ...l }) => l);
    return [...locais, ...remotas].sort((a, b) => b.lido_em.localeCompare(a.lido_em));
  }, [inventarioId, leiturasCache]);

  const confirmarPosicao = useCallback(async (valor?: string) => {
    const cod = normalizeCode(valor ?? posicao);
    scanBufferRef.current = "";
    if (!cod) { beepError(); toast.error("Bipe a posição"); return; }
    setPosicao(cod);
    // PBL (flowrack) mantém regra: 1 produto por posição → checa duplicata da posição inteira.
    // Outras posições (caixa fechada) permitem múltiplos produtos → checagem por (posição+SKU) é feita após bipar produto.
    const ehPbl = cod.startsWith("01995");
    if (ehPbl) {
      const existentes = await checarPosicao(cod);
      if (existentes === null) return;
      if (existentes.length > 0) {
        beepWarn();
        const maxContagem = Math.max(...existentes.map((e) => e.numero_contagem));
        setModalDup({ leituras: existentes, contagemAtual: maxContagem });
        return;
      }
    }
    setNumeroContagem(1);
    setEtapa("produto");
  }, [posicao, checarPosicao]);

  function escolherAcaoDup(acao: AcaoPosicao) {
    if (!modalDup) return;
    const atual = modalDup.contagemAtual;
    if (acao === "nova_contagem" && op && modalDup.leituras.some((l) => l.operador_id === op.id)) {
      beepError();
      toast.error("Você já contou esta posição. A próxima contagem precisa ser feita por outro operador.");
      return;
    }
    setModalDup(null);
    if (acao === "pular") { setPosicao(""); setProdutoInput(""); setProdutoSku(""); setProdutoDesc(null); setQuantidade(""); setNumeroContagem(1); setEtapa("posicao"); return; }
    setNumeroContagem(atual + 1);
    setEtapa(produtoSku ? "quantidade" : "produto");
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

    // Em posições NÃO-PBL: checa duplicata por (posição + SKU) para permitir múltiplos produtos por endereço.
    const ehPbl = posicao.startsWith("01995");
    if (!ehPbl) {
      const existentesPS = await checarPosicao(posicao, sku);
      if (existentesPS && existentesPS.length > 0) {
        beepWarn();
        const maxContagem = Math.max(...existentesPS.map((e) => e.numero_contagem));
        setProdutoSku(sku);
        setProdutoDesc(desc);
        setModalDup({ leituras: existentesPS, contagemAtual: maxContagem });
        return;
      }
    }

    // Verifica WMS: SKU está na posição certa?
    if (navigator.onLine) {
      const { data: wmsRows } = await supabase
        .from("estoque_wms_snapshot")
        .select("codigo_posicao")
        .eq("inventario_id", inventarioId)
        .eq("sku", sku);
      const posicoesWms = new Set(
        (wmsRows ?? []).map((r: any) => r.codigo_posicao as string),
      );
      if (posicoesWms.size > 0 && !posicoesWms.has(posicao)) {
        // Remove sugestões de posições que já foram contadas neste inventário
        const { data: jaContadas } = await supabase
          .from("leituras")
          .select("codigo_posicao")
          .eq("inventario_id", inventarioId)
          .eq("codigo_produto", sku)
          .in("codigo_posicao", Array.from(posicoesWms));
        const contadas = new Set((jaContadas ?? []).map((r: any) => r.codigo_posicao as string));
        const pendentes = Array.from(posicoesWms).filter((p) => !contadas.has(p)).sort();
        if (pendentes.length > 0) {
          setWmsAlerta({ posicoesCorretas: pendentes });
          beepWarn();
        } else {
          setWmsAlerta(null);
        }
      } else {
        setWmsAlerta(null);
      }
    }

    setProdutoSku(sku);
    setProdutoDesc(desc);
    setQuantidade("");
    setEtapa("quantidade");
  }, [produtoInput, posicao, inventarioId, checarPosicao]);

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
      setLeiturasCache((prev) => [{ codigo_posicao: posicao, codigo_produto: produtoSku, quantidade: qtd, numero_contagem: numeroContagem, operador_nome: op.nome, operador_id: op.id, lido_em: lidoEm }, ...prev]);
    }
    beepSuccess();
    setUltima({ posicao, sku: produtoSku, desc: produtoDesc, qtd, contagem: numeroContagem });
    if (offline) toast.warning("Salvo offline — será sincronizado");
    setWmsAlerta(null);
    setPosicao(""); setProdutoInput(""); setProdutoSku(""); setProdutoDesc(null); setQuantidade(""); setNumeroContagem(1);
    setEtapa("posicao");
  }

  function trocarPosicao() {
    scanBufferRef.current = "";
    setWmsAlerta(null);
    setPosicao(""); setProdutoInput(""); setProdutoSku(""); setProdutoDesc(null); setQuantidade(""); setNumeroContagem(1);
    setEtapa("posicao");
  }

  function sair() { clearOperador(); navigate({ to: "/" }); }

  return (
    <div className="collector-count-page min-h-screen bg-background" style={pageStyle}>
      {/* Header */}
      <header className="collector-count-header sticky top-0 z-20 bg-background border-b border-border" style={headerStyle}>
        <div style={headerInnerStyle}>
          <p className="collector-count-title" style={headerTitleStyle}>{inv?.nome ?? "..."}</p>
          <p className="collector-count-operator" style={headerOpStyle}>{op?.nome}</p>
          <div style={headerActionsStyle}>
            {minhaPos !== null && (
              <span style={{ ...pillStyle, borderColor: minhaPos === 1 ? "#f5b53d" : "#2b3142", color: minhaPos === 1 ? "#f5d36b" : "#f1f3f7" }}>
                {minhaPos === 1 ? "🏆 " : minhaPos === 2 ? "🥈 " : minhaPos === 3 ? "🥉 " : ""}{minhaPos}°
              </span>
            )}
            <span style={{ ...pillStyle, borderColor: online ? "rgba(34,195,154,0.55)" : "rgba(226,59,59,0.65)", color: online ? "#22e6b3" : "#ff8a8a" }}>
              {pending > 0 ? `${pending} pend.` : online ? "online" : "offline"}
            </span>
            <button type="button" style={logoutButtonStyle} onClick={sair} aria-label="Sair">
              sair
            </button>
          </div>
        </div>
      </header>

      {/* Última leitura */}
      {ultima && (
        <div style={lastReadStyle}>
          <div style={lastReadInnerStyle}>
            <span style={{ color: "#22e6b3", marginRight: 5, fontWeight: 900 }}>✓</span>
            <span style={{ color: "#aab2c4", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>{formatPosicaoDisplay(ultima.posicao)}</span>
            <span style={{ margin: "0 6px", color: "#697386" }}>›</span>
            <strong style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>{ultima.sku}</strong>
            <span style={{ margin: "0 6px", color: "#697386" }}>·</span>
            <strong style={{ color: "#22e6b3" }}>{ultima.qtd}</strong>
            {ultima.contagem > 1 && <span style={{ marginLeft: 6, color: "#aab2c4", fontSize: 10 }}>{ultima.contagem}ª c.</span>}
            {ultima.desc && <div style={{ marginTop: 3, color: "#aab2c4", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ultima.desc}</div>}
          </div>
        </div>
      )}

      <main className="collector-count-main max-w-lg mx-auto px-4 py-4 space-y-3" style={mainStyle}>
        {/* ENDEREÇO */}
        <div className={`collector-count-card rounded-xl overflow-hidden border bg-card ${etapa === "posicao" ? "border-primary" : "border-border"}`} style={stepCardStyle(etapa === "posicao")}>
          <div className="collector-count-card-header" style={stepHeaderStyle(etapa === "posicao")}>
            <span style={stepNumberStyle(etapa === "posicao", etapa !== "posicao")}>{etapa === "posicao" ? "1" : "✓"}</span>
            <span style={{ display: "inline-block", marginRight: 5, fontWeight: 900 }}>⌖</span>
            <span style={stepLabelStyle(etapa === "posicao")}>Endereço</span>
            {numeroContagem > 1 && etapa !== "posicao" && (
              <Badge className="ml-auto bg-warning/15 text-warning border-warning/25 text-[10px] px-1.5 py-0 h-5" style={{ float: "right", background: "rgba(245,181,61,0.18)", color: "#f5d36b", border: "1px solid rgba(245,181,61,0.45)" }}>{numeroContagem}ª</Badge>
            )}
          </div>
          <div className="collector-count-card-body px-4 py-3" style={cardBodyStyle}>
            {etapa === "posicao" ? (
              <input
                ref={refPos}
                type="text"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    const val = (refPos.current?.value ?? "").trim();
                    if (refPos.current) refPos.current.value = "";
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
                style={scanInputStyle}
              />
            ) : (
              <div>
                <button
                  type="button"
                  onClick={trocarPosicao}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-md hover:bg-primary/10 shrink-0"
                  style={smallButtonStyle}
                >
                  trocar
                </button>
                <p style={readonlyValueStyle}>{formatPosicaoDisplay(posicao)}</p>
              </div>
            )}
          </div>
        </div>

        {/* PRODUTO */}
        {etapa !== "posicao" && (
          <div className={`collector-count-card rounded-xl overflow-hidden border bg-card ${etapa === "produto" ? "border-primary" : "border-border"}`} style={stepCardStyle(etapa === "produto")}>
            <div className="collector-count-card-header" style={stepHeaderStyle(etapa === "produto")}>
              <span style={stepNumberStyle(etapa === "produto", etapa === "quantidade")}>{etapa === "produto" ? "2" : "✓"}</span>
              <span style={{ display: "inline-block", marginRight: 5, fontWeight: 900 }}>▦</span>
              <span style={stepLabelStyle(etapa === "produto")}>Produto</span>
            </div>
            <div className="collector-count-card-body px-4 py-3" style={cardBodyStyle}>
              {etapa === "produto" ? (
                <input
                  ref={refProd}
                  type="text"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      const val = (refProd.current?.value ?? "").trim();
                      if (refProd.current) refProd.current.value = "";
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
                  style={scanInputStyle}
                />
              ) : (
                <div>
                  <p className="text-xl font-mono font-bold leading-tight" style={readonlyValueStyle}>{produtoSku}</p>
                  {produtoDesc && <p className="text-xs text-muted-foreground mt-0.5 leading-tight" style={secondaryTextStyle}>{produtoDesc}</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Alerta persistente: produto fora do lugar */}
        {wmsAlerta && etapa === "quantidade" && (
          <div className="rounded-xl border-2 border-violet-500 bg-violet-500/15 p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2" style={alertStyle}>
            <span style={{ display: "inline-block", marginRight: 7, color: "#c4b5fd", fontSize: 18, fontWeight: 900 }}>!</span>
            <div>
              <p className="text-sm font-bold text-violet-700 dark:text-violet-200 uppercase tracking-wide" style={{ margin: 0, color: "#ddd6fe", fontSize: 14, fontWeight: 900, textTransform: "uppercase" }}>
                Produto fora do lugar
              </p>
              <p className="text-xs text-violet-700/90 dark:text-violet-200/90 leading-relaxed mt-1" style={{ margin: "6px 0 0", color: "#f1f3f7", fontSize: 12 }}>
                Segundo o WMS, <span className="font-mono font-bold">{produtoSku}</span> deveria estar em:
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2" style={{ marginTop: 8 }}>
                {wmsAlerta.posicoesCorretas.map((p) => (
                  <span key={p} className="px-2 py-1 rounded bg-violet-600 text-white text-xs font-mono font-bold" style={{ display: "inline-block", margin: "0 5px 5px 0", padding: "5px 8px", borderRadius: 6, background: "#7c3aed", color: "#fff", fontSize: 12, fontWeight: 900 }}>
                    {formatPosicaoDisplay(p)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* QUANTIDADE */}
        {etapa === "quantidade" && (
          <div className="collector-count-card rounded-xl overflow-hidden border border-primary bg-card" style={stepCardStyle(true)}>
            <div className="collector-count-card-header px-4 py-2.5 border-b border-border/50 flex items-center gap-2 bg-primary/5" style={stepHeaderStyle(true)}>
              <span style={stepNumberStyle(true, false)}>3</span>
              <span style={{ display: "inline-block", marginRight: 5, fontWeight: 900 }}>#</span>
              <span style={stepLabelStyle(true)}>Quantidade</span>
            </div>
            <div className="collector-count-card-body px-4 py-4 space-y-3" style={{ ...cardBodyStyle, paddingTop: 14 }}>
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
                style={qtyInputStyle}
                autoComplete="off"
              />
              <div className="grid grid-cols-4 gap-2" style={quickButtonsStyle}>
                {[1, 5, 10].map((n) => (
                  <Button key={n} variant="secondary" className="h-10 text-sm font-semibold" style={quickButtonStyle}
                    onClick={() => setQuantidade(String((parseQuantidade(quantidade) ?? 0) + n))}>
                    +{n}
                  </Button>
                ))}
                <Button variant="outline" className="h-10 text-sm" style={{ ...quickButtonStyle, marginRight: 0 }} onClick={() => setQuantidade("")}>
                  Limpar
                </Button>
              </div>
              <Button
                onClick={pedirConfirmacao}
                disabled={salvando || !quantidade.trim()}
                className="w-full h-14 text-base font-bold gap-2"
                style={confirmMainStyle}
              >
                Confirmar
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Popup de confirmação */}
      <Dialog open={confirmandoLeitura} onOpenChange={(open) => { if (!open) { setConfirmandoLeitura(false); setWmsAlerta(null); } }}>
        <DialogContent className="max-w-sm bg-popover !opacity-100 shadow-2xl gap-3 p-5" style={{ background: "#1c2b47", color: "#f1f3f7", border: "1px solid #2d4070", maxWidth: 360, padding: 18 }}>
          <DialogHeader className="space-y-0">
            <DialogTitle className="flex items-center gap-2 text-base" style={{ color: "#f1f3f7", fontSize: 17, fontWeight: 900 }}>
              Confirmar leitura
            </DialogTitle>
          </DialogHeader>

          <div className="rounded-lg border border-border bg-background/40 overflow-hidden" style={{ border: "1px solid #2b3142", borderRadius: 8, overflow: "hidden", background: "#172033", marginTop: 12 }}>
            <div className="grid grid-cols-[88px_1fr] items-center gap-3 px-3 py-2.5 border-b border-border" style={dialogRowStyle}>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide" style={dialogLabelStyle}>Endereço</span>
              <span className="font-mono font-bold text-base leading-tight truncate" style={{ display: "block", color: "#f1f3f7", fontSize: 16, fontWeight: 900 }}>{formatPosicaoDisplay(posicao)}</span>
            </div>
            <div className="grid grid-cols-[88px_1fr] items-center gap-3 px-3 py-2.5 border-b border-border" style={dialogRowStyle}>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide" style={dialogLabelStyle}>Produto</span>
              <div>
                <p className="font-mono font-bold text-base leading-tight truncate" style={{ margin: 0, color: "#f1f3f7", fontSize: 16, fontWeight: 900 }}>{produtoSku}</p>
                {produtoDesc && <p className="text-[11px] text-muted-foreground leading-tight truncate" style={{ margin: "3px 0 0", color: "#aab2c4", fontSize: 11 }}>{produtoDesc}</p>}
              </div>
            </div>
            <div className="grid grid-cols-[88px_1fr] items-center gap-3 px-3 py-3 bg-primary/5" style={{ ...dialogRowStyle, borderBottom: 0, background: "rgba(34,195,154,0.12)" }}>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide" style={dialogLabelStyle}>Quantidade</span>
              <span className="font-bold text-3xl text-primary leading-none tabular-nums" style={{ display: "block", color: "#22e6b3", fontSize: 34, lineHeight: 1, fontWeight: 900 }}>{quantidade}</span>
            </div>
          </div>

          {wmsAlerta && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 flex items-start gap-2.5" style={{ marginTop: 12, padding: 10, borderRadius: 8, border: "1px solid #a78bfa", background: "#2d2446", color: "#f1f3f7" }}>
              <span style={{ display: "inline-block", marginRight: 5, color: "#c4b5fd", fontWeight: 900 }}>!</span>
              <div>
                <p className="text-xs font-semibold text-violet-700 dark:text-violet-300" style={{ margin: 0, color: "#ddd6fe", fontSize: 12, fontWeight: 900 }}>Produto fora do lugar</p>
                <p className="text-[11px] text-violet-600/90 dark:text-violet-400/90 leading-relaxed mt-0.5" style={{ margin: "4px 0 0", color: "#f1f3f7", fontSize: 11 }}>
                  WMS diz que este SKU deveria estar em: <strong className="font-mono">{wmsAlerta.posicoesCorretas.map(formatPosicaoDisplay).join(", ")}</strong>
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1" style={{ marginTop: 12 }}>
            <Button onClick={gravar} disabled={salvando} className="w-full h-12 text-base font-bold gap-2" style={{ ...confirmMainStyle, height: 48, marginTop: 0 }}>
              {salvando
                ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : "Confirmar"}
            </Button>
            <Button variant="outline" onClick={() => setConfirmandoLeitura(false)} className="w-full h-10 text-sm" style={{ width: "100%", height: 42, marginTop: 8, borderRadius: 8, border: "1px solid #4b5875", background: "#172033", color: "#f1f3f7", fontSize: 14, fontWeight: 800 }}>
              Corrigir quantidade
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {modalDup && (
        <PosicaoJaContadaModal
          open
          posicao={posicao}
          contagemAtual={modalDup.contagemAtual}
          leituras={modalDup.leituras}
          operadorAtualId={op?.id ?? null}
          onClose={() => { setModalDup(null); setPosicao(""); setEtapa("posicao"); }}
          onEscolher={escolherAcaoDup}
        />
      )}
    </div>
  );
}
