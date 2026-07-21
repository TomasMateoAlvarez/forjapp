import { createHash, randomBytes } from "node:crypto";
import { db } from "../db.js";

// Token de sesión opaco (no JWT): un random de 32 bytes que el cliente manda
// como "Authorization: Bearer <token>". Se guarda hasheado (sha256) en
// auth_tokens, nunca en texto plano — así un dump de la base no expone
// tokens usables directamente. Se eligió sobre JWT para no reimplementar
// firmado/verificación a mano; revocar sesión es un DELETE simple.
const TOKEN_TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueToken(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000);
  await db.run(`INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)`, [tokenHash, userId, expiresAt]);
  return token;
}

export type AuthenticatedUser = { id: number; email: string };

export async function getUserByToken(token: string): Promise<AuthenticatedUser | null> {
  const tokenHash = hashToken(token);
  const row = await db.get<AuthenticatedUser>(
    `SELECT u.id, u.email FROM auth_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.expires_at > now()`,
    [tokenHash]
  );
  return row ?? null;
}

export async function revokeToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await db.run(`DELETE FROM auth_tokens WHERE token_hash = ?`, [tokenHash]);
}
