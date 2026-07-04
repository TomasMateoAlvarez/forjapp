import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "forja.sqlite");

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");


db.exec(`
CREATE TABLE IF NOT EXISTS workout_types (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  muscle_group TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_type_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_type_id TEXT NOT NULL REFERENCES workout_types(id),
  exercise_name TEXT NOT NULL,
  default_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,           -- YYYY-MM-DD
  workout_type_id TEXT NOT NULL REFERENCES workout_types(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  reps INTEGER NOT NULL,
  set_number INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS biometrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,    -- YYYY-MM-DD
  weight_kg REAL,
  height_cm REAL,
  feeling INTEGER               -- 1-5
);

CREATE TABLE IF NOT EXISTS custom_routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_routine_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER NOT NULL REFERENCES custom_routines(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  default_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_records (
  exercise_name TEXT PRIMARY KEY,
  best_weight_kg REAL NOT NULL,
  best_weight_date TEXT NOT NULL,
  best_volume REAL NOT NULL,
  best_volume_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL UNIQUE  -- YYYY-MM-DD (lunes)
);

CREATE TABLE IF NOT EXISTS plan_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  workout_type_id TEXT NOT NULL REFERENCES workout_types(id),
  done INTEGER NOT NULL DEFAULT 0
);
`);

// --- Migrations (idempotent) ---
{
  const cols = db.prepare(`PRAGMA table_info(workout_type_exercises)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "default_rest_seconds")) {
    db.exec(`ALTER TABLE workout_type_exercises ADD COLUMN default_rest_seconds INTEGER`);
    db.exec(`UPDATE workout_type_exercises SET default_rest_seconds = 90 WHERE default_rest_seconds IS NULL`);
  }
  if (!cols.some((c) => c.name === "target_sets")) {
    db.exec(`ALTER TABLE workout_type_exercises ADD COLUMN target_sets INTEGER`);
  }
  if (!cols.some((c) => c.name === "target_reps")) {
    db.exec(`ALTER TABLE workout_type_exercises ADD COLUMN target_reps TEXT`);
  }
}
{
  const creCols = db.prepare(`PRAGMA table_info(custom_routine_exercises)`).all() as { name: string }[];
  if (!creCols.some((c) => c.name === "target_sets")) {
    db.exec(`ALTER TABLE custom_routine_exercises ADD COLUMN target_sets INTEGER`);
  }
  if (!creCols.some((c) => c.name === "target_reps")) {
    db.exec(`ALTER TABLE custom_routine_exercises ADD COLUMN target_reps TEXT`);
  }
}
{
  const seCols = db.prepare(`PRAGMA table_info(session_exercises)`).all() as { name: string }[];
  if (!seCols.some((c) => c.name === "is_warmup")) {
    db.exec(`ALTER TABLE session_exercises ADD COLUMN is_warmup INTEGER NOT NULL DEFAULT 0`);
  }
}
{
  // Rebuild sessions to make workout_type_id nullable + add custom_routine_id
  const sessionCols = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
  if (!sessionCols.some((c) => c.name === "custom_routine_id")) {
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec(`CREATE TABLE sessions_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      workout_type_id TEXT REFERENCES workout_types(id),
      custom_routine_id INTEGER REFERENCES custom_routines(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`INSERT INTO sessions_v2 (id, date, workout_type_id, created_at) SELECT id, date, workout_type_id, created_at FROM sessions`);
    db.exec(`DROP TABLE sessions`);
    db.exec(`ALTER TABLE sessions_v2 RENAME TO sessions`);
    db.exec(`PRAGMA foreign_keys = ON`);
  }
}

// --- Multi-tenancy: cada instalación (web/iOS) manda un X-Client-Id propio.
// workout_types/workout_type_exercises quedan GLOBALES (catálogo compartido).
// Los datos personales se aíslan por client_id. Todo lo existente antes de
// esta migración queda bajo el tenant 'default' para no perder datos.
{
  const sessionCols = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
  if (!sessionCols.some((c) => c.name === "client_id")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN client_id TEXT NOT NULL DEFAULT 'default'`);
  }
}
{
  const crCols = db.prepare(`PRAGMA table_info(custom_routines)`).all() as { name: string }[];
  if (!crCols.some((c) => c.name === "client_id")) {
    db.exec(`ALTER TABLE custom_routines ADD COLUMN client_id TEXT NOT NULL DEFAULT 'default'`);
  }
}
{
  // biometrics: UNIQUE(date) -> UNIQUE(client_id, date)
  const bCols = db.prepare(`PRAGMA table_info(biometrics)`).all() as { name: string }[];
  if (!bCols.some((c) => c.name === "client_id")) {
    db.exec(`CREATE TABLE biometrics_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL DEFAULT 'default',
      date TEXT NOT NULL,
      weight_kg REAL,
      height_cm REAL,
      feeling INTEGER,
      UNIQUE(client_id, date)
    )`);
    db.exec(`INSERT INTO biometrics_v2 (id, client_id, date, weight_kg, height_cm, feeling)
             SELECT id, 'default', date, weight_kg, height_cm, feeling FROM biometrics`);
    db.exec(`DROP TABLE biometrics`);
    db.exec(`ALTER TABLE biometrics_v2 RENAME TO biometrics`);
  }
}
{
  // personal_records: PK(exercise_name) -> PK(client_id, exercise_name)
  const prCols = db.prepare(`PRAGMA table_info(personal_records)`).all() as { name: string }[];
  if (!prCols.some((c) => c.name === "client_id")) {
    db.exec(`CREATE TABLE personal_records_v2 (
      client_id TEXT NOT NULL DEFAULT 'default',
      exercise_name TEXT NOT NULL,
      best_weight_kg REAL NOT NULL,
      best_weight_date TEXT NOT NULL,
      best_volume REAL NOT NULL,
      best_volume_date TEXT NOT NULL,
      PRIMARY KEY (client_id, exercise_name)
    )`);
    db.exec(`INSERT INTO personal_records_v2 (client_id, exercise_name, best_weight_kg, best_weight_date, best_volume, best_volume_date)
             SELECT 'default', exercise_name, best_weight_kg, best_weight_date, best_volume, best_volume_date FROM personal_records`);
    db.exec(`DROP TABLE personal_records`);
    db.exec(`ALTER TABLE personal_records_v2 RENAME TO personal_records`);
  }
}
{
  // weekly_plans: UNIQUE(week_start) -> UNIQUE(client_id, week_start)
  const wpCols = db.prepare(`PRAGMA table_info(weekly_plans)`).all() as { name: string }[];
  if (!wpCols.some((c) => c.name === "client_id")) {
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec(`CREATE TABLE weekly_plans_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL DEFAULT 'default',
      week_start TEXT NOT NULL,
      UNIQUE(client_id, week_start)
    )`);
    db.exec(`INSERT INTO weekly_plans_v2 (id, client_id, week_start) SELECT id, 'default', week_start FROM weekly_plans`);
    db.exec(`DROP TABLE weekly_plans`);
    db.exec(`ALTER TABLE weekly_plans_v2 RENAME TO weekly_plans`);
    db.exec(`PRAGMA foreign_keys = ON`);
  }
}
{
  // user_profile: singleton id=1 -> una fila por client_id
  const upCols = db.prepare(`PRAGMA table_info(user_profile)`).all() as { name: string }[];
  if (upCols.length > 0 && !upCols.some((c) => c.name === "client_id")) {
    db.exec(`CREATE TABLE user_profile_v2 (
      client_id TEXT PRIMARY KEY,
      height_cm REAL,
      updated_at TEXT
    )`);
    db.exec(`INSERT INTO user_profile_v2 (client_id, height_cm, updated_at)
             SELECT 'default', height_cm, updated_at FROM user_profile WHERE id = 1`);
    db.exec(`DROP TABLE user_profile`);
    db.exec(`ALTER TABLE user_profile_v2 RENAME TO user_profile`);
  }
}

// --- user_profile (altura master data, una fila por client_id) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS user_profile (
    client_id TEXT PRIMARY KEY,
    height_cm REAL,
    updated_at TEXT
  )
`);
{
  // Instalación nueva sin ningún dato todavía: si había altura cargada en
  // biometrics (no debería pasar en un install limpio, pero por las dudas),
  // la migramos al tenant 'default'.
  const row = db.prepare(`SELECT COUNT(*) as c FROM user_profile WHERE client_id = 'default'`).get() as { c: number };
  if (row.c === 0) {
    const latest = db.prepare(
      `SELECT height_cm FROM biometrics WHERE height_cm IS NOT NULL AND client_id = 'default' ORDER BY date DESC LIMIT 1`
    ).get() as { height_cm: number } | undefined;
    if (latest) {
      db.prepare(`INSERT INTO user_profile (client_id, height_cm, updated_at) VALUES ('default', ?, datetime('now'))`).run(latest.height_cm);
    }
  }
}

// --- Seed: tipos de entreno + ejercicios predeterminados (solo la primera vez) ---
const seedTypes: { id: string; label: string; muscle_group: string; exercises: string[] }[] = [
  { id: "pecho", label: "Pecho", muscle_group: "pecho", exercises: ["Press banca", "Press inclinado con mancuernas", "Press declinado", "Aperturas con mancuernas", "Cruces en polea", "Fondos en paralelas", "Press en máquina Smith", "Pull-over con mancuerna"] },
  { id: "espalda", label: "Espalda", muscle_group: "espalda", exercises: ["Dominadas", "Remo con barra", "Remo con mancuerna a un brazo", "Jalón al pecho", "Remo en polea baja", "Peso muerto", "Pull-over en polea", "Remo en máquina"] },
  { id: "piernas", label: "Piernas", muscle_group: "piernas", exercises: ["Sentadilla", "Prensa de piernas", "Peso muerto rumano", "Zancadas con mancuernas", "Extensión de cuádriceps", "Curl femoral", "Elevación de talones", "Sentadilla búlgara"] },
  { id: "push", label: "Push", muscle_group: "empuje", exercises: ["Press banca", "Press militar", "Press de hombros con mancuernas", "Fondos en paralelas", "Extensión de tríceps en polea", "Elevaciones laterales", "Press francés", "Aperturas con mancuernas"] },
  { id: "pull", label: "Pull", muscle_group: "tracción", exercises: ["Dominadas", "Remo con barra", "Curl de bíceps con barra", "Curl martillo", "Face pull", "Remo en polea", "Curl concentrado", "Encogimientos de trapecio"] },
  { id: "full_body", label: "Full Body", muscle_group: "full", exercises: ["Sentadilla", "Press banca", "Remo con barra", "Press militar", "Peso muerto", "Zancadas", "Dominadas", "Plancha abdominal"] },
  { id: "hombro_brazo", label: "Hombro y brazo", muscle_group: "hombro", exercises: ["Press militar", "Elevaciones laterales", "Elevaciones frontales", "Pájaros (deltoide posterior)", "Curl de bíceps", "Curl martillo", "Extensión de tríceps en polea", "Press francés"] },
];

const insertType = db.prepare(`INSERT OR IGNORE INTO workout_types (id, label, muscle_group) VALUES (?, ?, ?)`);
const insertExercise = db.prepare(`INSERT INTO workout_type_exercises (workout_type_id, exercise_name, default_order) VALUES (?, ?, ?)`);
const countExercises = db.prepare(`SELECT COUNT(*) as c FROM workout_type_exercises WHERE workout_type_id = ?`);

for (const t of seedTypes) {
  insertType.run(t.id, t.label, t.muscle_group);
  const existing = countExercises.get(t.id) as { c: number };
  if (existing.c === 0) {
    t.exercises.forEach((name, i) => insertExercise.run(t.id, name, i));
  }
}
