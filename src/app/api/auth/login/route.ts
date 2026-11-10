import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  USERNAME_RE,
  atRestUnseal,
  clientIp,
  createSession,
  fail,
  json,
  limited,
  publicMe,
  readJson,
  verifyAuthKey,
} from "@/lib/server/core";

export async function POST(req: Request) {
  const b = await readJson(req);
  const username = typeof b.username === "string" ? b.username.trim().toLowerCase() : "";
  const authKey = typeof b.authKey === "string" ? b.authKey.slice(0, 64) : "";
  const ip = clientIp(req);

  if (limited(`login:${ip}:${username}`, 10, 600_000) || limited(`login-ip:${ip}`, 80, 600_000)) {
    return fail(429, "Çok fazla deneme yaptın. 10 dakika sonra tekrar dene.");
  }

  const rows = USERNAME_RE.test(username)
    ? await db.select().from(users).where(eq(users.username, username)).limit(1)
    : [];
  const user = rows[0];
  const ok = await verifyAuthKey(authKey, user?.authHash ?? null);
  // Same answer whether the account exists or not.
  if (!user || !ok) return fail(401, "Kullanıcı adı veya şifre hatalı.");

  let encPrivateKey: string;
  try {
    encPrivateKey = atRestUnseal(user.encPrivateKey, `user-key|${user.username}`);
  } catch {
    return fail(500, "Anahtar paketi doğrulanamadı.");
  }

  const token = await createSession(user.id);
  return json({ token, user: publicMe(user), encPrivateKey });
}
