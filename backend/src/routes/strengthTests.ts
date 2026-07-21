import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { resolveEffectiveClientId } from "../auth/coachAccess.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const strengthTestsRouter = Router();

export const strengthTestSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    test_type: z.enum(["salto_simple", "drop_jump"]),
    flight_time_sec: z.number().positive(),
    contact_time_sec: z.number().positive().optional(),
    drop_height_cm: z.number().positive().optional(),
  })
  .refine((d) => d.test_type !== "drop_jump" || d.contact_time_sec !== undefined, {
    message: "drop_jump requiere contact_time_sec",
  });

// Altura de salto (cm) = (tiempo de vuelo, seg)² × 1.226 × 100 (Manual Anselmi).
function jumpHeightCm(flightTimeSec: number): number {
  return flightTimeSec ** 2 * 1.226 * 100;
}

// Q de estabilidad reactiva = tiempo de vuelo / tiempo de contacto — se repite
// el test desde alturas de caída crecientes; el Q máximo indica la altura
// óptima de trabajo pliométrico para ese atleta (no se calcula acá, es
// responsabilidad de quien lea la serie de tests).
function reactiveStabilityQ(flightTimeSec: number, contactTimeSec: number): number {
  return flightTimeSec / contactTimeSec;
}

type StrengthTestRow = {
  id: number;
  date: string;
  test_type: "salto_simple" | "drop_jump";
  flight_time_sec: number;
  contact_time_sec: number | null;
  drop_height_cm: number | null;
};

function withComputed(row: StrengthTestRow) {
  return {
    ...row,
    jump_height_cm: jumpHeightCm(row.flight_time_sec),
    reactive_stability_q: row.contact_time_sec != null ? reactiveStabilityQ(row.flight_time_sec, row.contact_time_sec) : null,
  };
}

// POST /api/strength-tests -> guarda un test de salto/pliometría
strengthTestsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = strengthTestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { date, test_type, flight_time_sec, contact_time_sec, drop_height_cm } = parsed.data;

    const row = await db.get<StrengthTestRow>(
      `INSERT INTO strength_tests (client_id, date, test_type, flight_time_sec, contact_time_sec, drop_height_cm)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id, date, test_type, flight_time_sec, contact_time_sec, drop_height_cm`,
      [req.clientId, date, test_type, flight_time_sec, contact_time_sec ?? null, drop_height_cm ?? null]
    );

    res.status(201).json(withComputed(row!));
  })
);

// GET /api/strength-tests -> historial de tests, más reciente primero
strengthTestsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await db.all<StrengthTestRow>(
      `SELECT id, date, test_type, flight_time_sec, contact_time_sec, drop_height_cm
       FROM strength_tests WHERE client_id = ? ORDER BY date DESC, id DESC`,
      [await resolveEffectiveClientId(req)]
    );
    res.json(rows.map(withComputed));
  })
);
