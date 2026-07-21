import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { mondayOfISO } from "../lib/dates.js";
import { resolveEffectiveClientId } from "../auth/coachAccess.js";
import { averageIntensityPct } from "../lib/intensity.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const weeklyPlanRouter = Router();

// Sin motor de periodización: un campo declarativo simple + una comparación
// contra la intensidad real de la semana. "Máximo esperado" es una
// referencia orientativa, no una regla estricta.
export const mesocyclePhaseSchema = z.enum(["acumulacion", "intensificacion", "descarga", "mantenimiento"]);
type MesocyclePhase = z.infer<typeof mesocyclePhaseSchema>;

const PHASE_LABEL: Record<MesocyclePhase, string> = {
  acumulacion: "acumulación",
  intensificacion: "intensificación",
  descarga: "descarga",
  mantenimiento: "mantenimiento",
};
const PHASE_MAX_EXPECTED_INTENSITY_PCT: Record<MesocyclePhase, number> = {
  acumulacion: 75,
  intensificacion: 100,
  descarga: 60,
  mantenimiento: 80,
};

export const planSchema = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // lunes de esa semana
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        workout_type_id: z.string().min(1),
      })
    )
    .min(1),
  mesocycle_phase: mesocyclePhaseSchema.optional(),
});

// GET /api/weekly-plan/suggested -> plantilla de rutina inicial para alguien
// sin rutina propia, a partir del catálogo ya existente (Full Body/Push/Pull).
// 3 días no consecutivos por semana (con descanso entre medio) para ondular
// el esfuerzo en vez de repetir el mismo tipo/grupo muscular seguido — no es
// personalización, es un punto de partida razonable e igual para todos.
weeklyPlanRouter.get("/suggested", (_req, res) => {
  const template = [
    { weekday_index: 0, workout_type_id: "full_body" }, // Lun
    { weekday_index: 1, workout_type_id: null }, // Mar (descanso)
    { weekday_index: 2, workout_type_id: "push" }, // Mié
    { weekday_index: 3, workout_type_id: null }, // Jue (descanso)
    { weekday_index: 4, workout_type_id: "pull" }, // Vie
    { weekday_index: 5, workout_type_id: null }, // Sáb (descanso)
    { weekday_index: 6, workout_type_id: null }, // Dom (descanso)
  ];
  res.json({ days: template });
});

// GET /api/weekly-plan/cuban-method-template -> reparto de volumen por
// microciclo del "método cubano" (Manual Anselmi §2.2): 35/28/22/15% del
// volumen total del mesociclo repartido en 4 semanas, de más a menos volumen
// a medida que sube la intensidad relativa. Es solo una referencia orientativa
// (no hay un campo de "volumen planificado" en el modelo para aplicarla
// automáticamente) — el cliente la usa para sugerir la fase de cada semana.
weeklyPlanRouter.get("/cuban-method-template", (_req, res) => {
  const weeks: { week_number: number; volume_pct: number; mesocycle_phase: MesocyclePhase }[] = [
    { week_number: 1, volume_pct: 35, mesocycle_phase: "acumulacion" },
    { week_number: 2, volume_pct: 28, mesocycle_phase: "acumulacion" },
    { week_number: 3, volume_pct: 22, mesocycle_phase: "intensificacion" },
    { week_number: 4, volume_pct: 15, mesocycle_phase: "descarga" },
  ];
  res.json({ weeks });
});

// POST /api/weekly-plan -> crea/reemplaza el plan de una semana
weeklyPlanRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { week_start, days, mesocycle_phase } = parsed.data;
    const clientId = req.clientId;

    const planId = await withTransaction(async (tx) => {
      await tx.run(
        `INSERT INTO weekly_plans (client_id, week_start, mesocycle_phase) VALUES (?, ?, ?)
         ON CONFLICT(client_id, week_start) DO UPDATE SET
           mesocycle_phase = COALESCE(excluded.mesocycle_phase, weekly_plans.mesocycle_phase)`,
        [clientId, week_start, mesocycle_phase ?? null]
      );
      const plan = await tx.get<{ id: number }>(`SELECT id FROM weekly_plans WHERE client_id = ? AND week_start = ?`, [clientId, week_start]);

      await tx.run(`DELETE FROM plan_days WHERE plan_id = ?`, [plan!.id]);
      for (const d of days) {
        await tx.run(`INSERT INTO plan_days (plan_id, date, workout_type_id) VALUES (?, ?, ?)`, [plan!.id, d.date, d.workout_type_id]);
      }
      return plan!.id;
    });

    res.status(201).json({ id: planId, week_start, days, mesocycle_phase: mesocycle_phase ?? null });
  })
);

// GET /api/weekly-plan/for-date/:date -> tipo planificado para ese día exacto o null
weeklyPlanRouter.get(
  "/for-date/:date",
  asyncHandler(async (req, res) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      return res.status(400).json({ error: "Formato inválido, esperado YYYY-MM-DD" });
    }
    const weekStart = mondayOfISO(req.params.date);
    const row = await db.get<{ workout_type_id: string; workout_label: string }>(
      `SELECT pd.workout_type_id, wt.label as workout_label
       FROM weekly_plans wp
       JOIN plan_days pd ON pd.plan_id = wp.id
       JOIN workout_types wt ON wt.id = pd.workout_type_id
       WHERE wp.client_id = ? AND wp.week_start = ? AND pd.date = ?`,
      [await resolveEffectiveClientId(req), weekStart, req.params.date]
    );
    res.json(row ?? null);
  })
);

// GET /api/weekly-plan/:week_start -> siempre devuelve los 7 días con planeado + real
weeklyPlanRouter.get(
  "/:week_start",
  asyncHandler(async (req, res) => {
    const weekStart = req.params.week_start;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: "Formato inválido" });
    }
    const clientId = await resolveEffectiveClientId(req);

    // Generate the 7 dates of the week
    const weekDates: string[] = [];
    const base = new Date(weekStart + "T12:00:00");
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() + i);
      weekDates.push(d.toISOString().slice(0, 10));
    }
    const weekEnd = weekDates[6];

    const plan = await db.get<{ id: number; mesocycle_phase: string | null }>(
      `SELECT id, mesocycle_phase FROM weekly_plans WHERE client_id = ? AND week_start = ?`,
      [clientId, weekStart]
    );

    type PlannedRow = { date: string; planned_workout_type_id: string; planned_label: string; done: number };
    const plannedRows = plan
      ? await db.all<PlannedRow>(
          `SELECT pd.date, pd.workout_type_id as planned_workout_type_id, wt.label as planned_label, pd.done
           FROM plan_days pd JOIN workout_types wt ON wt.id = pd.workout_type_id
           WHERE pd.plan_id = ?`,
          [plan.id]
        )
      : [];

    type ActualRow = { date: string; actual_workout_type_id: string | null; actual_label: string | null };
    const actualRows = await db.all<ActualRow>(
      `SELECT s.date, s.workout_type_id as actual_workout_type_id,
              COALESCE(wt.label, cr.name) as actual_label
       FROM sessions s
       LEFT JOIN workout_types wt ON wt.id = s.workout_type_id
       LEFT JOIN custom_routines cr ON cr.id = s.custom_routine_id
       WHERE s.client_id = ? AND s.date >= ? AND s.date <= ?`,
      [clientId, weekStart, weekEnd]
    );

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

    // Intensidad real de la semana vs. lo declarado en mesocycle_phase — campo
    // simple, sin motor de periodización: solo avisa si la intensidad real
    // superó el máximo esperado para la fase declarada (ej. "descarga" con
    // intensidad de "intensificación").
    let week_intensity_pct: number | null = null;
    let mesocycle_discrepancy: string | null = null;
    const phase = plan?.mesocycle_phase as MesocyclePhase | null;
    if (phase) {
      const weekSets = await db.all<{ exercise_name: string; weight_kg: number }>(
        `SELECT se.exercise_name, se.weight_kg
         FROM session_exercises se JOIN sessions s ON s.id = se.session_id
         WHERE s.client_id = ? AND se.is_warmup = 0 AND s.date >= ? AND s.date <= ?`,
        [clientId, weekStart, weekEnd]
      );
      week_intensity_pct = await averageIntensityPct(clientId, weekSets);

      const maxExpected = PHASE_MAX_EXPECTED_INTENSITY_PCT[phase];
      if (week_intensity_pct !== null && week_intensity_pct > maxExpected) {
        mesocycle_discrepancy = `Planificaste una semana de ${PHASE_LABEL[phase]} pero tu intensidad promedio real fue ${week_intensity_pct.toFixed(0)}%, más alta de lo esperado para esa fase.`;
      }
    }

    res.json({ week_start: weekStart, mesocycle_phase: phase, week_intensity_pct, mesocycle_discrepancy, days });
  })
);

// POST /api/weekly-plan/:week_start/mark-done -> marcar un día del plan como cumplido
weeklyPlanRouter.post(
  "/:week_start/mark-done",
  asyncHandler(async (req, res) => {
    const { date } = req.body as { date?: string };
    if (!date) return res.status(400).json({ error: "Falta 'date'" });

    const plan = await db.get<{ id: number }>(`SELECT id FROM weekly_plans WHERE client_id = ? AND week_start = ?`, [
      req.clientId,
      req.params.week_start,
    ]);
    if (!plan) return res.status(404).json({ error: "No hay plan para esa semana" });

    await db.run(`UPDATE plan_days SET done = 1 WHERE plan_id = ? AND date = ?`, [plan.id, date]);
    res.json({ ok: true });
  })
);
