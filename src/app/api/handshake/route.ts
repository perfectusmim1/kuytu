import { clientIp, createWireHandshake, fail, json, limited } from "@/lib/server/core";

export const dynamic = "force-dynamic";

/**
 * Ephemeral ECDH P-256 key exchange for application-layer wire encryption.
 * Neither the shared secret nor the derived AES-256-GCM key is ever sent over the network.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (limited(`handshake:${ip}`, 120, 60_000)) {
    return fail(429, "Çok fazla bağlantı isteği.");
  }

  let body: { pub?: unknown } = {};
  try {
    body = (await req.json()) as { pub?: unknown };
  } catch {
    return fail(400, "Geçersiz el sıkışma isteği.");
  }

  const res = typeof body.pub === "string" ? createWireHandshake(body.pub) : null;
  if (!res) return fail(400, "Geçersiz el sıkışma anahtarı.");
  return json(res);
}
