import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const tokenLifetimeMs = 12 * 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Falta la clave privada del servidor.");
  return value;
}

export async function hashBarberPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(pin, Buffer.from(salt, "hex"), 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

export async function verifyBarberPin(pin: string, stored: string): Promise<boolean> {
  const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(stored);
  if (!match) return false;
  const actual = (await scrypt(pin, Buffer.from(match[1], "hex"), 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(match[2], "hex"));
}

export function barberPinFingerprint(pin: string): string {
  return createHmac("sha256", secret()).update("barber-pin:").update(pin).digest("hex");
}

export function barberCredentialTag(pinHash: string): string {
  return createHmac("sha256", secret()).update("barber-credential:").update(pinHash).digest("base64url");
}

export function issueBarberToken(shopId: string, pinHash: string): string {
  if (!uuid.test(shopId)) throw new Error("Barbero inválido.");
  const payload = Buffer.from(JSON.stringify({ shopId, credential: barberCredentialTag(pinHash), expires: Date.now() + tokenLifetimeMs, nonce: randomBytes(12).toString("hex") })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(`barber-session:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyBarberToken(token: string): { shopId: string; credential: string } | null {
  if (token.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [payload, signature] = token.split(".");
  const expected = createHmac("sha256", secret()).update(`barber-session:${payload}`).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data !== "object") return null;
    const { shopId, credential, expires } = data as { shopId?: unknown; credential?: unknown; expires?: unknown };
    if (typeof shopId !== "string" || !uuid.test(shopId) || typeof credential !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(credential) || typeof expires !== "number" || expires <= Date.now() || expires > Date.now() + tokenLifetimeMs) return null;
    return { shopId, credential };
  } catch { return null; }
}

function ownerCredential(): string | null {
  const pin = process.env.ADMIN_PIN;
  if (!pin) return null;
  return createHmac("sha256", secret()).update("owner-credential:").update(pin).digest("base64url");
}

export function issueOwnerToken(): string {
  const credential = ownerCredential();
  if (!credential) throw new Error("Configura el PIN en el servidor.");
  const payload = Buffer.from(JSON.stringify({ credential, expires: Date.now() + tokenLifetimeMs, nonce: randomBytes(12).toString("hex") })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(`owner-session:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOwnerToken(token: string): boolean {
  if (token.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
  const [payload, signature] = token.split(".");
  const expected = createHmac("sha256", secret()).update(`owner-session:${payload}`).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data !== "object") return false;
    const { credential, expires } = data as { credential?: unknown; expires?: unknown };
    const current = ownerCredential();
    return typeof credential === "string" && current !== null && credential === current &&
      typeof expires === "number" && expires > Date.now() && expires <= Date.now() + tokenLifetimeMs;
  } catch { return false; }
}

export function ownerPinMatches(pin: string): boolean {
  const expected = process.env.ADMIN_PIN;
  if (!expected) return false;
  return timingSafeEqual(createHash("sha256").update(pin).digest(), createHash("sha256").update(expected).digest());
}
