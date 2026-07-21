import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { issueToken, revokeToken, getUserByToken } from "../auth/tokens.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const authRouter = Router();

// Tablas cuyo historial vive por client_id (ver db.ts): las tablas hijas
// (session_exercises, custom_routine_exercises, plan_days) no tienen su
// propio client_id, "se mueven" solas al reasignar el padre.
const CLIENT_SCOPED_TABLES = ["sessions", "custom_routines", "biometrics", "personal_records", "weekly_plans", "user_profile", "strength_tests", "cardio_sessions"] as const;

export const migrateAnonymousDataSchema = z.object({
  anonymous_client_id: z.string().trim().min(1),
});

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

// POST /api/auth/register — crea una cuenta nueva y devuelve un token de sesión.
// No pasa por requireIdentity (se monta antes en app.ts): todavía no hay identidad.
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;

    const existing = await db.get(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existing) return res.status(409).json({ error: "Ya existe una cuenta con ese email" });

    const passwordHash = hashPassword(password);
    const inserted = await db.get<{ id: number }>(`INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id`, [email, passwordHash]);
    const userId = inserted!.id;
    const token = await issueToken(userId);
    res.status(201).json({ token, user: { id: userId, email } });
  })
);

// POST /api/auth/login
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;

    const user = await db.get<{ id: number; email: string; password_hash: string }>(
      `SELECT id, email, password_hash FROM users WHERE email = ?`,
      [email]
    );
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Email o contraseña incorrectos" });
    }

    const token = await issueToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email } });
  })
);

// POST /api/auth/migrate-anonymous-data — mueve el historial guardado bajo un
// X-Client-Id anónimo (este dispositivo, antes de tener cuenta) a la cuenta
// recién creada/logueada. Es un paso explícito que el cliente dispara una
// sola vez (ver AccountPanel.tsx / AccountView.swift) — crear cuenta por sí
// solo NO migra nada, para no mezclar datos por sorpresa.
// No pasa por requireIdentity (mismo motivo que logout: valida el Bearer acá
// mismo) porque necesita DOS identidades a la vez: la cuenta destino (token)
// y el client_id anónimo origen (body), algo que requireIdentity no expone.
authRouter.post(
  "/migrate-anonymous-data",
  asyncHandler(async (req, res) => {
    const authHeader = req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : null;
    const user = token ? await getUserByToken(token) : null;
    if (!user) return res.status(401).json({ error: "Requiere una cuenta autenticada" });

    const parsed = migrateAnonymousDataSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { anonymous_client_id: source } = parsed.data;
    const destination = String(user.id);
    if (source === destination) return res.json({ ok: true, migrated: {} });

    const migrated: Record<string, number> = await withTransaction(async (tx) => {
      const result: Record<string, number> = {};
      for (const table of CLIENT_SCOPED_TABLES) {
        // Se mueve fila por fila (identificada por su `ctid` físico, válido
        // para cualquier tabla sin asumir que tiene una columna `id` — no es
        // el caso de personal_records/user_profile) con un SAVEPOINT propio:
        // si la fila destino ya tiene una que chocaría con una constraint
        // UNIQUE (ej. misma fecha en biometrics), esa fila puntual se
        // deja en el client_id anónimo en vez de abortar toda la migración —
        // reemplaza al `UPDATE OR IGNORE` de SQLite, que no existe en Postgres.
        const rows = await tx.all<{ ctid: string }>(`SELECT ctid FROM ${table} WHERE client_id = ?`, [source]);
        let count = 0;
        for (const row of rows) {
          await tx.run(`SAVEPOINT sp_migrate`);
          try {
            await tx.run(`UPDATE ${table} SET client_id = ? WHERE ctid = ?`, [destination, row.ctid]);
            await tx.run(`RELEASE SAVEPOINT sp_migrate`);
            count++;
          } catch {
            await tx.run(`ROLLBACK TO SAVEPOINT sp_migrate`);
          }
        }
        result[table] = count;
      }
      return result;
    });

    res.json({ ok: true, migrated });
  })
);

// POST /api/auth/logout — revoca el token si viene uno; siempre responde ok
// (logout es idempotente, no hace falta que el token siga siendo válido).
authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const authHeader = req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : null;
    if (token) await revokeToken(token);
    res.json({ ok: true });
  })
);
