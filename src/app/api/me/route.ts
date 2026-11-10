import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import {
  AUTH_KEY_RE,
  B64_RE,
  UNAUTHORIZED,
  atRestSeal,
  clearSessionCookie,
  fail,
  features,
  getAuth,
  hashAuthKey,
  json,
  limited,
  publicMe,
  randomToken,
  readJson,
  verifyAuthKey,
} from "@/lib/server/core";

export async function GET(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  // encPrivateKey is ciphertext; only the password holder can open it.
  return json({ me: publicMe(auth.user), features: features(), encPrivateKey: auth.user.encPrivateKey });
}

export async function PATCH(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const me = auth.user;
  const b = await readJson(req);
  const patch: Partial<typeof users.$inferInsert> = {};

  if (typeof b.displayName === "string") {
    const name = b.displayName.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return fail(400, "Görünen ad boş olamaz.");
    patch.displayName = name;
  }
  if (b.whoCanRequest === "everyone" || b.whoCanRequest === "link" || b.whoCanRequest === "nobody") {
    patch.whoCanRequest = b.whoCanRequest;
  }
  if (typeof b.readReceipts === "boolean") patch.readReceipts = b.readReceipts;
  if (typeof b.showPresence === "boolean") patch.showPresence = b.showPresence;
  if (typeof b.hue === "number" && Number.isFinite(b.hue)) patch.hue = Math.round(Math.abs(b.hue)) % 360;
  if (b.regenerateInvite === true) patch.inviteCode = randomToken(9);

  let passwordChanged = false;
  if (b.password && typeof b.password === "object") {
    const p = b.password as Record<string, unknown>;
    if (limited(`pw:${me.id}`, 8, 600_000)) return fail(429, "Çok fazla deneme. Biraz sonra tekrar dene.");
    if (
      typeof p.currentAuthKey !== "string" ||
      typeof p.newAuthKey !== "string" ||
      !AUTH_KEY_RE.test(p.newAuthKey) ||
      typeof p.encPrivateKey !== "string" ||
      p.encPrivateKey.length > 800 ||
      !/^[A-Za-z0-9+/=]{16}\.[A-Za-z0-9+/=]+$/.test(p.encPrivateKey) ||
      !B64_RE.test(p.encPrivateKey.split(".")[1])
    ) {
      return fail(400, "Geçersiz istek.");
    }
    if (!(await verifyAuthKey(p.currentAuthKey.slice(0, 64), me.authHash))) {
      return fail(403, "Mevcut şifre hatalı.");
    }
    patch.authHash = await hashAuthKey(p.newAuthKey);
    patch.encPrivateKey = atRestSeal(p.encPrivateKey, `user-key|${me.username}`);
    passwordChanged = true;
  }

  if (!Object.keys(patch).length) return json({ me: publicMe(me) });

  const [updated] = await db.update(users).set(patch).where(eq(users.id, me.id)).returning();
  if (passwordChanged) {
    // Every other device must sign in again with the new password.
    await db.delete(sessions).where(and(eq(sessions.userId, me.id), ne(sessions.id, auth.sessionId)));
  }
  return json({ me: publicMe(updated) });
}

export async function DELETE(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const b = await readJson(req);
  if (limited(`del:${auth.user.id}`, 8, 600_000)) return fail(429, "Çok fazla deneme. Biraz sonra tekrar dene.");
  const authKey = typeof b.authKey === "string" ? b.authKey.slice(0, 64) : "";
  if (!(await verifyAuthKey(authKey, auth.user.authHash))) return fail(403, "Şifre hatalı.");
  // Cascades to sessions, conversations, messages and blocks.
  await db.delete(users).where(eq(users.id, auth.user.id));
  await clearSessionCookie();
  return json({ ok: true });
}
