import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { initDb } from "./db.js";

import { workoutTypesRouter } from "./routes/workoutTypes.js";
import { sessionsRouter } from "./routes/sessions.js";
import { historyRouter } from "./routes/history.js";
import { biometricsRouter } from "./routes/biometrics.js";
import { weeklyPlanRouter } from "./routes/weeklyPlan.js";
import { alertsRouter } from "./routes/alerts.js";
import { customRoutinesRouter } from "./routes/customRoutines.js";
import { profileRouter } from "./routes/profile.js";
import { exercisesRouter } from "./routes/exercises.js";
import { streakRouter } from "./routes/streak.js";
import { exportRouter } from "./routes/export.js";
import { authRouter } from "./routes/auth.js";
import { coachRouter } from "./routes/coach.js";
import { strengthTestsRouter } from "./routes/strengthTests.js";
import { cardioSessionsRouter } from "./routes/cardioSessions.js";
import { requireIdentity } from "./middleware/auth.js";

// Separado de index.ts para poder testear la API real (vía HTTP contra un
// puerto efímero + DB temporal) sin arrancar el servidor de desarrollo.
export const app = express();

// FRONTEND_ORIGIN restringe CORS al dominio real del frontend en producción
// (Vercel). Sin esa variable (desarrollo local, o instalaciones que corren
// todo en LAN) queda abierto como siempre — nunca lo contrario: no hay forma
// de "abrir sin querer" en producción por olvidar setear la variable, el
// default es el modo restringido en cuanto Render la exige para el service.
const frontendOrigin = process.env.FRONTEND_ORIGIN;
app.use(cors(frontendOrigin ? { origin: frontendOrigin } : {}));
app.use(express.json());

// index.ts (y test-helpers.ts) esperan esta promesa antes de aceptar tráfico
// real: el montaje de rutas de acá abajo es síncrono (no toca la base), pero
// ningún request debe procesarse antes de que el schema/seed esté listo.
export const dbReady = initDb();

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "forja-backend" }));

// Auth se monta antes de requireIdentity: registrarse/loguearse es, por
// definición, no tener identidad todavía.
app.use("/api/auth", authRouter);

app.use("/api", requireIdentity);

app.use("/api/workout-types", workoutTypesRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/history", historyRouter);
app.use("/api/biometrics", biometricsRouter);
app.use("/api/weekly-plan", weeklyPlanRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/custom-routines", customRoutinesRouter);
app.use("/api/profile", profileRouter);
app.use("/api/exercises", exercisesRouter);
app.use("/api/streak", streakRouter);
app.use("/api/export", exportRouter);
app.use("/api/coach", coachRouter);
app.use("/api/strength-tests", strengthTestsRouter);
app.use("/api/cardio-sessions", cardioSessionsRouter);

// Manejo de errores centralizado: cualquier throw dentro de un handler (incluidos
// los rollbacks de transacción en las rutas) cae acá en vez de filtrar una traza
// cruda al cliente. Debe ir después de montar todas las rutas.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  const isDev = process.env.NODE_ENV !== "production";
  const message = isDev && err instanceof Error ? err.message : "Error interno del servidor";
  res.status(500).json({ error: message });
});
