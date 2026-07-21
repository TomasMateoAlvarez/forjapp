import { Router } from "express";
import { z } from "zod";
import { db, withTransaction, type DbApi } from "../db.js";
import { resolveEffectiveClientId } from "../auth/coachAccess.js";
import { averageIntensityPct } from "../lib/intensity.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const sessionsRouter = Router();

const setEntrySchema = z.object({
  weight_kg: z.number().nonnegative(),
  reps: z.number().int().positive(),
  is_warmup: z.boolean().optional().default(false),
  // RIR (reps in reserve) opcional por serie: 0 = falla técnica, cuanto más
  // alto más lejos del fallo. Alimenta la sugerencia de progresión (Fase 7).
  rir: z.number().int().min(0).max(10).optional(),
});

const exerciseEntrySchema = z.object({
  exercise_name: z.string().min(1),
  sets: z.array(setEntrySchema).min(1),
});

export const sessionSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha esperado: YYYY-MM-DD"),
    workout_type_id: z.string().min(1).optional(),
    custom_routine_id: z.number().int().positive().optional(),
    exercises: z.array(exerciseEntrySchema).min(1),
    // RPE (esfuerzo percibido) de la SESIÓN completa, 1-10 — distinto del RIR
    // por serie de arriba. Opcional, se pide al cerrar la sesión en Today.tsx.
    rpe: z.number().int().min(1).max(10).optional(),
    // Capturados automáticamente por el cliente al abrir/cerrar la sesión en
    // Today.tsx — habilitan Índice/Coeficiente de Hipertrofia (Fase 9).
    started_at: z.string().datetime().optional(),
    ended_at: z.string().datetime().optional(),
  })
  .refine((d) => d.workout_type_id || d.custom_routine_id, {
    message: "Debe incluir workout_type_id o custom_routine_id",
  });

async function computeSessionSummary(
  clientId: string,
  sessionId: string | number,
  startedAt: string | null,
  endedAt: string | null
) {
  const sets = await db.all<{ exercise_name: string; weight_kg: number; reps: number }>(
    `SELECT exercise_name, weight_kg, reps FROM session_exercises WHERE session_id = ? AND is_warmup = 0`,
    [sessionId]
  );

  if (sets.length === 0) {
    return {
      tonelaje_total: 0,
      peso_medio: null as number | null,
      intensidad_promedio_pct: null as number | null,
      indice_hipertrofia: null as number | null,
      coeficiente_hipertrofia: null as number | null,
    };
  }

  const tonelaje_total = sets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0);
  const totalReps = sets.reduce((sum, s) => sum + s.reps, 0);
  const peso_medio = totalReps > 0 ? tonelaje_total / totalReps : null;
  const intensidad_promedio_pct = await averageIntensityPct(clientId, sets);

  // Índice de Hipertrofia (Peter Sisco) = Tonelaje / Tiempo (minutos).
  // Coeficiente de Hipertrofia = Tonelaje² / Tiempo. Solo si el cliente
  // mandó ambos timestamps (Today.tsx los captura automáticamente).
  let indice_hipertrofia: number | null = null;
  let coeficiente_hipertrofia: number | null = null;
  if (startedAt && endedAt) {
    const durationMin = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000;
    if (durationMin > 0) {
      indice_hipertrofia = tonelaje_total / durationMin;
      coeficiente_hipertrofia = (tonelaje_total * tonelaje_total) / durationMin;
    }
  }

  return { tonelaje_total, peso_medio, intensidad_promedio_pct, indice_hipertrofia, coeficiente_hipertrofia };
}

async function upsertPersonalRecord(
  tx: DbApi,
  clientId: string,
  exerciseName: string,
  date: string,
  candidateWeight: number,
  candidateVolume: number,
  newRecords: { exercise_name: string; type: string }[]
) {
  const existing = await tx.get<{ best_weight_kg: number; best_volume: number }>(
    `SELECT best_weight_kg, best_volume FROM personal_records WHERE client_id = ? AND exercise_name = ?`,
    [clientId, exerciseName]
  );

  if (!existing) {
    await tx.run(
      `INSERT INTO personal_records (client_id, exercise_name, best_weight_kg, best_weight_date, best_volume, best_volume_date) VALUES (?, ?, ?, ?, ?, ?)`,
      [clientId, exerciseName, candidateWeight, date, candidateVolume, date]
    );
    newRecords.push({ exercise_name: exerciseName, type: "weight" });
    newRecords.push({ exercise_name: exerciseName, type: "volume" });
    return;
  }

  if (candidateWeight > existing.best_weight_kg) {
    await tx.run(`UPDATE personal_records SET best_weight_kg = ?, best_weight_date = ? WHERE client_id = ? AND exercise_name = ?`, [
      candidateWeight,
      date,
      clientId,
      exerciseName,
    ]);
    newRecords.push({ exercise_name: exerciseName, type: "weight" });
  }
  if (candidateVolume > existing.best_volume) {
    await tx.run(`UPDATE personal_records SET best_volume = ?, best_volume_date = ? WHERE client_id = ? AND exercise_name = ?`, [
      candidateVolume,
      date,
      clientId,
      exerciseName,
    ]);
    newRecords.push({ exercise_name: exerciseName, type: "volume" });
  }
}

// POST /api/sessions
sessionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const clientId = req.clientId;
    const { date, workout_type_id, custom_routine_id, exercises, rpe, started_at, ended_at } = parsed.data;

    if (workout_type_id) {
      const typeExists = await db.get(`SELECT id FROM workout_types WHERE id = ?`, [workout_type_id]);
      if (!typeExists) return res.status(404).json({ error: "Tipo de entreno no encontrado" });
    }
    if (custom_routine_id) {
      const routineExists = await db.get(`SELECT id FROM custom_routines WHERE id = ? AND client_id = ?`, [custom_routine_id, clientId]);
      if (!routineExists) return res.status(404).json({ error: "Rutina no encontrada" });
    }

    const newRecords: { exercise_name: string; type: string }[] = [];

    const sessionId = await withTransaction(async (tx) => {
      const inserted = await tx.get<{ id: number }>(
        `INSERT INTO sessions (client_id, date, workout_type_id, custom_routine_id, rpe, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [clientId, date, workout_type_id ?? null, custom_routine_id ?? null, rpe ?? null, started_at ?? null, ended_at ?? null]
      );
      const newSessionId = inserted!.id;

      for (const ex of exercises) {
        let setNumber = 1;
        for (const set of ex.sets) {
          await tx.run(
            `INSERT INTO session_exercises (session_id, exercise_name, weight_kg, reps, set_number, is_warmup, rir) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [newSessionId, ex.exercise_name, set.weight_kg, set.reps, setNumber, set.is_warmup ? 1 : 0, set.rir ?? null]
          );
          setNumber++;
        }

        // Los PRs se calculan solo sobre series de trabajo: el calentamiento no cuenta.
        const workingSets = ex.sets.filter((s) => !s.is_warmup);
        if (workingSets.length === 0) continue;

        const candidateWeight = Math.max(...workingSets.map((s) => s.weight_kg));
        const candidateVolume = workingSets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0);
        await upsertPersonalRecord(tx, clientId, ex.exercise_name, date, candidateWeight, candidateVolume, newRecords);
      }

      return newSessionId;
    });

    res.status(201).json({ id: sessionId, date, workout_type_id, custom_routine_id, new_records: newRecords });
  })
);

// GET /api/sessions
sessionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const from = (req.query.from as string) ?? "0000-01-01";
    const to = (req.query.to as string) ?? "9999-12-31";
    const sessions = await db.all(
      `SELECT s.id, s.date, s.workout_type_id, s.custom_routine_id, s.rpe,
              COALESCE(wt.label, cr.name) as workout_label
       FROM sessions s
       LEFT JOIN workout_types wt ON wt.id = s.workout_type_id
       LEFT JOIN custom_routines cr ON cr.id = s.custom_routine_id
       WHERE s.client_id = ? AND s.date BETWEEN ? AND ? ORDER BY s.date DESC`,
      [await resolveEffectiveClientId(req), from, to]
    );
    res.json(sessions);
  })
);

// GET /api/sessions/:id -> incluye resumen de indicadores (tonelaje, peso
// medio, intensidad promedio) calculado sobre las series de trabajo.
sessionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const clientId = await resolveEffectiveClientId(req);
    const session = await db.get<{ started_at: string | null; ended_at: string | null }>(
      `SELECT s.id, s.date, s.workout_type_id, s.custom_routine_id, s.rpe, s.started_at, s.ended_at,
              COALESCE(wt.label, cr.name) as workout_label
       FROM sessions s
       LEFT JOIN workout_types wt ON wt.id = s.workout_type_id
       LEFT JOIN custom_routines cr ON cr.id = s.custom_routine_id
       WHERE s.id = ? AND s.client_id = ?`,
      [req.params.id, clientId]
    );
    if (!session) return res.status(404).json({ error: "Sesión no encontrada" });
    const exercises = await db.all(
      `SELECT exercise_name, weight_kg, reps, set_number FROM session_exercises WHERE session_id = ? ORDER BY exercise_name, set_number`,
      [req.params.id]
    );
    const summary = await computeSessionSummary(clientId, req.params.id, session.started_at, session.ended_at);
    res.json({ ...session, ...summary, exercises });
  })
);
