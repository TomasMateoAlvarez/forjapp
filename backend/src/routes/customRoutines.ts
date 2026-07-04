import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";

export const customRoutinesRouter = Router();

// GET /api/custom-routines
customRoutinesRouter.get("/", (req, res) => {
  const rows = db.prepare(`SELECT id, name, created_at FROM custom_routines WHERE client_id = ? ORDER BY created_at DESC`).all(req.clientId);
  res.json(rows);
});

// POST /api/custom-routines  { name, exercises: string[] }
customRoutinesRouter.post("/", (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    exercises: z.array(z.string().min(1)).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, exercises } = parsed.data;
  db.exec("BEGIN");
  try {
    const r = db.prepare(`INSERT INTO custom_routines (client_id, name) VALUES (?, ?)`).run(req.clientId, name);
    const rid = r.lastInsertRowid;
    const insertEx = db.prepare(`INSERT INTO custom_routine_exercises (routine_id, exercise_name, default_order) VALUES (?, ?, ?)`);
    exercises.forEach((ex, i) => insertEx.run(rid, ex, i));
    db.exec("COMMIT");
    res.status(201).json({ id: rid, name });
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
});

// GET /api/custom-routines/:id/exercises
customRoutinesRouter.get("/:id/exercises", (req, res) => {
  const routine = db.prepare(`SELECT id FROM custom_routines WHERE id = ? AND client_id = ?`).get(req.params.id, req.clientId);
  if (!routine) return res.status(404).json({ error: "Rutina no encontrada" });
  const exercises = db
    .prepare(`SELECT exercise_name, target_sets, target_reps FROM custom_routine_exercises WHERE routine_id = ? ORDER BY default_order`)
    .all(req.params.id) as { exercise_name: string; target_sets: number | null; target_reps: string | null }[];
  res.json(exercises.map((e) => ({
    exercise_name: e.exercise_name,
    default_rest_seconds: 90,
    target_sets: e.target_sets ?? null,
    target_reps: e.target_reps ?? null,
  })));
});

// DELETE /api/custom-routines/:id
customRoutinesRouter.delete("/:id", (req, res) => {
  const result = db.prepare(`DELETE FROM custom_routines WHERE id = ? AND client_id = ?`).run(req.params.id, req.clientId) as { changes: number };
  if (result.changes === 0) return res.status(404).json({ error: "Rutina no encontrada" });
  res.json({ ok: true });
});

// POST /api/custom-routines/:id/exercises  { exercise_name, target_sets?, target_reps? }
customRoutinesRouter.post("/:id/exercises", (req, res) => {
  const { exercise_name, target_sets, target_reps } = req.body as { exercise_name?: string; target_sets?: number; target_reps?: string };
  if (!exercise_name?.trim()) return res.status(400).json({ error: "Falta exercise_name" });
  const routine = db.prepare(`SELECT id FROM custom_routines WHERE id = ? AND client_id = ?`).get(req.params.id, req.clientId);
  if (!routine) return res.status(404).json({ error: "Rutina no encontrada" });
  const row = db
    .prepare(`SELECT COALESCE(MAX(default_order), -1) + 1 AS next FROM custom_routine_exercises WHERE routine_id = ?`)
    .get(req.params.id) as { next: number };
  db.prepare(`INSERT INTO custom_routine_exercises (routine_id, exercise_name, default_order, target_sets, target_reps) VALUES (?, ?, ?, ?, ?)`)
    .run(req.params.id, exercise_name.trim(), row.next, target_sets ?? null, target_reps?.trim() ?? null);
  res.status(201).json({ ok: true });
});

// PATCH /api/custom-routines/:id/exercises/:exerciseName -> edita target_sets/target_reps
customRoutinesRouter.patch("/:id/exercises/:exerciseName", (req, res) => {
  const routine = db.prepare(`SELECT id FROM custom_routines WHERE id = ? AND client_id = ?`).get(req.params.id, req.clientId);
  if (!routine) return res.status(404).json({ error: "Rutina no encontrada" });
  const { target_sets, target_reps } = req.body as { target_sets?: number | null; target_reps?: string | null };
  const result = db
    .prepare(`UPDATE custom_routine_exercises SET target_sets = ?, target_reps = ? WHERE routine_id = ? AND exercise_name = ?`)
    .run(target_sets ?? null, target_reps ?? null, req.params.id, req.params.exerciseName) as { changes: number };
  if (result.changes === 0) return res.status(404).json({ error: "Ejercicio no encontrado" });
  res.json({ ok: true });
});

// DELETE /api/custom-routines/:id/exercises/:exerciseName
customRoutinesRouter.delete("/:id/exercises/:exerciseName", (req, res) => {
  const routine = db.prepare(`SELECT id FROM custom_routines WHERE id = ? AND client_id = ?`).get(req.params.id, req.clientId);
  if (!routine) return res.status(404).json({ error: "Rutina no encontrada" });
  const result = db
    .prepare(`DELETE FROM custom_routine_exercises WHERE routine_id = ? AND exercise_name = ?`)
    .run(req.params.id, req.params.exerciseName) as { changes: number };
  if (result.changes === 0) return res.status(404).json({ error: "Ejercicio no encontrado" });
  res.json({ ok: true });
});
