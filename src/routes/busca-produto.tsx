import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getOperador } from "@/lib/operador-session";
import { buscarProdutoWms, sugerirProdutosWms, type PosicaoProduto, type SugestaoProduto } from "@/lib/produto-busca.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, PackageSearch, RefreshCw, MapPin, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/busca-produto")({
  component: BuscaProduto,
});

const fmt = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(n);

function DepositoBadge({ dep, rotulo }: { dep: string; rotulo: string }) {
  const cor =
    dep === "02"
      ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
      : "bg-sky-500/15 text-sky-300 border-sky-500/30";
  return <Badge variant="outline" className={`text-[10px] font-medium ${cor}`}>{rotulo}</Badge>;
}

type Resultado = {
  codigo_bipado: string;
  sku: string | null;
  descricao: string | null;
  total: number;
  posicoes: PosicaoProduto[];
  estoque_carregado_em: string;
  do_cache: boolean;
};

function BuscaProduto() {
  const navigate = useNavigate();
  const buscar = useServerFn(buscarProdutoWms);
  const sugerir = useServerFn(sugerirProdutosWms);
  const inputRef = useRef<HTMLInputElement>(null);

  const [op, setOp] = useState<{ id: string; nome: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sugestoes, setSugestoes] = useState<SugestaoProduto[]>([]);
  const [mostrarSug, setMostrarSug] = useState(false);
  const [destacado, setDestacado] = useState(0);
  const sugReqId = useRef(0);

  useEffect(() => {
    const o = getOperador();
    if (!o) { navigate({ to: "/" }); return; }
    setOp(o);
    inputRef.current?.focus();
  }, [navigate]);

  useEffect(() => {
    const termo = codigo.trim();
    if (termo.length < 2) {
      setSugestoes([]);
      setMostrarSug(false);
      return;
    }
    const id = ++sugReqId.current;
    const t = setTimeout(async () => {
      try {
        const r = await sugerir({ data: { termo, limite: 15 } });
        if (id !== sugReqId.current) return;
        setSugestoes(r.sugestoes);
        setMostrarSug(true);
        setDestacado(0);
      } catch {
        // silencioso para typeahead
      }
    }, 180);
    return () => clearTimeout(t);
  }, [codigo, sugerir]);

  async function executar(c: string, forcar = false) {
    const code = c.trim();
    if (!code) return;
    setMostrarSug(false);
    setCarregando(true);
    setErro(null);
    try {
      const r = await buscar({ data: { codigo: code, forcar } });
      setResultado(r);
      if (r.posicoes.length === 0) toast.warning("Nenhuma posição encontrada para este produto");
    } catch (e: any) {
      setErro(e?.message ?? "Falha ao consultar WMS");
      toast.error(e?.message ?? "Falha ao consultar WMS");
    } finally {
      setCarregando(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function escolher(s: SugestaoProduto) {
    setCodigo("");
    setMostrarSug(false);
    setSugestoes([]);
    executar(s.sku);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mostrarSug && sugestoes[destacado]) {
      escolher(sugestoes[destacado]);
      return;
    }
    executar(codigo);
    setCodigo("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!mostrarSug || sugestoes.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setDestacado((d) => Math.min(d + 1, sugestoes.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDestacado((d) => Math.max(d - 1, 0));
    } else if (e.key === "Escape") {
      setMostrarSug(false);
    }
  }


  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to="/hub" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
          <div className="min-w-0 text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Operador</p>
            <p className="text-sm font-semibold truncate leading-tight">{op?.nome}</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <PackageSearch className="h-5 w-5 text-primary" /> Busca por produto
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Bipe o SKU ou o código de barras e veja todas as posições do estoque WMS.
          </p>
        </div>

        <form onSubmit={onSubmit} className="relative flex gap-2">
          <div className="relative flex-1">
            <Input
              ref={inputRef}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={onKeyDown}
              onFocus={() => sugestoes.length > 0 && setMostrarSug(true)}
              onBlur={() => setTimeout(() => setMostrarSug(false), 150)}
              placeholder="SKU, descrição ou EAN"
              inputMode="text"
              autoComplete="off"
              className="font-mono"
              disabled={carregando}
            />
            {mostrarSug && sugestoes.length > 0 && (
              <ul className="absolute z-20 top-full mt-1 left-0 right-0 max-h-72 overflow-auto bg-popover border border-border rounded-lg shadow-lg">
                {sugestoes.map((s, i) => (
                  <li
                    key={s.sku}
                    onMouseDown={(e) => { e.preventDefault(); escolher(s); }}
                    onMouseEnter={() => setDestacado(i)}
                    className={`px-3 py-2 cursor-pointer text-sm border-b border-border/40 last:border-0 ${i === destacado ? "bg-accent" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-foreground">{s.sku}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {s.posicoes} pos{s.posicoes === 1 ? "" : "."}
                      </span>
                    </div>
                    {s.descricao && (
                      <p className="text-xs text-muted-foreground truncate">{s.descricao}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button type="submit" disabled={carregando || !codigo.trim()}>
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
          </Button>
        </form>


        {erro && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        {resultado && (
          <div className="space-y-3">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Bipado</p>
                  <p className="font-mono text-sm">{resultado.codigo_bipado}</p>
                  {resultado.sku && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      SKU <span className="font-mono text-foreground">{resultado.sku}</span>
                    </p>
                  )}
                  {resultado.descricao && (
                    <p className="text-sm font-medium leading-snug mt-1">{resultado.descricao}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => executar(resultado.codigo_bipado, true)}
                  disabled={carregando}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Atualizar
                </Button>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {resultado.posicoes.length} posiç{resultado.posicoes.length === 1 ? "ão" : "ões"}
                </span>
                <span className="font-semibold">Total: {fmt(resultado.total)}</span>
              </div>
            </div>

            {resultado.posicoes.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                Produto sem posições no WMS.
              </div>
            ) : (
              <ul className="space-y-2">
                {resultado.posicoes.map((p, i) => (
                  <li key={i} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-mono text-sm font-semibold">{p.apelido}</span>
                        <DepositoBadge dep={p.deposito} rotulo={p.deposito_rotulo} />
                      </div>
                      {p.lote && (
                        <p className="text-[11px] text-muted-foreground mt-1 ml-5">Lote {p.lote}</p>
                      )}
                    </div>
                    <span className="font-mono text-sm font-semibold tabular-nums">{fmt(p.qtde)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
