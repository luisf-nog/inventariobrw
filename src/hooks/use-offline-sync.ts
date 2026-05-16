import { useEffect, useState } from "react";
import { getQueue, syncQueue } from "@/lib/offline-queue";
import { toast } from "sonner";

export function useOfflineSync() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pending, setPending] = useState<number>(() => getQueue().length);

  useEffect(() => {
    const refresh = () => setPending(getQueue().length);
    const goOnline = async () => {
      setOnline(true);
      const before = getQueue().length;
      if (before > 0) {
        const { ok, fail } = await syncQueue();
        refresh();
        if (ok > 0) toast.success(`Sincronizadas ${ok} leituras offline`);
        if (fail > 0) toast.error(`${fail} leituras falharam ao sincronizar`);
      }
    };
    const goOffline = () => { setOnline(false); toast.warning("Sem internet — modo offline ativo"); };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("offline-queue-change", refresh);
    // sync on mount if there's pending and we're online
    if (navigator.onLine && getQueue().length > 0) {
      goOnline();
    }
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("offline-queue-change", refresh);
    };
  }, []);

  return { online, pending };
}
