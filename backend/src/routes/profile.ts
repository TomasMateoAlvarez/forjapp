import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";

export const profileRouter = Router();

type ProfileRow = { client_id: string; height_cm: number | null; updated_at: string | null };

profileRouter.get("/", (req, res) => {
  const row = db.prepare(`SELECT height_cm FROM user_profile WHERE client_id = ?`).get(req.clientId) as ProfileRow | undefined;
  res.json({ height_cm: row?.height_cm ?? null });
});

profileRouter.put("/", (req, res) => {
  const parsed = z.object({ height_cm: z.number().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  db.prepare(
    `INSERT INTO user_profile (client_id, height_cm, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(client_id) DO UPDATE SET height_cm = excluded.height_cm, updated_at = excluded.updated_at`
  ).run(req.clientId, parsed.data.height_cm);
  res.json({ ok: true });
});
