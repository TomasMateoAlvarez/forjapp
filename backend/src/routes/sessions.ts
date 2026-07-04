import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";

export const sessionsRouter = Router();

const setEntrySchema = z.object({
  weight_kg: z.number().nonnegative(),
  reps: z.number().int().positive(),
  is_warmup: z.boolean().optional().default(false),
});

const exerciseEntrySchema = z.object({
  exercise_name: z.string().min(1),
  sets: z.array(setEntrySchema).min(1),
});

const sessionSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha esperado: YYYY-MM-DD"),
    workout_type_id: z.string().min(1).optional(),
    custom_routine_id: z.number().int().positive().optional(),
    exercises: z.array(exerciseEntrySchema).min(1),
  })
  .refine((d) => d.workout_type_id || d.custom_routine_id, {
    message: "Debe incluir workout_type_id o custom_routine_id",
  });

const getPR = db.prepare(`SELECT best_weight_kg, best_volume FROM personal_records WHERE client_id = ? AND exercise_name = ?`);
const insertPR = db.prepare(`INSERT INTO personal_records (client_id, exercise_name, best_weight_kg, best_weight_date, best_volume, best_volume_date) VALUES (?, ?, ?, ?, ?, ?)`);
const updateWeightPR = db.prepare(`UPDATE personal_records SET best_weight_kg = ?, best_weight_date = ? WHERE client_id = ? AND exercise_name = ?`);
const updateVolumePR = db.prepare(`UPDATE personal_records SET best_volume = ?, best_volume_date = ? WHERE client_id = ? AND exercise_name = ?`);

// POST /api/sessions
sessionsRouter.post("/", (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const clientId = req.clientId;
  const { date, workout_type_id, custom_routine_id, exercises } = parsed.data;

  if (workout_type_id) {
    const typeExists = db.prepare(`SELECT id FROM workout_types WHERE id = ?`).get(workout_type_id);
    if (!typeExists) return res.status(404).json({ error: "Tipo de entreno no encontrado" });
  }
  if (custom_routine_id) {
    const routineExists = db.prepare(`SELECT id FROM custom_routines WHERE id = ? AND client_id = ?`).get(custom_routine_id, clientId);
    if (!routineExists) return res.status(404).json({ error: "Rutina no encontrada" });
  }

  const insertSession = db.prepare(
    `INSERT INTO sessions (client_id, date, workout_type_id, custom_routine_id) VALUES (?, ?, ?, ?)`
  );
  const insertSet = db.prepare(
    `INSERT INTO session_exercises (session_id, exercise_name, weight_kg, reps, set_number, is_warmup) VALUES (?, ?, ?, ?, ?, ?)`
  );

  db.exec("BEGIN");
  let sessionId: number | bigint;
  const newRecords: { exercise_name: string; type: string }[] = [];

  try {
    const result = insertSession.run(clientId, date, workout_type_id ?? null, custom_routine_id ?? null);
    sessionId = result.lastInsertRowid;

    for (const ex of exercises) {
      ex.sets.forEach((set, i) => {
        insertSet.run(sessionId, ex.exercise_name, set.weight_kg, set.reps, i + 1, set.is_warmup ? 1 : 0);
      });

      // Los PRs se calculan solo sobre series de trabajo: el calentamiento no cuenta.
      const workingSets = ex.sets.filter((s) => !s.is_warmup);
      if (workingSets.length === 0) continue;

      const candidateWeight = Math.max(...workingSets.map((s) => s.weight_kg));
      const candidateVolume = workingSets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0);
      const existing = getPR.get(clientId, ex.exercise_name) as { best_weight_kg: number; best_volume: number } | undefined;

      if (!existing) {
        insertPR.run(clientId, ex.exercise_name, candidateWeight, date, candidateVolume, date);
        newRecords.push({ exercise_name: ex.exercise_name, type: "weight" });
        newRecords.push({ exercise_name: ex.exercise_name, type: "volume" });
      } else {
        if (candidateWeight > existing.best_weight_kg) {
          updateWeightPR.run(candidateWeight, date, clientId, ex.exercise_name);
          newRecords.push({ exercise_name: ex.exercise_name, type: "weight" });
        }
        if (candidateVolume > existing.best_volume) {
          updateVolumePR.run(candidateVolume, date, clientId, ex.exercise_name);
          newRecords.push({ exercise_name: ex.exercise_name, type: "volume" });
        }
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  res.status(201).json({ id: sessionId, date, workout_type_id, custom_routine_id, new_records: newRecords });
});

// GET /api/sessions
sessionsRouter.get("/", (req, res) => {
  const from = (req.query.from as string) ?? "0000-01-01";
  const to = (req.query.to as string) ?? "9999-12-31";
  const sessions = db
    .prepare(
      `SELECT s.id, s.date, s.workout_type_id, s.custom_routine_id,
              COALESCE(wt.label, cr.name) as workout_label
       FROM sessions s
       LEFT JOIN workout_types wt ON wt.id = s.workout_type_id
       LEFT JOIN custom_routines cr ON cr.id = s.custom_routine_id
       WHERE s.client_id = ? AND s.date BETWEEN ? AND ? ORDER BY s.date DESC`
    )
    .all(req.clientId, from, to);
  res.json(sessions);
});

// GET /api/sessions/:id
sessionsRouter.get("/:id", (req, res) => {
  const session = db
    .prepare(
      `SELECT s.id, s.date, s.workout_type_id, s.custom_routine_id,
              COALESCE(wt.label, cr.name) as workout_label
       FROM sessions s
       LEFT JOIN workout_types wt ON wt.id = s.workout_type_id
       LEFT JOIN custom_routines cr ON cr.id = s.custom_routine_id
       WHERE s.id = ? AND s.client_id = ?`
    )
    .get(req.params.id, req.clientId);
  if (!session) return res.status(404).json({ error: "Sesión no encontrada" });
  const exercises = db
    .prepare(`SELECT exercise_name, weight_kg, reps, set_number FROM session_exercises WHERE session_id = ? ORDER BY exercise_name, set_number`)
    .all(req.params.id);
  res.json({ ...session, exercises });
});
