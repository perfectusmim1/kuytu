import type { Payload, ReplyRef } from "./types";

/**
 * Link → native embed parsing. Runs entirely on the device, after decryption,
 * so the server never learns which links are shared unless the user loads a preview.
 */
export type Embed =
  | { kind: "tiktok"; url: string; id: string | null; photo: boolean }
  | { kind: "instagram"; url: string; code: string; variant: "p" | "reel" | "tv" }
  | { kind: "x"; url: string; id: string }
  | { kind: "youtube"; url: string; id: string; short: boolean; start: number }
  | { kind: "spotify"; url: string; id: string; type: string }
  | { kind: "image"; url: string; src: string };

export const EMBED_NAME: Record<Embed["kind"], string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
  youtube: "YouTube",
  spotify: "Spotify",
  image: "Görsel",
};

export const EMBED_DOMAIN: Record<Exclude<Embed["kind"], "image">, string> = {
  tiktok: "tiktok.com",
  instagram: "instagram.com",
  x: "x.com",
  youtube: "youtube.com",
  spotify: "open.spotify.com",
};

const PREVIEW_LABEL: Record<Embed["kind"], string> = {
  tiktok: "TikTok videosu",
  instagram: "Instagram gönderisi",
  x: "X gönderisi",
  youtube: "YouTube videosu",
  spotify: "Spotify",
  image: "GIF",
};

function httpsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && !u.port ? u : null;
  } catch {
    return null;
  }
}

/* Only these hosts are ever loaded automatically as media. Arbitrary image
   URLs stay plain links, so nobody can use a "picture" to log your IP. */

export function isVaultUrl(raw: string): boolean {
  const u = httpsUrl(raw);
  if (!u || u.search || u.hash || u.pathname.includes("..")) return false;
  if (u.hostname === "vault.kuytu.internal") {
    return /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u.pathname);
  }
  const hostOk = /^pomf\d*\.lain\.la$/.test(u.hostname) || u.hostname === "files.catbox.moe";
  return hostOk && /^\/[\w./-]{3,120}$/.test(u.pathname);
}

export function isImgurUrl(raw: string): boolean {
  const u = httpsUrl(raw);
  return !!u && u.hostname === "i.imgur.com" && /^\/\w+\.(jpe?g|png|gif|webp)$/i.test(u.pathname);
}

export function isGiphyUrl(raw: string): boolean {
  const u = httpsUrl(raw);
  if (!u) return false;
  const hostOk = /^media\d*\.giphy\.com$/.test(u.hostname) || u.hostname === "i.giphy.com";
  return hostOk && /\.(gif|webp)$/i.test(u.pathname);
}

export function parseEmbed(raw: string): Embed | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const path = u.pathname;
  let m: RegExpMatchArray | null;

  if (host === "tiktok.com") {
    m = path.match(/\/(video|photo)\/(\d{8,25})/);
    if (m) return { kind: "tiktok", url: raw, id: m[2], photo: m[1] === "photo" };
    m = path.match(/^\/v\/(\d{8,25})/);
    if (m) return { kind: "tiktok", url: raw, id: m[1], photo: false };
    if (/^\/t\/[\w-]+\/?$/.test(path)) return { kind: "tiktok", url: raw, id: null, photo: false };
    return null;
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return /^\/[\w-]+\/?$/.test(path) ? { kind: "tiktok", url: raw, id: null, photo: false } : null;
  }

  if (host === "instagram.com" || host === "instagr.am") {
    m = path.match(/\/(p|reel|reels|tv)\/([\w-]{5,40})/);
    if (!m) return null;
    const variant = m[1] === "reels" ? "reel" : (m[1] as "p" | "reel" | "tv");
    return { kind: "instagram", url: raw, code: m[2], variant };
  }

  if (host === "twitter.com" || host === "x.com") {
    m = path.match(/^\/(?:\w{1,20}|i\/web)\/status(?:es)?\/(\d{1,25})/);
    return m ? { kind: "x", url: raw, id: m[1] } : null;
  }

  if (host === "youtu.be" || host === "youtube.com" || host === "music.youtube.com") {
    let id: string | null = null;
    let short = false;
    if (host === "youtu.be") id = path.slice(1).split("/")[0];
    else if (path === "/watch") id = u.searchParams.get("v");
    else if ((m = path.match(/^\/(shorts|embed|live)\/([\w-]{11})/))) {
      id = m[2];
      short = m[1] === "shorts";
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const start = parseInt(u.searchParams.get("t") ?? u.searchParams.get("start") ?? "0", 10) || 0;
    return { kind: "youtube", url: raw, id, short, start };
  }

  if (host === "open.spotify.com") {
    m = path.match(/^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,40})/);
    return m ? { kind: "spotify", url: raw, type: m[1], id: m[2] } : null;
  }

  if (host === "giphy.com") {
    m = path.match(/^\/(?:gifs|stickers)\/(?:[^/]*-)?([A-Za-z0-9]{6,40})\/?$/);
    return m ? { kind: "image", url: raw, src: `https://media.giphy.com/media/${m[1]}/giphy.gif` } : null;
  }
  if (isGiphyUrl(raw) || isImgurUrl(raw)) return { kind: "image", url: raw, src: raw };

  return null;
}

export type Frame = { src: string; width: number; height: number | null; ratio: string | null };

/** Compact official embed/player URL when an iframe player is used. */
export function embedFrame(e: Exclude<Embed, { kind: "image" }>, dark: boolean): Frame | null {
  switch (e.kind) {
    case "tiktok":
      if (!e.id) return null;
      return e.photo
        ? { src: `https://www.tiktok.com/embed/v2/${e.id}?lang=tr-TR`, width: 340, height: 420, ratio: null }
        : {
            src: `https://www.tiktok.com/player/v1/${e.id}?music_info=1&description=1&rel=0`,
            width: 340,
            height: null,
            ratio: "9 / 14",
          };
    case "instagram":
      return {
        src: `https://www.instagram.com/${e.variant}/${e.code}/embed/`,
        width: 340,
        height: 400,
        ratio: null,
      };
    case "x":
      return {
        src: `https://platform.twitter.com/embed/Tweet.html?id=${e.id}&dnt=true&lang=tr&theme=${dark ? "dark" : "light"}&embedId=kuytu-${e.id}`,
        width: 340,
        height: 360,
        ratio: null,
      };
    case "youtube":
      return {
        src: `https://www.youtube-nocookie.com/embed/${e.id}?autoplay=1&rel=0&playsinline=1${e.start ? `&start=${e.start}` : ""}`,
        width: e.short ? 340 : 440,
        height: null,
        ratio: e.short ? "9 / 14" : "16 / 9",
      };
    case "spotify":
      return {
        src: `https://open.spotify.com/embed/${e.type}/${e.id}`,
        width: 340,
        height: e.type === "track" || e.type === "episode" ? 152 : 260,
        ratio: null,
      };
  }
}

export type TextPart = { link: boolean; value: string };

export function splitText(text: string): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const start = m.index ?? 0;
    const url = m[0].replace(/[.,;:!?)\]}’”]+$/, "");
    if (url.length < 10) continue;
    if (start > last) out.push({ link: false, value: text.slice(last, start) });
    out.push({ link: true, value: url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ link: false, value: text.slice(last) });
  return out;
}

/** One-line summary for the conversation list and notifications. */
export function previewOf(p: Payload): string {
  if (p.t === "react") return p.emoji ? `${p.emoji} ifadeyle yanıtladı` : "İfade kaldırıldı";
  if (p.t === "image") return "Fotoğraf";
  if (p.t === "gif") return "GIF";
  const body = p.body.trim();
  if (/^https?:\/\/\S+$/i.test(body)) {
    const e = parseEmbed(body);
    if (e) return PREVIEW_LABEL[e.kind];
  }
  return body.replace(/\s+/g, " ").slice(0, 140);
}

const SAFE_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "🙏", ""]);

function normalizeReply(r: unknown): ReplyRef | undefined {
  if (!r || typeof r !== "object") return undefined;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.senderId !== "string" || typeof o.text !== "string") return undefined;
  if (!/^[0-9a-f-]{36}$/i.test(o.id) || !/^[0-9a-f-]{36}$/i.test(o.senderId)) return undefined;
  const text = o.text.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!text) return undefined;
  return { id: o.id, senderId: o.senderId, text };
}

/**
 * Decrypted content comes from the other person's device, so it is treated
 * as untrusted: shapes are checked and media must point at a known host.
 */
export function normalizePayload(x: unknown): Payload | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const dim = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 20000 ? Math.round(v) : fallback;
  const reply = normalizeReply(o.reply);
  const forwarded = o.forwarded === true ? true : undefined;

  if (o.t === "react" && typeof o.targetId === "string" && typeof o.emoji === "string") {
    if (!/^[0-9a-f-]{36}$/i.test(o.targetId)) return null;
    const emoji = o.emoji.trim();
    if (!ALLOWED_REACTIONS.has(emoji)) return null;
    return { t: "react", targetId: o.targetId, emoji };
  }

  if (o.t === "text" && typeof o.body === "string") {
    return {
      t: "text",
      body: o.body.slice(0, 8000),
      ...(reply ? { reply } : {}),
      ...(forwarded ? { forwarded } : {}),
    };
  }

  if (o.t === "gif" && typeof o.url === "string") {
    return isGiphyUrl(o.url)
      ? {
          t: "gif",
          url: o.url,
          w: dim(o.w, 240),
          h: dim(o.h, 180),
          ...(reply ? { reply } : {}),
          ...(forwarded ? { forwarded } : {}),
        }
      : {
          t: "text",
          body: o.url.slice(0, 2000),
          ...(reply ? { reply } : {}),
          ...(forwarded ? { forwarded } : {}),
        };
  }

  if (o.t === "image" && typeof o.url === "string") {
    const enc = o.enc && typeof o.enc === "object" ? (o.enc as Record<string, unknown>) : null;
    const w = dim(o.w, 800);
    const h = dim(o.h, 600);
    if (enc && typeof enc.k === "string" && typeof enc.iv === "string" && isVaultUrl(o.url)) {
      const mime = typeof enc.mime === "string" && SAFE_MIME.includes(enc.mime) ? enc.mime : "image/jpeg";
      return {
        t: "image",
        url: o.url,
        w,
        h,
        enc: { k: enc.k, iv: enc.iv, mime },
        ...(reply ? { reply } : {}),
        ...(forwarded ? { forwarded } : {}),
      };
    }
    if (!enc && isImgurUrl(o.url)) {
      return {
        t: "image",
        url: o.url,
        w,
        h,
        ...(reply ? { reply } : {}),
        ...(forwarded ? { forwarded } : {}),
      };
    }
    return {
      t: "text",
      body: o.url.slice(0, 2000),
      ...(reply ? { reply } : {}),
      ...(forwarded ? { forwarded } : {}),
    };
  }
  return null;
}
