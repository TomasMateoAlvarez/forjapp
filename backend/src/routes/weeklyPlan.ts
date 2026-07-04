import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";

export const weeklyPlanRouter = Router();

const planSchema = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // lunes de esa semana
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        workout_type_id: z.string().min(1),
      })
    )
    .min(1),
});

// POST /api/weekly-plan -> crea/reemplaza el plan de una semana
weeklyPlanRouter.post("/", (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { week_start, days } = parsed.data;
  const clientId = req.clientId;

  db.exec("BEGIN");
  let planId: number | bigint;
  try {
    db.prepare(`INSERT OR IGNORE INTO weekly_plans (client_id, week_start) VALUES (?, ?)`).run(clientId, week_start);
    const plan = db.prepare(`SELECT id FROM weekly_plans WHERE client_id = ? AND week_start = ?`).get(clientId, week_start) as { id: number };

    db.prepare(`DELETE FROM plan_days WHERE plan_id = ?`).run(plan.id);
    const insertDay = db.prepare(
      `INSERT INTO plan_days (plan_id, date, workout_type_id) VALUES (?, ?, ?)`
    );
    for (const d of days) insertDay.run(plan.id, d.date, d.workout_type_id);
    planId = plan.id;
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  res.status(201).json({ id: planId, week_start, days });
});

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d.toISOString().slice(0, 10);
}

// GET /api/weekly-plan/for-date/:date -> tipo planificado para ese día exacto o null
weeklyPlanRouter.get("/for-date/:date", (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
    return res.status(400).json({ error: "Formato inválido, esperado YYYY-MM-DD" });
  }
  const weekStart = getMondayOf(req.params.date);
  const row = db
    .prepare(
      `SELECT pd.workout_type_id, wt.label as workout_label
       FROM weekly_plans wp
       JOIN plan_days pd ON pd.plan_id = wp.id
       JOIN workout_types wt ON wt.id = pd.workout_type_id
       WHERE wp.client_id = ? AND wp.week_start = ? AND pd.date = ?`
    )
    .get(req.clientId, weekStart, req.params.date) as { workout_type_id: string; workout_label: string } | undefined;
  res.json(row ?? null);
});

// GET /api/weekly-plan/:week_start -> siempre devuelve los 7 días con planeado + real
weeklyPlanRouter.get("/:week_start", (req, res) => {
  const weekStart = req.params.week_start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return res.status(400).json({ error: "Formato inválido" });
  }
  const clientId = req.clientId;

  // Generate the 7 dates of the week
  const weekDates: string[] = [];
  const base = new Date(weekStart + "T12:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    weekDates.push(d.toISOString().slice(0, 10));
  }
  const weekEnd = weekDates[6];

  const plan = db.prepare(`SELECT id FROM weekly_plans WHERE client_id = ? AND week_start = ?`).get(clientId, weekStart) as { id: number } | undefined;

  type PlannedRow = { date: string; planned_workout_type_id: string; planned_label: string; done: number };
  const plannedRows = plan
    ? (db.prepare(
        `SELECT pd.date, pd.workout_type_id as planned_workout_type_id, wt.label as planned_label, pd.done
         FROM plan_days pd JOIN workout_types wt ON wt.id = pd.workout_type_id
         WHERE pd.plan_id = ?`
      ).all(plan.id) as PlannedRow[])
    : [];

  type ActualRow = { date: string; actual_workout_type_id: string | null; actual_label: string | null };
  const actualRows = db.prepare(
    `SELECT s.date, s.workout_type_id as actual_workout_type_id,
            COALESCE(wt.label, cr.name) as actual_label
     FROM sessions s
     LEFT JOIN workout_types wt ON wt.id = s.workout_type_id
     LEFT JOIN custom_routines cr ON cr.id = s.custom_routine_id
     WHERE s.client_id = ? AND s.date >= ? AND s.date <= ?`
  ).all(clientId, weekStart, weekEnd) as ActualRow[];

  const planByDate = new Map(plannedRows.map((r) => [r.date, r]));
  const actualByDate = new Map(actualRows.map((r) => [r.date, r]));

  const days = weekDates.map((date) => {
    const planned = planByDate.get(date);
    const actual = actualByDate.get(date);
    return {
      date,
      planned_workout_type_id: planned?.planned_workout_type_id ?? null,
      planned_label: planned?.planned_label ?? null,
      actual_workout_type_id: actual?.actual_workout_type_id ?? null,
      actual_label: actual?.actual_label ?? null,
      done: !!(actual || planned?.done),
    };
  });

  res.json({ week_start: weekStart, days });
});

// POST /api/weekly-plan/:week_start/mark-done -> marcar un día del plan como cumplido
weeklyPlanRouter.post("/:week_start/mark-done", (req, res) => {
  const { date } = req.body as { date?: string };
  if (!date) return res.status(400).json({ error: "Falta 'date'" });

  const plan = db.prepare(`SELECT id FROM weekly_plans WHERE client_id = ? AND week_start = ?`).get(req.clientId, req.params.week_start) as
    | { id: number }
    | undefined;
  if (!plan) return res.status(404).json({ error: "No hay plan para esa semana" });

  db.prepare(`UPDATE plan_days SET done = 1 WHERE plan_id = ? AND date = ?`).run(plan.id, date);
  res.json({ ok: true });
});
