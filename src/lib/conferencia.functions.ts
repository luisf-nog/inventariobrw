import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const WMS_BASE = "https://apiwms.flsoft.com.br/brwdados";
const WMS_TOKEN = "QlJXX1dNUw==";
const COD_PROPRIETARIO = "100";

// A API do WMS só aceita filtrar por codProprietario — toda chamada devolve o
// estoque inteiro (~5 MB). Em vez de baixar isso a cada bipe, mantemos o dump
// em memória por uma janela curta e filtramos a posição localmente.
const CACHE_TTL_MS = 60_000; // 60s — dado "ao vivo o bastante" para conferência
const WMS_TIMEOUT_MS = 25_000;

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

// Cache de processo. No Cloudflare Workers o isolate fica "quente" entre
// requisições, então rajadas de bipes reaproveitam o mesmo dump.
let cache: { rows: WmsRow[]; carregadoEm: number } | null = null;
let inflight: Promise<WmsRow[]> | null = null;

async function baixarEstoqueWms(): Promise<WmsRow[]> {
  const url = `${WMS_BASE}/consultaEstoque?codProprietario=${COD_PROPRIETARIO}`;
  // NÃO definimos Accept-Encoding manualmente: no Workers isso desativa a
  // descompressão automática. O runtime negocia gzip sozinho.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WMS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${WMS_TOKEN}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`WMS retornou ${res.status}: ${body.slice(0, 200)}`);
    }
    const rows = (await res.json()) as WmsRow[];
    if (!Array.isArray(rows)) throw new Error("Formato inesperado do WMS");
    return rows;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("Tempo de resposta do WMS esgotado — tente novamente");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function obterEstoque(
  forcar: boolean,
): Promise<{ rows: WmsRow[]; carregadoEm: number; doCache: boolean }> {
  const agora = Date.now();
  if (!forcar && cache && agora - cache.carregadoEm < CACHE_TTL_MS) {
    return { rows: cache.rows, carregadoEm: cache.carregadoEm, doCache: true };
  }
  // Dedup de requisições concorrentes: vários bipes simultâneos compartilham
  // o mesmo download em vez de disparar N chamadas ao WMS.
  if (!forcar && inflight) {
    const rows = await inflight;
    return { rows, carregadoEm: cache?.carregadoEm ?? Date.now(), doCache: true };
  }
  const p = baixarEstoqueWms();
  inflight = p;
  try {
    const rows = await p;
    cache = { rows, carregadoEm: Date.now() };
    return { rows, carregadoEm: cache.carregadoEm, doCache: false };
  } finally {
    if (inflight === p) inflight = null;
  }
}

export type PosicaoComItens = {
  codigo: string;
  itens: ItemPosicaoWms[];
};

// Endereços têm 12 dígitos: LL-RRRR-PP-AA-VV
//   LL = lado, RRRR = rua, PP = prédio, AA = andar, VV = vão
// Um "prédio físico" agrupa 2 endereços que compartilham rua+andar+vão e
// cujos PP são consecutivos (ímpar + próximo par): {01,02}, {03,04}, …
// O lado pode diferir entre as faces (ruas extradimensionais invertem o
// lado), por isso ignoramos LL no matching.
function parseEndereco(code: string) {
  const c = code.replace(/\D/g, "");
  if (c.length !== 12) return null;
  return {
    lado: c.slice(0, 2),
    rua: c.slice(2, 6),
    predio: parseInt(c.slice(6, 8), 10),
    andar: c.slice(8, 10),
    vao: c.slice(10, 12),
  };
}

function chavesDoPredio(code: string) {
  const p = parseEndereco(code);
  if (!p || !Number.isFinite(p.predio) || p.predio < 1) return null;
  const base = p.predio % 2 === 1 ? p.predio : p.predio - 1; // ímpar do par
  return {
    rua: p.rua,
    andar: p.andar,
    vao: p.vao,
    predios: [base, base + 1] as [number, number],
  };
}

export const consultarPosicaoWms = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        codigoPosicao: z.string().min(1).max(64),
        forcar: z.boolean().optional(),
        modo: z.enum(["posicao", "predio"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const alvo = data.codigoPosicao.trim().toUpperCase();
    const modo = data.modo ?? "posicao";
    const { rows, carregadoEm, doCache } = await obterEstoque(!!data.forcar);

    const pred = modo === "predio" ? chavesDoPredio(alvo) : null;
    const matchPredio = (pos: string) => {
      if (!pred) return false;
      const p = parseEndereco(pos);
      if (!p) return false;
      return (
        p.rua === pred.rua &&
        p.andar === pred.andar &&
        p.vao === pred.vao &&
        (p.predio === pred.predios[0] || p.predio === pred.predios[1])
      );
    };

    const porPosicao = new Map<string, Map<string, ItemPosicaoWms>>();
    for (const r of rows) {
      const pos = String(r.COD_ENDERECO ?? "").trim().toUpperCase();
      if (!pos) continue;
      const bate = pos === alvo || (modo === "predio" && matchPredio(pos));
      if (!bate) continue;
      const sku = String(r.COD_PROD_ERP ?? r.COD_PRODUTO ?? "").trim().toUpperCase();
      if (!sku) continue;
      const lote = r.NUM_LOTE ? String(r.NUM_LOTE).trim() : "";
      const k = `${sku}|${lote}`;
      const qtd = Number(r.QTDE_UNIDADES ?? 0);
      let agg = porPosicao.get(pos);
      if (!agg) { agg = new Map(); porPosicao.set(pos, agg); }
      const ex = agg.get(k);
      if (ex) {
        ex.qtde += qtd;
      } else {
        agg.set(k, {
          sku,
          descricao: r.DESCR_PRODUTO ?? null,
          lote: lote || null,
          qtde: qtd,
          ean: r.CODIGO_BARRAS ?? null,
          dt_validade: r.DT_VALIDADE ?? null,
        });
      }
    }

    const posicoes: PosicaoComItens[] = Array.from(porPosicao.entries())
      .map(([codigo, m]) => ({
        codigo,
        itens: Array.from(m.values()).sort((a, b) => a.sku.localeCompare(b.sku)),
      }))
      .sort((a, b) => {
        if (a.codigo === alvo) return -1;
        if (b.codigo === alvo) return 1;
        return a.codigo.localeCompare(b.codigo);
      });

    if (!posicoes.find((p) => p.codigo === alvo)) {
      posicoes.unshift({ codigo: alvo, itens: [] });
    }

    return {
      posicao: alvo,
      modo,
      predio: pred,
      consultado_em: new Date().toISOString(),
      estoque_carregado_em: new Date(carregadoEm).toISOString(),
      do_cache: doCache,
      posicoes,
    };
  });
