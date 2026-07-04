import { Router } from "express";
import { db } from "../db.js";

export const streakRouter = Router();

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayOf(d: Date): Date {
  const day = d.getUTCDay(); // 0=domingo .. 6=sábado
  const diff = (day + 6) % 7; // días desde el lunes más reciente
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() - diff);
  return m;
}

// GET /api/streak -> cuántas semanas consecutivas (ya terminadas) se cumplió
// el plan completo. La semana en curso no cuenta todavía (puede no haber
// terminado); se evalúa desde la última semana completa hacia atrás.
streakRouter.get("/", (req, res) => {
  const clientId = req.clientId;
  const currentMonday = mondayOf(new Date());
  const cursor = new Date(currentMonday);
  cursor.setUTCDate(cursor.getUTCDate() - 7);

  let streak = 0;

  for (;;) {
    const weekStart = toISO(cursor);
    const plan = db.prepare(`SELECT id FROM weekly_plans WHERE client_id = ? AND week_start = ?`).get(clientId, weekStart) as { id: number } | undefined;
    if (!plan) break;

    const planDays = db
      .prepare(`SELECT date, done FROM plan_days WHERE plan_id = ?`)
      .all(plan.id) as { date: string; done: number }[];
    if (planDays.length === 0) break; // sin días planificados esa semana: no cuenta como "cumplida"

    const weekEnd = toISO(new Date(cursor.getTime() + 6 * 86400000));
    const actualDates = new Set(
      (
        db.prepare(`SELECT DISTINCT date FROM sessions WHERE client_id = ? AND date >= ? AND date <= ?`).all(clientId, weekStart, weekEnd) as {
          date: string;
        }[]
      ).map((r) => r.date)
    );

    const allFulfilled = planDays.every((pd) => pd.done === 1 || actualDates.has(pd.date));
    if (!allFulfilled) break;

    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }

  res.json({ weeks: streak });
});
