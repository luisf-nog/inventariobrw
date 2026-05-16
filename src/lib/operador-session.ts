const KEY = "inv:operador";

export type OperadorSession = { id: string; nome: string };

export function getOperador(): OperadorSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OperadorSession) : null;
  } catch {
    return null;
  }
}

export function setOperador(op: OperadorSession) {
  localStorage.setItem(KEY, JSON.stringify(op));
}

export function clearOperador() {
  localStorage.removeItem(KEY);
}
