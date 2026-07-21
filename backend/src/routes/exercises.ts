import { Router } from "express";
import { db } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const exercisesRouter = Router();

// GET /api/exercises -> nombres únicos de ejercicios ya usados en cualquier
// rutina o sesión, para autocompletar y evitar duplicados tipo "Press banca"
// vs "Press de banca".
exercisesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await db.all<{ exercise_name: string }>(
      `SELECT exercise_name FROM workout_type_exercises
       UNION
       SELECT cre.exercise_name FROM custom_routine_exercises cre
         JOIN custom_routines cr ON cr.id = cre.routine_id
        WHERE cr.client_id = ?
       UNION
       SELECT se.exercise_name FROM session_exercises se
         JOIN sessions s ON s.id = se.session_id
        WHERE s.client_id = ?
       ORDER BY LOWER(exercise_name)`,
      [req.clientId, req.clientId]
    );
    res.json(rows.map((r) => r.exercise_name));
  })
);
