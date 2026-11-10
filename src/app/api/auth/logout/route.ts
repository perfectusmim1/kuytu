import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { clearSessionCookie, getAuth, json, readJson } from "@/lib/server/core";

export async function POST(req: Request) {
  const auth = await getAuth(req);
  if (auth) {
    const b = await readJson(req);
    if (b.all === true) await db.delete(sessions).where(eq(sessions.userId, auth.user.id));
    else await db.delete(sessions).where(eq(sessions.id, auth.sessionId));
  }
  await clearSessionCookie();
  return json({ ok: true });
}
