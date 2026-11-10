import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, users } from "@/db/schema";
import {
  INVITE_RE,
  UNAUTHORIZED,
  USERNAME_RE,
  blockState,
  fail,
  getAuth,
  json,
  limited,
  readJson,
  summarize,
  type UserRow,
} from "@/lib/server/core";

// One answer for "no such user", "has requests turned off" and "blocked you",
// so usernames cannot be probed for their privacy settings.
const NOT_FOUND = "Kullanıcı bulunamadı ya da mesaj isteği kabul etmiyor.";
const LINK_DEAD = "Bu davet bağlantısı artık geçerli değil.";

/** Start a conversation: by username (message request) or invite link (opens directly). */
export async function POST(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const me = auth.user;
  if (limited(`newconv:${me.id}`, 30, 3_600_000)) {
    return fail(429, "Kısa sürede çok fazla istek gönderdin. Biraz bekle.");
  }
  const b = await readJson(req);

  let target: UserRow | undefined;
  let viaLink = false;

  if (typeof b.inviteCode === "string") {
    if (!INVITE_RE.test(b.inviteCode)) return fail(404, LINK_DEAD);
    viaLink = true;
    [target] = await db.select().from(users).where(eq(users.inviteCode, b.inviteCode)).limit(1);
    if (!target || target.whoCanRequest === "nobody") return fail(404, LINK_DEAD);
  } else if (typeof b.username === "string") {
    const name = b.username.trim().toLowerCase().replace(/^@/, "");
    if (!USERNAME_RE.test(name)) return fail(400, "Geçerli bir kullanıcı adı yaz.");
    [target] = await db.select().from(users).where(eq(users.username, name)).limit(1);
    if (!target) return fail(404, NOT_FOUND);
  } else {
    return fail(400, "Kullanıcı adı ya da davet kodu gerekli.");
  }

  if (target.id === me.id) {
    return fail(400, viaLink ? "Bu senin kendi davet bağlantın." : "Kendine mesaj isteği gönderemezsin.");
  }

  const bl = await blockState(me.id, target.id);
  if (bl.byB) return fail(404, viaLink ? LINK_DEAD : NOT_FOUND);
  if (bl.byA) return fail(409, "Bu kişiyi engelledin. Yazmak için önce ayarlardan engeli kaldır.");

  const [lowId, highId] = me.id < target.id ? [me.id, target.id] : [target.id, me.id];
  const pair = and(eq(conversations.lowId, lowId), eq(conversations.highId, highId));
  let [conv] = await db.select().from(conversations).where(pair).limit(1);

  if (conv) {
    // Answering someone's request, or arriving through their link, opens the chat.
    if (conv.status === "pending" && (conv.initiatorId !== me.id || viaLink)) {
      [conv] = await db
        .update(conversations)
        .set({ status: "accepted", rev: sql`${conversations.rev} + 1`, updatedAt: new Date() })
        .where(eq(conversations.id, conv.id))
        .returning();
    }
  } else {
    if (!viaLink && target.whoCanRequest !== "everyone") return fail(404, NOT_FOUND);
    const inserted = await db
      .insert(conversations)
      .values({ lowId, highId, initiatorId: me.id, status: viaLink ? "accepted" : "pending" })
      .onConflictDoNothing()
      .returning();
    conv = inserted[0] ?? (await db.select().from(conversations).where(pair).limit(1))[0];
  }

  if (!conv) return fail(500, "Sohbet açılamadı. Tekrar dene.");
  const [summary] = await summarize(me, [conv]);
  if (!summary) return fail(404, NOT_FOUND);
  return json({ conversation: summary });
}
