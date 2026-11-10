export type KuytuAndroidBridge = {
  getVersionName: () => string;
  getNotificationPermission: () => "granted" | "default" | "denied";
  requestNotificationPermission: () => void;
  showNotification: (title: string, body: string, convId: string) => void;
  canInstallPackages: () => boolean;
  openInstallPermissionSettings: () => void;
  downloadAndInstallApk: (apkUrl: string) => void;
  vibrate: (ms: number) => void;
};

declare global {
  interface Window {
    KuytuAndroid?: KuytuAndroidBridge;
  }
}

export function getAndroidBridge(): KuytuAndroidBridge | null {
  if (typeof window === "undefined") return null;
  return window.KuytuAndroid ?? null;
}

export async function registerSW(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    /* notifications fall back to the page-level API or native Android bridge */
  }
}

export type NoticeState = "unsupported" | "default" | "granted" | "denied";

export function noticeState(): NoticeState {
  if (typeof window === "undefined") return "unsupported";
  const android = getAndroidBridge();
  if (android) {
    try {
      return android.getNotificationPermission();
    } catch {
      return "default";
    }
  }
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function askNoticePermission(): Promise<NoticeState> {
  const android = getAndroidBridge();
  if (android) {
    try {
      const current = android.getNotificationPermission();
      if (current === "granted") return "granted";
      return await new Promise<NoticeState>((resolve) => {
        let settled = false;
        const finish = (state: NoticeState) => {
          if (settled) return;
          settled = true;
          window.removeEventListener("kuytu:notif-permission", onResult as EventListener);
          resolve(state);
        };
        const onResult = (e: CustomEvent<string>) => {
          const val = e.detail;
          finish(val === "granted" ? "granted" : "denied");
        };
        window.addEventListener("kuytu:notif-permission", onResult as EventListener);
        android.requestNotificationPermission();
        setTimeout(() => {
          try {
            finish(android.getNotificationPermission());
          } catch {
            finish("denied");
          }
        }, 12_000);
      });
    } catch {
      return "denied";
    }
  }

  if (noticeState() === "unsupported") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export async function pushNotice(title: string, body: string, tag: string): Promise<void> {
  const android = getAndroidBridge();
  if (android) {
    try {
      if (android.getNotificationPermission() === "granted") {
        android.showNotification(title, body, tag);
      }
      return;
    } catch {
      /* fall through */
    }
  }

  if (noticeState() !== "granted") return;
  const options = { body, tag, icon: "/icon.svg", badge: "/icon.svg" };
  try {
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

export function vibrate(ms = 15): void {
  try {
    const android = getAndroidBridge();
    if (android) {
      android.vibrate(ms);
      return;
    }
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
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
