import { Router } from "express";
import { db } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const workoutTypesRouter = Router();

// GET /api/workout-types  -> lista de tipos (Pecho, Espalda, Push, Pull...)
workoutTypesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const types = await db.all(`SELECT id, label, muscle_group FROM workout_types ORDER BY label`);
    res.json(types);
  })
);

// GET /api/workout-types/:id/exercises -> set predeterminado de ese tipo
workoutTypesRouter.get(
  "/:id/exercises",
  asyncHandler(async (req, res) => {
    const type = await db.get(`SELECT id FROM workout_types WHERE id = ?`, [req.params.id]);
    if (!type) return res.status(404).json({ error: "Tipo de entreno no encontrado" });

    const exercises = await db.all<{ exercise_name: string; default_rest_seconds: number | null; target_sets: number | null; target_reps: string | null }>(
      `SELECT exercise_name, default_rest_seconds, target_sets, target_reps FROM workout_type_exercises WHERE workout_type_id = ? ORDER BY default_order`,
      [req.params.id]
    );

    res.json(
      exercises.map((e) => ({
        exercise_name: e.exercise_name,
        default_rest_seconds: e.default_rest_seconds ?? 90,
        target_sets: e.target_sets ?? null,
        target_reps: e.target_reps ?? null,
      }))
    );
  })
);

// POST /api/workout-types/:id/exercises -> agrega un ejercicio a esa rutina
workoutTypesRouter.post(
  "/:id/exercises",
  asyncHandler(async (req, res) => {
    const { exercise_name, target_sets, target_reps } = req.body as { exercise_name?: string; target_sets?: number; target_reps?: string };
    if (!exercise_name || typeof exercise_name !== "string" || !exercise_name.trim()) {
      return res.status(400).json({ error: "Falta exercise_name" });
    }

    const type = await db.get(`SELECT id FROM workout_types WHERE id = ?`, [req.params.id]);
    if (!type) return res.status(404).json({ error: "Tipo de entreno no encontrado" });

    const row = await db.get<{ next: number }>(`SELECT COALESCE(MAX(default_order), -1) + 1 AS next FROM workout_type_exercises WHERE workout_type_id = ?`, [
      req.params.id,
    ]);

    await db.run(`INSERT INTO workout_type_exercises (workout_type_id, exercise_name, default_order, target_sets, target_reps) VALUES (?, ?, ?, ?, ?)`, [
      req.params.id,
      exercise_name.trim(),
      row!.next,
      target_sets ?? null,
      target_reps?.trim() ?? null,
    ]);

    res.status(201).json({ ok: true });
  })
);

// PATCH /api/workout-types/:id/exercises/:exerciseName -> edita target_sets/target_reps
workoutTypesRouter.patch(
  "/:id/exercises/:exerciseName",
  asyncHandler(async (req, res) => {
    const type = await db.get(`SELECT id FROM workout_types WHERE id = ?`, [req.params.id]);
    if (!type) return res.status(404).json({ error: "Tipo de entreno no encontrado" });

    const { target_sets, target_reps } = req.body as { target_sets?: number | null; target_reps?: string | null };
    const result = await db.run(`UPDATE workout_type_exercises SET target_sets = ?, target_reps = ? WHERE workout_type_id = ? AND exercise_name = ?`, [
      target_sets ?? null,
      target_reps ?? null,
      req.params.id,
      req.params.exerciseName,
    ]);

    if (result.rowCount === 0) return res.status(404).json({ error: "Ejercicio no encontrado" });
    res.json({ ok: true });
  })
);

// DELETE /api/workout-types/:id/exercises/:exerciseName -> quita ese ejercicio de la rutina
workoutTypesRouter.delete(
  "/:id/exercises/:exerciseName",
  asyncHandler(async (req, res) => {
    const type = await db.get(`SELECT id FROM workout_types WHERE id = ?`, [req.params.id]);
    if (!type) return res.status(404).json({ error: "Tipo de entreno no encontrado" });

    const result = await db.run(`DELETE FROM workout_type_exercises WHERE workout_type_id = ? AND exercise_name = ?`, [
      req.params.id,
      req.params.exerciseName,
    ]);

    if (result.rowCount === 0) return res.status(404).json({ error: "Ejercicio no encontrado" });

    res.json({ ok: true });
  })
);
