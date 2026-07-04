// Datos de prueba (historial de sesiones + biometrics) para poder ver los
// gráficos de progreso con algo cargado. NO se ejecuta al levantar el server:
// correr a mano con `npm run seed:demo` (requiere el backend corriendo en
// localhost:4000). Para borrar lo insertado: `npm run seed:demo -- --clear`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const API_BASE = "http://localhost:4000/api";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "..", "seed-demo-data.manifest.json");

type Manifest = { sessionIds: number[]; biometricDates: string[] };

function loadManifest(): Manifest {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return { sessionIds: [], biometricDates: [] };
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

// --- Generación de fechas: una única secuencia alternada (Pecho, Piernas,
// Pecho, Piernas...) separada 3-4 días entre sesiones consecutivas, cubriendo
// ~9 semanas hasta hoy. Cada tipo entrena aprox. una vez cada 7 días.
function buildAlternatingDates(totalSessions: number): string[] {
  const dates: Date[] = [];
  const gaps = [3, 4];
  let cursor = new Date();
  // retrocedemos la suma de todos los gaps que van a aplicarse (totalSessions - 1 gaps)
  let daysBack = 0;
  for (let i = 0; i < totalSessions - 1; i++) daysBack += gaps[i % 2];
  cursor.setDate(cursor.getDate() - daysBack);
  for (let i = 0; i < totalSessions; i++) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + gaps[i % 2]);
  }
  return dates.map(toISODate);
}

type ExerciseConfig = {
  name: string;
  startWeight: number;
  endWeight: number;
  baseReps: number;
  sets: number;
};

type TypeConfig = {
  workoutTypeId: string;
  exercises: ExerciseConfig[];
};

const PECHO: TypeConfig = {
  workoutTypeId: "pecho",
  exercises: [
    { name: "Press banca", startWeight: 55, endWeight: 72.5, baseReps: 8, sets: 4 },
    { name: "Press inclinado con mancuernas", startWeight: 20, endWeight: 26, baseReps: 9, sets: 3 },
    { name: "Aperturas con mancuernas", startWeight: 12, endWeight: 16, baseReps: 11, sets: 3 },
    { name: "Fondos en paralelas", startWeight: 0, endWeight: 7.5, baseReps: 9, sets: 3 },
  ],
};

const PIERNAS: TypeConfig = {
  workoutTypeId: "piernas",
  exercises: [
    { name: "Sentadilla", startWeight: 70, endWeight: 92.5, baseReps: 7, sets: 4 },
    { name: "Prensa de piernas", startWeight: 120, endWeight: 150, baseReps: 10, sets: 3 },
    { name: "Peso muerto rumano", startWeight: 60, endWeight: 75, baseReps: 8, sets: 3 },
    { name: "Extensión de cuádriceps", startWeight: 35, endWeight: 45, baseReps: 11, sets: 3 },
  ],
};

const SESSIONS_PER_TYPE = 9;

function weightAtStep(cfg: ExerciseConfig, step: number, totalSteps: number): number {
  const progress = step / (totalSteps - 1);
  const linear = cfg.startWeight + (cfg.endWeight - cfg.startWeight) * progress;
  // pequeño "deload" cada 5ta sesión para que la curva no sea perfectamente recta
  const deload = step > 0 && step % 5 === 0 ? 0.93 : 1;
  const noise = (Math.sin(step * 1.7 + cfg.startWeight) * 0.5); // +-0.5kg de ruido determinístico
  return Math.max(0, round125(linear * deload + noise));
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
      // top set: un poco más de peso, menos reps
      w = round125(weight + 2.5);
      reps = Math.max(3, cfg.baseReps - 3);
    } else if (variant === 2 && i === setsCount - 1) {
      // backoff set: bastante menos peso, más reps
      w = round125(weight * 0.8);
      reps = cfg.baseReps + 3;
    } else {
      reps = cfg.baseReps + (i === setsCount - 1 ? 1 : 0);
    }
    sets.push({ weight_kg: w, reps });
  }
  return sets;
}

async function createSession(date: string, workoutTypeId: string, exercises: TypeConfig["exercises"], step: number) {
  const payload = {
    date,
    workout_type_id: workoutTypeId,
    exercises: exercises.map((cfg) => ({
      exercise_name: cfg.name,
      sets: buildSets(cfg, step, SESSIONS_PER_TYPE),
    })),
  };
  // 'default' matcheá con el client_id que usan los clientes web/iOS de fábrica.
  const res = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": "default" },
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
    headers: { "Content-Type": "application/json", "X-Client-Id": "default" },
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
  const res = await fetch(`${API_BASE}/biometrics`, { headers: { "X-Client-Id": "default" } });
  if (!res.ok) return new Set();
  const rows = (await res.json()) as { date: string }[];
  return new Set(rows.map((r) => r.date));
}

async function seed() {
  await checkBackendUp();

  const totalSessions = SESSIONS_PER_TYPE * 2;
  const allDates = buildAlternatingDates(totalSessions); // alterna Pecho, Piernas, Pecho...
  const pechoDates = allDates.filter((_, i) => i % 2 === 0);
  const piernasDates = allDates.filter((_, i) => i % 2 === 1);

  const manifest = loadManifest();
  console.log(`Insertando ${SESSIONS_PER_TYPE} sesiones de Pecho...`);
  for (let i = 0; i < pechoDates.length; i++) {
    const result = await createSession(pechoDates[i], PECHO.workoutTypeId, PECHO.exercises, i);
    manifest.sessionIds.push(result.id);
  }

  console.log(`Insertando ${SESSIONS_PER_TYPE} sesiones de Piernas...`);
  for (let i = 0; i < piernasDates.length; i++) {
    const result = await createSession(piernasDates[i], PIERNAS.workoutTypeId, PIERNAS.exercises, i);
    manifest.sessionIds.push(result.id);
  }

  console.log("Insertando biometrics (peso corporal)...");
  const already = await existingBiometricDates();
  // un registro de biometrics cada ~2 sesiones (9-10 puntos a lo largo de las ~9 semanas)
  const bioDates = allDates.filter((_, i) => i % 2 === 0);
  const startWeight = 83.5;
  const endWeight = 80.5;
  let skipped = 0;
  for (let i = 0; i < bioDates.length; i++) {
    const date = bioDates[i];
    if (already.has(date)) {
      // no pisamos un check-in real que ya exista en esa fecha
      skipped++;
      continue;
    }
    const progress = i / (bioDates.length - 1);
    const weight = Math.round((startWeight + (endWeight - startWeight) * progress + Math.sin(i) * 0.3) * 10) / 10;
    const feeling = 3 + (i % 3 === 0 ? 1 : 0) - (i % 5 === 0 ? 1 : 0);
    await createBiometric(date, weight, Math.min(5, Math.max(1, feeling)));
    manifest.biometricDates.push(date);
  }
  if (skipped > 0) {
    console.log(`  (${skipped} fecha(s) ya tenían un check-in real y no se tocaron)`);
  }

  saveManifest(manifest);

  console.log("\n✓ Listo. Se insertaron datos de PRUEBA:");
  console.log(`  - ${manifest.sessionIds.length} sesiones (Pecho + Piernas) en las últimas ~9 semanas`);
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
  const { db } = await import("./db.js");

  const CLIENT_ID = "default"; // este script siempre opera sobre el tenant 'default'

  db.exec("BEGIN");
  try {
    const deleteSession = db.prepare(`DELETE FROM sessions WHERE id = ? AND client_id = ?`);
    for (const id of manifest.sessionIds) deleteSession.run(id, CLIENT_ID);

    const deleteBiometric = db.prepare(`DELETE FROM biometrics WHERE date = ? AND client_id = ?`);
    for (const date of manifest.biometricDates) deleteBiometric.run(date, CLIENT_ID);

    // Recalcular personal_records para los ejercicios tocados, en base a lo que
    // quede realmente en session_exercises (para no dejar PRs fantasma de la demo).
    const affectedExercises = [...PECHO.exercises, ...PIERNAS.exercises].map((e) => e.name);
    const deletePR = db.prepare(`DELETE FROM personal_records WHERE client_id = ? AND exercise_name = ?`);
    const insertPR = db.prepare(
      `INSERT INTO personal_records (client_id, exercise_name, best_weight_kg, best_weight_date, best_volume, best_volume_date) VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const name of affectedExercises) {
      deletePR.run(CLIENT_ID, name);
      const rows = db
        .prepare(
          `SELECT s.date, se.weight_kg, se.reps FROM session_exercises se JOIN sessions s ON s.id = se.session_id WHERE s.client_id = ? AND se.exercise_name = ?`
        )
        .all(CLIENT_ID, name) as { date: string; weight_kg: number; reps: number }[];
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
      insertPR.run(CLIENT_ID, name, bestWeight.weight_kg, bestWeight.date, bestVolume.volume, bestVolume.date);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  console.log(`✓ Borradas ${manifest.sessionIds.length} sesiones y ${manifest.biometricDates.length} registros de biometrics de prueba.`);
  console.log("  Personal records recalculados en base a los datos reales restantes.");

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
