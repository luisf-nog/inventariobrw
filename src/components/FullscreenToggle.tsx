import { useEffect } from "react";

/** Botão flutuante para entrar/sair de tela cheia no coletor.
 *  Usa a Fullscreen API (com fallback -webkit- pra WebView antigo). */
export function FullscreenToggle() {
  useEffect(() => {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
      webkitFullscreenElement?: Element;
    };
    if (!el.requestFullscreen && !el.webkitRequestFullscreen) return;

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Tela cheia");
    button.title = "Tela cheia";
    button.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:9999",
      "width:44px",
      "height:44px",
      "border-radius:22px",
      "background:#1b1f2a",
      "color:#f1f3f7",
      "border:1px solid #2b3142",
      "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
      "font-size:22px",
      "font-weight:900",
      "line-height:40px",
      "text-align:center",
      "padding:0",
    ].join(";");

    const update = () => {
      const isFs = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
      button.innerHTML = isFs ? "&#x2922;" : "&#x26F6;";
      button.title = isFs ? "Sair de tela cheia" : "Tela cheia";
      button.setAttribute("aria-label", button.title);
    };

    const onChange = () => {
      update();
    };
    const toggle = async () => {
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

    update();
    button.addEventListener("click", toggle);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    document.body.appendChild(button);

    return () => {
      button.removeEventListener("click", toggle);
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      button.remove();
    };
  }, []);

  return null;
}
