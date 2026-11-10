import { UNAUTHORIZED, assertPublicUrl, fail, getAuth, json, limited, searchParams } from "@/lib/server/core";

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const WHATSAPP_UA = "WhatsApp/2.24.10.85 A";

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

const resolveCache = new Map<string, { at: number; data: ResolvedSocial }>();

const ALLOWED_VIDEO_HOSTS = [
  /\.cdninstagram\.com$/i,
  /\.fbcdn\.net$/i,
  /\.tiktokcdn\.com$/i,
  /\.tiktokcdn-us\.com$/i,
  /\.tiktokcdn-eu\.com$/i,
  /\.tiktokv\.com$/i,
  /^(www\.)?tikwm\.com$/i,
  /^video\.twimg\.com$/i,
  /^pbs\.twimg\.com$/i,
];

function isAllowedVideoHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALLOWED_VIDEO_HOSTS.some((re) => re.test(h));
}

function refererForVideoHost(hostname: string): string {
  const h = hostname.toLowerCase();
  if (h.includes("tiktok") || h.includes("tikwm")) return "https://www.tiktok.com/";
  if (h.includes("instagram") || h.includes("fbcdn")) return "https://www.instagram.com/";
  if (h.includes("twimg")) return "https://x.com/";
  return "";
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function decodeJsonEscaped(raw: string): string {
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
  }
}

function extractMeta(html: string, keys: string[]): string | null {
  for (const k of keys) {
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']+)["']`, "i");
    const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${k}["']`, "i");
    const m = html.match(a) ?? html.match(b);
    if (m?.[1]) return decodeHtmlEntities(m[1]).trim();
  }
  return null;
}

async function fetchThumbDataUrl(rawUrl: string | null | undefined): Promise<string | null> {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return null;
    if (u.hostname.toLowerCase() === "pbs.twimg.com" && u.pathname.startsWith("/media/") && !u.searchParams.has("name")) {
      u.searchParams.set("name", "medium");
    }
    await assertPublicUrl(u);
    const ref = refererForVideoHost(u.hostname);
    const res = await fetch(u, {
      headers: {
        "User-Agent": MOBILE_UA,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...(ref ? { Referer: ref } : {}),
      },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim().toLowerCase();
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 5_000_000) return null;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function resolveInstagram(u: URL): Promise<ResolvedSocial | null> {
  const m = u.pathname.match(/\/(p|reel|reels|tv)\/([\w-]{5,40})/);
  if (!m) return null;
  const code = m[2];
  const cleanUrl = new URL(`https://www.instagram.com/reel/${code}/`);
  await assertPublicUrl(cleanUrl);

  let html = "";
  try {
    const res = await fetch(cleanUrl, {
      headers: {
        "User-Agent": GOOGLEBOT_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(7_000),
    });
    html = await res.text();
  } catch {
    /* fallback below */
  }

  let videoUrl: string | null = null;
  const videoMatch = html.match(/"video_versions":\[\{"[^}]*"url":"([^"]+)"/);
  if (videoMatch?.[1]) {
    const candidate = decodeHtmlEntities(decodeJsonEscaped(videoMatch[1]));
    try {
      const vu = new URL(candidate);
      if (vu.protocol === "https:" && isAllowedVideoHost(vu.hostname)) videoUrl = vu.toString();
    } catch {
      videoUrl = null;
    }
  }

  if (!html.includes("og:title") || !html.includes("og:image")) {
    try {
      const waRes = await fetch(cleanUrl, {
        headers: { "User-Agent": WHATSAPP_UA },
        signal: AbortSignal.timeout(5_000),
      });
      const waHtml = await waRes.text();
      if (waHtml.includes("og:")) html = waHtml + "\n" + html;
    } catch {
      /* ignore */
    }
  }

  let thumbUrl = extractMeta(html, ["og:image", "twitter:image"]);
  if (!thumbUrl) {
    const imgMatch = html.match(/"image_versions2":\{"candidates":\[\{"url":"([^"]+)"/);
    if (imgMatch?.[1]) thumbUrl = decodeHtmlEntities(decodeJsonEscaped(imgMatch[1]));
  }

  const ogTitle = extractMeta(html, ["og:title", "twitter:title"]);
  const ogDesc = extractMeta(html, ["og:description", "description"]);
  const ogUrl = extractMeta(html, ["og:url"]);
  const durRaw = extractMeta(html, ["video:duration"]);
  const duration = durRaw && /^\d+$/.test(durRaw) ? Number(durRaw) : null;

  let handle: string | null = null;
  if (ogUrl) {
    const um = ogUrl.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/(?:p|reel|reels|tv)\//i);
    if (um?.[1] && !["p", "reel", "reels", "tv", "explore"].includes(um[1].toLowerCase())) {
      handle = `@${um[1]}`;
    }
  }

  let author: string | null = null;
  let description: string | null = null;

  if (ogTitle) {
    const tm = ogTitle.match(/^(.+?)\s+on Instagram(?:\s*:\s*["“]?([\s\S]*?)["”]?)?$/i);
    if (tm) {
      const displayName = tm[1].trim();
      author = handle && !displayName.includes(handle) ? `${displayName} (${handle})` : displayName;
      if (tm[2]?.trim()) description = tm[2].trim();
    } else {
      author = handle ?? ogTitle;
    }
  } else if (handle) {
    author = handle;
  }

  if (!description && ogDesc) {
    const cleaned = ogDesc
      .replace(/^.*?on Instagram:\s*["“「]?/i, "")
      .replace(/["”」]?\s*$/i, "")
      .trim();
    if (cleaned) description = cleaned;
  }

  const thumbDataUrl = await fetchThumbDataUrl(thumbUrl);

  return {
    id: code,
    photo: !videoUrl && m[1] === "p",
    title: author ?? "Instagram",
    author,
    description: description ? description.slice(0, 220) : null,
    siteName: "instagram.com",
    thumbDataUrl,
    videoUrl,
    duration,
    canonicalUrl: ogUrl ?? cleanUrl.toString(),
  };
}

async function resolveX(u: URL): Promise<ResolvedSocial | null> {
  const m = u.pathname.match(/^\/(?:(\w{1,20})|i\/web)\/status(?:es)?\/(\d{1,25})/);
  if (!m) return null;
  const handleHint = m[1] && m[1] !== "i" ? m[1] : "i";
  const id = m[2];

  try {
    const apiUrl = new URL(`https://api.fxtwitter.com/${handleHint}/status/${id}`);
    await assertPublicUrl(apiUrl);
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": "Kuytu/1.0" },
      signal: AbortSignal.timeout(6_000),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as {
        tweet?: {
          text?: string;
          author?: { name?: string; screen_name?: string };
          media?: {
            all?: Array<{
              type?: string;
              url?: string;
              thumbnail_url?: string;
              duration?: number;
            }>;
            photos?: Array<{
              type?: string;
              url?: string;
              thumbnail_url?: string;
              duration?: number;
            }>;
            videos?: Array<{
              type?: string;
              url?: string;
              thumbnail_url?: string;
              duration?: number;
            }>;
          };
        };
      } | null;
      const tweet = data?.tweet;
      if (tweet) {
        const name = tweet.author?.name?.trim();
        const screen = tweet.author?.screen_name?.trim();
        const title = name && screen ? `${name} (@${screen})` : name || (screen ? `@${screen}` : "X");
        const allMedia = [
          ...(tweet.media?.all ?? []),
          ...((tweet.media?.all?.length ? [] : tweet.media?.photos) ?? []),
          ...((tweet.media?.all?.length ? [] : tweet.media?.videos) ?? []),
        ];
        const firstVideo = allMedia.find((item) => item.type === "video" || item.type === "gif");
        const firstMedia = firstVideo ?? allMedia[0];
        let videoUrl: string | null = null;
        if (firstVideo?.url) {
          try {
            const vu = new URL(firstVideo.url);
            if (vu.protocol === "https:" && isAllowedVideoHost(vu.hostname)) videoUrl = vu.toString();
          } catch {
            videoUrl = null;
          }
        }

        const photoUrls = allMedia
          .filter((item) => (item.type === "photo" || (!item.type && item.url)) && item.url)
          .slice(0, 4)
          .map((item) => item.url as string);

        let imagesDataUrls: string[] | null = null;
        let thumbDataUrl: string | null = null;

        if (photoUrls.length > 1) {
          const resolvedImgs = (await Promise.all(photoUrls.map((pu) => fetchThumbDataUrl(pu)))).filter(
            (x): x is string => Boolean(x),
          );
          if (resolvedImgs.length) {
            imagesDataUrls = resolvedImgs;
            thumbDataUrl = resolvedImgs[0];
          }
        } else {
          const rawThumb =
            firstVideo?.thumbnail_url ??
            firstMedia?.thumbnail_url ??
            photoUrls[0] ??
            firstMedia?.url ??
            null;
          thumbDataUrl = await fetchThumbDataUrl(rawThumb);
        }

        return {
          id,
          photo: !videoUrl && (photoUrls.length > 0 || Boolean(thumbDataUrl)),
          title,
          author: screen ? `@${screen}` : null,
          description: tweet.text ? tweet.text.slice(0, 260) : null,
          siteName: "x.com",
          thumbDataUrl,
          imagesDataUrls,
          videoUrl,
          duration: typeof firstMedia?.duration === "number" ? Math.round(firstMedia.duration) : null,
          canonicalUrl: u.toString(),
        };
      }
    }
  } catch {
    /* fallback below */
  }

  return {
    id,
    title: handleHint !== "i" ? `@${handleHint}` : "X gönderisi",
    siteName: "x.com",
    canonicalUrl: u.toString(),
  };
}

const isTikTokHost = (h: string) => h === "tiktok.com" || h.endsWith(".tiktok.com");

function extractTikTok(u: URL): { id: string; photo: boolean } | null {
  const m = u.pathname.match(/\/(video|photo|v)\/(\d{8,25})/);
  return m ? { id: m[2], photo: m[1] === "photo" } : null;
}

async function resolveTikTokUrl(u: URL): Promise<ResolvedSocial | null> {
  let current = new URL(u.toString());
  const original = current.toString();
  let found = extractTikTok(current);

  if (!found) {
    try {
      for (let hop = 0; hop < 5; hop++) {
        await assertPublicUrl(current);
        const res = await fetch(current, {
          redirect: "manual",
          headers: { "User-Agent": MOBILE_UA },
          signal: AbortSignal.timeout(6_000),
        });
        const location = res.headers.get("location");
        if (!location) break;
        const next = new URL(location, current);
        if (next.protocol !== "https:" || !isTikTokHost(next.hostname)) break;
        found = extractTikTok(next);
        current = next;
        if (found) break;
      }
    } catch {
      /* continue */
    }
  }

  // Query tikwm for direct video stream, cover, author & caption
  try {
    const cleanTarget = found
      ? `https://www.tiktok.com/@i/video/${found.id}`
      : current.toString();
    const apiUrl = new URL(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanTarget)}`);
    await assertPublicUrl(apiUrl);
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": MOBILE_UA },
      signal: AbortSignal.timeout(6_000),
    });
    const payload = (await res.json().catch(() => null)) as {
      code?: number;
      data?: {
        id?: string;
        title?: string;
        play?: string;
        wmplay?: string;
        cover?: string;
        origin_cover?: string;
        duration?: number;
        images?: string[];
        author?: { unique_id?: string; nickname?: string };
      };
    } | null;
    const d = payload?.data;
    if (res.ok && payload?.code === 0 && d) {
      const id = d.id && /^\d{8,25}$/.test(d.id) ? d.id : (found?.id ?? null);
      const photo = Boolean(d.images && d.images.length > 0) || Boolean(found?.photo);
      const nick = d.author?.nickname?.trim();
      const handle = d.author?.unique_id?.trim();
      const title = nick && handle ? `${nick} (@${handle})` : nick || (handle ? `@${handle}` : "TikTok");
      let videoUrl: string | null = null;
      if (!photo) {
        const rawPlay = d.play || d.wmplay || (id ? `https://www.tikwm.com/video/media/play/${id}.mp4` : null);
        if (rawPlay) {
          try {
            const vu = new URL(rawPlay);
            if (vu.protocol === "https:" && isAllowedVideoHost(vu.hostname)) videoUrl = vu.toString();
          } catch {
            videoUrl = null;
          }
        }
      }

      let imagesDataUrls: string[] | null = null;
      if (photo && d.images && d.images.length > 1) {
        const imgs = (await Promise.all(d.images.slice(0, 4).map((iu) => fetchThumbDataUrl(iu)))).filter(
          (x): x is string => Boolean(x),
        );
        if (imgs.length) imagesDataUrls = imgs;
      }

      const thumbDataUrl =
        imagesDataUrls?.[0] ?? (await fetchThumbDataUrl(d.cover ?? d.origin_cover ?? d.images?.[0] ?? null));

      return {
        id,
        photo,
        title,
        author: handle ? `@${handle}` : null,
        description: d.title ? d.title.slice(0, 220) : null,
        siteName: "tiktok.com",
        thumbDataUrl,
        imagesDataUrls,
        videoUrl,
        duration: typeof d.duration === "number" ? Math.round(d.duration) : null,
        canonicalUrl: current.toString(),
      };
    }
  } catch {
    /* fallback to oEmbed */
  }

  try {
    const oembedUrl = new URL(`https://www.tiktok.com/oembed?url=${encodeURIComponent(original)}`);
    await assertPublicUrl(oembedUrl);
    const res = await fetch(oembedUrl, {
      headers: { "User-Agent": MOBILE_UA },
      signal: AbortSignal.timeout(6_000),
    });
    const data = (await res.json().catch(() => null)) as {
      embed_product_id?: string;
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    } | null;
    if (res.ok && data) {
      const id =
        data.embed_product_id && /^\d{8,25}$/.test(data.embed_product_id)
          ? data.embed_product_id
          : (found?.id ?? null);
      const thumbDataUrl = await fetchThumbDataUrl(data.thumbnail_url);
      return {
        id,
        photo: found?.photo ?? false,
        title: data.author_name ?? "TikTok",
        description: data.title ? data.title.slice(0, 220) : null,
        siteName: "tiktok.com",
        thumbDataUrl,
        videoUrl: id && !found?.photo ? `https://www.tikwm.com/video/media/play/${id}.mp4` : null,
        canonicalUrl: current.toString(),
      };
    }
  } catch {
    /* ignore */
  }

  return found
    ? {
        id: found.id,
        photo: found.photo,
        title: "TikTok",
        siteName: "tiktok.com",
        videoUrl: !found.photo ? `https://www.tikwm.com/video/media/play/${found.id}.mp4` : null,
        canonicalUrl: current.toString(),
      }
    : null;
}

async function resolveYouTube(u: URL): Promise<ResolvedSocial | null> {
  try {
    const oembedUrl = new URL(`https://www.youtube.com/oembed?url=${encodeURIComponent(u.toString())}&format=json`);
    await assertPublicUrl(oembedUrl);
    const res = await fetch(oembedUrl, {
      headers: { "User-Agent": MOBILE_UA },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    } | null;
    if (!data) return null;
    const thumbDataUrl = await fetchThumbDataUrl(data.thumbnail_url);
    return {
      title: data.title ? data.title.slice(0, 200) : (data.author_name ?? "YouTube"),
      author: data.author_name ?? null,
      description: data.author_name ?? null,
      siteName: "youtube.com",
      thumbDataUrl,
      canonicalUrl: u.toString(),
    };
  } catch {
    return null;
  }
}

async function resolveSpotify(u: URL): Promise<ResolvedSocial | null> {
  try {
    const oembedUrl = new URL(`https://open.spotify.com/oembed?url=${encodeURIComponent(u.toString())}`);
    await assertPublicUrl(oembedUrl);
    const res = await fetch(oembedUrl, {
      headers: { "User-Agent": MOBILE_UA },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      title?: string;
      thumbnail_url?: string;
    } | null;
    if (!data) return null;
    const thumbDataUrl = await fetchThumbDataUrl(data.thumbnail_url);
    return {
      title: data.title ?? "Spotify",
      description: "Spotify'da dinle",
      siteName: "open.spotify.com",
      thumbDataUrl,
      canonicalUrl: u.toString(),
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const sp = searchParams(req);
  const proxy = sp.get("proxy") === "1";

  if (proxy) {
    if (limited(`resolve-video:${auth.user.id}`, 60, 60_000)) return fail(429, "Biraz yavaşla.");
    let current: URL;
    try {
      current = new URL(sp.get("url") ?? "");
    } catch {
      return fail(400, "Geçersiz medya bağlantısı.");
    }
    if (current.protocol !== "https:" || !isAllowedVideoHost(current.hostname)) {
      return fail(403, "Bu medya kaynağına izin verilmiyor.");
    }
    try {
      let upstream: Response | null = null;
      for (let hop = 0; hop < 4; hop++) {
        await assertPublicUrl(current);
        const ref = refererForVideoHost(current.hostname);
        const res = await fetch(current, {
          redirect: "manual",
          headers: {
            "User-Agent": MOBILE_UA,
            Accept: "video/*,*/*;q=0.8",
            ...(ref ? { Referer: ref } : {}),
          },
          signal: AbortSignal.timeout(20_000),
        });
        const location = res.headers.get("location");
        if (location && res.status >= 300 && res.status < 400) {
          await res.body?.cancel().catch(() => {});
          const next = new URL(location, current);
          if (next.protocol !== "https:" || !isAllowedVideoHost(next.hostname)) {
            return fail(403, "Yönlendirilen medya kaynağına izin verilmiyor.");
          }
          current = next;
          continue;
        }
        upstream = res;
        break;
      }

      if (!upstream || !upstream.ok || !upstream.body) return fail(404, "Video akışı alınamadı.");
      const ct = upstream.headers.get("content-type") ?? "video/mp4";
      const cl = upstream.headers.get("content-length");
      const headers: Record<string, string> = {
        "Content-Type": ct.startsWith("video/") ? ct : "video/mp4",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      };
      if (cl && /^\d+$/.test(cl)) headers["Content-Length"] = cl;
      return new Response(upstream.body, { status: 200, headers });
    } catch {
      return fail(502, "Video indirilemedi.");
    }
  }

  if (limited(`resolve:${auth.user.id}`, 90, 60_000)) return fail(429, "Biraz yavaşla.");

  let target: URL;
  try {
    target = new URL(sp.get("url") ?? "");
  } catch {
    return fail(400, "Geçersiz bağlantı.");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return fail(400, "Geçersiz bağlantı.");
  }

  const cacheKey = `v3:${target.toString()}`;
  const cached = resolveCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30 * 60_000) {
    return json(cached.data);
  }

  const host = target.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  let result: ResolvedSocial | null = null;

  if (host === "instagram.com" || host === "instagr.am") {
    result = await resolveInstagram(target);
  } else if (host === "x.com" || host === "twitter.com") {
    result = await resolveX(target);
  } else if (isTikTokHost(host) || host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    result = await resolveTikTokUrl(target);
  } else if (host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
    result = await resolveYouTube(target);
  } else if (host === "open.spotify.com") {
    result = await resolveSpotify(target);
  }

  if (!result) return fail(404, "Bağlantı önizlemesi alınamadı.");

  resolveCache.set(cacheKey, { at: Date.now(), data: result });
  if (resolveCache.size > 500) {
    const oldest = resolveCache.keys().next().value;
    if (oldest) resolveCache.delete(oldest);
  }
  return json(result);
}
