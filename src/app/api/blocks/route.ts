import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { blocks, users } from "@/db/schema";
import { UNAUTHORIZED, fail, getAuth, isUuid, json, readJson, searchParams } from "@/lib/server/core";

export async function GET(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const rows = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName, hue: users.hue })
    .from(blocks)
    .innerJoin(users, eq(users.id, blocks.blockedId))
    .where(eq(blocks.blockerId, auth.user.id));
  return json({ blocked: rows });
}

export async function POST(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const b = await readJson(req);
  if (!isUuid(b.userId) || b.userId === auth.user.id) return fail(400, "Geçersiz kullanıcı.");
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, b.userId)).limit(1);
  if (!target) return fail(404, "Kullanıcı bulunamadı.");
  await db.insert(blocks).values({ blockerId: auth.user.id, blockedId: target.id }).onConflictDoNothing();
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return UNAUTHORIZED();
  const userId = searchParams(req).get("userId");
  if (!isUuid(userId)) return fail(400, "Geçersiz kullanıcı.");
  await db.delete(blocks).where(and(eq(blocks.blockerId, auth.user.id), eq(blocks.blockedId, userId)));
  return json({ ok: true });
}
