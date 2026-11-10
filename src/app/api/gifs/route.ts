import { isGiphyUrl } from "@/lib/embeds";
import { UNAUTHORIZED, fail, getAuth, json, limited, searchParams } from "@/lib/server/core";
import type { GifResult } from "@/lib/types";

type Rendition = { url?: string; webp?: string; width?: string; height?: string };
type GiphyItem = { id?: string; title?: string; images?: Record<string, Rendition | undefined> };

const strip = (url: string) => url.split("?")[0];

/**
 * GIPHY search, proxied so the API key stays on the server and GIPHY never
 * sees who is searching.
 */
export async function GET(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const key = process.env.GIPHY_API_KEY;
  if (!key) return fail(503, "GIF araması bu sunucuda yapılandırılmamış.");
  if (limited(`gifs:${auth.user.id}`, 60, 60_000)) return fail(429, "Biraz yavaşla.");

  const q = (searchParams(req).get("q") ?? "").trim().slice(0, 50);
  const params = new URLSearchParams({ api_key: key, limit: "30", rating: "pg-13", bundle: "messaging_non_clips" });
  if (q) {
    params.set("q", q);
    params.set("lang", "tr");
  }

  let data: { data?: GiphyItem[] } | null = null;
  try {
    const res = await fetch(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return fail(502, res.status === 429 ? "GIPHY kotası doldu. Biraz sonra tekrar dene." : "GIPHY yanıt vermedi.");
    data = (await res.json()) as { data?: GiphyItem[] };
  } catch {
    return fail(502, "GIPHY yanıt vermedi.");
  }

  const gifs: GifResult[] = [];
  for (const g of data?.data ?? []) {
    const full = g.images?.downsized ?? g.images?.original;
    const small = g.images?.fixed_width ?? full;
    if (!g.id || !full?.url || !small?.url) continue;
    const url = strip(full.url);
    if (!isGiphyUrl(url)) continue;
    gifs.push({
      id: g.id,
      title: g.title || "GIF",
      url,
      w: Number(full.width) || 240,
      h: Number(full.height) || 180,
      preview: strip(small.webp ?? small.url),
    });
  }
  return json({ gifs });
}
