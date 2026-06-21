import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getOperador } from "@/lib/operador-session";
import { mapaVaziasRuaWms, type PredioRua } from "@/lib/conferencia.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, RefreshCw, MapPinned, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/vazias-rua")({
  component: VaziasRua,
});

type Resultado = {
  deposito: string;
  deposito_rotulo: string;
  rua: string;
  bipada: { predio: string; andar: string; vao: string; codigo: string; apelido: string };
  total_vagas: number;
  total_vazias: number;
  predios: PredioRua[];
  estoque_carregado_em: string;
  do_cache: boolean;
};

const fmt = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

function DepositoBadge({ dep, rotulo }: { dep: string; rotulo: string }) {
  const cor =
    dep === "02"
      ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
      : "bg-sky-500/15 text-sky-300 border-sky-500/30";
  return <Badge variant="outline" className={`text-[10px] font-medium ${cor}`}>{rotulo}</Badge>;
}

function VaziasRua() {
  const navigate = useNavigate();
  const consultar = useServerFn(mapaVaziasRuaWms);
  const inputRef = useRef<HTMLInputElement>(null);

  const [op, setOp] = useState<{ id: string; nome: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // marcação local "já validei fisicamente": persiste só na sessão atual da tela
  const [validadas, setValidadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    const o = getOperador();
    if (!o) { navigate({ to: "/" }); return; }
    setOp(o);
    inputRef.current?.focus();
  }, [navigate]);

  async function executar(forcar = false) {
    const c = codigo.trim();
    if (!c) return;
    setCarregando(true);
    setErro(null);
    try {
      const res = (await consultar({ data: { codigoPosicao: c, forcar } })) as Resultado;
      setResultado(res);
      setValidadas(new Set());
      if (forcar) toast.success("Dados atualizados");
    } catch (e: any) {
      const msg = e?.message ?? "Falha ao consultar";
      setErro(msg);
      toast.error(msg);
    } finally {
      setCarregando(false);
      inputRef.current?.select();
    }
  }

  function toggleValidada(codigo: string) {
    setValidadas((prev) => {
      const n = new Set(prev);
      if (n.has(codigo)) n.delete(codigo); else n.add(codigo);
      return n;
    });
  }

  const pendentes = useMemo(() => {
    if (!resultado) return 0;
    let n = 0;
    for (const p of resultado.predios)
      for (const v of p.posicoes)
        if (v.vazia && !validadas.has(v.codigo)) n++;
    return n;
  }, [resultado, validadas]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to="/hub" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Hub
          </Link>
          <div className="text-right min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Operador</p>
            <p className="text-sm font-semibold truncate leading-tight">{op?.nome}</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 space-y-5">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <MapPinned className="h-5 w-5 text-primary" /> Mapa de Vazias por Rua
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Bipe qualquer posição. O sistema mostra todas as vagas da rua que o WMS aponta como
            vazias — caminhe e valide fisicamente. Marque ✓ nas que estiverem realmente vazias.
          </p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void executar(false); }}
          className="flex gap-2"
        >
          <Input
            ref={inputRef}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Bipe uma posição (ex.: 01.007.014.03.01)"
            autoComplete="off"
            inputMode="text"
            className="h-11 font-mono text-base"
          />
          <Button type="submit" disabled={carregando || !codigo.trim()} className="h-11 px-5">
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Consultar"}
          </Button>
          {resultado && (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => void executar(true)}
              disabled={carregando}
              title="Forçar nova leitura do WMS"
            >
              <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
            </Button>
          )}
        </form>

        {erro && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
            {erro}
          </div>
        )}

        {resultado && (
          <>
            <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
              <DepositoBadge dep={resultado.deposito} rotulo={resultado.deposito_rotulo} />
              <div className="text-sm">
                <span className="text-muted-foreground">Rua</span>{" "}
                <span className="font-mono font-bold text-base">{resultado.rua}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Bipada</span>{" "}
                <span className="font-mono font-semibold">{resultado.bipada.apelido}</span>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-3 text-xs">
                <span><span className="text-muted-foreground">Total vagas:</span> <b>{fmt(resultado.total_vagas)}</b></span>
                <span><span className="text-muted-foreground">Vazias (WMS):</span> <b className="text-amber-400">{fmt(resultado.total_vazias)}</b></span>
                <span><span className="text-muted-foreground">Pendentes:</span> <b className={pendentes === 0 ? "text-emerald-400" : "text-amber-400"}>{fmt(pendentes)}</b></span>
                <span className="text-muted-foreground">
                  WMS: {new Date(resultado.estoque_carregado_em).toLocaleTimeString("pt-BR")}{" "}
                  {resultado.do_cache ? "(cache)" : "(novo)"}
                </span>
              </div>
            </div>

            <Legenda />

            <div className="space-y-6">
              {resultado.predios.map((p) => (
                <PredioGrade
                  key={p.predio}
                  rua={resultado.rua}
                  predio={p}
                  bipadaCod={resultado.bipada.codigo}
                  validadas={validadas}
                  onToggle={toggleValidada}
                />
              ))}
            </div>
          </>
        )}

        {!resultado && !erro && !carregando && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            Bipe uma posição para começar.
          </div>
        )}
      </main>
    </div>
  );
}

function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded border border-border bg-muted/30" /> Ocupada (WMS)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded border border-amber-500/60 bg-amber-500/15" /> Vazia (WMS) — validar
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded border border-emerald-500/60 bg-emerald-500/20" /> Validada por você
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded ring-2 ring-primary" /> Posição bipada
      </span>
    </div>
  );
}

function PredioGrade({
  rua,
  predio,
  bipadaCod,
  validadas,
  onToggle,
}: {
  rua: string;
  predio: PredioRua;
  bipadaCod: string;
  validadas: Set<string>;
  onToggle: (codigo: string) => void;
}) {
  // Linhas = andares (do mais alto pro mais baixo, como na prateleira)
  const andares = Array.from({ length: predio.maxAndar }, (_, i) => predio.maxAndar - i);
  const vaos = Array.from({ length: predio.maxVao }, (_, i) => i + 1);

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <header className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-sm">
            Prédio <span className="font-mono">{rua}-{predio.predio}</span>
          </h2>
          <Badge variant="outline" className="text-[10px]">
            {predio.maxAndar} and × {predio.maxVao} vãos
          </Badge>
        </div>
        <div className="text-[11px] text-muted-foreground">
          <b className="text-amber-400">{predio.vazias}</b> vazias de {predio.totalVagas}
        </div>
      </header>

      <div className="p-3 overflow-x-auto">
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="w-10"></th>
              {vaos.map((v) => (
                <th key={v} className="text-[10px] text-muted-foreground font-medium w-12 text-center">
                  V{String(v).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {andares.map((a) => (
              <tr key={a}>
                <th className="text-[10px] text-muted-foreground font-medium pr-2 text-right">
                  A{String(a).padStart(2, "0")}
                </th>
                {vaos.map((v) => {
                  const vaga = predio.posicoes.find((x) => x.andar === a && x.vao === v)!;
                  const isBipada = vaga.codigo === bipadaCod;
                  const validada = validadas.has(vaga.codigo);
                  let cls = "border border-border bg-muted/30 text-muted-foreground/60";
                  if (vaga.vazia && validada) cls = "border border-emerald-500/60 bg-emerald-500/20 text-emerald-300";
                  else if (vaga.vazia) cls = "border border-amber-500/60 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25";
                  if (isBipada) cls += " ring-2 ring-primary";
                  return (
                    <td key={v} className="p-0">
                      <button
                        type="button"
                        onClick={() => vaga.vazia && onToggle(vaga.codigo)}
                        disabled={!vaga.vazia}
                        title={vaga.vazia
                          ? `${vaga.apelido} — vazia no WMS${validada ? " (validada)" : " (clique para validar)"}`
                          : `${vaga.apelido} — ${vaga.qtdItens} SKU(s)`}
                        className={`h-10 w-12 rounded text-[10px] font-mono font-semibold transition-colors flex items-center justify-center ${cls} ${vaga.vazia ? "cursor-pointer" : "cursor-default"}`}
                      >
                        {validada ? <CheckCircle2 className="h-4 w-4" /> : vaga.vazia ? "•" : vaga.qtdItens}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
