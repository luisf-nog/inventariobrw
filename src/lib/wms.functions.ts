import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const WMS_BASE = "https://apiwms.flsoft.com.br/brwdados";
const WMS_TOKEN = "QlJXX1dNUw==";
const COD_PROPRIETARIO = "100";

type WmsRow = {
  COD_ENDERECO: string;
  APELIDO?: string;
  COD_PROD_ERP?: string;
  COD_PRODUTO?: string;
  DESCR_PRODUTO?: string;
  CODIGO_BARRAS?: string;
  NUM_LOTE?: string;
  DT_VALIDADE?: string;
  QTDE_UNIDADES?: number;
  QTDE_ESTOQUE?: number;
  QTDE_EMBAL?: number;
};

export const sincronizarEstoqueWms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ inventarioId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = context.supabase;
    const url = `${WMS_BASE}/consultaEstoque?codProprietario=${COD_PROPRIETARIO}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${WMS_TOKEN}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`WMS retornou ${res.status}: ${body.slice(0, 200)}`);
    }
    const rows = (await res.json()) as WmsRow[];
    if (!Array.isArray(rows)) {
      throw new Error("Formato inesperado do WMS");
    }

    // Limpa snapshot anterior do inventário
    const { error: delErr } = await supabaseAdmin
      .from("estoque_wms_snapshot")
      .delete()
      .eq("inventario_id", data.inventarioId);
    if (delErr) throw new Error(`Erro limpando snapshot: ${delErr.message}`);

    // Normaliza e dedup por (posicao, sku, lote)
    const seen = new Map<string, any>();
    for (const r of rows) {
      const codigo_posicao = String(r.COD_ENDERECO ?? "").trim().toUpperCase();
      const sku = String(r.COD_PROD_ERP ?? r.COD_PRODUTO ?? "").trim().toUpperCase();
      if (!codigo_posicao || !sku) continue;
      // Filtra somente posições do flowrack (01.995.*)
      if (!codigo_posicao.startsWith("01995")) continue;
      const lote = r.NUM_LOTE ? String(r.NUM_LOTE).trim() : "";
      const k = `${codigo_posicao}|${sku}|${lote}`;
      const qtd = Number(r.QTDE_UNIDADES ?? 0);
      if (seen.has(k)) {
        // soma duplicatas eventuais
        const ex = seen.get(k);
        ex.qtde_unidades += qtd;
      } else {
        seen.set(k, {
          inventario_id: data.inventarioId,
          codigo_posicao,
          sku,
          descricao: r.DESCR_PRODUTO ?? null,
          qtde_unidades: qtd,
          qtde_estoque: r.QTDE_ESTOQUE ?? null,
          qtde_embal: r.QTDE_EMBAL ?? null,
          ean: r.CODIGO_BARRAS ?? null,
          lote: lote || null,
          dt_validade: r.DT_VALIDADE ?? null,
          raw: r as any,
        });
      }
    }

    const linhas = Array.from(seen.values());

    // Insere em lotes (limite payload supabase ~ alguns MB)
    const CHUNK = 1000;
    let inseridos = 0;
    for (let i = 0; i < linhas.length; i += CHUNK) {
      const slice = linhas.slice(i, i + CHUNK);
      const { error } = await supabaseAdmin
        .from("estoque_wms_snapshot")
        .insert(slice);
      if (error) throw new Error(`Erro inserindo snapshot (lote ${i}): ${error.message}`);
      inseridos += slice.length;
    }

    const agora = new Date().toISOString();
    await supabaseAdmin
      .from("inventarios")
      .update({ wms_sincronizado_em: agora })
      .eq("id", data.inventarioId);

    return {
      ok: true,
      total_recebido: rows.length,
      total_inserido: inseridos,
      posicoes: new Set(linhas.map((l) => l.codigo_posicao)).size,
      sincronizado_em: agora,
    };
  });
