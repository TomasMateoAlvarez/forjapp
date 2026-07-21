import { Router } from "express";
import { db } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const exportRouter = Router();

// GET /api/export -> backup completo de los datos del usuario en JSON.
// Pensado para el botón de "Exportar datos" en Perfil, no para restaurar
// automáticamente (no hay endpoint de import).
exportRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const clientId = req.clientId;
    // El catálogo (workout_types/workout_type_exercises) es global y compartido,
    // así que se incluye completo; el resto se filtra por client_id.
    const workout_types = await db.all(`SELECT * FROM workout_types`);
    const workout_type_exercises = await db.all(`SELECT * FROM workout_type_exercises`);
    const custom_routines = await db.all<{ id: number }>(`SELECT * FROM custom_routines WHERE client_id = ?`, [clientId]);
    const routineIds = custom_routines.map((r) => r.id);
    const custom_routine_exercises = routineIds.length
      ? await db.all(`SELECT * FROM custom_routine_exercises WHERE routine_id IN (${routineIds.map(() => "?").join(",")})`, routineIds)
      : [];
    const sessions = await db.all<{ id: number }>(`SELECT * FROM sessions WHERE client_id = ?`, [clientId]);
    const sessionIds = sessions.map((s) => s.id);
    const session_exercises = sessionIds.length
      ? await db.all(`SELECT * FROM session_exercises WHERE session_id IN (${sessionIds.map(() => "?").join(",")})`, sessionIds)
      : [];
    const biometrics = await db.all(`SELECT * FROM biometrics WHERE client_id = ?`, [clientId]);
    const personal_records = await db.all(`SELECT * FROM personal_records WHERE client_id = ?`, [clientId]);
    const weekly_plans = await db.all<{ id: number }>(`SELECT * FROM weekly_plans WHERE client_id = ?`, [clientId]);
    const planIds = weekly_plans.map((p) => p.id);
    const plan_days = planIds.length
      ? await db.all(`SELECT * FROM plan_days WHERE plan_id IN (${planIds.map(() => "?").join(",")})`, planIds)
      : [];
    const user_profile = await db.all(`SELECT * FROM user_profile WHERE client_id = ?`, [clientId]);

    res.setHeader("Content-Disposition", `attachment; filename="forja-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      exported_at: new Date().toISOString(),
      workout_types,
      workout_type_exercises,
      custom_routines,
      custom_routine_exercises,
      sessions,
      session_exercises,
      biometrics,
      personal_records,
      weekly_plans,
      plan_days,
      user_profile,
    });
  })
);
