import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

/** Botão flutuante para entrar/sair de tela cheia no coletor.
 *  Usa a Fullscreen API (com fallback -webkit- pra WebView antigo). */
export function FullscreenToggle() {
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element };
      setIsFs(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggle = async () => {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
      webkitFullscreenElement?: Element;
    };
    try {
      if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen indisponível neste dispositivo:", err);
    }
  };

  // Esconde se a API não existe
  const el = typeof document !== "undefined" ? (document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }) : null;
  const supported = el && (el.requestFullscreen || el.webkitRequestFullscreen);
  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isFs ? "Sair de tela cheia" : "Tela cheia"}
      title={isFs ? "Sair de tela cheia" : "Tela cheia"}
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        width: 44,
        height: 44,
        borderRadius: 22,
        background: "#1b1f2a",
        color: "#f1f3f7",
        border: "1px solid #2b3142",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      {isFs ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
    </button>
  );
}
