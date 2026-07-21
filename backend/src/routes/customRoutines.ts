import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const customRoutinesRouter = Router();

export const createRoutineSchema = z.object({
  name: z.string().min(1),
  exercises: z.array(z.string().min(1)).min(1),
});

// GET /api/custom-routines
customRoutinesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await db.all(`SELECT id, name, created_at FROM custom_routines WHERE client_id = ? ORDER BY created_at DESC`, [req.clientId]);
    res.json(rows);
  })
);

// POST /api/custom-routines  { name, exercises: string[] }
customRoutinesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createRoutineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { name, exercises } = parsed.data;
    const rid = await withTransaction(async (tx) => {
      const inserted = await tx.get<{ id: number }>(`INSERT INTO custom_routines (client_id, name) VALUES (?, ?) RETURNING id`, [
        req.clientId,
        name,
      ]);
      const routineId = inserted!.id;
      for (let i = 0; i < exercises.length; i++) {
        await tx.run(`INSERT INTO custom_routine_exercises (routine_id, exercise_name, default_order) VALUES (?, ?, ?)`, [
          routineId,
          exercises[i],
          i,
        ]);
      }
      return routineId;
    });
    res.status(201).json({ id: rid, name });
  })
);

// GET /api/custom-routines/:id/exercises
customRoutinesRouter.get(
  "/:id/exercises",
  asyncHandler(async (req, res) => {
    const routine = await db.get(`SELECT id FROM custom_routines WHERE id = ? AND client_id = ?`, [req.params.id, req.clientId]);
    if (!routine) return res.status(404).json({ error: "Rutina no encontrada" });
    const exercises = await db.all<{ exercise_name: string; target_sets: number | null; target_reps: string | null }>(
      `SELECT exercise_name, target_sets, target_reps FROM custom_routine_exercises WHERE routine_id = ? ORDER BY default_order`,
      [req.params.id]
    );
    res.json(
      exercises.map((e) => ({
        exercise_name: e.exercise_name,
        default_rest_seconds: 90,
        target_sets: e.target_sets ?? null,
        target_reps: e.target_reps ?? null,
      }))
    );
  })
);

// DELETE /api/custom-routines/:id
customRoutinesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await db.run(`DELETE FROM custom_routines WHERE id = ? AND client_id = ?`, [req.params.id, req.clientId]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Rutina no encontrada" });
    res.json({ ok: true });
  })
);

// POST /api/custom-routines/:id/exercises  { exercise_name, target_sets?, target_reps? }
customRoutinesRouter.post(
  "/:id/exercises",
  asyncHandler(async (req, res) => {
    const { exercise_name, target_sets, target_reps } = req.body as { exercise_name?: string; target_sets?: number; target_reps?: string };
    if (!exercise_name?.trim()) return res.status(400).json({ error: "Falta exercise_name" });
    const routine = await db.get(`SELECT id FROM custom_routines WHERE id = ? AND client_id = ?`, [req.params.id, req.clientId]);
    if (!routine) return res.status(404).json({ error: "Rutina no encontrada" });
    const row = await db.get<{ next: number }>(`SELECT COALESCE(MAX(default_order), -1) + 1 AS next FROM custom_routine_exercises WHERE routine_id = ?`, [
      req.params.id,
    ]);
    await db.run(
      `INSERT INTO custom_routine_exercises (routine_id, exercise_name, default_order, target_sets, target_reps) VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, exercise_name.trim(), row!.next, target_sets ?? null, target_reps?.trim() ?? null]
    );
    res.status(201).json({ ok: true });
  })
);

// PATCH /api/custom-routines/:id/exercises/:exerciseName -> edita target_sets/target_reps
customRoutinesRouter.patch(
  "/:id/exercises/:exerciseName",
  asyncHandler(async (req, res) => {
    const routine = await db.get(`SELECT id FROM custom_routines WHERE id = ? AND client_id = ?`, [req.params.id, req.clientId]);
    if (!routine) return res.status(404).json({ error: "Rutina no encontrada" });
    const { target_sets, target_reps } = req.body as { target_sets?: number | null; target_reps?: string | null };
    const result = await db.run(`UPDATE custom_routine_exercises SET target_sets = ?, target_reps = ? WHERE routine_id = ? AND exercise_name = ?`, [
      target_sets ?? null,
      target_reps ?? null,
      req.params.id,
      req.params.exerciseName,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Ejercicio no encontrado" });
    res.json({ ok: true });
  })
);

// DELETE /api/custom-routines/:id/exercises/:exerciseName
customRoutinesRouter.delete(
  "/:id/exercises/:exerciseName",
  asyncHandler(async (req, res) => {
    const routine = await db.get(`SELECT id FROM custom_routines WHERE id = ? AND client_id = ?`, [req.params.id, req.clientId]);
    if (!routine) return res.status(404).json({ error: "Rutina no encontrada" });
    const result = await db.run(`DELETE FROM custom_routine_exercises WHERE routine_id = ? AND exercise_name = ?`, [
      req.params.id,
      req.params.exerciseName,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Ejercicio no encontrado" });
    res.json({ ok: true });
  })
);
