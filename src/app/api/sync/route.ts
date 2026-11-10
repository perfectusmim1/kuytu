import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, users } from "@/db/schema";
import { UNAUTHORIZED, features, getAuth, isUuid, json, publicMe, readJson, summarize } from "@/lib/server/core";

/**
 * The heartbeat. One call every couple of seconds: reports presence, marks
 * the open conversation as read, and returns the current conversation list.
 * Everything message-related in the response is ciphertext.
 */
export async function POST(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const me = auth.user;
  const b = await readJson(req);
  const writes: Promise<unknown>[] = [];

  if (b.visible === true) {
    writes.push(db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, me.id)));
  }

  const readSeq = typeof b.readSeq === "number" && Number.isSafeInteger(b.readSeq) ? b.readSeq : 0;
  if (isUuid(b.activeId) && readSeq > 0) {
    writes.push(
      db
        .update(conversations)
        .set({
          lowReadSeq: sql`case when ${conversations.lowId} = ${me.id} then greatest(${conversations.lowReadSeq}, ${readSeq}::bigint) else ${conversations.lowReadSeq} end`,
          highReadSeq: sql`case when ${conversations.highId} = ${me.id} then greatest(${conversations.highReadSeq}, ${readSeq}::bigint) else ${conversations.highReadSeq} end`,
        })
        .where(
          and(
            eq(conversations.id, b.activeId),
            or(eq(conversations.lowId, me.id), eq(conversations.highId, me.id)),
          ),
        ),
    );
  }
  await Promise.all(writes);

  const rows = await db
    .select()
    .from(conversations)
    .where(or(eq(conversations.lowId, me.id), eq(conversations.highId, me.id)));

  return json({ me: publicMe(me), features: features(), conversations: await summarize(me, rows) });
}
