import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import {
  B64_RE,
  UNAUTHORIZED,
  atRestSeal,
  blockState,
  fail,
  findConversation,
  getAuth,
  isUuid,
  json,
  limited,
  peerIdOf,
  readJson,
  searchParams,
  toWire,
} from "@/lib/server/core";

type Ctx = { params: Promise<{ id: string }> };

const PAGE = 50;
const MAX_CIPHERTEXT = 16_000;
const REQUEST_LIMIT = 5;
const MISSING = "Sohbet bulunamadı.";

export async function GET(req: Request, ctx: Ctx) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const { id } = await ctx.params;
  if (!isUuid(id)) return fail(404, MISSING);
  const conv = await findConversation(id, auth.user.id);
  if (!conv) return fail(404, MISSING);

  const beforeRaw = Number(searchParams(req).get("before"));
  const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : null;

  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, id), before ? lt(messages.seq, before) : undefined))
    .orderBy(desc(messages.seq))
    .limit(PAGE + 1);

  return json({ messages: rows.slice(0, PAGE).reverse().map(toWire), hasMore: rows.length > PAGE });
}

/** Stores one encrypted message. The server only checks shape and seals it at rest. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const me = auth.user;
  const { id } = await ctx.params;
  if (!isUuid(id)) return fail(404, MISSING);

  const b = await readJson(req);
  if (
    !isUuid(b.id) ||
    typeof b.iv !== "string" ||
    !/^[A-Za-z0-9+/]{16}$/.test(b.iv) ||
    typeof b.ciphertext !== "string" ||
    b.ciphertext.length < 24 ||
    !B64_RE.test(b.ciphertext)
  ) {
    return fail(400, "Geçersiz mesaj.");
  }
  if (b.ciphertext.length > MAX_CIPHERTEXT) return fail(413, "Mesaj çok uzun.");
  const messageId = b.id.toLowerCase();

  const conv = await findConversation(id, me.id);
  if (!conv) return fail(404, MISSING);

  const bl = await blockState(me.id, peerIdOf(conv, me.id));
  if (bl.byA || bl.byB) return fail(403, "Bu sohbete mesaj gönderilemiyor.");

  if (conv.status === "pending") {
    if (conv.initiatorId !== me.id) return fail(403, "Yanıtlamak için önce isteği kabul et.");
    if (conv.messageCount >= REQUEST_LIMIT) {
      return fail(403, `İstek kabul edilene kadar en fazla ${REQUEST_LIMIT} mesaj gönderebilirsin.`);
    }
  }
  if (limited(`msg:${me.id}`, 40, 10_000)) return fail(429, "Çok hızlı gidiyorsun, bir saniye bekle.");

  const sealedIv = atRestSeal(b.iv, `msg-iv|${id}|${me.id}|${messageId}`);
  const sealedCt = atRestSeal(b.ciphertext, `msg-ct|${id}|${me.id}|${messageId}`);

  const inserted = await db
    .insert(messages)
    .values({ id: messageId, conversationId: id, senderId: me.id, iv: sealedIv, ciphertext: sealedCt })
    .onConflictDoNothing()
    .returning();

  let row = inserted[0];
  if (!row) {
    // A retry of a message that already arrived: return the stored copy.
    [row] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.senderId, me.id), eq(messages.conversationId, id)))
      .limit(1);
    if (!row) return fail(409, "Mesaj gönderilemedi. Tekrar dene.");
    return json({ message: toWire(row) });
  }

  const iAmLow = conv.lowId === me.id;
  const seq = row.seq;
  await db
    .update(conversations)
    .set({
      rev: sql`${conversations.rev} + 1`,
      messageCount: sql`${conversations.messageCount} + 1`,
      updatedAt: new Date(),
      ...(iAmLow
        ? { lowTypingAt: null, lowReadSeq: sql`greatest(${conversations.lowReadSeq}, ${seq}::bigint)` }
        : { highTypingAt: null, highReadSeq: sql`greatest(${conversations.highReadSeq}, ${seq}::bigint)` }),
    })
    .where(eq(conversations.id, id));

  return json({ message: toWire(row) }, 201);
}

/** "Delete for everyone" or burn-after-reading: erases the message from the server. */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const { id } = await ctx.params;
  const sp = searchParams(req);
  const messageId = sp.get("messageId");
  const burn = sp.get("burn") === "1";
  if (!isUuid(id) || !isUuid(messageId)) return fail(404, "Mesaj bulunamadı.");

  const conv = await findConversation(id, auth.user.id);
  if (!conv) return fail(404, MISSING);

  if (burn) {
    // Ephemeral / View-Once self-destruct: completely remove row from DB for both participants.
    await db
      .delete(messages)
      .where(and(eq(messages.id, messageId.toLowerCase()), eq(messages.conversationId, id)));
    await db
      .update(conversations)
      .set({ rev: sql`${conversations.rev} + 1` })
      .where(eq(conversations.id, id));
    return json({ ok: true });
  }

  const updated = await db
    .update(messages)
    .set({ deletedAt: new Date(), iv: null, ciphertext: null })
    .where(
      and(
        eq(messages.id, messageId.toLowerCase()),
        eq(messages.conversationId, id),
        eq(messages.senderId, auth.user.id),
        isNull(messages.deletedAt),
      ),
    )
    .returning({ id: messages.id });
  if (!updated.length) return fail(404, "Mesaj bulunamadı.");

  await db
    .update(conversations)
    .set({ rev: sql`${conversations.rev} + 1` })
    .where(eq(conversations.id, id));
  return json({ ok: true });
}
