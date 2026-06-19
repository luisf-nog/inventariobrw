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
// "Prédio" no operacional = a rua inteira: todos os endereços que
// compartilham os dígitos de rua (3-6), independente de lado/prédio/andar/vão.
// Operadores costumam separar mentalmente entre PAR e ÍMPAR pelo dígito
// do prédio (PP) — usamos isso só para ordenar a exibição.
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

    const refAlvo = parseEndereco(alvo);
    const ruaAlvo = modo === "predio" ? refAlvo?.rua ?? null : null;

    const porPosicao = new Map<string, Map<string, ItemPosicaoWms>>();
    for (const r of rows) {
      const pos = String(r.COD_ENDERECO ?? "").trim().toUpperCase();
      if (!pos) continue;
      let bate = pos === alvo;
      if (!bate && ruaAlvo) {
        const p = parseEndereco(pos);
        if (p && p.rua === ruaAlvo) bate = true;
      }
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

    // Ordena: posição bipada primeiro; depois ÍMPAR antes de PAR (operação
    // costuma percorrer ímpar→par); dentro de cada paridade, por prédio/andar/vão/lado.
    const ordem = (pos: string) => {
      if (pos === alvo) return [-1, 0, 0, 0, 0, 0];
      const p = parseEndereco(pos);
      if (!p) return [2, 0, 0, 0, 0, 0];
      const paridade = p.predio % 2 === 1 ? 0 : 1; // ímpar primeiro
      return [0, paridade, p.predio, parseInt(p.andar, 10), parseInt(p.vao, 10), parseInt(p.lado, 10)];
    };
    const cmp = (a: string, b: string) => {
      const oa = ordem(a);
      const ob = ordem(b);
      for (let i = 0; i < oa.length; i++) {
        if (oa[i] !== ob[i]) return oa[i] - ob[i];
      }
      return a.localeCompare(b);
    };

    const posicoes: PosicaoComItens[] = Array.from(porPosicao.entries())
      .map(([codigo, m]) => ({
        codigo,
        itens: Array.from(m.values()).sort((a, b) => a.sku.localeCompare(b.sku)),
      }))
      .sort((a, b) => cmp(a.codigo, b.codigo));

    if (!posicoes.find((p) => p.codigo === alvo)) {
      posicoes.unshift({ codigo: alvo, itens: [] });
    }

    return {
      posicao: alvo,
      modo,
      predio: ruaAlvo ? { rua: ruaAlvo } : null,
      consultado_em: new Date().toISOString(),
      estoque_carregado_em: new Date(carregadoEm).toISOString(),
      do_cache: doCache,
      posicoes,
    };
  });
