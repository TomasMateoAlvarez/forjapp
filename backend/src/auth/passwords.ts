import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt nativo de node:crypto en vez de bcrypt: evita sumar una dependencia
// para algo que Node ya resuelve bien (KDF con costo de memoria, salt propio).
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(":");
  if (!salt || !derivedHex) return false;
  const derived = scryptSync(password, salt, KEY_LENGTH);
  const storedBuf = Buffer.from(derivedHex, "hex");
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}
