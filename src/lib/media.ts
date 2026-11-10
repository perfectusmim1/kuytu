import { decryptBytes } from "./crypto";
import { api, authFetch } from "./vault";

export type PreparedImage = { blob: Blob; w: number; h: number; mime: string };

export type ResolvedSocial = {
  id?: string | null;
  photo?: boolean;
  title?: string | null;
  author?: string | null;
  description?: string | null;
  siteName?: string | null;
  thumbDataUrl?: string | null;
  imagesDataUrls?: string[] | null;
  videoUrl?: string | null;
  duration?: number | null;
  canonicalUrl?: string | null;
};

const MAX_EDGE = 2048;
const MAX_INPUT = 25 * 1024 * 1024;
const MAX_GIF = 8 * 1024 * 1024;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bu görsel açılamadı."));
    };
    img.src = url;
  });
}

/**
 * Re-encodes photos through a canvas before upload. This shrinks them and,
 * more importantly, drops EXIF metadata such as GPS location and device model.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("Yalnızca görsel gönderebilirsin.");
  if (file.size > MAX_INPUT) throw new Error("Görsel çok büyük (en fazla 25 MB).");
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("Bu görsel açılamadı.");

  if (file.type === "image/gif") {
    if (file.size > MAX_GIF) throw new Error("GIF çok büyük (en fazla 8 MB).");
    return { blob: file, w, h, mime: "image/gif" };
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Görsel işlenemedi.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("Görsel işlenemedi.");
  return { blob, w: cw, h: ch, mime: "image/jpeg" };
}

const cache = new Map<string, Promise<string>>();

/** Lets the sender keep showing the local copy instead of re-downloading it. */
export function rememberMedia(url: string, objectUrl: string) {
  cache.set(url, Promise.resolve(objectUrl));
}

/** Downloads ciphertext through our relay, decrypts on the device, returns a blob: URL. */
export function loadEncryptedMedia(url: string, enc: { k: string; iv: string; mime: string }): Promise<string> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const res = await authFetch(`/api/media?u=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error("Medya alınamadı.");
      const plain = await decryptBytes(await res.arrayBuffer(), enc.k, enc.iv);
      return URL.createObjectURL(new Blob([plain], { type: enc.mime }));
    })();
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

const socialCache = new Map<string, Promise<ResolvedSocial | null>>();
const socialSyncCache = new Map<string, ResolvedSocial>();

export function getCachedSocial(url: string): ResolvedSocial | null {
  const key = `v3:${url}`;
  const mem = socialSyncCache.get(key);
  if (mem) return mem;
  if (typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(`kuytu:social:${key}`);
      if (raw) {
        const parsed = JSON.parse(raw) as ResolvedSocial;
        socialSyncCache.set(key, parsed);
        return parsed;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Resolves social media metadata, thumbnail, and direct stream URL via the server relay. */
export function resolveSocial(url: string): Promise<ResolvedSocial | null> {
  const cached = getCachedSocial(url);
  if (cached) return Promise.resolve(cached);
  const key = `v3:${url}`;
  let p = socialCache.get(key);
  if (!p) {
    p = api<ResolvedSocial>(`/api/resolve?url=${encodeURIComponent(url)}&v=3`)
      .then((res) => {
        if (res) {
          socialSyncCache.set(key, res);
          try {
            window.sessionStorage.setItem(`kuytu:social:${key}`, JSON.stringify(res));
          } catch {
            /* ignore quota */
          }
        }
        return res;
      })
      .catch(() => null);
    socialCache.set(key, p);
  }
  return p;
}

/** Backwards-compatible alias for TikTok resolution. */
export function resolveTikTok(url: string): Promise<{ id: string; photo: boolean } | null> {
  return resolveSocial(url).then((r) => (r?.id ? { id: r.id, photo: Boolean(r.photo) } : null));
}

const videoBlobCache = new Map<string, Promise<string>>();

/** Downloads a social video stream through our authenticated relay and returns a blob: URL. */
export function loadProxiedVideo(videoUrl: string): Promise<string> {
  let p = videoBlobCache.get(videoUrl);
  if (!p) {
    p = (async () => {
      const res = await authFetch(`/api/resolve?proxy=1&url=${encodeURIComponent(videoUrl)}`);
      if (!res.ok) throw new Error("Video yüklenemedi.");
      const ct = res.headers.get("content-type") || "video/mp4";
      const buf = await res.arrayBuffer();
      return URL.createObjectURL(new Blob([buf], { type: ct }));
    })();
    videoBlobCache.set(videoUrl, p);
    p.catch(() => videoBlobCache.delete(videoUrl));
  }
  return p;
}
