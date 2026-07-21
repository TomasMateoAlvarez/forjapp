import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { resolveEffectiveClientId } from "../auth/coachAccess.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const cardioSessionsRouter = Router();

export const cardioSessionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activity_type: z.enum(["cardio", "tecnico_tactico", "otro"]),
  duration_min: z.number().int().positive(),
  notes: z.string().max(500).optional(),
});

// POST /api/cardio-sessions -> guarda una sesión de cardio/técnico-táctico,
// separada de las sesiones de sobrecarga (`sessions`).
cardioSessionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = cardioSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { date, activity_type, duration_min, notes } = parsed.data;

    const row = await db.get(
      `INSERT INTO cardio_sessions (client_id, date, activity_type, duration_min, notes) VALUES (?, ?, ?, ?, ?)
       RETURNING id, date, activity_type, duration_min, notes`,
      [req.clientId, date, activity_type, duration_min, notes ?? null]
    );

    res.status(201).json(row);
  })
);

// GET /api/cardio-sessions -> historial, más reciente primero
cardioSessionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT id, date, activity_type, duration_min, notes
       FROM cardio_sessions WHERE client_id = ? ORDER BY date DESC, id DESC`,
      [await resolveEffectiveClientId(req)]
    );
    res.json(rows);
  })
);
