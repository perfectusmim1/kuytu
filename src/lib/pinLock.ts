"use client";

export type PinStoredConfig = {
  salt: string;
  pinHash: string;
  duressHash: string | null;
  locked: boolean;
  failedAttempts: number;
  cooldownUntil: number;
};

const PIN_KEY = "kuytu:pin:v1";

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function hashPinWithSalt(salt: string, role: "pin" | "duress", code: string): Promise<string> {
  const enc = new TextEncoder().encode(`kuytu/pin/v1|${salt}|${role}|${code.trim()}`);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return toHex(digest);
}

export function readPinConfig(): PinStoredConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PinStoredConfig>;
    if (typeof parsed.salt !== "string" || typeof parsed.pinHash !== "string") return null;
    return {
      salt: parsed.salt,
      pinHash: parsed.pinHash,
      duressHash: typeof parsed.duressHash === "string" ? parsed.duressHash : null,
      locked: Boolean(parsed.locked),
      failedAttempts: typeof parsed.failedAttempts === "number" ? parsed.failedAttempts : 0,
      cooldownUntil: typeof parsed.cooldownUntil === "number" ? parsed.cooldownUntil : 0,
    };
  } catch {
    return null;
  }
}

function writePinConfig(cfg: PinStoredConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PIN_KEY, JSON.stringify(cfg));
    window.dispatchEvent(new CustomEvent("kuytu:pin-changed"));
  } catch {
    /* ignore quota errors */
  }
}

export async function savePinConfig(pin: string, duressPin?: string | null): Promise<void> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toHex(saltBytes);
  const pinHash = await hashPinWithSalt(salt, "pin", pin);
  const duressHash =
    duressPin && duressPin.trim().length >= 4 ? await hashPinWithSalt(salt, "duress", duressPin.trim()) : null;
  writePinConfig({
    salt,
    pinHash,
    duressHash,
    locked: false,
    failedAttempts: 0,
    cooldownUntil: 0,
  });
}

export function clearPinConfig(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PIN_KEY);
    window.dispatchEvent(new CustomEvent("kuytu:pin-changed"));
  } catch {
    /* ignore */
  }
}

export function setPinLockedState(locked: boolean): void {
  const cfg = readPinConfig();
  if (!cfg) return;
  if (cfg.locked === locked) return;
  writePinConfig({ ...cfg, locked });
}

export async function verifyPinInput(
  input: string,
): Promise<{ status: "unlock" | "duress" | "invalid" | "cooldown"; waitSec?: number }> {
  const cfg = readPinConfig();
  if (!cfg) return { status: "unlock" };

  const now = Date.now();
  if (cfg.cooldownUntil > now) {
    return { status: "cooldown", waitSec: Math.ceil((cfg.cooldownUntil - now) / 1000) };
  }

  const candidatePin = await hashPinWithSalt(cfg.salt, "pin", input);
  if (candidatePin === cfg.pinHash) {
    writePinConfig({ ...cfg, locked: false, failedAttempts: 0, cooldownUntil: 0 });
    return { status: "unlock" };
  }

  if (cfg.duressHash) {
    const candidateDuress = await hashPinWithSalt(cfg.salt, "duress", input);
    if (candidateDuress === cfg.duressHash) {
      clearPinConfig();
      return { status: "duress" };
    }
  }

  const nextFailures = cfg.failedAttempts + 1;
  const cooldownUntil = nextFailures >= 5 ? now + 30_000 : 0;
  writePinConfig({
    ...cfg,
    failedAttempts: nextFailures >= 5 ? 0 : nextFailures,
    cooldownUntil,
  });

  if (cooldownUntil > now) {
    return { status: "cooldown", waitSec: 30 };
  }
  return { status: "invalid" };
}
