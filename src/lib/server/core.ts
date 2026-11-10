import { AsyncLocalStorage } from "node:async_hooks";
import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { blocks, conversations, messages, sessions, users } from "@/db/schema";
import type { ConvSummary, Features, Me, WhoCanRequest, WireMessage } from "@/lib/types";

export type UserRow = typeof users.$inferSelect;
export type ConvRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
export const AUTH_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
export const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
export const INVITE_RE = /^[A-Za-z0-9_-]{8,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/* ---------- server master key (at-rest AES-256-GCM & HMAC pepper) ---------- */

const globalKeys = globalThis as typeof globalThis & {
  __kuytuMasterSecret?: Buffer;
};

function getMasterSecret(): Buffer {
  if (!globalKeys.__kuytuMasterSecret) {
    const raw = process.env.AT_REST_KEY?.trim() || process.env.DATABASE_URL || "kuytu-fallback-secret";
    globalKeys.__kuytuMasterSecret = createHash("sha256").update("kuytu/v2/master|").update(raw).digest();
  }
  return globalKeys.__kuytuMasterSecret;
}

function deriveSubKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", getMasterSecret(), Buffer.alloc(32), Buffer.from(`kuytu/v2/${purpose}`), 32));
}

export function atRestSeal(plain: string, aad: string): string {
  const key = deriveSubKey("at-rest-aes-gcm");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`kuytu/v2/at-rest|${aad}`, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `ar1.${iv.toString("base64")}.${ct.toString("base64")}`;
}

export function atRestUnseal(sealed: string, aad: string): string {
  if (!sealed.startsWith("ar1.")) return sealed;
  const parts = sealed.split(".");
  if (parts.length !== 3) throw new Error("Invalid at-rest ciphertext");
  const key = deriveSubKey("at-rest-aes-gcm");
  const iv = Buffer.from(parts[1], "base64");
  const buf = Buffer.from(parts[2], "base64");
  if (iv.length !== 12 || buf.length < 16) throw new Error("Invalid at-rest ciphertext");
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(`kuytu/v2/at-rest|${aad}`, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/* ---------- ephemeral ECDH P-256 + AES-256-GCM wire encryption ---------- */

type WireContext = {
  wireKey: Buffer | null;
  pathname: string;
  method: string;
  query: URLSearchParams;
  wireInvalid: boolean;
};

const wireStorage = new AsyncLocalStorage<WireContext>();
const reqWireMap = new WeakMap<Request, WireContext>();
const seenWireNonces = new Map<string, number>();

const WIRE_TTL_MS = 12 * 3600_000;
const WIRE_SKEW_MS = 5 * 60_000;

function aesGcmEncrypt(key: Buffer, plain: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${iv.toString("base64")}.${ct.toString("base64")}`;
}

function aesGcmDecrypt(key: Buffer, frame: string, aad: string): string {
  const [ivB64, ctB64, extra] = frame.split(".");
  if (extra || !ivB64 || !ctB64 || !B64_RE.test(ivB64) || !B64_RE.test(ctB64)) {
    throw new Error("Invalid wire frame");
  }
  const iv = Buffer.from(ivB64, "base64");
  const buf = Buffer.from(ctB64, "base64");
  if (iv.length !== 12 || buf.length < 16) throw new Error("Invalid wire frame");
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function checkReplayNonce(nonce: string, ts: number): boolean {
  const now = Date.now();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > WIRE_SKEW_MS) return false;
  if ( typeof nonce !== "string" || nonce.length < 8 || nonce.length > 64) return false;
  if (seenWireNonces.size > 15_000) {
    for (const [k, exp] of seenWireNonces) if (exp < now) seenWireNonces.delete(k);
  }
  const existing = seenWireNonces.get(nonce);
  if (existing && existing > now) return false;
  seenWireNonces.set(nonce, now + WIRE_SKEW_MS + 10_000);
  return true;
}

export function createWireHandshake(clientPubB64: string): { hid: string; pub: string; salt: string } | null {
  if (typeof clientPubB64 !== "string" || clientPubB64.length !== 88 || !B64_RE.test(clientPubB64)) return null;
  const clientPub = Buffer.from(clientPubB64, "base64");
  if (clientPub.length !== 65 || clientPub[0] !== 4) return null;

  try {
    const ecdh = createECDH("prime256v1");
    const serverPub = ecdh.generateKeys();
    const shared = ecdh.computeSecret(clientPub);
    const salt = randomBytes(32);
    const wireKey = Buffer.from(hkdfSync("sha256", shared, salt, Buffer.from("kuytu/v2/wire"), 32));
    shared.fill(0);

    const hid = atRestSeal(
      JSON.stringify({ k: wireKey.toString("base64"), exp: Date.now() + WIRE_TTL_MS }),
      "wire-hid",
    );
    wireKey.fill(0);

    return {
      hid,
      pub: serverPub.toString("base64"),
      salt: salt.toString("base64"),
    };
  } catch {
    return null;
  }
}

function resolveWireContext(req: Request): WireContext {
  const cached = reqWireMap.get(req);
  if (cached) {
    wireStorage.enterWith(cached);
    return cached;
  }

  const u = new URL(req.url);
  const pathname = u.pathname;
  const method = req.method.toUpperCase();
  const hid = req.headers.get("x-kuytu-wire");

  const ctx: WireContext = {
    wireKey: null,
    pathname,
    method,
    query: u.searchParams,
    wireInvalid: false,
  };

  if (!hid) {
    ctx.wireInvalid = true;
  } else {
    try {
      const raw = JSON.parse(atRestUnseal(hid, "wire-hid")) as { k?: string; exp?: number };
      if (!raw.k || typeof raw.exp !== "number" || raw.exp < Date.now()) {
        ctx.wireInvalid = true;
      } else {
        const key = Buffer.from(raw.k, "base64");
        if (key.length === 32) {
          ctx.wireKey = key;
          const encQuery = req.headers.get("x-kuytu-query");
          if (encQuery) {
            const qPlain = aesGcmDecrypt(key, encQuery, `kuytu/v2/query|${method}|${pathname}`);
            const qObj = JSON.parse(qPlain) as { q?: string; ts?: number; n?: string };
            if (typeof qObj.q === "string" && typeof qObj.ts === "number" && typeof qObj.n === "string") {
              if (!checkReplayNonce(`q:${qObj.n}`, qObj.ts)) {
                ctx.wireInvalid = true;
              } else {
                ctx.query = new URLSearchParams(qObj.q);
              }
            } else {
              ctx.wireInvalid = true;
            }
          }
        } else {
          ctx.wireInvalid = true;
        }
      }
    } catch {
      ctx.wireInvalid = true;
    }
  }

  reqWireMap.set(req, ctx);
  wireStorage.enterWith(ctx);
  return ctx;
}

export function searchParams(req: Request): URLSearchParams {
  return resolveWireContext(req).query;
}

/** Verifies same-origin for state-changing requests (CSRF protection). */
function verifySameOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return false;
  }
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const reqHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
      if (originHost && reqHost && originHost !== reqHost) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/* ---------- responses ---------- */

export const json = (data: unknown, status = 200) => {
  const ctx = wireStorage.getStore();
  if (ctx?.wireKey && !ctx.wireInvalid) {
    const payload = JSON.stringify(data);
    const frame = aesGcmEncrypt(ctx.wireKey, payload, `kuytu/v2/res|${status}|${ctx.pathname}`);
    return Response.json(
      { _w: frame },
      { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "X-Content-Type-Options": "nosniff" } },
    );
  }
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "X-Content-Type-Options": "nosniff" },
  });
};

export const fail = (status: number, error: string) => {
  const ctx = wireStorage.getStore();
  if (ctx?.wireInvalid) {
    return Response.json(
      { error: "Güvenli kanal yenileniyor.", wireReset: true },
      { status: 412, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
  }
  return json({ error }, status);
};

export const UNAUTHORIZED = () => fail(401, "Oturumun sona erdi. Yeniden giriş yap.");

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const ctx = resolveWireContext(req);
  if (!verifySameOrigin(req)) {
    await req.text().catch(() => "");
    return {};
  }
  if (ctx.wireInvalid || !ctx.wireKey) {
    await req.text().catch(() => "");
    ctx.wireInvalid = true;
    return {};
  }
  try {
    const v: unknown = await req.json();
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      ctx.wireInvalid = true;
      return {};
    }
    const obj = v as Record<string, unknown>;
    if (typeof obj._w !== "string") {
      ctx.wireInvalid = true;
      return {};
    }
    const decrypted = aesGcmDecrypt(ctx.wireKey, obj._w, `kuytu/v2/req|${ctx.method}|${ctx.pathname}`);
    const env = JSON.parse(decrypted) as { b?: unknown; ts?: number; n?: string };
    if (typeof env.ts !== "number" || typeof env.n !== "string" || !checkReplayNonce(`b:${env.n}`, env.ts)) {
      ctx.wireInvalid = true;
      return {};
    }
    return env.b && typeof env.b === "object" && !Array.isArray(env.b) ? (env.b as Record<string, unknown>) : {};
  } catch {
    ctx.wireInvalid = true;
    return {};
  }
}

/* ---------- secrets & password authHash ---------- */

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

function pepperAuthKey(authKey: string): Buffer {
  return createHmac("sha256", deriveSubKey("auth-pepper")).update(authKey).digest();
}

function scryptAsync(secret: string | Buffer, salt: Buffer, N = 32768): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashAuthKey(authKey: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pepperAuthKey(authKey), salt, 32768);
  return atRestSeal(`s2.${salt.toString("base64")}.${key.toString("base64")}`, "auth-hash");
}

const DUMMY_SALT = randomBytes(16);

/** Constant-shape verification: unknown users still cost one full scrypt run. */
export async function verifyAuthKey(authKey: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    await scryptAsync(pepperAuthKey(authKey), DUMMY_SALT, 32768);
    return false;
  }
  let unsealed = stored;
  try {
    unsealed = atRestUnseal(stored, "auth-hash");
  } catch {
    await scryptAsync(pepperAuthKey(authKey), DUMMY_SALT, 32768);
    return false;
  }
  const parts = unsealed.split(".");
  if (parts.length !== 3 || (parts[0] !== "s2" && parts[0] !== "s1")) {
    await scryptAsync(pepperAuthKey(authKey), DUMMY_SALT, 32768);
    return false;
  }
  const expected = Buffer.from(parts[2], "base64");
  const salt = Buffer.from(parts[1], "base64");
  const actual =
    parts[0] === "s2"
      ? await scryptAsync(pepperAuthKey(authKey), salt, 32768)
      : await scryptAsync(authKey, salt, 16384);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* ---------- sessions (HttpOnly SameSite=Strict cookie + Bearer token) ---------- */

const SESSION_DAYS = 60;
const SESSION_COOKIE = "kuytu_sid";

function hashSessionToken(token: string): string {
  return createHmac("sha256", deriveSubKey("session-token")).update(token).digest("hex");
}

async function isHttps(): Promise<boolean> {
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto");
    return proto ? proto.split(",")[0].trim() === "https" : process.env.NODE_ENV === "production";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt,
  });
  try {
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: await isHttps(),
      path: "/",
      expires: expiresAt,
    });
  } catch {
    /* non-request context fallback */
  }
  return token;
}

export async function clearSessionCookie(): Promise<void> {
  try {
    const jar = await cookies();
    jar.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      secure: await isHttps(),
      path: "/",
      maxAge: 0,
    });
  } catch {
    /* ignore */
  }
}

export async function getAuth(req: Request): Promise<{ user: UserRow; sessionId: string } | null> {
  const ctx = resolveWireContext(req);
  if (!verifySameOrigin(req)) return null;
  if (ctx.wireInvalid) return null;

  let rawToken: string | null = null;
  const m = /^Bearer ([A-Za-z0-9_-]{30,80})$/.exec(req.headers.get("authorization") ?? "");
  if (m) {
    rawToken = m[1];
  } else {
    try {
      const jar = await cookies();
      const c = jar.get(SESSION_COOKIE)?.value;
      if (c && /^[A-Za-z0-9_-]{30,80}$/.test(c)) rawToken = c;
    } catch {
      /* ignore */
    }
  }
  if (!rawToken) return null;

  const hmacHash = hashSessionToken(rawToken);
  const legacyHash = sha256(rawToken);

  const rows = await db
    .select({ user: users, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        or(eq(sessions.tokenHash, hmacHash), eq(sessions.tokenHash, legacyHash)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Transparently unseal the user's at-rest encrypted private key bundle.
  try {
    row.user = {
      ...row.user,
      encPrivateKey: atRestUnseal(row.user.encPrivateKey, `user-key|${row.user.username}`),
    };
  } catch {
    return null;
  }

  return row;
}

/* ---------- rate limiting (per process, in memory) ---------- */

const buckets = new Map<string, { n: number; reset: number }>();

export function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  b.n += 1;
  return b.n > max;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/* ---------- SSRF & safe upstream stream helpers ---------- */

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  const l = ip.toLowerCase();
  if (l === "::1" || l === "::") return true;
  if (l.startsWith("::ffff:")) return isPrivateIpv4(l.slice(7));
  return l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("ff");
}

export async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== "https:") throw new Error("HTTPS required");
  if (u.port && u.port !== "443") throw new Error("Port not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Host not allowed");
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error("Private IP blocked");
  }
}

export async function readStreamBounded(res: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    const merged = Buffer.concat(chunks);
    const out = new Uint8Array(merged.byteLength);
    out.set(merged);
    return out;
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }
}

/* ---------- shaping ---------- */

export const publicMe = (u: UserRow): Me => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  hue: u.hue,
  publicKey: u.publicKey,
  inviteCode: u.inviteCode,
  whoCanRequest: u.whoCanRequest as WhoCanRequest,
  readReceipts: u.readReceipts,
  showPresence: u.showPresence,
});

export const features = (): Features => ({
  gifs: Boolean(process.env.GIPHY_API_KEY),
  imgur: Boolean(process.env.IMGUR_CLIENT_ID),
});

export const toWire = (m: MessageRow): WireMessage => {
  let iv = m.iv;
  let ciphertext = m.ciphertext;
  if (m.deletedAt === null && iv && ciphertext) {
    try {
      iv = atRestUnseal(iv, `msg-iv|${m.conversationId}|${m.senderId}|${m.id}`);
      ciphertext = atRestUnseal(ciphertext, `msg-ct|${m.conversationId}|${m.senderId}|${m.id}`);
    } catch {
      iv = null;
      ciphertext = null;
    }
  }
  return {
    id: m.id,
    seq: m.seq,
    senderId: m.senderId,
    iv,
    ciphertext,
    deleted: m.deletedAt !== null,
    createdAt: m.createdAt.toISOString(),
  };
};

/* ---------- conversations ---------- */

export const peerIdOf = (c: ConvRow, userId: string) => (c.lowId === userId ? c.highId : c.lowId);

export async function findConversation(id: string, userId: string): Promise<ConvRow | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), or(eq(conversations.lowId, userId), eq(conversations.highId, userId))))
    .limit(1);
  return rows[0] ?? null;
}

/** byA: a blocked b. byB: b blocked a. */
export async function blockState(a: string, b: string): Promise<{ byA: boolean; byB: boolean }> {
  const rows = await db
    .select()
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    );
  return { byA: rows.some((r) => r.blockerId === a), byB: rows.some((r) => r.blockerId === b) };
}

const ONLINE_WINDOW_MS = 15_000;
const TYPING_WINDOW_MS = 5_000;

/**
 * Builds what a user is allowed to see about their conversations. Privacy
 * settings are enforced here, on the server, and are reciprocal: hide your
 * own read receipts or presence and you stop seeing other people's too.
 */
export async function summarize(me: UserRow, rows: ConvRow[]): Promise<ConvSummary[]> {
  if (!rows.length) return [];
  const convIds = rows.map((r) => r.id);
  const peerIds = rows.map((r) => peerIdOf(r, me.id));

  const [peers, blockRows, lastRows, unreadRows] = await Promise.all([
    db.select().from(users).where(inArray(users.id, peerIds)),
    db
      .select()
      .from(blocks)
      .where(or(eq(blocks.blockerId, me.id), eq(blocks.blockedId, me.id))),
    db
      .selectDistinctOn([messages.conversationId])
      .from(messages)
      .where(inArray(messages.conversationId, convIds))
      .orderBy(messages.conversationId, desc(messages.seq)),
    db
      .select({ id: messages.conversationId, n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          inArray(messages.conversationId, convIds),
          ne(messages.senderId, me.id),
          isNull(messages.deletedAt),
          sql`${messages.seq} > (case when ${conversations.lowId} = ${me.id} then ${conversations.lowReadSeq} else ${conversations.highReadSeq} end)`,
        ),
      )
      .groupBy(messages.conversationId),
  ]);

  const peerMap = new Map(peers.map((p) => [p.id, p]));
  const lastMap = new Map(lastRows.map((m) => [m.conversationId, m]));
  const unreadMap = new Map(unreadRows.map((r) => [r.id, r.n]));
  const blockedByMe = new Set(blockRows.filter((b) => b.blockerId === me.id).map((b) => b.blockedId));
  const blockedMe = new Set(blockRows.filter((b) => b.blockedId === me.id).map((b) => b.blockerId));
  const now = Date.now();

  const out: ConvSummary[] = [];
  for (const c of rows) {
    const peer = peerMap.get(peerIdOf(c, me.id));
    if (!peer) continue;
    if (blockedByMe.has(peer.id)) continue;
    // An empty request is invisible to the recipient until a first message exists.
    if (c.status === "pending" && c.initiatorId !== me.id && c.messageCount === 0) continue;

    const iAmLow = c.lowId === me.id;
    const open = c.status === "accepted" && !blockedMe.has(peer.id);
    const presence = open && me.showPresence && peer.showPresence;
    const receipts = open && me.readReceipts && peer.readReceipts;
    const online = presence ? now - peer.lastSeenAt.getTime() < ONLINE_WINDOW_MS : null;
    const typingAt = iAmLow ? c.highTypingAt : c.lowTypingAt;
    const last = lastMap.get(c.id);

    out.push({
      id: c.id,
      status: c.status === "accepted" ? "accepted" : "pending",
      initiatorId: c.initiatorId,
      rev: c.rev,
      updatedAt: c.updatedAt.toISOString(),
      peer: {
        id: peer.id,
        username: peer.username,
        displayName: peer.displayName,
        hue: peer.hue,
        publicKey: peer.publicKey,
        online,
        lastSeenAt: presence && !online ? peer.lastSeenAt.toISOString() : null,
      },
      unread: unreadMap.get(c.id) ?? 0,
      last: last ? toWire(last) : null,
      peerReadSeq: receipts ? (iAmLow ? c.highReadSeq : c.lowReadSeq) : null,
      peerTyping: Boolean(presence && typingAt && now - typingAt.getTime() < TYPING_WINDOW_MS),
    });
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}
