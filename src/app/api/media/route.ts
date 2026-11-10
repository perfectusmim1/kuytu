import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaBlobs } from "@/db/schema";
import { isVaultUrl } from "@/lib/embeds";
import {
  UNAUTHORIZED,
  assertPublicUrl,
  atRestUnseal,
  fail,
  getAuth,
  isUuid,
  limited,
  readStreamBounded,
  searchParams,
} from "@/lib/server/core";

const MAX_BYTES = 16 * 1024 * 1024;
const INTERNAL_PREFIX = "https://vault.kuytu.internal/";

const MEDIA_HEADERS = {
  "Content-Type": "application/octet-stream",
  "X-Content-Type-Options": "nosniff",
  "Content-Disposition": "attachment",
  "Cache-Control": "private, max-age=31536000, immutable",
};

/**
 * Relays encrypted media back to a signed-in user. Two reasons to relay
 * instead of letting the browser fetch directly: the file host never sees
 * who is downloading, and it works regardless of the host's CORS policy.
 * Only an allow-list of hosts can be fetched, so this is not an open proxy.
 */
export async function GET(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  if (limited(`media:${auth.user.id}`, 120, 60_000)) return fail(429, "Biraz yavaşla.");

  const target = searchParams(req).get("u") ?? "";
  if (!isVaultUrl(target)) return fail(400, "Geçersiz medya adresi.");

  if (target.startsWith(INTERNAL_PREFIX)) {
    const blobId = target.slice(INTERNAL_PREFIX.length);
    if (!isUuid(blobId)) return fail(404, "Medya alınamadı.");
    const [row] = await db.select().from(mediaBlobs).where(eq(mediaBlobs.id, blobId)).limit(1);
    if (!row) return fail(404, "Medya alınamadı.");
    try {
      const b64 = atRestUnseal(row.ciphertext, `blob|${row.id}`);
      const buf = Buffer.from(b64, "base64");
      const bytes = new Uint8Array(buf.byteLength);
      bytes.set(buf);
      return new Response(bytes, { headers: MEDIA_HEADERS });
    } catch {
      return fail(502, "Medya alınamadı.");
    }
  }

  let upstream: Response;
  try {
    const parsed = new URL(target);
    await assertPublicUrl(parsed);
    upstream = await fetch(parsed, {
      redirect: "manual",
      // The host drops connections that arrive with Node's default User-Agent.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Kuytu/1.0)" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return fail(502, "Medya alınamadı.");
  }
  if (!upstream.ok || !upstream.body) return fail(upstream.status === 404 ? 404 : 502, "Medya alınamadı.");
  if (Number(upstream.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(413, "Medya çok büyük.");

  const bounded = await readStreamBounded(upstream, MAX_BYTES);
  if (!bounded) return fail(413, "Medya çok büyük veya okunamadı.");

  return new Response(bounded, { headers: MEDIA_HEADERS });
}
