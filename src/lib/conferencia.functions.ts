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
  COD_DEPOSITO?: string | number;
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

// Endereço completo = DD + RRR-PPP-AA-VV (12 dígitos):
//   DD  = depósito (01 = Normal, 02 = Extradimensional)
//   RRR = rua  PPP = prédio  AA = andar  VV = vão
// O COD_ENDERECO do WMS traz só os 10 últimos dígitos; o depósito vem na
// coluna COD_DEPOSITO. Quando o operador bipa o código completo (12 díg.) ou
// só o endereço (10 díg.), aceitamos os dois — se faltar o depósito,
// assumimos "01" (Normal).
// "Prédio" = mesmos 8 primeiros dígitos da forma canônica (depósito + rua + prédio).
export const DEPOSITOS: Record<string, string> = {
  "01": "Normal",
  "02": "Extradimensional",
};

export function rotuloDeposito(dep: string | null | undefined): string {
  if (!dep) return "—";
  return DEPOSITOS[dep] ?? `Depósito ${dep}`;
}

export function parseEndereco(code: string, depositoExterno?: string | number | null) {
  const so = code.replace(/\D/g, "");
  if (so.length < 10) return null;
  const enderecoDigits = so.slice(-10);
  let deposito: string | null = null;
  if (so.length >= 12) {
    deposito = so.slice(-12, -10);
  } else if (depositoExterno != null && String(depositoExterno).trim() !== "") {
    deposito = String(depositoExterno).replace(/\D/g, "").padStart(2, "0").slice(-2);
  }
  const depCanon = deposito ?? "01"; // default Normal
  return {
    deposito: depCanon,
    depositoRotulo: rotuloDeposito(depCanon),
    rua: enderecoDigits.slice(0, 3),
    predio: enderecoDigits.slice(3, 6),
    andar: enderecoDigits.slice(6, 8),
    vao: enderecoDigits.slice(8, 10),
    chavePredio: depCanon + enderecoDigits.slice(0, 6), // 8 dígitos
    canon: depCanon + enderecoDigits, // 12 dígitos
    apelido: `${enderecoDigits.slice(0, 3)}-${enderecoDigits.slice(3, 6)}-${enderecoDigits.slice(6, 8)}-${enderecoDigits.slice(8, 10)}`,
  };
}

export function formatarApelido(code: string | null | undefined): string {
  if (!code) return "";
  const p = parseEndereco(code);
  return p ? p.apelido : code;
}

export function formatarApelidoCompleto(code: string | null | undefined): string {
  if (!code) return "";
  const p = parseEndereco(code);
  if (!p) return code;
  return `${p.deposito}-${p.apelido}`;
}

export function depositoDoCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const p = parseEndereco(code);
  return p?.deposito ?? null;
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
    const refAlvo = parseEndereco(data.codigoPosicao);
    const alvo = refAlvo?.canon ?? data.codigoPosicao.trim().toUpperCase();
    const modo = data.modo ?? "posicao";
    const { rows, carregadoEm, doCache } = await obterEstoque(!!data.forcar);

    const chavePredioAlvo = modo === "predio" ? refAlvo?.chavePredio ?? null : null;

    const porPosicao = new Map<string, Map<string, ItemPosicaoWms>>();
    for (const r of rows) {
      const posRaw = String(r.COD_ENDERECO ?? "").trim();
      if (!posRaw) continue;
      const pp = parseEndereco(posRaw, r.COD_DEPOSITO);
      const pos = pp?.canon ?? posRaw.toUpperCase();
      let bate = pos === alvo;
      if (!bate && chavePredioAlvo && pp && pp.chavePredio === chavePredioAlvo) {
        bate = true;
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

    // Ordena: posição bipada primeiro; depois por andar → vão.
    const ordem = (pos: string) => {
      if (pos === alvo) return [-1, 0, 0];
      const p = parseEndereco(pos);
      if (!p) return [2, 0, 0];
      return [0, parseInt(p.andar, 10), parseInt(p.vao, 10)];
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
      deposito: refAlvo?.deposito ?? null,
      deposito_rotulo: refAlvo?.depositoRotulo ?? null,
      modo,
      predio: chavePredioAlvo ? { chave: chavePredioAlvo } : null,
      consultado_em: new Date().toISOString(),
      estoque_carregado_em: new Date(carregadoEm).toISOString(),
      do_cache: doCache,
      posicoes,
    };
  });
