/**
 * Device-side encrypted vault (IndexedDB with non-extractable AES-256-GCM device key)
 * and Ephemeral ECDH P-256 + AES-256-GCM encrypted wire API client.
 */

import { fromB64, toB64 } from "./crypto";

export type Session = { token: string; userId: string; username: string; privateKey: CryptoKey };

const te = new TextEncoder();
const td = new TextDecoder();
const src = (v: ArrayBuffer | Uint8Array) => v as BufferSource;

const memory = new Map<string, unknown>();
const DEVICE_KEY_NAME = "__device_key__";

let dbInstancePromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbInstancePromise) {
    dbInstancePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("kuytu", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("kv")) {
          req.result.createObjectStore("kv");
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbInstancePromise = null;
        };
        db.onclose = () => {
          dbInstancePromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbInstancePromise = null;
        reject(req.error);
      };
    });
  }
  return dbInstancePromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("kv", mode);
    const req = fn(tx.objectStore("kv"));
    tx.oncomplete = () => {
      resolve(req.result);
    };
    const onFail = () => {
      reject(tx.error);
    };
    tx.onerror = onFail;
    tx.onabort = onFail;
  });
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T | undefined;
  try {
    const val = await run<T | undefined>("readonly", (s) => s.get(key));
    if (val !== undefined) memory.set(key, val);
    return val;
  } catch {
    return memory.get(key) as T | undefined;
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  try {
    await run("readwrite", (s) => s.put(value, key));
  } catch {
    /* storage unavailable (private mode, blocked iframe): keep in memory for this tab */
  }
}

let deviceKeyPromise: Promise<CryptoKey> | null = null;

/** Non-extractable device AES-256-GCM key used to seal all metadata and TOFU pins in IndexedDB. */
function getDeviceKey(): Promise<CryptoKey> {
  if (!deviceKeyPromise) {
    deviceKeyPromise = (async () => {
      const existing = await kvGet<CryptoKey>(DEVICE_KEY_NAME);
      if (existing && typeof existing === "object" && "type" in existing) return existing;
      const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      await kvSet(DEVICE_KEY_NAME, generated);
      return generated;
    })().catch((err) => {
      deviceKeyPromise = null;
      throw err;
    });
  }
  return deviceKeyPromise;
}

export async function sealLocal(slot: string, value: unknown): Promise<string> {
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = te.encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: src(iv), additionalData: src(te.encode(`kuytu/v2/idb|${slot}`)) },
    key,
    src(plain),
  );
  plain.fill(0);
  return `${toB64(iv)}.${toB64(ct)}`;
}

export async function unsealLocal<T>(slot: string, sealed: string): Promise<T | null> {
  try {
    const [ivB64, ctB64, extra] = sealed.split(".");
    if (extra || !ivB64 || !ctB64) return null;
    const key = await getDeviceKey();
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: src(fromB64(ivB64)), additionalData: src(te.encode(`kuytu/v2/idb|${slot}`)) },
      key,
      src(fromB64(ctB64)),
    );
    try {
      return JSON.parse(td.decode(pt)) as T;
    } finally {
      new Uint8Array(pt).fill(0);
    }
  } catch {
    return null;
  }
}

type StoredSessionRecord = {
  sealedMeta?: string;
  privateKey?: CryptoKey;
  // Legacy fallback fields
  token?: string;
  userId?: string;
  username?: string;
};

export async function loadSession(): Promise<Session | null> {
  const rec = await kvGet<StoredSessionRecord>("session");
  if (!rec?.privateKey) return null;
  if (typeof rec.sealedMeta === "string") {
    const meta = await unsealLocal<{ token: string; userId: string; username: string }>("session", rec.sealedMeta);
    if (!meta?.token || !meta.userId || !meta.username) return null;
    return { token: meta.token, userId: meta.userId, username: meta.username, privateKey: rec.privateKey };
  }
  if (rec.token && rec.userId && rec.username) {
    const s: Session = {
      token: rec.token,
      userId: rec.userId,
      username: rec.username,
      privateKey: rec.privateKey,
    };
    await saveSession(s);
    return s;
  }
  return null;
}

export async function saveSession(s: Session): Promise<void> {
  const sealedMeta = await sealLocal("session", { token: s.token, userId: s.userId, username: s.username });
  await kvSet("session", { sealedMeta, privateKey: s.privateKey });
}

export async function wipeVault(): Promise<void> {
  memory.clear();
  deviceKeyPromise = null;
  wireChannelPromise = null;
  try {
    if (typeof window !== "undefined") {
      for (const k of Object.keys(window.sessionStorage)) {
        if (k.startsWith("kuytu:")) window.sessionStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
  try {
    await run("readwrite", (s) => s.clear());
  } catch {
    /* nothing persisted */
  }
}

/** Save device-encrypted chat snapshot in IndexedDB so cold starts hydrate without waiting for network. */
export async function saveEncryptedSnapshot(userId: string, snapshot: unknown): Promise<void> {
  try {
    const slot = `snapshot:${userId}`;
    const sealed = await sealLocal(slot, snapshot);
    await kvSet(slot, sealed);
  } catch {
    /* ignore */
  }
}

export async function loadEncryptedSnapshot<T>(userId: string): Promise<T | null> {
  try {
    const slot = `snapshot:${userId}`;
    const raw = await kvGet<string>(slot);
    if (!raw || typeof raw !== "string") return null;
    return await unsealLocal<T>(slot, raw);
  } catch {
    return null;
  }
}

/** Trust-on-first-use: remember each contact's key (sealed with deviceKey) and flag any later change. */
export async function checkPin(userId: string, publicKey: string): Promise<"new" | "ok" | "changed"> {
  const slot = `pin:${userId}`;
  const raw = await kvGet<string>(slot);
  if (!raw) {
    await kvSet(slot, await sealLocal(slot, publicKey));
    return "new";
  }
  const unsealed = await unsealLocal<string>(slot, raw);
  if (!unsealed) {
    if (raw === publicKey) {
      await kvSet(slot, await sealLocal(slot, publicKey));
      return "ok";
    }
    return "changed";
  }
  return unsealed === publicKey ? "ok" : "changed";
}

export const acceptPin = async (userId: string, publicKey: string) => {
  const slot = `pin:${userId}`;
  await kvSet(slot, await sealLocal(slot, publicKey));
};

/* ---------- Ephemeral ECDH P-256 + AES-256-GCM Wire Transport ---------- */

type WireChannel = {
  hid: string;
  key: CryptoKey;
  expiresAt: number;
};

type StoredWireChannel = {
  sealedHid: string;
  key: CryptoKey;
  expiresAt: number;
};

let wireChannelPromise: Promise<WireChannel> | null = null;

function randomNonce(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

async function loadStoredWireChannel(): Promise<WireChannel | null> {
  try {
    const stored = await kvGet<StoredWireChannel>("wireChannel");
    if (!stored?.key || !stored.sealedHid || typeof stored.expiresAt !== "number") return null;
    if (stored.expiresAt < Date.now() + 60_000) return null;
    const hid = await unsealLocal<string>("wireChannel", stored.sealedHid);
    if (!hid) return null;
    return { hid, key: stored.key, expiresAt: stored.expiresAt };
  } catch {
    return null;
  }
}

async function saveStoredWireChannel(ch: WireChannel): Promise<void> {
  try {
    const sealedHid = await sealLocal("wireChannel", ch.hid);
    await kvSet("wireChannel", { sealedHid, key: ch.key, expiresAt: ch.expiresAt } satisfies StoredWireChannel);
  } catch {
    /* ignore */
  }
}

async function negotiateWireChannel(skipCache = false): Promise<WireChannel> {
  if (!skipCache) {
    const cached = await loadStoredWireChannel();
    if (cached) return cached;
  }

  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const clientPub = toB64(await crypto.subtle.exportKey("raw", pair.publicKey));

  const res = await fetch("/api/handshake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pub: clientPub }),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Wire handshake failed");
  const data = (await res.json()) as { hid?: string; pub?: string; salt?: string };
  if (!data?.hid || !data.pub || !data.salt) throw new Error("Invalid handshake response");

  const serverPubKey = await crypto.subtle.importKey(
    "raw",
    src(fromB64(data.pub)),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: serverPubKey }, pair.privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  new Uint8Array(shared).fill(0);

  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: src(fromB64(data.salt)), info: src(te.encode("kuytu/v2/wire")) },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const channel: WireChannel = {
    hid: data.hid,
    key,
    expiresAt: Date.now() + 11 * 3600_000,
  };
  void saveStoredWireChannel(channel);
  return channel;
}

function getWireChannel(forceRefresh = false): Promise<WireChannel> {
  if (forceRefresh) {
    wireChannelPromise = null;
    memory.delete("wireChannel");
  }
  if (!wireChannelPromise) {
    wireChannelPromise = negotiateWireChannel(forceRefresh).catch((err) => {
      wireChannelPromise = null;
      throw err;
    });
  }
  return wireChannelPromise.then((ch) => {
    if (ch.expiresAt < Date.now()) {
      wireChannelPromise = null;
      return getWireChannel(true);
    }
    return ch;
  });
}

async function wireEncrypt(key: CryptoKey, plain: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = te.encode(plain);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: src(iv), additionalData: src(te.encode(aad)) },
    key,
    src(bytes),
  );
  bytes.fill(0);
  return `${toB64(iv)}.${toB64(ct)}`;
}

async function wireDecrypt(key: CryptoKey, frame: string, aad: string): Promise<string> {
  const [ivB64, ctB64] = frame.split(".");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: src(fromB64(ivB64)), additionalData: src(te.encode(aad)) },
    key,
    src(fromB64(ctB64)),
  );
  try {
    return td.decode(pt);
  } finally {
    new Uint8Array(pt).fill(0);
  }
}

function splitPathAndQuery(path: string): { pathname: string; query: string } {
  const qIdx = path.indexOf("?");
  if (qIdx < 0) return { pathname: path, query: "" };
  return { pathname: path.slice(0, qIdx), query: path.slice(qIdx + 1) };
}

/* ---------- API client ---------- */

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function configureApi(nextToken: string | null, handler: (() => void) | null) {
  token = nextToken;
  onUnauthorized = handler;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ApiInit = { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> };

export async function api<T>(path: string, init: ApiInit = {}, retried = false): Promise<T> {
  const method = (init.method ?? (init.json !== undefined || init.body !== undefined ? "POST" : "GET")).toUpperCase();
  const { pathname, query } = splitPathAndQuery(path);

  let channel: WireChannel;
  try {
    channel = await getWireChannel();
  } catch {
    throw new ApiError(0, "Sunucuya ulaşılamadı. Bağlantını kontrol et.");
  }

  const headers: Record<string, string> = {
    ...init.headers,
    "X-Kuytu-Wire": channel.hid,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (query) {
    headers["X-Kuytu-Query"] = await wireEncrypt(
      channel.key,
      JSON.stringify({ q: query, ts: Date.now(), n: randomNonce() }),
      `kuytu/v2/query|${method}|${pathname}`,
    );
  }

  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    const encryptedBody = await wireEncrypt(
      channel.key,
      JSON.stringify({ b: init.json, ts: Date.now(), n: randomNonce() }),
      `kuytu/v2/req|${method}|${pathname}`,
    );
    body = JSON.stringify({ _w: encryptedBody });
  }

  let res: Response;
  try {
    res = await fetch(pathname, {
      method,
      headers,
      body,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Sunucuya ulaşılamadı. Bağlantını kontrol et.");
  }

  if (res.status === 412 && !retried) {
    await getWireChannel(true).catch(() => {});
    return api<T>(path, init, true);
  }

  const rawData = (await res.json().catch(() => null)) as { _w?: string; error?: string } | null;
  let data: { error?: string } | null = rawData;

  if (rawData && typeof rawData._w === "string") {
    try {
      const plain = await wireDecrypt(channel.key, rawData._w, `kuytu/v2/res|${res.status}|${pathname}`);
      data = JSON.parse(plain) as { error?: string };
    } catch {
      if (!retried) {
        await getWireChannel(true).catch(() => {});
        return api<T>(path, init, true);
      }
      throw new ApiError(res.status, "Güvenli yanıt doğrulanamadı.");
    }
  }

  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? "Bir şeyler ters gitti.");
  }
  return data as T;
}

/** Authenticated fetch for binary downloads (encrypted media) with encrypted query transport. */
export async function authFetch(path: string, retried = false): Promise<Response> {
  const { pathname, query } = splitPathAndQuery(path);
  const channel = await getWireChannel();
  const headers: Record<string, string> = {
    "X-Kuytu-Wire": channel.hid,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (query) {
    headers["X-Kuytu-Query"] = await wireEncrypt(
      channel.key,
      JSON.stringify({ q: query, ts: Date.now(), n: randomNonce() }),
      `kuytu/v2/query|GET|${pathname}`,
    );
  }
  const res = await fetch(pathname, {
    method: "GET",
    headers,
    credentials: "same-origin",
    cache: "private" as RequestCache,
  }).catch(() => fetch(pathname, { method: "GET", headers, credentials: "same-origin" }));

  if (res.status === 412 && !retried) {
    await getWireChannel(true).catch(() => {});
    return authFetch(path, true);
  }
  return res;
}
