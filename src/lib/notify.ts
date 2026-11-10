export async function registerSW(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    /* notifications fall back to the page-level API */
  }
}

export type NoticeState = "unsupported" | "default" | "granted" | "denied";

export function noticeState(): NoticeState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function askNoticePermission(): Promise<NoticeState> {
  if (noticeState() === "unsupported") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export async function pushNotice(title: string, body: string, tag: string): Promise<void> {
  if (noticeState() !== "granted") return;
  const options = { body, tag, icon: "/icon.svg", badge: "/icon.svg" };
  try {
    // Android only allows notifications through a service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, options);
  } catch {
    /* not available in this context */
  }
}

let audio: AudioContext | null = null;

/** A short two-note chime, synthesised so no audio file is needed. */
export function blip(): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  } catch {
    /* audio blocked until the user interacts with the page */
  }
}
