import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { TRAINING_MODES } from "../lib/trainingModes.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const profileRouter = Router();

type ProfileRow = {
  client_id: string;
  height_cm: number | null;
  training_mode: string | null;
  pro_enabled: number;
  updated_at: string | null;
};

profileRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const row = await db.get<ProfileRow>(`SELECT height_cm, training_mode, pro_enabled FROM user_profile WHERE client_id = ?`, [req.clientId]);
    res.json({
      height_cm: row?.height_cm ?? null,
      training_mode: row?.training_mode ?? null,
      pro_enabled: !!row?.pro_enabled,
    });
  })
);

profileRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        height_cm: z.number().positive().optional(),
        training_mode: z.enum(["fuerza", "hipertrofia", "mantenimiento"]).optional(),
        pro_enabled: z.boolean().optional(),
      })
      .refine((d) => d.height_cm !== undefined || d.training_mode !== undefined || d.pro_enabled !== undefined, {
        message: "Debe incluir height_cm, training_mode o pro_enabled",
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { height_cm, training_mode, pro_enabled } = parsed.data;
    // pro_enabled es NOT NULL (default 0) a diferencia de height_cm/training_mode
    // (nullable): en el INSERT hace falta un COALESCE a 0 para una fila nueva,
    // pero en el UPDATE hay que comparar contra el parámetro original (@pro_enabled),
    // no contra `excluded.pro_enabled` — ese ya pasó por el COALESCE a 0 del INSERT
    // y siempre "ganaría" sobre el valor existente en una actualización parcial.
    await db.run(
      `INSERT INTO user_profile (client_id, height_cm, training_mode, pro_enabled, updated_at)
       VALUES (@client_id, @height_cm, @training_mode, COALESCE(@pro_enabled, 0), now())
       ON CONFLICT(client_id) DO UPDATE SET
         height_cm = COALESCE(excluded.height_cm, user_profile.height_cm),
         training_mode = COALESCE(excluded.training_mode, user_profile.training_mode),
         pro_enabled = COALESCE(@pro_enabled, user_profile.pro_enabled),
         updated_at = excluded.updated_at`,
      {
        client_id: req.clientId,
        height_cm: height_cm ?? null,
        training_mode: training_mode ?? null,
        pro_enabled: pro_enabled === undefined ? null : pro_enabled ? 1 : 0,
      }
    );
    res.json({ ok: true });
  })
);

// GET /api/profile/training-modes -> catálogo de modos con sus constantes de referencia
profileRouter.get("/training-modes", (_req, res) => {
  res.json(Object.values(TRAINING_MODES));
});
