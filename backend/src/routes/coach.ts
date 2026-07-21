import { Router, Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../db.js";
import { addDaysISO } from "../lib/dates.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const coachRouter = Router();

// Todo lo de coach requiere una cuenta real (no tiene sentido para el modo
// legacy anónimo: no hay a quién vincular). Se chequea acá, no en el
// middleware global, para no exigir cuenta en el resto de la API.
function requireAccount(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(403).json({ error: "Esta función requiere una cuenta (registrate o iniciá sesión)" });
  }
  next();
}
coachRouter.use(requireAccount);

function generateCode(): string {
  // 8 caracteres alfanuméricos en mayúscula, fáciles de compartir de palabra.
  return randomBytes(6).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();
}

// POST /api/coach/invite-code -> (re)genera el código de este atleta
coachRouter.post(
  "/invite-code",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const code = generateCode();
    await db.run(
      `INSERT INTO athlete_invite_codes (code, athlete_user_id) VALUES (?, ?)
       ON CONFLICT(athlete_user_id) DO UPDATE SET code = excluded.code, created_at = now()`,
      [code, userId]
    );
    res.status(201).json({ code });
  })
);

// GET /api/coach/invite-code -> código actual (o null si nunca se generó)
coachRouter.get(
  "/invite-code",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const row = await db.get<{ code: string }>(`SELECT code FROM athlete_invite_codes WHERE athlete_user_id = ?`, [userId]);
    res.json(row ?? null);
  })
);

// POST /api/coach/link-requests { code } -> el coach pide vínculo con el atleta dueño de ese código
coachRouter.post(
  "/link-requests",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const parsed = z.object({ code: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const invite = await db.get<{ athlete_user_id: number }>(`SELECT athlete_user_id FROM athlete_invite_codes WHERE code = ?`, [
      parsed.data.code.toUpperCase(),
    ]);
    if (!invite) return res.status(404).json({ error: "Código inválido" });
    if (invite.athlete_user_id === userId) {
      return res.status(400).json({ error: "No podés vincularte con vos mismo" });
    }

    const existing = await db.get<{ status: string }>(`SELECT status FROM coach_athletes WHERE coach_user_id = ? AND athlete_user_id = ?`, [
      userId,
      invite.athlete_user_id,
    ]);
    if (existing) return res.status(409).json({ error: `Ya existe un vínculo (${existing.status}) con ese atleta` });

    await db.run(`INSERT INTO coach_athletes (coach_user_id, athlete_user_id, status) VALUES (?, ?, 'pending')`, [
      userId,
      invite.athlete_user_id,
    ]);
    res.status(201).json({ ok: true });
  })
);

// GET /api/coach/pending-requests -> pedidos de coaches esperando que ESTE usuario (como atleta) los acepte/rechace
coachRouter.get(
  "/pending-requests",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const rows = await db.all(
      `SELECT ca.id, ca.coach_user_id, u.email as coach_email, ca.created_at
       FROM coach_athletes ca JOIN users u ON u.id = ca.coach_user_id
       WHERE ca.athlete_user_id = ? AND ca.status = 'pending'
       ORDER BY ca.created_at DESC`,
      [userId]
    );
    res.json(rows);
  })
);

// POST /api/coach/link-requests/:id/accept
coachRouter.post(
  "/link-requests/:id/accept",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const result = await db.run(`UPDATE coach_athletes SET status = 'accepted' WHERE id = ? AND athlete_user_id = ? AND status = 'pending'`, [
      req.params.id,
      userId,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json({ ok: true });
  })
);

// POST /api/coach/link-requests/:id/reject
coachRouter.post(
  "/link-requests/:id/reject",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const result = await db.run(`DELETE FROM coach_athletes WHERE id = ? AND athlete_user_id = ? AND status = 'pending'`, [
      req.params.id,
      userId,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json({ ok: true });
  })
);

// GET /api/coach/athletes -> atletas vinculados (aceptados) a este coach, con
// adherencia agregada de las últimas 8 semanas + último check-in biométrico.
coachRouter.get(
  "/athletes",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const links = await db.all<{ athlete_user_id: number; athlete_email: string }>(
      `SELECT ca.athlete_user_id, u.email as athlete_email
       FROM coach_athletes ca JOIN users u ON u.id = ca.athlete_user_id
       WHERE ca.coach_user_id = ? AND ca.status = 'accepted'
       ORDER BY u.email`,
      [userId]
    );

    const athletes = [];
    for (const link of links) {
      const clientId = String(link.athlete_user_id);

      const weeks = await db.all<{ week_start: string; id: number }>(
        `SELECT wp.week_start, wp.id
         FROM weekly_plans wp
         WHERE wp.client_id = ?
         ORDER BY wp.week_start DESC
         LIMIT 8`,
        [clientId]
      );

      let fulfilledCount = 0;
      for (const week of weeks) {
        const planDays = await db.all<{ date: string; done: number }>(`SELECT date, done FROM plan_days WHERE plan_id = ?`, [week.id]);
        if (planDays.length === 0) continue;
        const weekEnd = addDaysISO(week.week_start, 6);
        const actualRows = await db.all<{ date: string }>(`SELECT DISTINCT date FROM sessions WHERE client_id = ? AND date >= ? AND date <= ?`, [
          clientId,
          week.week_start,
          weekEnd,
        ]);
        const actualDates = new Set(actualRows.map((r) => r.date));
        const fulfilled = planDays.every((pd) => pd.done === 1 || actualDates.has(pd.date));
        if (fulfilled) fulfilledCount++;
      }
      const adherence_pct = weeks.length > 0 ? Math.round((fulfilledCount / weeks.length) * 100) : null;

      const lastCheckIn = await db.get<{ date: string }>(`SELECT date FROM biometrics WHERE client_id = ? ORDER BY date DESC LIMIT 1`, [
        clientId,
      ]);

      athletes.push({
        athlete_user_id: link.athlete_user_id,
        athlete_email: link.athlete_email,
        adherence_pct,
        last_check_in: lastCheckIn?.date ?? null,
      });
    }

    res.json(athletes);
  })
);

async function hasAcceptedLink(coachUserId: number, athleteUserId: number): Promise<boolean> {
  const link = await db.get(`SELECT 1 FROM coach_athletes WHERE coach_user_id = ? AND athlete_user_id = ? AND status = 'accepted'`, [
    coachUserId,
    athleteUserId,
  ]);
  return !!link;
}

// GET /api/coach/sessions/:sessionId/comments -> visible para el atleta dueño
// de la sesión y para cualquier coach con vínculo aceptado con ese atleta.
coachRouter.get(
  "/sessions/:sessionId/comments",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const session = await db.get<{ client_id: string }>(`SELECT client_id FROM sessions WHERE id = ?`, [req.params.sessionId]);
    if (!session) return res.status(404).json({ error: "Sesión no encontrada" });

    const isOwner = session.client_id === String(userId);
    const athleteUserId = Number(session.client_id);
    const isLinkedCoach = Number.isInteger(athleteUserId) && (await hasAcceptedLink(userId, athleteUserId));
    if (!isOwner && !isLinkedCoach) return res.status(403).json({ error: "No tenés acceso a esta sesión" });

    const comments = await db.all(
      `SELECT sc.id, sc.comment, sc.created_at, u.email as coach_email
       FROM session_comments sc JOIN users u ON u.id = sc.coach_user_id
       WHERE sc.session_id = ? ORDER BY sc.created_at ASC`,
      [req.params.sessionId]
    );
    res.json(comments);
  })
);

// POST /api/coach/sessions/:sessionId/comments { comment } -> solo un coach
// con vínculo aceptado con el dueño de la sesión puede comentarla.
coachRouter.post(
  "/sessions/:sessionId/comments",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const parsed = z.object({ comment: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const session = await db.get<{ client_id: string }>(`SELECT client_id FROM sessions WHERE id = ?`, [req.params.sessionId]);
    if (!session) return res.status(404).json({ error: "Sesión no encontrada" });

    const athleteUserId = Number(session.client_id);
    if (!Number.isInteger(athleteUserId) || !(await hasAcceptedLink(userId, athleteUserId))) {
      return res.status(403).json({ error: "No tenés un vínculo aceptado con el dueño de esta sesión" });
    }

    await db.run(`INSERT INTO session_comments (session_id, coach_user_id, comment) VALUES (?, ?, ?)`, [
      req.params.sessionId,
      userId,
      parsed.data.comment,
    ]);
    res.status(201).json({ ok: true });
  })
);
