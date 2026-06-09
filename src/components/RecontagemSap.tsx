import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Upload, Lock, Unlock, RefreshCw, Trash2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { fmtNum, fmtDelta } from "@/lib/validation";

export type RecontagemItem = {
  sku: string;
  descricao: string;
  deltaPicking: number | null;
  deltaPbl: number | null;
  divergente: boolean;
  naoContado: boolean;
};

type PedidoSap = { sku: string; pedido: string | null; qtde: number | null; descricao: string | null };

export function RecontagemSap({ itens, isAdmin }: { itens: RecontagemItem[]; isAdmin: boolean }) {
  const [pedidos, setPedidos] = useState<PedidoSap[]>([]);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [filtro, setFiltro] = useState("");
  const [mostrarBloqueados, setMostrarBloqueados] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const carregar = async () => {
    const PAGE = 1000;
    const out: PedidoSap[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("itens_pedidos_sap")
        .select("sku, pedido, qtde, descricao, atualizado_em")
        .order("atualizado_em", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) { toast.error(error.message); break; }
      const rows = (data ?? []) as any[];
      if (rows.length && !atualizadoEm) setAtualizadoEm(rows[0].atualizado_em);
      out.push(...rows.map((r) => ({ sku: r.sku, pedido: r.pedido, qtde: r.qtde, descricao: r.descricao })));
      if (rows.length < PAGE) break;
    }
    setPedidos(out);
    setCarregando(false);
  };

  useEffect(() => {
    carregar();
    const ch = supabase
      .channel("itens-pedidos-sap")
      .on("postgres_changes", { event: "*", schema: "public", table: "itens_pedidos_sap" }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // sku -> [{pedido, qtde}]
  const bloqueios = useMemo(() => {
    const m = new Map<string, PedidoSap[]>();
    for (const p of pedidos) {
      const arr = m.get(p.sku) ?? [];
      arr.push(p);
      m.set(p.sku, arr);
    }
    return m;
  }, [pedidos]);

  const linhas = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    return itens
      .map((it) => {
        const bl = bloqueios.get(it.sku) ?? [];
        return { ...it, bloqueios: bl, bloqueado: bl.length > 0 };
      })
      .filter((r) => {
        if (!mostrarBloqueados && r.bloqueado) return false;
        if (f && !r.sku.toUpperCase().includes(f) && !r.descricao.toUpperCase().includes(f)) return false;
        return true;
      })
      .sort((a, b) => {
        // liberados primeiro
        if (a.bloqueado !== b.bloqueado) return a.bloqueado ? 1 : -1;
        return a.sku.localeCompare(b.sku);
      });
  }, [itens, bloqueios, filtro, mostrarBloqueados]);

  const totalLiberados = linhas.filter((r) => !r.bloqueado).length;
  const totalBloqueados = linhas.filter((r) => r.bloqueado).length;

  async function importar(file: File) {
    setImportando(true);
    setProgresso("Lendo planilha...");
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const cols = Object.keys(rows[0] ?? {});
      const findCol = (re: RegExp) => cols.find((c) => re.test(norm(c)));
      const indCol = findCol(/indicador/) ?? "Indicador";
      const skuCol = findCol(/cod.*item|sku/) ?? "Cod. Item";
      const pedCol = findCol(/pedido/) ?? "Nº Pedido";
      const qtdCol = findCol(/qtde|quant/) ?? "Qtde";
      const descCol = findCol(/descric/) ?? "Descrição item";

      const filtrados = rows.filter((r) => Number(r[indCol]) === 17);
      const toInsert = filtrados
        .map((r) => ({
          sku: String(r[skuCol] ?? "").trim().toUpperCase(),
          pedido: String(r[pedCol] ?? "").trim() || null,
          qtde: Number(r[qtdCol]) || null,
          descricao: String(r[descCol] ?? "").trim() || null,
        }))
        .filter((r) => r.sku);

      setProgresso(`Limpando base...`);
      const { error: delErr } = await supabase.from("itens_pedidos_sap").delete().neq("sku", "__never__");
      if (delErr) throw delErr;

      setProgresso(`Enviando ${toInsert.length} linhas...`);
      const chunk = <T,>(arr: T[], n: number) => arr.reduce<T[][]>((acc, _, i) => (i % n ? acc : [...acc, arr.slice(i, i + n)]), []);
      let ok = 0;
      for (const batch of chunk(toInsert, 500)) {
        const { error } = await supabase.from("itens_pedidos_sap").insert(batch);
        if (error) throw error;
        ok += batch.length;
        setProgresso(`Enviando: ${ok}/${toInsert.length}`);
      }
      toast.success(`Base SAP atualizada: ${ok} itens em pedido (Indicador 17)`);
      await carregar();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message ?? String(e)));
    } finally {
      setImportando(false);
      setProgresso("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function limpar() {
    if (!confirm("Limpar toda a base de itens em pedido (SAP)?")) return;
    const { error } = await supabase.from("itens_pedidos_sap").delete().neq("sku", "__never__");
    if (error) toast.error(error.message);
    else { toast.success("Base limpa"); carregar(); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" /> Base SAP — itens em pedido (Indicador 17)
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {carregando ? "Carregando..." : `${fmtNum(pedidos.length)} linhas · ${fmtNum(bloqueios.size)} SKUs bloqueados`}
              {atualizadoEm && ` · atualizado em ${new Date(atualizadoEm).toLocaleString("pt-BR")}`}
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
              <Button onClick={() => fileRef.current?.click()} disabled={importando} size="sm" className="gap-1.5 h-8">
                {importando
                  ? <><div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />{progresso || "Importando..."}</>
                  : <><Upload className="h-3.5 w-3.5" /> Substituir base</>}
              </Button>
              {pedidos.length > 0 && (
                <Button onClick={limpar} variant="outline" size="sm" className="gap-1.5 h-8" disabled={importando}>
                  <Trash2 className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Sobe a planilha exportada do SAP — o sistema filtra <code className="font-mono">Indicador = 17</code> e substitui a base inteira.
          Toda tela aberta atualiza em tempo real. Um item está <span className="text-emerald-600 dark:text-emerald-400 font-semibold">liberado</span> para recontagem
          quando o SKU não consta nesta base.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filtrar SKU / descrição"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <Button
          variant={mostrarBloqueados ? "outline" : "default"}
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setMostrarBloqueados((v) => !v)}
        >
          {mostrarBloqueados ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          {mostrarBloqueados ? "Mostrando todos" : "Apenas liberados"}
        </Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={carregar}>
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
        <div className="ml-auto flex gap-2">
          <Badge variant="secondary" className="gap-1"><Unlock className="h-3 w-3" /> {fmtNum(totalLiberados)} liberados</Badge>
          <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" /> {fmtNum(totalBloqueados)} bloqueados</Badge>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium w-[90px]">Status</th>
              <th className="text-left px-3 py-2 font-medium w-[110px]">SKU</th>
              <th className="text-left px-3 py-2 font-medium">Descrição</th>
              <th className="text-right px-3 py-2 font-medium w-[80px]">Δ Pick</th>
              <th className="text-right px-3 py-2 font-medium w-[80px]">Δ PBL</th>
              <th className="text-left px-3 py-2 font-medium w-[280px]">Pedidos bloqueando</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum item divergente.</td></tr>
            )}
            {linhas.map((r) => (
              <tr key={r.sku} className={`border-t border-border ${r.bloqueado ? "opacity-60" : ""}`}>
                <td className="px-3 py-2">
                  {r.bloqueado ? (
                    <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400 border-amber-600/40">
                      <Lock className="h-3 w-3" /> Bloq.
                    </Badge>
                  ) : (
                    <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                      <Unlock className="h-3 w-3" /> Livre
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 font-mono font-semibold">{r.sku}</td>
                <td className="px-3 py-2">
                  {r.descricao || <span className="text-muted-foreground italic">sem descrição</span>}
                  {r.naoContado && <Badge variant="secondary" className="ml-2 text-[10px]">não contado</Badge>}
                  {r.divergente && <Badge variant="destructive" className="ml-2 text-[10px]">divergente</Badge>}
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${(r.deltaPicking ?? 0) === 0 ? "text-muted-foreground/50" : (r.deltaPicking ?? 0) > 0 ? "text-emerald-500" : "text-destructive"}`}>
                  {r.deltaPicking == null ? "—" : fmtDelta(r.deltaPicking)}
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${(r.deltaPbl ?? 0) === 0 ? "text-muted-foreground/50" : (r.deltaPbl ?? 0) > 0 ? "text-emerald-500" : "text-destructive"}`}>
                  {r.deltaPbl == null ? "—" : fmtDelta(r.deltaPbl)}
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">
                  {r.bloqueios.length === 0 ? "—" : r.bloqueios.slice(0, 4).map((b, i) => (
                    <span key={i} className="inline-block mr-2">
                      <span className="font-mono">{b.pedido ?? "?"}</span>
                      {b.qtde != null && <span className="ml-1">({fmtNum(b.qtde)})</span>}
                    </span>
                  ))}
                  {r.bloqueios.length > 4 && <span>+{r.bloqueios.length - 4}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
