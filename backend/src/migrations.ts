import type { DbApi } from "./db.js";

// Migraciones versionadas: cada una corre una sola vez, registrada en
// schema_migrations. Los primeros 9 ids son historia de la época `node:sqlite`
// (índices, auth, coach, RIR/training_mode, RPE de sesión, duración +
// mesociclo, strength_tests, cardio_sessions, pro_enabled) — con la migración
// a Postgres (Fase 11.1) esa forma final ya quedó incluida directo en el
// schema base de db.ts (Neon arranca vacío, no hay instalación existente que
// migrar paso a paso), así que sus `up()` son no-ops acá. Se mantienen en la
// lista para no perder continuidad del id/auditoría en `schema_migrations`.
// Toda migración NUEVA de acá en más (real, con su propio `up()`) se agrega
// al final del array con prefijo `0010_`, `0011_`... y sí corre de verdad.
export type Migration = { id: string; up: (db: DbApi) => Promise<void> };

const noop: Migration["up"] = async () => {};

export const migrations: Migration[] = [
  { id: "0001_indices_sessions_biometrics", up: noop },
  { id: "0002_auth_users_tokens", up: noop },
  { id: "0003_coach_athlete", up: noop },
  { id: "0004_training_mode_and_rir", up: noop },
  { id: "0005_session_rpe", up: noop },
  { id: "0006_session_duration_and_mesocycle", up: noop },
  { id: "0007_strength_tests", up: noop },
  { id: "0008_cardio_sessions", up: noop },
  { id: "0009_profile_pro_enabled", up: noop },
];

export async function runMigrations(db: DbApi): Promise<void> {
  await db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const appliedRows = await db.all<{ id: string }>(`SELECT id FROM schema_migrations`);
  const applied = new Set(appliedRows.map((r) => r.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    await migration.up(db);
    await db.run(`INSERT INTO schema_migrations (id) VALUES (?)`, [migration.id]);
  }
}
