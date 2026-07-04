import { Router } from "express";
import { db } from "../db.js";

export const historyRouter = Router();

// GET /api/history -> lista de ejercicios con al menos un registro
historyRouter.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT exercise_name, COUNT(*) as entries, MAX(s.date) as last_date
       FROM session_exercises se JOIN sessions s ON s.id = se.session_id
       WHERE s.client_id = ?
       GROUP BY exercise_name
       ORDER BY last_date DESC`
    )
    .all(req.clientId);
  res.json(rows);
});

// GET /api/history/:exerciseName/latest -> series de trabajo del último día registrado
// (el calentamiento no se usa para precargar la próxima sesión)
historyRouter.get("/:exerciseName/latest", (req, res) => {
  const rows = db
    .prepare(
      `SELECT se.weight_kg, se.reps, se.set_number
       FROM session_exercises se
       JOIN sessions s ON s.id = se.session_id
       WHERE s.client_id = ? AND se.exercise_name = ? AND se.is_warmup = 0
         AND s.date = (
           SELECT MAX(s2.date) FROM sessions s2
           JOIN session_exercises se2 ON se2.session_id = s2.id
           WHERE s2.client_id = ? AND se2.exercise_name = ? AND se2.is_warmup = 0
         )
       ORDER BY se.set_number`
    )
    .all(req.clientId, req.params.exerciseName, req.clientId, req.params.exerciseName);
  res.json(rows);
});

// GET /api/history/:exerciseName/records -> récord personal de ese ejercicio
historyRouter.get("/:exerciseName/records", (req, res) => {
  const row = db
    .prepare(`SELECT * FROM personal_records WHERE client_id = ? AND exercise_name = ?`)
    .get(req.clientId, req.params.exerciseName);
  res.json(row ?? null);
});

// GET /api/history/:exerciseName -> evolución completa del ejercicio (incluye
// series de calentamiento marcadas con is_warmup para que el cliente decida
// si mostrarlas, pero deben excluirse de cálculos de 1RM/volumen/PR)
historyRouter.get("/:exerciseName", (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.date, se.weight_kg, se.reps, se.set_number, se.is_warmup
       FROM session_exercises se
       JOIN sessions s ON s.id = se.session_id
       WHERE s.client_id = ? AND se.exercise_name = ?
       ORDER BY s.date ASC, se.set_number ASC`
    )
    .all(req.clientId, req.params.exerciseName) as { date: string; weight_kg: number; reps: number; set_number: number; is_warmup: number }[];
  res.json(rows.map((r) => ({ ...r, is_warmup: !!r.is_warmup })));
});
