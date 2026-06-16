import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, FileSpreadsheet, ScanLine, AlertTriangle, Filter,
  ChevronLeft, ChevronRight, Users, MapPin, ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { formatPosicaoDisplay, fmtNum, fmtDelta } from "@/lib/validation";

export const Route = createFileRoute("/admin/conferencias")({
  component: AnaliseConferencias,
});

type Registro = {
  id: string;
  codigo_posicao: string;
  sku: string;
  descricao: string | null;
  lote: string | null;
  qtde_sistema: number | null;
  qtde_informada: number;
  observacao: string | null;
  operador_nome: string | null;
  criado_em: string;
};

function divergenciaDe(r: Registro): number | null {
  return r.qtde_sistema == null ? null : r.qtde_informada - r.qtde_sistema;
}

function AnaliseConferencias() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [soDivergentes, setSoDivergentes] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);

  async function carregar() {
    setCarregando(true);
    const PAGE = 1000;
    const out: Registro[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("conferencias_posicao")
        .select("id, codigo_posicao, sku, descricao, lote, qtde_sistema, qtde_informada, observacao, operador_nome, criado_em")
        .order("criado_em", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) { toast.error(error.message); break; }
      const rows = (data ?? []) as Registro[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    setRegistros(out);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    const ch = supabase
      .channel("conferencias-posicao-analise")
      .on("postgres_changes", { event: "*", schema: "public", table: "conferencias_posicao" }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtrados = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    return registros.filter((r) => {
      if (soDivergentes) {
        const d = divergenciaDe(r);
        if (d == null || d === 0) return false;
      }
      if (!f) return true;
      return (
        r.codigo_posicao.toUpperCase().includes(f) ||
        formatPosicaoDisplay(r.codigo_posicao).toUpperCase().includes(f) ||
        r.sku.toUpperCase().includes(f) ||
        (r.descricao ?? "").toUpperCase().includes(f) ||
        (r.operador_nome ?? "").toUpperCase().includes(f) ||
        (r.observacao ?? "").toUpperCase().includes(f)
      );
    });
  }, [registros, filtro, soDivergentes]);

  const kpis = useMemo(() => {
    const posicoes = new Set<string>();
    const skus = new Set<string>();
    const operadores = new Set<string>();
    let divergentes = 0;
    for (const r of registros) {
      posicoes.add(r.codigo_posicao);
      skus.add(r.sku);
      if (r.operador_nome) operadores.add(r.operador_nome);
      const d = divergenciaDe(r);
      if (d != null && d !== 0) divergentes++;
    }
    return { total: registros.length, posicoes: posicoes.size, skus: skus.size, operadores: operadores.size, divergentes };
  }, [registros]);

  useEffect(() => { setPage(0); }, [filtro, soDivergentes, pageSize]);

  const pageCount = Math.max(1, Math.ceil(filtrados.length / pageSize));
  const pageAtual = Math.min(page, pageCount - 1);
  const pagina = useMemo(
    () => filtrados.slice(pageAtual * pageSize, pageAtual * pageSize + pageSize),
    [filtrados, pageAtual, pageSize],
  );

  async function exportarXLSX() {
    if (filtrados.length === 0) { toast.error("Nada para exportar"); return; }
    const XLSX = await import("xlsx");
    const dados = filtrados.map((r) => {
      const d = divergenciaDe(r);
      return {
        Posição: formatPosicaoDisplay(r.codigo_posicao),
        "Posição (código)": r.codigo_posicao,
        SKU: r.sku,
        Descrição: r.descricao ?? "",
        Lote: r.lote ?? "",
        "Qtd sistema (WMS)": r.qtde_sistema ?? "",
        "Qtd conferida": r.qtde_informada,
        Divergência: d ?? "",
        Status: d == null ? "sem base WMS" : d === 0 ? "bate" : "divergente",
        Observação: r.observacao ?? "",
        Operador: r.operador_nome ?? "",
        "Data/hora": new Date(r.criado_em).toLocaleString("pt-BR"),
      };
    });
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Conferências");
    XLSX.writeFile(wb, `conferencias-posicao-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ScanLine className="h-4 w-4" /> Conferências de Posição
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {carregando ? "Carregando…" : `${fmtNum(kpis.total)} registros · atualiza em tempo real`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={carregar} disabled={carregando}>
            <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => void exportarXLSX()} disabled={filtrados.length === 0}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> Exportar Excel
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi icon={ListChecks} label="Registros" valor={fmtNum(kpis.total)} />
        <Kpi icon={MapPin} label="Posições" valor={fmtNum(kpis.posicoes)} />
        <Kpi icon={ScanLine} label="SKUs" valor={fmtNum(kpis.skus)} />
        <Kpi
          icon={AlertTriangle}
          label="Divergentes"
          valor={fmtNum(kpis.divergentes)}
          destaque={kpis.divergentes > 0}
        />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filtrar posição / SKU / operador / observação"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="max-w-sm h-8 text-sm"
        />
        <Button
          variant={soDivergentes ? "default" : "outline"}
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setSoDivergentes((v) => !v)}
        >
          <Filter className="h-3.5 w-3.5" />
          {soDivergentes ? "Só divergentes" : "Todas"}
        </Button>
        <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> {fmtNum(kpis.operadores)} operadores
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {fmtNum(filtrados.length)} de {fmtNum(registros.length)}
        </span>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Posição</th>
                <th className="text-left px-3 py-2 font-medium">SKU</th>
                <th className="text-left px-3 py-2 font-medium">Descrição</th>
                <th className="text-left px-3 py-2 font-medium">Lote</th>
                <th className="text-right px-3 py-2 font-medium">Sistema</th>
                <th className="text-right px-3 py-2 font-medium">Conferido</th>
                <th className="text-right px-3 py-2 font-medium">Δ</th>
                <th className="text-left px-3 py-2 font-medium">Operador</th>
                <th className="text-left px-3 py-2 font-medium">Data</th>
                <th className="text-left px-3 py-2 font-medium">Obs.</th>
              </tr>
            </thead>
            <tbody>
              {pagina.length === 0 && (
                <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">
                  {carregando ? "Carregando…" : "Nenhuma conferência."}
                </td></tr>
              )}
              {pagina.map((r) => {
                const d = divergenciaDe(r);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{formatPosicaoDisplay(r.codigo_posicao)}</td>
                    <td className="px-3 py-2 font-mono font-semibold">{r.sku}</td>
                    <td className="px-3 py-2 max-w-[260px] truncate" title={r.descricao ?? ""}>
                      {r.descricao || <span className="text-muted-foreground italic">—</span>}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.lote || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                      {r.qtde_sistema == null ? "—" : fmtNum(r.qtde_sistema)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">{fmtNum(r.qtde_informada)}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${
                      d == null ? "text-muted-foreground/50" : d === 0 ? "text-emerald-500" : "text-destructive font-semibold"
                    }`}>
                      {d == null ? "—" : d === 0 ? "0" : fmtDelta(d)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.operador_nome ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(r.criado_em).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate italic text-muted-foreground" title={r.observacao ?? ""}>
                      {r.observacao || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginação */}
      {filtrados.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Por página:</span>
            {[50, 100, 200].map((n) => (
              <button
                key={n}
                onClick={() => setPageSize(n)}
                className={`px-2 py-1 rounded border ${pageSize === n ? "border-primary text-primary" : "border-border hover:text-foreground"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span>
              {fmtNum(pageAtual * pageSize + 1)}–{fmtNum(Math.min((pageAtual + 1) * pageSize, filtrados.length))} de {fmtNum(filtrados.length)}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={pageAtual <= 0} onClick={() => setPage(pageAtual - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={pageAtual >= pageCount - 1} onClick={() => setPage(pageAtual + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon, label, valor, destaque,
}: { icon: typeof MapPin; label: string; valor: string; destaque?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${destaque ? "text-destructive" : ""}`}>{valor}</p>
    </div>
  );
}
