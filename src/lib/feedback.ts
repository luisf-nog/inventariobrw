// Sons gerados via WebAudio — sem assets externos
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return ctx;
}

function tone(freq: number, durationMs: number, type: OscillatorType = "sine", volume = 0.15) {
  const ac = getCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(ac.destination);
  const now = ac.currentTime;
  osc.start(now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.stop(now + durationMs / 1000);
}

export function beepSuccess() {
  tone(1200, 90, "square", 0.12);
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(60);
}

export function beepWarn() {
  tone(440, 180, "sawtooth", 0.15);
  setTimeout(() => tone(330, 220, "sawtooth", 0.15), 200);
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([120, 60, 200]);
}

export function beepError() {
  tone(200, 300, "square", 0.18);
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(300);
}
