import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (err: any) {
    const root = err?.cause?.message || err?.message || String(err);
    const code = err?.cause?.code || err?.code;
    console.error("Health check error:", root, code);
    return Response.json(
      { ok: false, error: root, code },
      { status: 500 }
    );
  }
}
