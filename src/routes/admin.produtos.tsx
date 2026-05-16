import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, Search, Trash2 } from "lucide-react";

export const Route = createFileRoute("/admin/produtos")({
  component: AdminProdutos,
});

type Produto = { sku: string; descricao: string };

function AdminProdutos() {
  const [total, setTotal] = useState<number>(0);
  const [totalEans, setTotalEans] = useState<number>(0);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<(Produto & { eans: string[] })[]>([]);
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function carregarContagens() {
    const [{ count: p }, { count: e }] = await Promise.all([
      supabase.from("produtos").select("*", { count: "exact", head: true }),
      supabase.from("produto_eans").select("*", { count: "exact", head: true }),
    ]);
    setTotal(p ?? 0);
    setTotalEans(e ?? 0);
  }
  useEffect(() => { carregarContagens(); }, []);

  async function buscar() {
    const q = busca.trim();
    if (!q) { setResultados([]); return; }
    // Procura por SKU, descrição ou EAN
    const { data: porEan } = await supabase.from("produto_eans").select("sku").eq("ean", q).limit(5);
    const skusEan = (porEan ?? []).map((r) => r.sku);
    const { data: prods } = await supabase
      .from("produtos")
      .select("sku, descricao")
      .or(`sku.ilike.%${q}%,descricao.ilike.%${q}%${skusEan.length ? `,sku.in.(${skusEan.join(",")})` : ""}`)
      .limit(50);
    const skus = (prods ?? []).map((p) => p.sku);
    const { data: eans } = skus.length
      ? await supabase.from("produto_eans").select("ean, sku").in("sku", skus)
      : { data: [] as { ean: string; sku: string }[] };
    setResultados((prods ?? []).map((p) => ({
      ...p,
      eans: (eans ?? []).filter((e) => e.sku === p.sku).map((e) => e.ean),
    })));
  }

  async function excluirTudo() {
    if (!confirm("Apagar TODOS os produtos e EANs cadastrados?")) return;
    await supabase.from("produto_eans").delete().neq("ean", "");
    await supabase.from("produtos").delete().neq("sku", "");
    toast.success("Base limpa");
    carregarContagens();
    setResultados([]);
  }

  async function importar(file: File) {
    setImportando(true);
    setProgresso("Lendo planilha...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

      // mapeia colunas tolerando variações
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const sample = rows[0] ?? {};
      const cols = Object.keys(sample);
      const skuCol = cols.find((c) => /item|sku|codigo|cod\.|produto/.test(norm(c))) ?? cols[0];
      const descCol = cols.find((c) => /descric|desc|nome/.test(norm(c))) ?? cols[1];
      const eanCols = cols.filter((c) => /barra|ean|gtin/.test(norm(c)));

      const produtos: Produto[] = [];
      const eans: { ean: string; sku: string; tipo: string | null }[] = [];
      const skusVistos = new Set<string>();
      const eansVistos = new Set<string>();

      for (const r of rows) {
        const sku = String(r[skuCol] ?? "").trim().toUpperCase();
        const descricao = String(r[descCol] ?? "").trim();
        if (!sku || !descricao) continue;
        if (!skusVistos.has(sku)) {
          produtos.push({ sku, descricao });
          skusVistos.add(sku);
        }
        for (const ec of eanCols) {
          const raw = String(r[ec] ?? "").trim();
          if (!raw || raw.toUpperCase() === "N/A" || raw === "0") continue;
          const ean = raw.replace(/\D/g, "");
          if (!ean || eansVistos.has(ean)) continue;
          eansVistos.add(ean);
          eans.push({ ean, sku, tipo: ec });
        }
      }

      setProgresso(`Enviando ${produtos.length} produtos...`);
      // upsert em lotes
      const chunk = <T,>(arr: T[], n: number) => arr.reduce<T[][]>((acc, _, i) => (i % n ? acc : [...acc, arr.slice(i, i + n)]), []);
      let okP = 0, failP = 0;
      for (const batch of chunk(produtos, 500)) {
        const { error } = await supabase.from("produtos").upsert(batch, { onConflict: "sku" });
        if (error) { failP += batch.length; console.error(error); } else { okP += batch.length; }
        setProgresso(`Produtos: ${okP}/${produtos.length}`);
      }
      setProgresso(`Enviando ${eans.length} EANs...`);
      let okE = 0, failE = 0;
      for (const batch of chunk(eans, 500)) {
        const { error } = await supabase.from("produto_eans").upsert(batch, { onConflict: "ean" });
        if (error) { failE += batch.length; console.error(error); } else { okE += batch.length; }
        setProgresso(`EANs: ${okE}/${eans.length}`);
      }
      toast.success(`Importado: ${okP} produtos, ${okE} EANs${failP || failE ? ` (falhas: ${failP}+${failE})` : ""}`);
      carregarContagens();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message ?? String(e)));
    } finally {
      setImportando(false);
      setProgresso("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Produtos</h2>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString("pt-BR")} produtos · {totalEans.toLocaleString("pt-BR")} EANs
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={importando}>
            <Upload className="h-4 w-4 mr-1" />
            {importando ? progresso || "Importando..." : "Importar planilha"}
          </Button>
          {total > 0 && (
            <Button variant="outline" onClick={excluirTudo} disabled={importando}>
              <Trash2 className="h-4 w-4 mr-1" /> Limpar
            </Button>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          Planilha esperada: colunas com SKU, descrição e um ou mais códigos de barras (EAN). Reconhece automaticamente colunas
          como "Nº do item", "Descrição", "Cod.Barras Master/Inner/Embalagem". Reimportar atualiza os registros existentes.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Buscar por SKU, descrição ou EAN"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && buscar()}
        />
        <Button onClick={buscar} variant="secondary"><Search className="h-4 w-4" /></Button>
      </div>

      <div className="space-y-2">
        {resultados.map((p) => (
          <div key={p.sku} className="bg-card border border-border rounded-lg p-3">
            <div className="flex justify-between gap-2">
              <p className="font-mono font-semibold">{p.sku}</p>
              <p className="text-xs text-muted-foreground">{p.eans.length} EAN(s)</p>
            </div>
            <p className="text-sm">{p.descricao}</p>
            {p.eans.length > 0 && (
              <p className="text-xs text-muted-foreground font-mono mt-1 break-all">{p.eans.join(" · ")}</p>
            )}
          </div>
        ))}
        {busca && resultados.length === 0 && (
          <p className="text-sm text-muted-foreground">Nada encontrado.</p>
        )}
      </div>
    </div>
  );
}
