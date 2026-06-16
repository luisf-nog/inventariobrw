import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const WMS_BASE = "https://apiwms.flsoft.com.br/brwdados";
const WMS_TOKEN = "QlJXX1dNUw==";
const COD_PROPRIETARIO = "100";

type WmsRow = {
  COD_ENDERECO?: string;
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

export type ItemPosicaoWms = {
  sku: string;
  descricao: string | null;
  lote: string | null;
  qtde: number;
  ean: string | null;
  dt_validade: string | null;
};

export const consultarPosicaoWms = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ codigoPosicao: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const alvo = data.codigoPosicao.trim().toUpperCase();
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
    if (!Array.isArray(rows)) throw new Error("Formato inesperado do WMS");

    const agregado = new Map<string, ItemPosicaoWms>();
    for (const r of rows) {
      const pos = String(r.COD_ENDERECO ?? "").trim().toUpperCase();
      if (pos !== alvo) continue;
      const sku = String(r.COD_PROD_ERP ?? r.COD_PRODUTO ?? "").trim().toUpperCase();
      if (!sku) continue;
      const lote = r.NUM_LOTE ? String(r.NUM_LOTE).trim() : "";
      const k = `${sku}|${lote}`;
      const qtd = Number(r.QTDE_UNIDADES ?? 0);
      const ex = agregado.get(k);
      if (ex) {
        ex.qtde += qtd;
      } else {
        agregado.set(k, {
          sku,
          descricao: r.DESCR_PRODUTO ?? null,
          lote: lote || null,
          qtde: qtd,
          ean: r.CODIGO_BARRAS ?? null,
          dt_validade: r.DT_VALIDADE ?? null,
        });
      }
    }

    return {
      posicao: alvo,
      consultado_em: new Date().toISOString(),
      itens: Array.from(agregado.values()).sort((a, b) =>
        a.sku.localeCompare(b.sku),
      ),
    };
  });
