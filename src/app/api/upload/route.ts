import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaBlobs } from "@/db/schema";
import { isImgurUrl, isVaultUrl } from "@/lib/embeds";
import { UNAUTHORIZED, atRestSeal, fail, getAuth, json, limited, searchParams } from "@/lib/server/core";

const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 45_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// These hosts drop connections that arrive with Node's default User-Agent.
const UA = "Mozilla/5.0 (compatible; Kuytu/1.0)";

type Bytes = Uint8Array<ArrayBuffer>;

/* Free hosts that accept opaque files. The bytes they receive are already
   encrypted on the sender's device, so they store noise. Tried in order. */

async function toCatbox(bytes: Bytes): Promise<string | null> {
  const fd = new FormData();
  fd.append("reqtype", "fileupload");
  if (process.env.CATBOX_USERHASH) {
    fd.append("userhash", process.env.CATBOX_USERHASH);
  }
  fd.append("fileToUpload", new Blob([bytes], { type: "application/octet-stream" }), "k.bin");
  const res = await fetch("https://catbox.moe/user/api.php", {
    method: "POST",
    headers: { "User-Agent": UA },
    body: fd,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const url = (await res.text()).trim();
  return res.ok && isVaultUrl(url) ? url : null;
}

async function toLain(bytes: Bytes): Promise<string | null> {
  const fd = new FormData();
  fd.append("files[]", new Blob([bytes], { type: "application/octet-stream" }), "k.bin");
  const res = await fetch("https://pomf.lain.la/upload.php", {
    method: "POST",
    headers: { "User-Agent": UA },
    body: fd,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => null)) as { success?: boolean; files?: Array<{ url?: string }> } | null;
  const url = data?.success ? data.files?.[0]?.url : null;
  return typeof url === "string" && isVaultUrl(url) ? url : null;
}

async function toDatabaseVault(bytes: Bytes, userId: string): Promise<string | null> {
  const b64 = Buffer.from(bytes).toString("base64");
  const [inserted] = await db
    .insert(mediaBlobs)
    .values({
      ownerId: userId,
      ciphertext: "pending",
      size: bytes.byteLength,
    })
    .returning({ id: mediaBlobs.id });
  if (!inserted) return null;
  const sealed = atRestSeal(b64, `blob|${inserted.id}`);
  await db.update(mediaBlobs).set({ ciphertext: sealed }).where(eq(mediaBlobs.id, inserted.id));
  return `https://vault.kuytu.internal/${inserted.id}`;
}

async function toImgur(bytes: Bytes, type: string, clientId: string): Promise<string | null> {
  const fd = new FormData();
  fd.append("image", new Blob([bytes], { type }), "image");
  fd.append("type", "file");
  const res = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: { Authorization: `Client-ID ${clientId}`, "User-Agent": UA },
    body: fd,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => null)) as { data?: { link?: string } } | null;
  const link = data?.data?.link;
  return res.ok && typeof link === "string" && isImgurUrl(link) ? link : null;
}

/**
 * Relays an upload to an encrypted store. The file arrives already encrypted
 * with AES-256-GCM on the sender's device.
 */
export async function POST(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  if (limited(`upload:${auth.user.id}`, 30, 600_000)) {
    return fail(429, "Kısa sürede çok fazla görsel gönderdin. Biraz bekle.");
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(413, "Dosya çok büyük.");

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return fail(400, "Boş dosya.");
  if (bytes.length > MAX_BYTES) return fail(413, "Dosya çok büyük.");

  const wantsImgur = searchParams(req).get("host") === "imgur";

  if (wantsImgur) {
    const clientId = process.env.IMGUR_CLIENT_ID;
    if (!clientId) return fail(503, "Imgur bu sunucuda yapılandırılmamış.");
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!IMAGE_TYPES.has(type)) return fail(415, "Imgur yalnızca JPEG, PNG, GIF ve WebP kabul eder.");
    const url = await toImgur(bytes, type, clientId).catch(() => null);
    if (!url) return fail(502, "Imgur yüklemeyi kabul etmedi. Biraz sonra tekrar dene.");
    return json({ url, host: "imgur" });
  }

  const order = (process.env.UPLOAD_PROVIDERS ?? "catbox,pomf,db")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const name of order) {
    let url: string | null = null;
    if (name === "catbox") url = await toCatbox(bytes).catch(() => null);
    else if (name === "pomf") url = await toLain(bytes).catch(() => null);
    else if (name === "db") url = await toDatabaseVault(bytes, auth.user.id).catch(() => null);
    if (url) return json({ url, host: "vault" });
  }

  return fail(502, "Şifreli depoya şu an ulaşılamıyor. Biraz sonra tekrar dene.");
}
