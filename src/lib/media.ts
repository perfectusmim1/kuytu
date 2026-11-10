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
    return { blob: file, w: cwOr(w), h: cwOr(h), mime: "image/gif" };
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

function cwOr(n: number): number {
  return Math.max(1, Math.round(n));
}

/**
 * Private in-memory Blob vault.
 * Instead of exposing persistent `blob:https://...` URLs that can be copied and opened
 * in external tabs, media is referenced by internal `kuytu-vault://<id>` tokens and rendered
 * onto `<canvas>` (or via self-revoking 1-shot object URLs).
 */
const blobVault = new Map<string, Blob>();
const mediaTokenCache = new Map<string, Promise<string>>();

export function registerLocalBlob(blob: Blob): string {
  const token = `kuytu-vault://${crypto.randomUUID()}`;
  blobVault.set(token, blob);
  return token;
}

export function getVaultBlob(tokenOrUrl: string): Blob | null {
  return blobVault.get(tokenOrUrl) ?? null;
}

/** Lets the sender keep showing the local copy instead of re-downloading it. */
export function rememberMedia(url: string, token: string) {
  const blob = blobVault.get(token);
  if (blob) {
    blobVault.set(url, blob);
  }
  mediaTokenCache.set(url, Promise.resolve(token));
}

/** Downloads ciphertext through our relay, decrypts on the device, returns an internal vault token. */
export function loadEncryptedMedia(url: string, enc: { k: string; iv: string; mime: string }): Promise<string> {
  let p = mediaTokenCache.get(url);
  if (!p) {
    p = (async () => {
      const existing = blobVault.get(url);
      if (existing) {
        const tok = registerLocalBlob(existing);
        return tok;
      }
      const res = await authFetch(`/api/media?u=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error("Medya alınamadı.");
      const plain = await decryptBytes(await res.arrayBuffer(), enc.k, enc.iv);
      const blob = new Blob([plain], { type: enc.mime });
      const token = registerLocalBlob(blob);
      blobVault.set(url, blob);
      return token;
    })();
    mediaTokenCache.set(url, p);
    p.catch(() => mediaTokenCache.delete(url));
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

const videoRawBlobCache = new Map<string, Promise<Blob>>();

/**
 * Downloads a social video stream through our authenticated relay and returns a one-time
 * ephemeral `blob:` URL that is immediately revoked once `<video>` buffers it.
 */
export async function loadProxiedVideo(videoUrl: string): Promise<string> {
  let p = videoRawBlobCache.get(videoUrl);
  if (!p) {
    p = (async () => {
      const res = await authFetch(`/api/resolve?proxy=1&url=${encodeURIComponent(videoUrl)}`);
      if (!res.ok) throw new Error("Video yüklenemedi.");
      const ct = res.headers.get("content-type") || "video/mp4";
      const buf = await res.arrayBuffer();
      return new Blob([buf], { type: ct });
    })();
    videoRawBlobCache.set(videoUrl, p);
    p.catch(() => videoRawBlobCache.delete(videoUrl));
  }
  const blob = await p;
  return URL.createObjectURL(blob);
}
