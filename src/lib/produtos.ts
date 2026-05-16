import { supabase } from "@/integrations/supabase/client";
import { normalizeCode } from "@/lib/validation";

export type ProdutoResolvido = {
  sku: string;
  descricao: string | null;
};

export async function resolverProdutoPorCodigo(raw: string): Promise<ProdutoResolvido> {
  const codigo = normalizeCode(raw);
  let sku = codigo;

  const eanDigits = raw.replace(/\D/g, "");
  if (eanDigits.length >= 6) {
    const { data } = await supabase
      .from("produto_eans")
      .select("sku")
      .eq("ean", eanDigits)
      .maybeSingle();

    if (data?.sku) sku = data.sku;
  }

  const { data: produto } = await supabase
    .from("produtos")
    .select("descricao")
    .eq("sku", sku)
    .maybeSingle();

  return { sku, descricao: produto?.descricao ?? null };
}

export async function traduzirEansParaSkus(codigos: string[]): Promise<Record<string, string>> {
  const eans = Array.from(new Set(codigos.map((c) => c.replace(/\D/g, "")).filter((c) => c.length >= 6)));
  if (eans.length === 0) return {};

  const { data } = await supabase.from("produto_eans").select("ean, sku").in("ean", eans);
  const map: Record<string, string> = {};
  for (const item of data ?? []) map[item.ean] = item.sku;
  return map;
}

export async function buscarDescricoesPorSku(skus: string[]): Promise<Record<string, string>> {
  const unicos = Array.from(new Set(skus.filter(Boolean)));
  if (unicos.length === 0) return {};

  const { data } = await supabase.from("produtos").select("sku, descricao").in("sku", unicos);
  const map: Record<string, string> = {};
  for (const produto of data ?? []) map[produto.sku] = produto.descricao;
  return map;
}