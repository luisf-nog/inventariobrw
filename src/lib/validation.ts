export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function formatPosicaoDisplay(codigo: string): string {
  const c = codigo.trim();
  if (c.length === 10) return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,7)}.${c.slice(7,10)}`;
  if (c.length === 12) {
    // WMS pads with a leading zero on segment 3 and a zero in the penultimate position of segment 4
    // e.g. 019950011305 → 01.995.01.135
    const seg3 = c.slice(6, 8);           // skip structural zero at c[5]
    const seg4 = c.slice(8, 10) + c[11]; // skip structural zero at c[10]
    return `${c.slice(0,2)}.${c.slice(2,5)}.${seg3}.${seg4}`;
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
