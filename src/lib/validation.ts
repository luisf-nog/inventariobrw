export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function formatPosicaoDisplay(codigo: string): string {
  const c = codigo.trim();
  if (c.length === 10) return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,7)}.${c.slice(7,10)}`;
  if (c.length === 12) {
    // PBL (flowrack) tem padding específico: 019950011305 → 01.995.01.135
    if (c.startsWith("01995")) {
      const seg3 = c.slice(6, 8);          // pula zero estrutural em c[5]
      const seg4 = c.slice(8, 10) + c[11]; // pula zero estrutural em c[10]
      return `${c.slice(0,2)}.${c.slice(2,5)}.${seg3}.${seg4}`;
    }
    // Picking padrão (porta-pallet): Dep(2).Rua(3).Predio(3).Andar(2).Apto(2)
    // e.g. 010070020101 → 01.007.002.01.01
    return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}.${c.slice(8,10)}.${c.slice(10,12)}`;
  }
  return c;
}

export function isValidCode(code: string): boolean {
  return code.length >= 3;
}

export function parseQuantidade(raw: string): number | null {
  const cleaned = raw.replace(",", ".").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
