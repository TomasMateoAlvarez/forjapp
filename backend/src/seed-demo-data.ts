// Datos de prueba (historial de sesiones + biometrics) para poder ver los
// gráficos de progreso con algo cargado, en TODOS los ejercicios del catálogo
// (no solo Pecho/Piernas). NO se ejecuta al levantar el server: correr a mano
// con `npm run seed:demo` (requiere el backend corriendo en localhost:4000).
// Para borrar lo insertado: `npm run seed:demo -- --clear`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const API_BASE = "http://localhost:4000/api";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// client_id destino: 'default' (instalación anónima de fábrica, web/iOS antes
// de crear cuenta) salvo que se pase --client-id=<id> — útil para sembrar
// directo en una cuenta ya creada (su client_id es el user.id como string),
// sin necesidad de token: en modo legacy, X-Client-Id manda tal cual llega.
const CLIENT_ID_ARG = process.argv.find((a) => a.startsWith("--client-id="));
const CLIENT_ID = CLIENT_ID_ARG ? CLIENT_ID_ARG.split("=")[1] : "default";
const MANIFEST_PATH = path.join(__dirname, "..", `seed-demo-data.manifest.${CLIENT_ID}.json`);

type Manifest = { sessionIds: number[]; biometricDates: string[]; exerciseNames: string[] };

function loadManifest(): Manifest {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return { sessionIds: [], biometricDates: [], exerciseNames: [] };
  }
}

function saveManifest(m: Manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round125(n: number): number {
  return Math.round(n / 1.25) * 1.25;
}

type WorkoutType = { id: string; label: string; muscle_group: string };
type ExerciseInfo = { exercise_name: string; default_rest_seconds: number; target_sets: number | null; target_reps: string | null };

// Config de progresión por ejercicio (peso inicial/final en kg, reps base,
// series) — un único mapa por NOMBRE de ejercicio (no por tipo de entreno):
// varios tipos comparten el mismo ejercicio (ej. "Press banca" en Pecho,
// Push y Full Body) y tiene que ser la MISMA progresión/PR en los tres.
// Todo arranca en un peso > 0 a propósito: intensidad_pct = peso/PR×100 se
// rompe (división por cero) si el primer registro de un ejercicio es 0kg.
type ExerciseConfig = { startWeight: number; endWeight: number; baseReps: number; sets: number };

const EXERCISE_CONFIG: Record<string, ExerciseConfig> = {
  // Empuje pecho
  "Press banca": { startWeight: 55, endWeight: 72.5, baseReps: 8, sets: 4 },
  "Press inclinado con mancuernas": { startWeight: 20, endWeight: 26, baseReps: 9, sets: 3 },
  "Press declinado": { startWeight: 50, endWeight: 65, baseReps: 8, sets: 3 },
  "Aperturas con mancuernas": { startWeight: 12, endWeight: 16, baseReps: 11, sets: 3 },
  "Cruces en polea": { startWeight: 10, endWeight: 14, baseReps: 12, sets: 3 },
  "Fondos en paralelas": { startWeight: 2.5, endWeight: 10, baseReps: 9, sets: 3 },
  "Press en máquina Smith": { startWeight: 40, endWeight: 52, baseReps: 9, sets: 3 },
  "Pull-over con mancuerna": { startWeight: 14, endWeight: 18, baseReps: 10, sets: 3 },
  // Tracción espalda
  "Dominadas": { startWeight: 2.5, endWeight: 10, baseReps: 8, sets: 4 },
  "Remo con barra": { startWeight: 50, endWeight: 65, baseReps: 8, sets: 4 },
  "Remo con mancuerna a un brazo": { startWeight: 18, endWeight: 24, baseReps: 10, sets: 3 },
  "Jalón al pecho": { startWeight: 45, endWeight: 58, baseReps: 10, sets: 3 },
  "Remo en polea baja": { startWeight: 45, endWeight: 58, baseReps: 10, sets: 3 },
  "Peso muerto": { startWeight: 80, endWeight: 105, baseReps: 5, sets: 4 },
  "Pull-over en polea": { startWeight: 20, endWeight: 27, baseReps: 11, sets: 3 },
  "Remo en máquina": { startWeight: 40, endWeight: 52, baseReps: 10, sets: 3 },
  // Piernas
  "Sentadilla": { startWeight: 70, endWeight: 92.5, baseReps: 7, sets: 4 },
  "Prensa de piernas": { startWeight: 120, endWeight: 150, baseReps: 10, sets: 3 },
  "Peso muerto rumano": { startWeight: 60, endWeight: 75, baseReps: 8, sets: 3 },
  "Zancadas con mancuernas": { startWeight: 12, endWeight: 16, baseReps: 10, sets: 3 },
  "Extensión de cuádriceps": { startWeight: 35, endWeight: 45, baseReps: 11, sets: 3 },
  "Curl femoral": { startWeight: 30, endWeight: 40, baseReps: 11, sets: 3 },
  "Elevación de talones": { startWeight: 60, endWeight: 80, baseReps: 14, sets: 3 },
  "Sentadilla búlgara": { startWeight: 16, endWeight: 22, baseReps: 9, sets: 3 },
  // Hombros/brazos
  "Press militar": { startWeight: 35, endWeight: 45, baseReps: 7, sets: 4 },
  "Press de hombros con mancuernas": { startWeight: 16, endWeight: 22, baseReps: 9, sets: 3 },
  "Extensión de tríceps en polea": { startWeight: 20, endWeight: 27, baseReps: 11, sets: 3 },
  "Elevaciones laterales": { startWeight: 8, endWeight: 11, baseReps: 13, sets: 3 },
  "Press francés": { startWeight: 20, endWeight: 25, baseReps: 10, sets: 3 },
  "Curl de bíceps con barra": { startWeight: 25, endWeight: 32, baseReps: 9, sets: 3 },
  "Curl martillo": { startWeight: 10, endWeight: 14, baseReps: 10, sets: 3 },
  "Face pull": { startWeight: 15, endWeight: 20, baseReps: 13, sets: 3 },
  "Remo en polea": { startWeight: 40, endWeight: 50, baseReps: 10, sets: 3 },
  "Curl concentrado": { startWeight: 8, endWeight: 11, baseReps: 10, sets: 3 },
  "Encogimientos de trapecio": { startWeight: 40, endWeight: 55, baseReps: 12, sets: 3 },
  "Elevaciones frontales": { startWeight: 8, endWeight: 11, baseReps: 11, sets: 3 },
  "Pájaros (deltoide posterior)": { startWeight: 6, endWeight: 9, baseReps: 13, sets: 3 },
  "Curl de bíceps": { startWeight: 12, endWeight: 16, baseReps: 10, sets: 3 },
  // Full body / core
  "Zancadas": { startWeight: 2.5, endWeight: 10, baseReps: 10, sets: 3 },
  "Plancha abdominal": { startWeight: 2.5, endWeight: 7.5, baseReps: 8, sets: 3 },
};

// Fallback determinístico para cualquier ejercicio que no esté en el mapa de
// arriba (ej. si alguien agregó uno custom al catálogo antes de sembrar).
function fallbackConfig(name: string): ExerciseConfig {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 1000;
  const start = 15 + (hash % 30);
  return { startWeight: start, endWeight: start * 1.25, baseReps: 8 + (hash % 5), sets: 3 };
}

function configFor(name: string): ExerciseConfig {
  return EXERCISE_CONFIG[name] ?? fallbackConfig(name);
}

function weightAtStep(cfg: ExerciseConfig, step: number, totalSteps: number): number {
  const progress = totalSteps <= 1 ? 1 : step / (totalSteps - 1);
  const linear = cfg.startWeight + (cfg.endWeight - cfg.startWeight) * progress;
  // pequeño "deload" cada 5ta sesión para que la curva no sea perfectamente recta
  const deload = step > 0 && step % 5 === 0 ? 0.93 : 1;
  const noise = Math.sin(step * 1.7 + cfg.startWeight) * 0.5; // +-0.5kg de ruido determinístico
  return Math.max(1.25, round125(linear * deload + noise));
}

function buildSets(cfg: ExerciseConfig, step: number, totalSteps: number) {
  const weight = weightAtStep(cfg, step, totalSteps);
  // variación de series sueltas: a veces una serie extra a menos reps (top set),
  // a veces una serie de menos con más reps (backoff)
  const variant = step % 3;
  const setsCount = variant === 1 ? cfg.sets + 1 : cfg.sets;
  const sets = [];
  for (let i = 0; i < setsCount; i++) {
    let reps = cfg.baseReps;
    let w = weight;
    if (variant === 1 && i === 0) {
      w = round125(weight + 2.5);
      reps = Math.max(3, cfg.baseReps - 3);
    } else if (variant === 2 && i === setsCount - 1) {
      w = round125(weight * 0.8);
      reps = cfg.baseReps + 3;
    } else {
      reps = cfg.baseReps + (i === setsCount - 1 ? 1 : 0);
    }
    sets.push({ weight_kg: w, reps });
  }
  return sets;
}

async function fetchCatalog(): Promise<{ type: WorkoutType; exercises: ExerciseInfo[] }[]> {
  const typesRes = await fetch(`${API_BASE}/workout-types`, { headers: { "X-Client-Id": CLIENT_ID } });
  const types = (await typesRes.json()) as WorkoutType[];
  const out: { type: WorkoutType; exercises: ExerciseInfo[] }[] = [];
  for (const type of types) {
    const exRes = await fetch(`${API_BASE}/workout-types/${type.id}/exercises`, { headers: { "X-Client-Id": CLIENT_ID } });
    const exercises = (await exRes.json()) as ExerciseInfo[];
    out.push({ type, exercises });
  }
  return out;
}

async function createSession(date: string, workoutTypeId: string, exercises: ExerciseInfo[], step: number, totalSteps: number) {
  const payload = {
    date,
    workout_type_id: workoutTypeId,
    exercises: exercises.map((info) => ({
      exercise_name: info.exercise_name,
      sets: buildSets(configFor(info.exercise_name), step, totalSteps),
    })),
  };
  // 'default' matcheá con el client_id que usan los clientes web/iOS de fábrica.
  const res = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /sessions falló (${res.status}): ${body}`);
  }
  return res.json() as Promise<{ id: number }>;
}

async function createBiometric(date: string, weight_kg: number, feeling: number) {
  const res = await fetch(`${API_BASE}/biometrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID },
    body: JSON.stringify({ date, weight_kg, feeling }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /biometrics falló (${res.status}): ${body}`);
  }
}

async function checkBackendUp() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error();
  } catch {
    console.error(`No se pudo conectar con el backend en ${API_BASE}.`);
    console.error("Arrancá el server primero (npm run dev) y volvé a correr este script.");
    process.exit(1);
  }
}

async function existingBiometricDates(): Promise<Set<string>> {
  const res = await fetch(`${API_BASE}/biometrics`, { headers: { "X-Client-Id": CLIENT_ID } });
  if (!res.ok) return new Set();
  const rows = (await res.json()) as { date: string }[];
  return new Set(rows.map((r) => r.date));
}

const SESSIONS_PER_TYPE = 6; // 7 tipos × 6 = 42 sesiones, ~2 por semana, cubre ~14 semanas
const GAP_DAYS = 2; // días entre sesiones consecutivas (rotando de tipo cada vez)

// Una única secuencia de fechas retrocediendo desde hoy, separadas GAP_DAYS
// entre sí, rotando el tipo de entreno en orden fijo — así cada tipo entrena
// aprox. una vez cada (cantidad de tipos × GAP_DAYS) días.
function buildRotatingSchedule(types: string[], sessionsPerType: number): { date: string; typeId: string; step: number }[] {
  const totalSessions = types.length * sessionsPerType;
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - (totalSessions - 1) * GAP_DAYS);
  const stepByType: Record<string, number> = {};
  const schedule: { date: string; typeId: string; step: number }[] = [];
  for (let i = 0; i < totalSessions; i++) {
    const typeId = types[i % types.length];
    const step = stepByType[typeId] ?? 0;
    schedule.push({ date: toISODate(cursor), typeId, step });
    stepByType[typeId] = step + 1;
    cursor.setDate(cursor.getDate() + GAP_DAYS);
  }
  return schedule;
}

async function seed() {
  await checkBackendUp();

  console.log("Leyendo catálogo de tipos de entreno y ejercicios...");
  const catalog = await fetchCatalog();
  const exercisesByType = new Map(catalog.map((c) => [c.type.id, c.exercises]));
  const typeIds = catalog.map((c) => c.type.id);
  const allExerciseNames = new Set<string>();
  for (const c of catalog) for (const e of c.exercises) allExerciseNames.add(e.exercise_name);

  const schedule = buildRotatingSchedule(typeIds, SESSIONS_PER_TYPE);

  const manifest = loadManifest();
  console.log(`Insertando ${schedule.length} sesiones (${typeIds.length} tipos × ${SESSIONS_PER_TYPE}) cubriendo ${allExerciseNames.size} ejercicios distintos...`);
  for (const { date, typeId, step } of schedule) {
    const exercises = exercisesByType.get(typeId) ?? [];
    const result = await createSession(date, typeId, exercises, step, SESSIONS_PER_TYPE);
    manifest.sessionIds.push(result.id);
  }

  console.log("Insertando biometrics (peso corporal)...");
  const already = await existingBiometricDates();
  // un registro de biometrics cada 2 sesiones a lo largo de todo el período
  const bioDates = schedule.filter((_, i) => i % 2 === 0).map((s) => s.date);
  const startWeight = 83.5;
  const endWeight = 80.5;
  let skipped = 0;
  for (let i = 0; i < bioDates.length; i++) {
    const date = bioDates[i];
    if (already.has(date)) {
      skipped++;
      continue;
    }
    const progress = bioDates.length <= 1 ? 1 : i / (bioDates.length - 1);
    const weight = Math.round((startWeight + (endWeight - startWeight) * progress + Math.sin(i) * 0.3) * 10) / 10;
    const feeling = 3 + (i % 3 === 0 ? 1 : 0) - (i % 5 === 0 ? 1 : 0);
    await createBiometric(date, weight, Math.min(5, Math.max(1, feeling)));
    manifest.biometricDates.push(date);
  }
  if (skipped > 0) {
    console.log(`  (${skipped} fecha(s) ya tenían un check-in real y no se tocaron)`);
  }

  manifest.exerciseNames = [...new Set([...manifest.exerciseNames, ...allExerciseNames])];
  saveManifest(manifest);

  console.log("\n✓ Listo. Se insertaron datos de PRUEBA:");
  console.log(`  - ${manifest.sessionIds.length} sesiones en total, en los ${typeIds.length} tipos de entreno`);
  console.log(`  - ${allExerciseNames.size} ejercicios distintos con historial (todo el catálogo)`);
  console.log(`  - ${manifest.biometricDates.length} registros de peso corporal`);
  console.log("\nEstos son datos ficticios, no reales. Para borrarlos:");
  console.log("  npm run seed:demo -- --clear");
  console.log(`(el detalle de qué se insertó queda en ${path.relative(process.cwd(), MANIFEST_PATH)})`);
}

async function clear() {
  const manifest = loadManifest();
  if (manifest.sessionIds.length === 0 && manifest.biometricDates.length === 0) {
    console.log("No hay manifest de datos de prueba (nada para borrar, o ya se borraron).");
    return;
  }

  // Import directo a la db para poder borrar en bulk y recalcular PRs.
  const { withTransaction, pool } = await import("./db.js");

  let affectedCount = 0;
  await withTransaction(async (tx) => {
    // Nombres de ejercicio afectados por las sesiones que vamos a borrar —
    // capturado ANTES de borrar para poder recalcular sus PRs después. Si el
    // manifest es de una corrida vieja (sin exerciseNames), cae a la lista
    // guardada tal cual (compatibilidad hacia atrás).
    const placeholders = manifest.sessionIds.map(() => "?").join(",");
    const touchedFromSessions =
      manifest.sessionIds.length > 0
        ? await tx.all<{ exercise_name: string }>(
            `SELECT DISTINCT exercise_name FROM session_exercises WHERE session_id IN (${placeholders})`,
            manifest.sessionIds
          )
        : [];
    const affectedExercises = [...new Set([...touchedFromSessions.map((r) => r.exercise_name), ...(manifest.exerciseNames ?? [])])];
    affectedCount = affectedExercises.length;

    for (const id of manifest.sessionIds) {
      await tx.run(`DELETE FROM sessions WHERE id = ? AND client_id = ?`, [id, CLIENT_ID]);
    }

    for (const date of manifest.biometricDates) {
      await tx.run(`DELETE FROM biometrics WHERE date = ? AND client_id = ?`, [date, CLIENT_ID]);
    }

    // Recalcular personal_records para los ejercicios tocados, en base a lo que
    // quede realmente en session_exercises (para no dejar PRs fantasma de la demo).
    for (const name of affectedExercises) {
      await tx.run(`DELETE FROM personal_records WHERE client_id = ? AND exercise_name = ?`, [CLIENT_ID, name]);
      const rows = await tx.all<{ date: string; weight_kg: number; reps: number }>(
        `SELECT s.date, se.weight_kg, se.reps FROM session_exercises se JOIN sessions s ON s.id = se.session_id WHERE s.client_id = ? AND se.exercise_name = ?`,
        [CLIENT_ID, name]
      );
      if (rows.length === 0) continue;

      let bestWeight = { weight_kg: -1, date: "" };
      const volumeBySession = new Map<string, number>();
      for (const r of rows) {
        if (r.weight_kg > bestWeight.weight_kg) bestWeight = { weight_kg: r.weight_kg, date: r.date };
        volumeBySession.set(r.date, (volumeBySession.get(r.date) ?? 0) + r.weight_kg * r.reps);
      }
      let bestVolume = { volume: -1, date: "" };
      for (const [date, volume] of volumeBySession) {
        if (volume > bestVolume.volume) bestVolume = { volume, date };
      }
      await tx.run(
        `INSERT INTO personal_records (client_id, exercise_name, best_weight_kg, best_weight_date, best_volume, best_volume_date) VALUES (?, ?, ?, ?, ?, ?)`,
        [CLIENT_ID, name, bestWeight.weight_kg, bestWeight.date, bestVolume.volume, bestVolume.date]
      );
    }
  });

  console.log(`✓ Borradas ${manifest.sessionIds.length} sesiones y ${manifest.biometricDates.length} registros de biometrics de prueba.`);
  console.log(`  Personal records recalculados para ${affectedCount} ejercicios en base a los datos reales restantes.`);
  await pool.end();

  fs.rmSync(MANIFEST_PATH, { force: true });
}

const args = process.argv.slice(2);
if (args.includes("--clear")) {
  clear().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
