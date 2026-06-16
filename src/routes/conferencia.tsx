import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getOperador, clearOperador } from "@/lib/operador-session";
import { consultarPosicaoWms, type ItemPosicaoWms } from "@/lib/conferencia.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, LogOut, ScanLine, Loader2, RefreshCw, Check, AlertTriangle,
  PackageSearch, Save, History,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/conferencia")({
  component: ConferenciaPosicao,
});

const fmtNum = (n: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(n);

type Linha = ItemPosicaoWms & {
  key: string;
  qtdeInformada: string;
  observacao: string;
  salvando: boolean;
  salvoEm: string | null;
};

type Registro = {
  id: string;
  sku: string;
  descricao: string | null;
  lote: string | null;
  qtde_sistema: number | null;
  qtde_informada: number;
  observacao: string | null;
  operador_nome: string | null;
  criado_em: string;
};

function ConferenciaPosicao() {
  const navigate = useNavigate();
  const consultar = useServerFn(consultarPosicaoWms);
  const inputRef = useRef<HTMLInputElement>(null);

  const [op, setOp] = useState<{ id: string; nome: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [posicao, setPosicao] = useState<string | null>(null);
  const [consultadoEm, setConsultadoEm] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [historico, setHistorico] = useState<Registro[]>([]);

  useEffect(() => {
    const o = getOperador();
    if (!o) { navigate({ to: "/" }); return; }
    setOp(o);
    inputRef.current?.focus();
  }, [navigate]);

  async function carregarHistorico(pos: string) {
    const { data } = await supabase
      .from("conferencias_posicao")
      .select("id, sku, descricao, lote, qtde_sistema, qtde_informada, observacao, operador_nome, criado_em")
      .eq("codigo_posicao", pos)
      .order("criado_em", { ascending: false })
      .limit(50);
    setHistorico((data ?? []) as Registro[]);
  }

  async function buscar(codigoBruto: string) {
    const limpo = codigoBruto.trim().toUpperCase();
    if (!limpo) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await consultar({ data: { codigoPosicao: limpo } });
      setPosicao(r.posicao);
      setConsultadoEm(r.consultado_em);
      setLinhas(r.itens.map((it, i) => ({
        ...it,
        key: `${it.sku}|${it.lote ?? ""}|${i}`,
        qtdeInformada: "",
        observacao: "",
        salvando: false,
        salvoEm: null,
      })));
      await carregarHistorico(r.posicao);
      setCodigo("");
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (e: any) {
      setErro(e?.message ?? "Falha ao consultar WMS");
      toast.error("Falha ao consultar WMS: " + (e?.message ?? "erro"));
    } finally {
      setCarregando(false);
    }
  }

  function atualizarLinha(key: string, patch: Partial<Linha>) {
    setLinhas((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function salvarLinha(linha: Linha) {
    if (!op || !posicao) return;
    const valor = linha.qtdeInformada.replace(",", ".").trim();
    if (valor === "") { toast.error("Informe a quantidade conferida"); return; }
    const num = Number(valor);
    if (!Number.isFinite(num) || num < 0) { toast.error("Quantidade inválida"); return; }

    atualizarLinha(linha.key, { salvando: true });
    const { error } = await supabase.from("conferencias_posicao").insert({
      codigo_posicao: posicao,
      sku: linha.sku,
      descricao: linha.descricao,
      lote: linha.lote,
      qtde_sistema: linha.qtde,
      qtde_informada: num,
      observacao: linha.observacao.trim() || null,
      operador_id: op.id,
      operador_nome: op.nome,
    });
    if (error) {
      atualizarLinha(linha.key, { salvando: false });
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    atualizarLinha(linha.key, { salvando: false, salvoEm: new Date().toISOString() });
    toast.success(`Conferência registrada: ${linha.sku}`);
    void carregarHistorico(posicao);
  }

  async function salvarItemNovo(sku: string, qtde: string, obs: string) {
    if (!op || !posicao) return;
    const skuLimpo = sku.trim().toUpperCase();
    const valor = qtde.replace(",", ".").trim();
    if (!skuLimpo) { toast.error("Informe o SKU"); return; }
    if (valor === "") { toast.error("Informe a quantidade"); return; }
    const num = Number(valor);
    if (!Number.isFinite(num) || num < 0) { toast.error("Quantidade inválida"); return; }

    const { error } = await supabase.from("conferencias_posicao").insert({
      codigo_posicao: posicao,
      sku: skuLimpo,
      descricao: null,
      lote: null,
      qtde_sistema: null,
      qtde_informada: num,
      observacao: obs.trim() || null,
      operador_id: op.id,
      operador_nome: op.nome,
    });
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success(`Item extra registrado: ${skuLimpo}`);
    void carregarHistorico(posicao);
  }

  function sair() { clearOperador(); navigate({ to: "/" }); }

  const totalSistema = useMemo(
    () => linhas.reduce((s, l) => s + (Number(l.qtde) || 0), 0),
    [linhas],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link to="/hub" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Conferência de Posição</p>
              <p className="text-sm font-semibold truncate leading-tight">{op?.nome}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={sair} className="gap-1.5 text-muted-foreground hover:text-foreground shrink-0">
            <LogOut className="h-4 w-4" /> Trocar
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Scanner */}
        <section className="bg-card border border-border rounded-xl p-4">
          <label className="text-xs uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
            <ScanLine className="h-3.5 w-3.5" /> Bipe a posição
          </label>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => { e.preventDefault(); void buscar(codigo); }}
          >
            <Input
              ref={inputRef}
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ex.: A1-01-02"
              className="h-12 text-base font-mono uppercase"
              disabled={carregando}
            />
            <Button type="submit" size="lg" disabled={carregando || !codigo.trim()} className="h-12 px-5">
              {carregando ? <Loader2 className="h-5 w-5 animate-spin" /> : "Buscar"}
            </Button>
          </form>
          {erro && (
            <p className="mt-2 text-xs text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> {erro}
            </p>
          )}
        </section>

        {/* Resultado */}
        {posicao && (
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Posição</p>
                <h2 className="text-2xl font-bold tracking-tight font-mono">{posicao}</h2>
                {consultadoEm && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Consultado às {new Date(consultadoEm).toLocaleTimeString("pt-BR")} · tempo real WMS
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono">
                  {linhas.length} {linhas.length === 1 ? "item" : "itens"}
                </Badge>
                <Badge variant="outline" className="font-mono">
                  Σ {fmtNum(totalSistema)}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void buscar(posicao)}
                  disabled={carregando}
                  className="gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
              </div>
            </div>

            {linhas.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <PackageSearch className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  O WMS não retornou nenhum item para esta posição.
                </p>
                <ItemExtraForm onSalvar={salvarItemNovo} />
              </div>
            ) : (
              <div className="space-y-3">
                {linhas.map((linha) => (
                  <LinhaItem
                    key={linha.key}
                    linha={linha}
                    onChange={(patch) => atualizarLinha(linha.key, patch)}
                    onSalvar={() => void salvarLinha(linha)}
                  />
                ))}
                <details className="rounded-xl border border-dashed border-border p-4">
                  <summary className="text-xs font-semibold text-muted-foreground cursor-pointer">
                    + Adicionar item não listado pelo WMS
                  </summary>
                  <div className="mt-3">
                    <ItemExtraForm onSalvar={salvarItemNovo} />
                  </div>
                </details>
              </div>
            )}

            {/* Histórico */}
            {historico.length > 0 && (
              <section className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5 mb-3">
                  <History className="h-3.5 w-3.5" /> Histórico desta posição ({historico.length})
                </h3>
                <div className="space-y-2 max-h-64 overflow-auto">
                  {historico.map((h) => {
                    const div = h.qtde_sistema != null ? h.qtde_informada - h.qtde_sistema : null;
                    return (
                      <div key={h.id} className="text-xs border border-border rounded-lg p-2.5 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-mono font-semibold truncate">{h.sku}{h.lote ? ` · lote ${h.lote}` : ""}</p>
                          {h.descricao && <p className="text-muted-foreground truncate">{h.descricao}</p>}
                          {h.observacao && <p className="text-muted-foreground italic mt-0.5">"{h.observacao}"</p>}
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {h.operador_nome ?? "?"} · {new Date(h.criado_em).toLocaleString("pt-BR")}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono">{fmtNum(h.qtde_informada)}</p>
                          {h.qtde_sistema != null && (
                            <p className="text-[10px] text-muted-foreground">sist: {fmtNum(h.qtde_sistema)}</p>
                          )}
                          {div != null && div !== 0 && (
                            <Badge
                              variant={div > 0 ? "default" : "destructive"}
                              className="mt-1 font-mono text-[10px] h-4"
                            >
                              {div > 0 ? "+" : ""}{fmtNum(div)}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function LinhaItem({
  linha, onChange, onSalvar,
}: {
  linha: Linha;
  onChange: (patch: Partial<Linha>) => void;
  onSalvar: () => void;
}) {
  const qtdNum = linha.qtdeInformada.replace(",", ".").trim();
  const num = Number(qtdNum);
  const temNum = qtdNum !== "" && Number.isFinite(num);
  const diff = temNum ? num - linha.qtde : null;
  const igual = temNum && diff === 0;
  const ja = !!linha.salvoEm;

  return (
    <div className={`bg-card border rounded-xl p-4 transition-colors ${ja ? "border-emerald-500/40" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono font-semibold text-sm">{linha.sku}</p>
          {linha.descricao && (
            <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{linha.descricao}</p>
          )}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {linha.lote && <Badge variant="outline" className="font-mono text-[10px] h-5">Lote {linha.lote}</Badge>}
            {linha.dt_validade && (
              <Badge variant="outline" className="font-mono text-[10px] h-5">
                Val. {new Date(linha.dt_validade).toLocaleDateString("pt-BR")}
              </Badge>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sistema</p>
          <p className="text-2xl font-bold font-mono leading-none mt-0.5">{fmtNum(linha.qtde)}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 items-start">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Quantidade conferida
          </label>
          <Input
            type="text"
            inputMode="decimal"
            placeholder={fmtNum(linha.qtde)}
            value={linha.qtdeInformada}
            onChange={(e) => onChange({ qtdeInformada: e.target.value, salvoEm: null })}
            className={`h-11 mt-1 font-mono text-base ${
              temNum && diff !== 0
                ? "border-amber-500 focus-visible:ring-amber-500"
                : igual
                  ? "border-emerald-500 focus-visible:ring-emerald-500"
                  : ""
            }`}
          />
          {temNum && diff !== 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-mono">
              Divergência: {diff! > 0 ? "+" : ""}{fmtNum(diff!)}
            </p>
          )}
          {igual && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
              Bate com o sistema
            </p>
          )}
        </div>
        <Button
          onClick={onSalvar}
          disabled={linha.salvando || !temNum}
          size="lg"
          className="h-11 mt-[18px] px-4 gap-1.5"
          variant={ja ? "outline" : "default"}
        >
          {linha.salvando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : ja ? (
            <><Check className="h-4 w-4" /> Salvo</>
          ) : (
            <><Save className="h-4 w-4" /> Salvar</>
          )}
        </Button>
      </div>

      <div className="mt-2">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          Observações
        </label>
        <Textarea
          rows={2}
          placeholder="Ex.: avaria, embalagem trocada, lote diferente…"
          value={linha.observacao}
          onChange={(e) => onChange({ observacao: e.target.value, salvoEm: null })}
          className="mt-1 text-sm"
        />
      </div>
    </div>
  );
}

function ItemExtraForm({
  onSalvar,
}: { onSalvar: (sku: string, qtde: string, obs: string) => void | Promise<void> }) {
  const [sku, setSku] = useState("");
  const [qtde, setQtde] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function submit() {
    setSalvando(true);
    try {
      await onSalvar(sku, qtde, obs);
      setSku(""); setQtde(""); setObs("");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-2">
      <Input
        placeholder="SKU"
        value={sku}
        onChange={(e) => setSku(e.target.value.toUpperCase())}
        className="h-10 font-mono"
      />
      <Input
        placeholder="Qtd"
        inputMode="decimal"
        value={qtde}
        onChange={(e) => setQtde(e.target.value)}
        className="h-10 font-mono"
      />
      <Button onClick={() => void submit()} disabled={salvando || !sku.trim() || !qtde.trim()} className="h-10 gap-1.5">
        {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" /> Salvar</>}
      </Button>
      <Textarea
        placeholder="Observações (opcional)"
        rows={2}
        value={obs}
        onChange={(e) => setObs(e.target.value)}
        className="sm:col-span-3 text-sm"
      />
    </div>
  );
}
