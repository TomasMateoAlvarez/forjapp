import { Router } from "express";
import { db } from "../db.js";
import { mondayOfISO } from "../lib/dates.js";
import { averageIntensityPct } from "../lib/intensity.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const alertsRouter = Router();

const SUSTAINED_INTENSITY_THRESHOLD_PCT = 75; // piso de la zona hipertrofia (75-90%) del Manual Anselmi
const SUSTAINED_WEEKS_THRESHOLD = 3;

// Cuántas semanas CONSECUTIVAS (yendo hacia atrás desde `beforeDate`, sin
// contar esa semana en curso) tuvieron intensidad promedio >= umbral para
// este grupo muscular, sin ninguna semana de intensidad menor de por medio.
// Complementa la regla fija de 48hs — no la reemplaza.
async function sustainedHighIntensityWeeks(clientId: string, muscleGroup: string, beforeDate: string): Promise<number> {
  const rows = await db.all<{ date: string; exercise_name: string; weight_kg: number }>(
    `SELECT s.date, se.exercise_name, se.weight_kg
     FROM sessions s
     JOIN workout_types wt ON wt.id = s.workout_type_id
     JOIN session_exercises se ON se.session_id = s.id
     WHERE s.client_id = ? AND wt.muscle_group = ? AND se.is_warmup = 0 AND s.date < ?
     ORDER BY s.date DESC`,
    [clientId, muscleGroup, beforeDate]
  );

  if (rows.length === 0) return 0;

  const byWeek = new Map<string, { exercise_name: string; weight_kg: number }[]>();
  for (const r of rows) {
    const week = mondayOfISO(r.date);
    const arr = byWeek.get(week) ?? [];
    arr.push({ exercise_name: r.exercise_name, weight_kg: r.weight_kg });
    byWeek.set(week, arr);
  }

  const weeksDesc = [...byWeek.keys()].sort((a, b) => b.localeCompare(a));
  let streak = 0;
  for (const week of weeksDesc) {
    const avg = await averageIntensityPct(clientId, byWeek.get(week)!);
    if (avg !== null && avg >= SUSTAINED_INTENSITY_THRESHOLD_PCT) streak++;
    else break;
  }
  return streak;
}

// GET /api/alerts/check?workout_type_id=pecho&date=2026-07-03
// Dos alertas independientes:
// 1) Regla fija: mismo grupo muscular entrenado en las 48hs previas.
// 2) Tendencia: 3+ semanas seguidas de intensidad promedio alta (75%+) sin
//    una semana de intensidad menor — sugiere una semana de descarga.
alertsRouter.get(
  "/check",
  asyncHandler(async (req, res) => {
    const workoutTypeId = req.query.workout_type_id as string;
    const date = req.query.date as string;

    if (!workoutTypeId || !date) {
      return res.status(400).json({ error: "Faltan 'workout_type_id' y/o 'date'" });
    }

    const type = await db.get<{ muscle_group: string; label: string }>(`SELECT muscle_group, label FROM workout_types WHERE id = ?`, [
      workoutTypeId,
    ]);
    if (!type) return res.status(404).json({ error: "Tipo de entreno no encontrado" });

    // ventana de 48hs hacia atrás
    const targetDate = new Date(date + "T00:00:00");
    const twoDaysAgo = new Date(targetDate);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const fromDate = twoDaysAgo.toISOString().slice(0, 10);

    const recentSame = await db.get<{ date: string; label: string }>(
      `SELECT s.date, wt.label
       FROM sessions s JOIN workout_types wt ON wt.id = s.workout_type_id
       WHERE s.client_id = ? AND wt.muscle_group = ? AND s.date >= ? AND s.date < ?
       ORDER BY s.date DESC LIMIT 1`,
      [req.clientId, type.muscle_group, fromDate, date]
    );

    const warning = !!recentSame;
    const message = recentSame
      ? `Entrenaste ${recentSame.label} el ${recentSame.date}. No se recomienda repetir ${type.label} tan seguido.`
      : null;

    const sustainedWeeks = await sustainedHighIntensityWeeks(req.clientId, type.muscle_group, date);
    const trend_warning = sustainedWeeks >= SUSTAINED_WEEKS_THRESHOLD;
    const trend_message = trend_warning
      ? `Llevás ${sustainedWeeks} semanas seguidas de intensidad alta en ${type.label} sin bajar el ritmo — considerá una semana de descarga.`
      : null;

    res.json({ warning, message, trend_warning, trend_message });
  })
);
