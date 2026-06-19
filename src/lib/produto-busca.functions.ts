import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseEndereco, rotuloDeposito } from "./conferencia.functions";

const WMS_BASE = "https://apiwms.flsoft.com.br/brwdados";
const WMS_TOKEN = "QlJXX1dNUw==";
const COD_PROPRIETARIO = "100";
const CACHE_TTL_MS = 60_000;
const WMS_TIMEOUT_MS = 25_000;

type WmsRow = {
  COD_ENDERECO?: string;
  COD_DEPOSITO?: string | number;
  APELIDO?: string;
  COD_PROD_ERP?: string;
  COD_PRODUTO?: string;
  DESCR_PRODUTO?: string;
  CODIGO_BARRAS?: string;
  NUM_LOTE?: string;
  DT_VALIDADE?: string;
  QTDE_UNIDADES?: number;
};

let cache: { rows: WmsRow[]; carregadoEm: number } | null = null;
let inflight: Promise<WmsRow[]> | null = null;

async function baixar(): Promise<WmsRow[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), WMS_TIMEOUT_MS);
  try {
    const res = await fetch(`${WMS_BASE}/consultaEstoque?codProprietario=${COD_PROPRIETARIO}`, {
      headers: { Authorization: `Bearer ${WMS_TOKEN}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`WMS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as WmsRow[];
    if (!Array.isArray(rows)) throw new Error("Formato inesperado do WMS");
    return rows;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("Tempo de resposta do WMS esgotado");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function obter(forcar: boolean) {
  const agora = Date.now();
  if (!forcar && cache && agora - cache.carregadoEm < CACHE_TTL_MS) {
    return { rows: cache.rows, carregadoEm: cache.carregadoEm, doCache: true };
  }
  if (!forcar && inflight) {
    const rows = await inflight;
    return { rows, carregadoEm: cache?.carregadoEm ?? Date.now(), doCache: true };
  }
  const p = baixar();
  inflight = p;
  try {
    const rows = await p;
    cache = { rows, carregadoEm: Date.now() };
    return { rows, carregadoEm: cache.carregadoEm, doCache: false };
  } finally {
    if (inflight === p) inflight = null;
  }
}

export type PosicaoProduto = {
  posicao: string;
  apelido: string;
  deposito: string;
  deposito_rotulo: string;
  lote: string | null;
  qtde: number;
};

export const buscarProdutoWms = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      codigo: z.string().min(1).max(64),
      forcar: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const raw = data.codigo.trim().toUpperCase();
    const digits = raw.replace(/\D/g, "");
    const { rows, carregadoEm, doCache } = await obter(!!data.forcar);

    // Tentativa 1: match direto por SKU (COD_PROD_ERP / COD_PRODUTO) ou EAN.
    const bate = (r: WmsRow) => {
      const sku = String(r.COD_PROD_ERP ?? "").trim().toUpperCase();
      const sku2 = String(r.COD_PRODUTO ?? "").trim().toUpperCase();
      const ean = String(r.CODIGO_BARRAS ?? "").replace(/\D/g, "");
      if (sku && sku === raw) return true;
      if (sku2 && sku2 === raw) return true;
      if (digits && ean && ean === digits) return true;
      return false;
    };

    const filtrados = rows.filter(bate);

    let sku: string | null = null;
    let descricao: string | null = null;
    const porChave = new Map<string, PosicaoProduto>();

    for (const r of filtrados) {
      const posRaw = String(r.COD_ENDERECO ?? "").trim();
      if (!posRaw) continue;
      const pp = parseEndereco(posRaw, r.COD_DEPOSITO);
      if (!pp) continue;
      if (!sku) sku = String(r.COD_PROD_ERP ?? r.COD_PRODUTO ?? "").trim().toUpperCase() || null;
      if (!descricao) descricao = r.DESCR_PRODUTO ?? null;
      const lote = r.NUM_LOTE ? String(r.NUM_LOTE).trim() : "";
      const qtd = Number(r.QTDE_UNIDADES ?? 0);
      const k = `${pp.canon}|${lote}`;
      const ex = porChave.get(k);
      if (ex) {
        ex.qtde += qtd;
      } else {
        porChave.set(k, {
          posicao: pp.canon,
          apelido: pp.apelido,
          deposito: pp.deposito,
          deposito_rotulo: rotuloDeposito(pp.deposito),
          lote: lote || null,
          qtde: qtd,
        });
      }
    }

    const posicoes = Array.from(porChave.values()).sort((a, b) => {
      if (a.deposito !== b.deposito) return a.deposito.localeCompare(b.deposito);
      return a.posicao.localeCompare(b.posicao);
    });

    const total = posicoes.reduce((s, p) => s + p.qtde, 0);

    return {
      codigo_bipado: raw,
      sku,
      descricao,
      total,
      posicoes,
      consultado_em: new Date().toISOString(),
      estoque_carregado_em: new Date(carregadoEm).toISOString(),
      do_cache: doCache,
    };
  });

export type SugestaoProduto = {
  sku: string;
  descricao: string;
  ean: string | null;
  posicoes: number;
};

export const sugerirProdutosWms = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      termo: z.string().min(1).max(64),
      limite: z.number().int().min(1).max(50).optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const termo = data.termo.trim().toUpperCase();
    if (!termo) return { sugestoes: [] as SugestaoProduto[] };
    const limite = data.limite ?? 20;
    const termoDigits = termo.replace(/\D/g, "");
    const { rows } = await obter(false);

    type Agg = { sku: string; descricao: string; ean: string | null; posicoes: Set<string> };
    const mapa = new Map<string, Agg>();

    for (const r of rows) {
      const sku = String(r.COD_PROD_ERP ?? r.COD_PRODUTO ?? "").trim().toUpperCase();
      if (!sku) continue;
      const descricao = String(r.DESCR_PRODUTO ?? "").trim();
      const ean = String(r.CODIGO_BARRAS ?? "").replace(/\D/g, "");
      const skuUp = sku.toUpperCase();
      const descUp = descricao.toUpperCase();
      const bateSku = skuUp.includes(termo);
      // Descrição: só casa se o termo for um prefixo de palavra (evita "GT" casar com "tuGTon")
      const bateDesc =
        termo.length >= 3 &&
        new RegExp(`\\b${termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(descUp);
      const bateEan = termoDigits.length >= 3 && ean.includes(termoDigits);
      if (!bateSku && !bateDesc && !bateEan) continue;
      const ex = mapa.get(sku);
      const pos = String(r.COD_ENDERECO ?? "").trim();
      if (ex) {
        if (pos) ex.posicoes.add(pos);
        if (!ex.descricao && descricao) ex.descricao = descricao;
        if (!ex.ean && ean) ex.ean = ean;
      } else {
        mapa.set(sku, {
          sku,
          descricao,
          ean: ean || null,
          posicoes: new Set(pos ? [pos] : []),
        });
      }
    }

    const sugestoes: SugestaoProduto[] = Array.from(mapa.values())
      .map((a) => ({ sku: a.sku, descricao: a.descricao, ean: a.ean, posicoes: a.posicoes.size }))
      .sort((a, b) => {
        const aStart = a.sku.startsWith(termo) ? 0 : 1;
        const bStart = b.sku.startsWith(termo) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return a.sku.localeCompare(b.sku);
      })
      .slice(0, limite);

    return { sugestoes };
  });

