import { supabase } from "@/integrations/supabase/client";

export type LeituraQueueItem = {
  id: string; // local uuid
  inventario_id: string;
  codigo_posicao: string;
  codigo_produto: string;
  quantidade: number;
  numero_contagem: number;
  operador_id: string;
  operador_nome?: string | null;
  lido_em: string; // ISO local
};

const KEY = "inventario.offline.queue.v1";

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "loc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

export function getQueue(): LeituraQueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function setQueue(items: LeituraQueueItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("offline-queue-change"));
}

export function enqueueLeitura(
  data: Omit<LeituraQueueItem, "id" | "lido_em"> & { lido_em?: string },
): LeituraQueueItem {
  const item: LeituraQueueItem = {
    ...data,
    id: "local-" + uuid(),
    lido_em: data.lido_em ?? new Date().toISOString(),
  };
  setQueue([...getQueue(), item]);
  return item;
}

export function removeFromQueue(localId: string) {
  setQueue(getQueue().filter((i) => i.id !== localId));
}

export function getQueueForInventario(inventarioId: string): LeituraQueueItem[] {
  return getQueue().filter((i) => i.inventario_id === inventarioId);
}

let syncing = false;
export async function syncQueue(): Promise<{ ok: number; fail: number }> {
  if (syncing || typeof navigator === "undefined" || !navigator.onLine) {
    return { ok: 0, fail: 0 };
  }
  syncing = true;
  let ok = 0;
  let fail = 0;
  try {
    const items = getQueue();
    for (const it of items) {
      const { error } = await supabase.from("leituras").insert({
        inventario_id: it.inventario_id,
        codigo_posicao: it.codigo_posicao,
        codigo_produto: it.codigo_produto,
        quantidade: it.quantidade,
        numero_contagem: it.numero_contagem,
        operador_id: it.operador_id,
        lido_em: it.lido_em,
      });
      if (error) {
        fail++;
      } else {
        ok++;
        removeFromQueue(it.id);
      }
    }
  } finally {
    syncing = false;
  }
  return { ok, fail };
}
