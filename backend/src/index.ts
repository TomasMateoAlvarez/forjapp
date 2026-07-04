import express from "express";
import cors from "cors";
import "./db.js"; // inicializa y siembra la base de datos

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
import { requireClientId } from "./middleware/clientId.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "forja-backend" }));

app.use("/api", requireClientId);

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

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`FORJA backend corriendo en http://localhost:${PORT}`);
});
