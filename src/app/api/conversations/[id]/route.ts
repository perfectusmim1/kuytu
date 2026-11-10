import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { UNAUTHORIZED, fail, findConversation, getAuth, isUuid, json, readJson } from "@/lib/server/core";

type Ctx = { params: Promise<{ id: string }> };

const MISSING = "Sohbet bulunamadı.";

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const me = auth.user;
  const { id } = await ctx.params;
  if (!isUuid(id)) return fail(404, MISSING);
  const conv = await findConversation(id, me.id);
  if (!conv) return fail(404, MISSING);
  const b = await readJson(req);

  if (b.action === "typing") {
    // Respect the sender's own presence setting: nothing is recorded if it is off.
    if (conv.status === "accepted" && me.showPresence) {
      await db
        .update(conversations)
        .set(conv.lowId === me.id ? { lowTypingAt: new Date() } : { highTypingAt: new Date() })
        .where(eq(conversations.id, id));
    }
    return json({ ok: true });
  }

  if (b.action === "accept") {
    if (conv.status !== "pending" || conv.initiatorId === me.id) return fail(400, "Kabul edilecek bir istek yok.");
    await db
      .update(conversations)
      .set({ status: "accepted", rev: sql`${conversations.rev} + 1`, updatedAt: new Date() })
      .where(eq(conversations.id, id));
    return json({ ok: true });
  }

  return fail(400, "Bilinmeyen işlem.");
}

/** Removes the conversation and all of its messages for both people. */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const { id } = await ctx.params;
  if (!isUuid(id)) return fail(404, MISSING);
  const conv = await findConversation(id, auth.user.id);
  if (!conv) return fail(404, MISSING);
  await db.delete(conversations).where(eq(conversations.id, id));
  return json({ ok: true });
}
