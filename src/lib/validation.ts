export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
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
