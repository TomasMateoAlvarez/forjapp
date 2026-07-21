import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { runMigrations } from "./migrations.js";

// FORJA_TEST_DB aísla cada archivo de test (proceso propio de node:test) en su
// propia base de datos física de Postgres, creada/destruida por
// test-helpers.ts — equivalente al viejo FORJA_DB_PATH de node:sqlite, que
// apuntaba a un archivo temporal. Una base entera por test (en vez de, por
// ejemplo, un schema + `SET search_path`) evita cualquier condición de
// carrera con conexiones nuevas del pool: cada conexión física ya apunta a la
// base correcta desde el connect inicial, sin un segundo comando de sesión
// que coordinar.
const testDb = process.env.FORJA_TEST_DB;

// No valida DATABASE_URL acá arriba a propósito: este módulo se importa
// transitivamente desde `generate-openapi.ts` (vía los schemas zod que
// exportan las rutas), que corre aislado del server real y nunca necesita
// una conexión — sin esto, `npm run openapi:generate` rompería solo por
// importar `db.js` sin tener Postgres a mano. La variable se valida recién en
// `initDb()`, que es lo único que de verdad la necesita.
function resolveConnectionString(): string | undefined {
  const base = process.env.DATABASE_URL;
  if (!base || !testDb) return base;
  const url = new URL(base);
  url.pathname = `/${testDb}`;
  return url.toString();
}

export const pool = new Pool({ connectionString: resolveConnectionString() });

type Params = unknown[] | Record<string, unknown>;

// Traduce `?` posicionales (y `@nombre` con params en forma de objeto, usado
// en un par de UPSERTs) al `$1, $2, ...` que exige el protocolo de Postgres.
// Deja el resto del SQL (ON CONFLICT ... DO UPDATE SET x = excluded.x,
// CREATE INDEX IF NOT EXISTS, etc.) tal cual: es sintaxis válida en Postgres.
function toPgQuery(sql: string, params?: Params): { text: string; values: unknown[] } {
  if (!params || Array.isArray(params)) {
    let i = 0;
    const text = sql.replace(/\?/g, () => `$${++i}`);
    return { text, values: (params as unknown[]) ?? [] };
  }
  const values: unknown[] = [];
  const seen = new Map<string, number>();
  const text = sql.replace(/@(\w+)/g, (_match, name: string) => {
    if (!seen.has(name)) {
      values.push((params as Record<string, unknown>)[name]);
      seen.set(name, values.length);
    }
    return `$${seen.get(name)}`;
  });
  return { text, values };
}

export type DbApi = {
  all<T extends QueryResultRow = QueryResultRow>(sql: string, params?: Params): Promise<T[]>;
  get<T extends QueryResultRow = QueryResultRow>(sql: string, params?: Params): Promise<T | undefined>;
  run(sql: string, params?: Params): Promise<{ rowCount: number; rows: QueryResultRow[] }>;
};

function createDbApi(queryable: Pool | PoolClient): DbApi {
  return {
    async all<T extends QueryResultRow>(sql: string, params?: Params): Promise<T[]> {
      const { text, values } = toPgQuery(sql, params);
      const res = await queryable.query<T>(text, values);
      return res.rows;
    },
    async get<T extends QueryResultRow>(sql: string, params?: Params): Promise<T | undefined> {
      const { text, values } = toPgQuery(sql, params);
      const res = await queryable.query<T>(text, values);
      return res.rows[0];
    },
    async run(sql: string, params?: Params) {
      const { text, values } = toPgQuery(sql, params);
      const res = await queryable.query(text, values);
      return { rowCount: res.rowCount ?? 0, rows: res.rows };
    },
  };
}

// db.all/get/run reusan una conexión cualquiera del pool por llamada — sirve
// para todo excepto las rutas que necesitan varias sentencias atómicas
// (usar withTransaction para esas, ver abajo).
export const db = createDbApi(pool);

// BEGIN/COMMIT/ROLLBACK tienen que correr sobre LA MISMA conexión física, algo
// que pool.query() no garantiza (cada llamada puede tomar una conexión
// distinta del pool). withTransaction hace el checkout explícito de un
// PoolClient, corre el callback con un DbApi ligado a esa conexión, y libera
// la conexión al final pase lo que pase.
export async function withTransaction<T>(fn: (tx: DbApi) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx = createDbApi(client);
  try {
    await client.query("BEGIN");
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// --- Schema (estado final, no se reproduce paso a paso la historia de
// migraciones de la época SQLite: Neon arranca vacío, así que se declara
// directo la forma final de cada tabla en sintaxis Postgres — ver README
// sección de migraciones para el detalle de esta decisión). El orden importa:
// una tabla con REFERENCES necesita que la tabla referenciada ya exista
// (Postgres, a diferencia de SQLite, valida el FK al crear la tabla).
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workout_types (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  muscle_group TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_type_exercises (
  id SERIAL PRIMARY KEY,
  workout_type_id TEXT NOT NULL REFERENCES workout_types(id),
  exercise_name TEXT NOT NULL,
  default_order INTEGER NOT NULL,
  default_rest_seconds INTEGER,
  target_sets INTEGER,
  target_reps TEXT
);

CREATE TABLE IF NOT EXISTS custom_routines (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id TEXT NOT NULL DEFAULT 'default'
);

CREATE TABLE IF NOT EXISTS custom_routine_exercises (
  id SERIAL PRIMARY KEY,
  routine_id INTEGER NOT NULL REFERENCES custom_routines(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  default_order INTEGER NOT NULL,
  target_sets INTEGER,
  target_reps TEXT
);

-- date/week_start/*_date quedan TEXT (YYYY-MM-DD) a propósito: toda la
-- aritmética de fechas (mondayOf, streak, alertas de 48hs) vive en JS sobre
-- strings ISO, no en SQL — usar el tipo DATE de Postgres movería esa lógica a
-- lidiar con conversión de timezone en el driver sin ninguna ganancia real.
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  workout_type_id TEXT REFERENCES workout_types(id),
  custom_routine_id INTEGER REFERENCES custom_routines(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id TEXT NOT NULL DEFAULT 'default',
  rpe INTEGER,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS session_exercises (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  reps INTEGER NOT NULL,
  set_number INTEGER NOT NULL,
  is_warmup INTEGER NOT NULL DEFAULT 0,
  rir INTEGER
);

CREATE TABLE IF NOT EXISTS biometrics (
  id SERIAL PRIMARY KEY,
  client_id TEXT NOT NULL DEFAULT 'default',
  date TEXT NOT NULL,
  weight_kg REAL,
  height_cm REAL,
  feeling INTEGER,
  UNIQUE(client_id, date)
);

CREATE TABLE IF NOT EXISTS personal_records (
  client_id TEXT NOT NULL DEFAULT 'default',
  exercise_name TEXT NOT NULL,
  best_weight_kg REAL NOT NULL,
  best_weight_date TEXT NOT NULL,
  best_volume REAL NOT NULL,
  best_volume_date TEXT NOT NULL,
  PRIMARY KEY (client_id, exercise_name)
);

CREATE TABLE IF NOT EXISTS weekly_plans (
  id SERIAL PRIMARY KEY,
  client_id TEXT NOT NULL DEFAULT 'default',
  week_start TEXT NOT NULL,
  mesocycle_phase TEXT,
  UNIQUE(client_id, week_start)
);

CREATE TABLE IF NOT EXISTS plan_days (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  workout_type_id TEXT NOT NULL REFERENCES workout_types(id),
  done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_profile (
  client_id TEXT PRIMARY KEY,
  height_cm REAL,
  updated_at TIMESTAMPTZ,
  training_mode TEXT,
  pro_enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

CREATE TABLE IF NOT EXISTS athlete_invite_codes (
  code TEXT PRIMARY KEY,
  athlete_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coach_athletes (
  id SERIAL PRIMARY KEY,
  coach_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  athlete_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(coach_user_id, athlete_user_id)
);
CREATE INDEX IF NOT EXISTS idx_coach_athletes_coach ON coach_athletes(coach_user_id, status);
CREATE INDEX IF NOT EXISTS idx_coach_athletes_athlete ON coach_athletes(athlete_user_id, status);

CREATE TABLE IF NOT EXISTS session_comments (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  coach_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_comments_session ON session_comments(session_id);

CREATE TABLE IF NOT EXISTS strength_tests (
  id SERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  date TEXT NOT NULL,
  test_type TEXT NOT NULL,
  flight_time_sec REAL NOT NULL,
  contact_time_sec REAL,
  drop_height_cm REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_strength_tests_client_date ON strength_tests(client_id, date);

CREATE TABLE IF NOT EXISTS cardio_sessions (
  id SERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  date TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cardio_sessions_client_date ON cardio_sessions(client_id, date);

CREATE INDEX IF NOT EXISTS idx_sessions_client_date ON sessions(client_id, date);
CREATE INDEX IF NOT EXISTS idx_biometrics_client_date ON biometrics(client_id, date);
`;

const seedTypes: { id: string; label: string; muscle_group: string; exercises: string[] }[] = [
  { id: "pecho", label: "Pecho", muscle_group: "pecho", exercises: ["Press banca", "Press inclinado con mancuernas", "Press declinado", "Aperturas con mancuernas", "Cruces en polea", "Fondos en paralelas", "Press en máquina Smith", "Pull-over con mancuerna"] },
  { id: "espalda", label: "Espalda", muscle_group: "espalda", exercises: ["Dominadas", "Remo con barra", "Remo con mancuerna a un brazo", "Jalón al pecho", "Remo en polea baja", "Peso muerto", "Pull-over en polea", "Remo en máquina"] },
  { id: "piernas", label: "Piernas", muscle_group: "piernas", exercises: ["Sentadilla", "Prensa de piernas", "Peso muerto rumano", "Zancadas con mancuernas", "Extensión de cuádriceps", "Curl femoral", "Elevación de talones", "Sentadilla búlgara"] },
  { id: "push", label: "Push", muscle_group: "empuje", exercises: ["Press banca", "Press militar", "Press de hombros con mancuernas", "Fondos en paralelas", "Extensión de tríceps en polea", "Elevaciones laterales", "Press francés", "Aperturas con mancuernas"] },
  { id: "pull", label: "Pull", muscle_group: "tracción", exercises: ["Dominadas", "Remo con barra", "Curl de bíceps con barra", "Curl martillo", "Face pull", "Remo en polea", "Curl concentrado", "Encogimientos de trapecio"] },
  { id: "full_body", label: "Full Body", muscle_group: "full", exercises: ["Sentadilla", "Press banca", "Remo con barra", "Press militar", "Peso muerto", "Zancadas", "Dominadas", "Plancha abdominal"] },
  { id: "hombro_brazo", label: "Hombro y brazo", muscle_group: "hombro", exercises: ["Press militar", "Elevaciones laterales", "Elevaciones frontales", "Pájaros (deltoide posterior)", "Curl de bíceps", "Curl martillo", "Extensión de tríceps en polea", "Press francés"] },
];

async function seedCatalog(): Promise<void> {
  for (const t of seedTypes) {
    await db.run(`INSERT INTO workout_types (id, label, muscle_group) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING`, [t.id, t.label, t.muscle_group]);
    const existing = await db.get<{ c: string }>(`SELECT COUNT(*) as c FROM workout_type_exercises WHERE workout_type_id = ?`, [t.id]);
    if (Number(existing?.c ?? 0) === 0) {
      for (let i = 0; i < t.exercises.length; i++) {
        await db.run(`INSERT INTO workout_type_exercises (workout_type_id, exercise_name, default_order) VALUES (?, ?, ?)`, [t.id, t.exercises[i], i]);
      }
    }
  }
}

let initPromise: Promise<void> | undefined;

// Crea el schema (real o de test), la forma final de las tablas, corre las
// migraciones versionadas pendientes y siembra el catálogo — todo idempotente,
// se puede llamar en cada arranque sin duplicar nada. Memoizado: aunque
// varias rutas importen db.ts, la inicialización corre una sola vez.
export function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error("Falta la variable de entorno DATABASE_URL (connection string de Postgres, ver backend/.env.example)");
      }
      await pool.query(SCHEMA_SQL);
      await runMigrations(db);
      await seedCatalog();
    })();
  }
  return initPromise;
}
