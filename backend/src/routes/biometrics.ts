import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { resolveEffectiveClientId } from "../auth/coachAccess.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const biometricsRouter = Router();

export const biometricSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weight_kg: z.number().positive().optional(),
  height_cm: z.number().positive().optional(),
  feeling: z.number().int().min(1).max(5).optional(),
});

// POST /api/biometrics -> guarda/actualiza el check-in del día (peso, altura, cómo te sentís)
biometricsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = biometricSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { date, weight_kg, height_cm, feeling } = parsed.data;

    await db.run(
      `INSERT INTO biometrics (client_id, date, weight_kg, height_cm, feeling)
       VALUES (@client_id, @date, @weight_kg, @height_cm, @feeling)
       ON CONFLICT(client_id, date) DO UPDATE SET
         weight_kg = COALESCE(excluded.weight_kg, biometrics.weight_kg),
         height_cm = COALESCE(excluded.height_cm, biometrics.height_cm),
         feeling = COALESCE(excluded.feeling, biometrics.feeling)`,
      { client_id: req.clientId, date, weight_kg: weight_kg ?? null, height_cm: height_cm ?? null, feeling: feeling ?? null }
    );

    res.status(201).json({ ok: true });
  })
);

// GET /api/biometrics?from=&to= -> historial biométrico
biometricsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const from = (req.query.from as string) ?? "0000-01-01";
    const to = (req.query.to as string) ?? "9999-12-31";
    const rows = await db.all(`SELECT * FROM biometrics WHERE client_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC`, [
      await resolveEffectiveClientId(req),
      from,
      to,
    ]);
    res.json(rows);
  })
);
