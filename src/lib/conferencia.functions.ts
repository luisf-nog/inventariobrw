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

    // Para o modo "prédio" precisamos descobrir o "tamanho" do prédio
    // (quantos andares e vãos existem) para preencher as posições vazias —
    // o WMS só devolve posições com estoque, então sem isso o operador não
    // conseguiria sinalizar uma vaga que aparece vazia no sistema mas tem
    // produto físico.
    let maxAndar = 0;
    let maxVao = 0;
    if (refAlvo) {
      maxAndar = parseInt(refAlvo.andar, 10) || 0;
      maxVao = parseInt(refAlvo.vao, 10) || 0;
    }

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
      if (pp) {
        const a = parseInt(pp.andar, 10);
        const v = parseInt(pp.vao, 10);
        if (a > maxAndar) maxAndar = a;
        if (v > maxVao) maxVao = v;
      }
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

    // Garante que toda a grade do prédio apareça, mesmo posições vazias.
    if (chavePredioAlvo && refAlvo) {
      // mínimo razoável: pelo menos a posição bipada existe
      if (maxAndar < 1) maxAndar = 1;
      if (maxVao < 1) maxVao = 1;
      const dep = chavePredioAlvo.slice(0, 2);
      const ruaPredio = chavePredioAlvo.slice(2, 8); // 6 dígitos
      for (let a = 1; a <= maxAndar; a++) {
        for (let v = 1; v <= maxVao; v++) {
          const codigo = dep + ruaPredio + String(a).padStart(2, "0") + String(v).padStart(2, "0");
          if (!porPosicao.has(codigo)) porPosicao.set(codigo, new Map());
        }
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

// =====================================================================
// Mapa de vazias por rua — operador bipa qualquer posição e o sistema
// devolve a rua inteira (todos os prédios) com a grade andar × vão
// indicando o que o WMS aponta como vazio, para validação física.
// =====================================================================

export type VagaRua = {
  andar: number;
  vao: number;
  codigo: string;
  apelido: string;
  vazia: boolean;
  qtdItens: number;
};

export type PredioRua = {
  predio: string;
  maxAndar: number;
  maxVao: number;
  totalVagas: number;
  vazias: number;
  posicoes: VagaRua[];
};

export const mapaVaziasRuaWms = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        codigoPosicao: z.string().min(1).max(64),
        forcar: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const ref = parseEndereco(data.codigoPosicao);
    if (!ref) {
      throw new Error("Código de posição inválido. Bipe uma posição da rua.");
    }
    const { rows, carregadoEm, doCache } = await obterEstoque(!!data.forcar);

    const depAlvo = ref.deposito;
    const ruaAlvo = ref.rua;

    type Predio = {
      maxAndar: number;
      maxVao: number;
      ocupadas: Map<string, Set<string>>;
    };
    const predios = new Map<string, Predio>();

    function ensure(predio: string): Predio {
      let p = predios.get(predio);
      if (!p) {
        p = { maxAndar: 0, maxVao: 0, ocupadas: new Map() };
        predios.set(predio, p);
      }
      return p;
    }

    for (const r of rows) {
      const posRaw = String(r.COD_ENDERECO ?? "").trim();
      if (!posRaw) continue;
      const pp = parseEndereco(posRaw, r.COD_DEPOSITO);
      if (!pp) continue;
      if (pp.deposito !== depAlvo) continue;
      if (pp.rua !== ruaAlvo) continue;
      const a = parseInt(pp.andar, 10);
      const v = parseInt(pp.vao, 10);
      if (!a || !v) continue;
      const pred = ensure(pp.predio);
      if (a > pred.maxAndar) pred.maxAndar = a;
      if (v > pred.maxVao) pred.maxVao = v;
      const sku = String(r.COD_PROD_ERP ?? r.COD_PRODUTO ?? "").trim().toUpperCase();
      const qtd = Number(r.QTDE_UNIDADES ?? 0);
      if (!sku || qtd <= 0) continue;
      const key = `${pp.andar}-${pp.vao}`;
      let set = pred.ocupadas.get(key);
      if (!set) { set = new Set(); pred.ocupadas.set(key, set); }
      set.add(sku);
    }

    ensure(ref.predio);
    const predioRef = predios.get(ref.predio)!;
    const aRef = parseInt(ref.andar, 10);
    const vRef = parseInt(ref.vao, 10);
    if (aRef > predioRef.maxAndar) predioRef.maxAndar = aRef;
    if (vRef > predioRef.maxVao) predioRef.maxVao = vRef;

    const lista: PredioRua[] = [];
    let totalVagas = 0;
    let totalVazias = 0;

    for (const [predio, p] of Array.from(predios.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const posicoes: VagaRua[] = [];
      for (let a = 1; a <= p.maxAndar; a++) {
        for (let v = 1; v <= p.maxVao; v++) {
          const andarStr = String(a).padStart(2, "0");
          const vaoStr = String(v).padStart(2, "0");
          const codigo = depAlvo + ruaAlvo + predio + andarStr + vaoStr;
          const set = p.ocupadas.get(`${andarStr}-${vaoStr}`);
          const qtdItens = set ? set.size : 0;
          const vazia = qtdItens === 0;
          if (vazia) totalVazias++;
          totalVagas++;
          posicoes.push({
            andar: a,
            vao: v,
            codigo,
            apelido: `${ruaAlvo}-${predio}-${andarStr}-${vaoStr}`,
            vazia,
            qtdItens,
          });
        }
      }
      lista.push({
        predio,
        maxAndar: p.maxAndar,
        maxVao: p.maxVao,
        totalVagas: p.maxAndar * p.maxVao,
        vazias: posicoes.filter((x) => x.vazia).length,
        posicoes,
      });
    }

    return {
      deposito: depAlvo,
      deposito_rotulo: ref.depositoRotulo,
      rua: ruaAlvo,
      bipada: { predio: ref.predio, andar: ref.andar, vao: ref.vao, codigo: ref.canon, apelido: ref.apelido },
      total_vagas: totalVagas,
      total_vazias: totalVazias,
      predios: lista,
      consultado_em: new Date().toISOString(),
      estoque_carregado_em: new Date(carregadoEm).toISOString(),
      do_cache: doCache,
    };
  });
