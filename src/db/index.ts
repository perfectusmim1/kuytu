import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

const rawDatabaseUrl = process.env.DATABASE_URL;

if (!rawDatabaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

/**
 * Strict TLS verification against Supabase Root 2021 CA (MITM protection).
 * Custom CA path can be provided via DATABASE_CA_CERT; defaults to ./supabase-ca.crt.
 */
function sslConfig(url: string): PoolConfig["ssl"] {
  const wantsSsl = url.includes("supabase.co") || /[?&](sslmode=(require|verify-ca|verify-full)|ssl=true)/.test(url);
  if (!wantsSsl) return undefined;
  const caPath = process.env.DATABASE_CA_CERT || path.join(process.cwd(), "supabase-ca.crt");
  if (!fs.existsSync(caPath)) {
    throw new Error(`Database CA certificate not found: ${caPath}`);
  }
  return { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true };
}

const cleanUrl = rawDatabaseUrl.replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: cleanUrl,
    ssl: sslConfig(rawDatabaseUrl),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
