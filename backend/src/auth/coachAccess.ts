import { Request } from "express";
import { db } from "../db.js";

// Usado solo en endpoints de LECTURA (sessions/history/biometrics/weekly-plan/
// streak GET). Si el request trae ?as_athlete_id=X y el usuario autenticado
// tiene un vínculo coach->atleta ACEPTADO con ese atleta, la consulta se hace
// con el client_id del atleta en vez del propio. Si no hay vínculo aceptado
// (o el request es legacy sin cuenta), se ignora el parámetro y cada quien ve
// lo suyo — nunca se rompe el aislamiento por un query param no verificado.
export async function resolveEffectiveClientId(req: Request): Promise<string> {
  const asAthleteId = req.query.as_athlete_id as string | undefined;
  if (!asAthleteId || !req.userId) return req.clientId;

  const athleteUserId = Number(asAthleteId);
  if (!Number.isInteger(athleteUserId)) return req.clientId;

  const link = await db.get(`SELECT 1 FROM coach_athletes WHERE coach_user_id = ? AND athlete_user_id = ? AND status = 'accepted'`, [
    req.userId,
    athleteUserId,
  ]);
  if (!link) return req.clientId;

  return String(athleteUserId);
}
