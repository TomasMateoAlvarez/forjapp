import { Router } from "express";
import { db } from "../db.js";

export const alertsRouter = Router();

// GET /api/alerts/check?workout_type_id=pecho&date=2026-07-03
// Regla fija: si el mismo grupo muscular se entrenó en las 48hs previas, avisa. Sin IA, sin modelo dinámico.
alertsRouter.get("/check", (req, res) => {
  const workoutTypeId = req.query.workout_type_id as string;
  const date = req.query.date as string;

  if (!workoutTypeId || !date) {
    return res.status(400).json({ error: "Faltan 'workout_type_id' y/o 'date'" });
  }

  const type = db.prepare(`SELECT muscle_group, label FROM workout_types WHERE id = ?`).get(workoutTypeId) as
    | { muscle_group: string; label: string }
    | undefined;
  if (!type) return res.status(404).json({ error: "Tipo de entreno no encontrado" });

  // ventana de 48hs hacia atrás
  const targetDate = new Date(date + "T00:00:00");
  const twoDaysAgo = new Date(targetDate);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const fromDate = twoDaysAgo.toISOString().slice(0, 10);

  const recentSame = db
    .prepare(
      `SELECT s.date, wt.label
       FROM sessions s JOIN workout_types wt ON wt.id = s.workout_type_id
       WHERE s.client_id = ? AND wt.muscle_group = ? AND s.date >= ? AND s.date < ?
       ORDER BY s.date DESC LIMIT 1`
    )
    .get(req.clientId, type.muscle_group, fromDate, date) as { date: string; label: string } | undefined;

  if (recentSame) {
    return res.json({
      warning: true,
      message: `Entrenaste ${recentSame.label} el ${recentSame.date}. No se recomienda repetir ${type.label} tan seguido.`,
    });
  }

  res.json({ warning: false, message: null });
});
