export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function formatPosicaoDisplay(codigo: string): string {
  const c = codigo.trim();
  if (c.length === 10) return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,7)}.${c.slice(7,10)}`;
  if (c.length === 12) return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}.${c.slice(8,12)}`;
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
