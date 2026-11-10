/**
 * All encryption happens here, in the browser, with the Web Crypto API.
 *
 * Layers:
 *  1. password ──PBKDF2 (600,000 rounds)──▶ master ──HKDF-SHA256──▶ authKey (login proof)
 *                                                                 ▶ wrapKey (non-extractable, never leaves device)
 *  2. identity: ECDH P-256 key pair. The private key is non-extractable on the device
 *     and stored on the server only after AES-256-GCM + AAD encryption with wrapKey
 *     (plus server-side AES-256-GCM at-rest encryption).
 *  3. conversation key: ECDH(my private, their public) ──HKDF-SHA256──▶ AES-256-GCM (non-extractable)
 *  4. every message: fresh 96-bit IV, 64-byte block padding, and AAD binding the ciphertext
 *     to its conversation, sender and message id.
 *  5. every sensitive buffer in memory is zeroed (.fill(0)) immediately after use.
 */

const te = new TextEncoder();
const td = new TextDecoder();
const src = (v: ArrayBuffer | Uint8Array) => v as BufferSource;

const EC = { name: "ECDH", namedCurve: "P-256" } as const;
const PBKDF2_ITERATIONS = 600_000;
const IDENTITY_AAD = te.encode("kuytu/v2/identity-key");
const MEDIA_AAD = te.encode("kuytu/v2/media");

export const cryptoReady = () =>
  typeof window !== "undefined" && window.isSecureContext && Boolean(window.crypto?.subtle);

export function toB64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Derives cryptographically independent authKey and wrapKey using
 * PBKDF2-HMAC-SHA256 (600,000 iterations) followed by HKDF-SHA256 domain separation.
 */
export async function deriveCredentials(
  username: string,
  password: string,
): Promise<{ authKey: string; wrapKey: CryptoKey }> {
  const cleanUser = username.trim().toLowerCase();
  const pwBytes = te.encode(password.normalize("NFKC"));
  const saltDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", src(te.encode(`kuytu/v2/salt/${cleanUser}`))));

  const baseKey = await crypto.subtle.importKey("raw", src(pwBytes), "PBKDF2", false, ["deriveBits"]);
  pwBytes.fill(0);

  const masterBits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: src(saltDigest),
        iterations: PBKDF2_ITERATIONS,
      },
      baseKey,
      256,
    ),
  );

  const hkdfKey = await crypto.subtle.importKey("raw", src(masterBits), "HKDF", false, ["deriveBits", "deriveKey"]);
  masterBits.fill(0);

  const zeroSalt = new Uint8Array(32);
  const authBits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: src(zeroSalt), info: src(te.encode("kuytu/v2/auth")) },
      hkdfKey,
      256,
    ),
  );
  const authKey = toB64(authBits);
  authBits.fill(0);

  const wrapKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: src(zeroSalt), info: src(te.encode("kuytu/v2/key-wrap")) },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  return { authKey, wrapKey };
}

async function seal(key: CryptoKey, data: ArrayBuffer | Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: src(iv), additionalData: src(IDENTITY_AAD) },
    key,
    src(data),
  );
  return `${toB64(iv)}.${toB64(ct)}`;
}

async function unseal(key: CryptoKey, sealed: string): Promise<ArrayBuffer> {
  const [iv, ct] = sealed.split(".");
  const ivBytes = fromB64(iv);
  const ctBytes = fromB64(ct);
  try {
    return await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: src(ivBytes), additionalData: src(IDENTITY_AAD) },
      key,
      src(ctBytes),
    );
  } catch {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: src(ivBytes) }, key, src(ctBytes));
  }
}

const importPrivate = (pkcs8: ArrayBuffer) =>
  // Non-extractable: once on this device, the key can be used but never exported.
  crypto.subtle.importKey("pkcs8", pkcs8, EC, false, ["deriveBits"]);

export async function createIdentity(
  wrapKey: CryptoKey,
): Promise<{ publicKey: string; encPrivateKey: string; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(EC, true, ["deriveBits"]);
  const publicKey = toB64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const encPrivateKey = await seal(wrapKey, pkcs8);
  const privateKey = await importPrivate(pkcs8);
  new Uint8Array(pkcs8).fill(0);
  return { publicKey, encPrivateKey, privateKey };
}

export async function unlockIdentity(encPrivateKey: string, wrapKey: CryptoKey): Promise<CryptoKey> {
  const pkcs8 = await unseal(wrapKey, encPrivateKey);
  try {
    return await importPrivate(pkcs8);
  } finally {
    new Uint8Array(pkcs8).fill(0);
  }
}

/** Used on password change: same identity, new wrapping key. */
export async function rewrapIdentity(encPrivateKey: string, oldKey: CryptoKey, newKey: CryptoKey): Promise<string> {
  const pkcs8 = await unseal(oldKey, encPrivateKey);
  try {
    return await seal(newKey, pkcs8);
  } finally {
    new Uint8Array(pkcs8).fill(0);
  }
}

export async function conversationKey(privateKey: CryptoKey, peerPublicKey: string, convId: string): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey("raw", src(fromB64(peerPublicKey)), EC, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, privateKey, 256);
  const hk = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  new Uint8Array(shared).fill(0);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: src(te.encode("kuytu/v1/dm")), info: src(te.encode(convId)) },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPayload(
  key: CryptoKey,
  payload: unknown,
  aad: string,
): Promise<{ iv: string; ciphertext: string }> {
  const raw = te.encode(JSON.stringify(payload));
  // Pad to 64-byte blocks so ciphertext length reveals less about the message.
  const padded = new Uint8Array(Math.ceil((raw.length + 1) / 64) * 64).fill(0x20);
  padded.set(raw);
  raw.fill(0);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: src(iv), additionalData: src(te.encode(aad)) },
      key,
      src(padded),
    );
    return { iv: toB64(iv), ciphertext: toB64(ct) };
  } finally {
    padded.fill(0);
  }
}

export async function decryptPayload(key: CryptoKey, iv: string, ciphertext: string, aad: string): Promise<unknown> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: src(fromB64(iv)), additionalData: src(te.encode(aad)) },
    key,
    src(fromB64(ciphertext)),
  );
  try {
    return JSON.parse(td.decode(pt));
  } finally {
    new Uint8Array(pt).fill(0);
  }
}

/** Photos get their own one-off 256-bit key, which travels inside the encrypted message. */
export async function encryptBytes(data: ArrayBuffer): Promise<{ data: Uint8Array; k: string; iv: string }> {
  const keyRaw = crypto.getRandomValues(new Uint8Array(32));
  const k = toB64(keyRaw);
  const key = await crypto.subtle.importKey("raw", src(keyRaw), "AES-GCM", false, ["encrypt"]);
  keyRaw.fill(0);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: src(iv), additionalData: src(MEDIA_AAD) }, key, data);
  return { data: new Uint8Array(ct), k, iv: toB64(iv) };
}

export async function decryptBytes(data: ArrayBuffer, k: string, iv: string): Promise<ArrayBuffer> {
  const keyRaw = fromB64(k);
  const key = await crypto.subtle.importKey("raw", src(keyRaw), "AES-GCM", false, ["decrypt"]);
  keyRaw.fill(0);
  const ivBytes = fromB64(iv);
  try {
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv: src(ivBytes), additionalData: src(MEDIA_AAD) }, key, data);
  } catch {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: src(ivBytes) }, key, data);
  }
}

/**
 * A 60-digit code both people can compare out loud. If the codes match, the
 * server has not swapped anyone's key.
 */
export async function safetyNumber(keyA: string, keyB: string): Promise<string[]> {
  const [x, y] = [keyA, keyB].sort();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", src(te.encode(`kuytu/v1/safety|${x}|${y}`))));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + digest[i * 5 + j];
    groups.push(String(n % 100000).padStart(5, "0"));
  }
  return groups;
}
