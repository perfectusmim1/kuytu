import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  AUTH_KEY_RE,
  B64_RE,
  USERNAME_RE,
  atRestSeal,
  clientIp,
  createSession,
  fail,
  hashAuthKey,
  json,
  limited,
  publicMe,
  randomToken,
  readJson,
} from "@/lib/server/core";

const RESERVED = new Set(["admin", "kuytu", "destek", "support", "system", "sistem", "root", "moderator"]);

function validPublicKey(v: unknown): v is string {
  if (typeof v !== "string" || v.length !== 88 || !B64_RE.test(v)) return false;
  const raw = Buffer.from(v, "base64");
  return raw.length === 65 && raw[0] === 4; // uncompressed P-256 point
}

function validWrappedKey(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 800) return false;
  const [iv, ct, extra] = v.split(".");
  return !extra && !!iv && !!ct && iv.length === 16 && B64_RE.test(iv) && B64_RE.test(ct);
}

export async function POST(req: Request) {
  const b = await readJson(req);
  if (limited(`signup:${clientIp(req)}`, 10, 3_600_000)) {
    return fail(429, "Çok fazla hesap denemesi. Bir süre sonra tekrar dene.");
  }
  const username = typeof b.username === "string" ? b.username.trim().toLowerCase() : "";
  const displayName =
    (typeof b.displayName === "string" ? b.displayName.trim().replace(/\s+/g, " ").slice(0, 40) : "") || username;

  if (!USERNAME_RE.test(username)) {
    return fail(400, "Kullanıcı adı 3–20 karakter olmalı; yalnızca a–z, 0–9, nokta ve alt çizgi.");
  }
  if (RESERVED.has(username)) return fail(409, "Bu kullanıcı adı kullanılamıyor.");
  if (typeof b.authKey !== "string" || !AUTH_KEY_RE.test(b.authKey)) return fail(400, "Geçersiz kimlik bilgisi.");
  if (!validPublicKey(b.publicKey) || !validWrappedKey(b.encPrivateKey)) {
    return fail(400, "Şifreleme anahtarı oluşturulamadı. Sayfayı yenileyip tekrar dene.");
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (existing.length) return fail(409, "Bu kullanıcı adı alınmış.");

  const inserted = await db
    .insert(users)
    .values({
      username,
      displayName,
      authHash: await hashAuthKey(b.authKey),
      publicKey: b.publicKey,
      encPrivateKey: atRestSeal(b.encPrivateKey, `user-key|${username}`),
      inviteCode: randomToken(9),
      hue: Math.floor(Math.random() * 360),
    })
    .onConflictDoNothing({ target: users.username })
    .returning();

  const user = inserted[0];
  if (!user) return fail(409, "Bu kullanıcı adı alınmış.");

  const token = await createSession(user.id);
  return json({ token, user: publicMe(user) }, 201);
}
