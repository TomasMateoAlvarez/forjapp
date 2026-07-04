import { Router } from "express";
import { db } from "../db.js";

export const exportRouter = Router();

// GET /api/export -> backup completo de los datos del usuario en JSON.
// Pensado para el botón de "Exportar datos" en Perfil, no para restaurar
// automáticamente (no hay endpoint de import).
exportRouter.get("/", (req, res) => {
  const clientId = req.clientId;
  // El catálogo (workout_types/workout_type_exercises) es global y compartido,
  // así que se incluye completo; el resto se filtra por client_id.
  const workout_types = db.prepare(`SELECT * FROM workout_types`).all();
  const workout_type_exercises = db.prepare(`SELECT * FROM workout_type_exercises`).all();
  const custom_routines = db.prepare(`SELECT * FROM custom_routines WHERE client_id = ?`).all(clientId) as { id: number }[];
  const routineIds = custom_routines.map((r) => r.id);
  const custom_routine_exercises = routineIds.length
    ? db.prepare(`SELECT * FROM custom_routine_exercises WHERE routine_id IN (${routineIds.map(() => "?").join(",")})`).all(...routineIds)
    : [];
  const sessions = db.prepare(`SELECT * FROM sessions WHERE client_id = ?`).all(clientId) as { id: number }[];
  const sessionIds = sessions.map((s) => s.id);
  const session_exercises = sessionIds.length
    ? db.prepare(`SELECT * FROM session_exercises WHERE session_id IN (${sessionIds.map(() => "?").join(",")})`).all(...sessionIds)
    : [];
  const biometrics = db.prepare(`SELECT * FROM biometrics WHERE client_id = ?`).all(clientId);
  const personal_records = db.prepare(`SELECT * FROM personal_records WHERE client_id = ?`).all(clientId);
  const weekly_plans = db.prepare(`SELECT * FROM weekly_plans WHERE client_id = ?`).all(clientId) as { id: number }[];
  const planIds = weekly_plans.map((p) => p.id);
  const plan_days = planIds.length
    ? db.prepare(`SELECT * FROM plan_days WHERE plan_id IN (${planIds.map(() => "?").join(",")})`).all(...planIds)
    : [];
  const user_profile = db.prepare(`SELECT * FROM user_profile WHERE client_id = ?`).all(clientId);

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
});
