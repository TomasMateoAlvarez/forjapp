import { Router } from "express";
import { db } from "../db.js";
import { addDaysISO, mondayOfISO, toISODate } from "../lib/dates.js";
import { resolveEffectiveClientId } from "../auth/coachAccess.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const streakRouter = Router();

// GET /api/streak -> cuántas semanas consecutivas (ya terminadas) se cumplió
// el plan completo. La semana en curso no cuenta todavía (puede no haber
// terminado); se evalúa desde la última semana completa hacia atrás.
streakRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const clientId = await resolveEffectiveClientId(req);
    const currentMonday = mondayOfISO(toISODate(new Date()));
    let cursor = addDaysISO(currentMonday, -7);

    let streak = 0;

    for (;;) {
      const weekStart = cursor;
      const plan = await db.get<{ id: number }>(`SELECT id FROM weekly_plans WHERE client_id = ? AND week_start = ?`, [clientId, weekStart]);
      if (!plan) break;

      const planDays = await db.all<{ date: string; done: number }>(`SELECT date, done FROM plan_days WHERE plan_id = ?`, [plan.id]);
      if (planDays.length === 0) break; // sin días planificados esa semana: no cuenta como "cumplida"

      const weekEnd = addDaysISO(weekStart, 6);
      const actualRows = await db.all<{ date: string }>(
        `SELECT DISTINCT date FROM sessions WHERE client_id = ? AND date >= ? AND date <= ?`,
        [clientId, weekStart, weekEnd]
      );
      const actualDates = new Set(actualRows.map((r) => r.date));

      const allFulfilled = planDays.every((pd) => pd.done === 1 || actualDates.has(pd.date));
      if (!allFulfilled) break;

      streak++;
      cursor = addDaysISO(cursor, -7);
    }

    res.json({ weeks: streak });
  })
);
