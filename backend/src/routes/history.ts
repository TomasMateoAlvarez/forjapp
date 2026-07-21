import { Router } from "express";
import { db } from "../db.js";
import { resolveEffectiveClientId } from "../auth/coachAccess.js";
import { isTrainingMode, ModeConfig, TRAINING_MODES } from "../lib/trainingModes.js";
import { classifyZone } from "../lib/intensityZones.js";
import { suggestRestSeconds } from "../lib/restSuggestion.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const historyRouter = Router();

type SuggestionAction = "subir_peso" | "mantener" | "bajar" | "sin_datos";

function computeSuggestion(mode: ModeConfig, sets: { reps: number; rir: number | null }[]): { action: SuggestionAction; reason: string } {
  if (sets.length === 0) {
    return { action: "sin_datos", reason: "Todavía no hay series de trabajo registradas para este ejercicio." };
  }

  const allAtOrAboveMax = sets.every((s) => s.reps >= mode.rep_range_max);
  const ririedSets = sets.filter((s) => s.rir !== null);
  const allLowRir = ririedSets.length > 0 && ririedSets.every((s) => (s.rir as number) <= mode.progression_rir_threshold);

  if (allAtOrAboveMax && (ririedSets.length === 0 || allLowRir)) {
    return {
      action: "subir_peso",
      reason: `Completaste ${mode.rep_range_max}+ reps en todas las series de trabajo${ririedSets.length > 0 ? " con RIR bajo" : ""} — la próxima vez probá con más peso.`,
    };
  }

  const allBelowMin = sets.every((s) => s.reps < mode.rep_range_min);
  if (allBelowMin) {
    return {
      action: "bajar",
      reason: `No llegaste a las ${mode.rep_range_min} reps mínimas del rango de ${mode.label.toLowerCase()} — probá con menos peso.`,
    };
  }

  return {
    action: "mantener",
    reason: `Estás dentro del rango de ${mode.rep_range_min}-${mode.rep_range_max} reps de ${mode.label.toLowerCase()} — mantené el peso.`,
  };
}

// GET /api/history -> lista de ejercicios con al menos un registro
historyRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const clientId = await resolveEffectiveClientId(req);
    const rows = await db.all(
      `SELECT exercise_name, COUNT(*) as entries, MAX(s.date) as last_date
       FROM session_exercises se JOIN sessions s ON s.id = se.session_id
       WHERE s.client_id = ?
       GROUP BY exercise_name
       ORDER BY last_date DESC`,
      [clientId]
    );
    res.json(rows);
  })
);

const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function mondayIndexedWeekday(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00Z");
  return (d.getUTCDay() + 6) % 7; // getUTCDay: 0=domingo..6=sábado -> 0=lunes..6=domingo
}

// GET /api/history/prs-by-weekday -> cuántos PRs históricos (peso + volumen)
// cayeron en cada día de la semana. Siempre devuelve los 7 días, con 0 si no
// hay datos — sin pedir ningún campo nuevo, solo cruza personal_records.
// Se registra ANTES de /:exerciseName para no chocar con esa ruta genérica.
historyRouter.get(
  "/prs-by-weekday",
  asyncHandler(async (req, res) => {
    const clientId = await resolveEffectiveClientId(req);
    const rows = await db.all<{ best_weight_date: string; best_volume_date: string }>(
      `SELECT best_weight_date, best_volume_date FROM personal_records WHERE client_id = ?`,
      [clientId]
    );

    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const r of rows) {
      counts[mondayIndexedWeekday(r.best_weight_date)]++;
      counts[mondayIndexedWeekday(r.best_volume_date)]++;
    }

    res.json(WEEKDAY_LABELS.map((label, i) => ({ weekday_index: i, label, count: counts[i] })));
  })
);

// GET /api/history/:exerciseName/latest -> series de trabajo del último día registrado
// (el calentamiento no se usa para precargar la próxima sesión)
historyRouter.get(
  "/:exerciseName/latest",
  asyncHandler(async (req, res) => {
    const clientId = await resolveEffectiveClientId(req);
    const rows = await db.all(
      `SELECT se.weight_kg, se.reps, se.set_number, se.rir
       FROM session_exercises se
       JOIN sessions s ON s.id = se.session_id
       WHERE s.client_id = ? AND se.exercise_name = ? AND se.is_warmup = 0
         AND s.date = (
           SELECT MAX(s2.date) FROM sessions s2
           JOIN session_exercises se2 ON se2.session_id = s2.id
           WHERE s2.client_id = ? AND se2.exercise_name = ? AND se2.is_warmup = 0
         )
       ORDER BY se.set_number`,
      [clientId, req.params.exerciseName, clientId, req.params.exerciseName]
    );
    res.json(rows);
  })
);

// GET /api/history/:exerciseName/suggestion?mode= -> sugerencia de progresión
// (subir/mantener/bajar peso) para la próxima vez, basada en el histórico ya
// calculado. El modo viene del query param o, si no se pasa, del perfil.
historyRouter.get(
  "/:exerciseName/suggestion",
  asyncHandler(async (req, res) => {
    const clientId = await resolveEffectiveClientId(req);
    const modeParam = req.query.mode as string | undefined;

    let mode: string;
    if (modeParam && isTrainingMode(modeParam)) {
      mode = modeParam;
    } else {
      const profile = await db.get<{ training_mode: string | null }>(`SELECT training_mode FROM user_profile WHERE client_id = ?`, [
        clientId,
      ]);
      if (!profile?.training_mode || !isTrainingMode(profile.training_mode)) {
        return res.status(400).json({
          error: "Elegí un modo de entrenamiento en tu perfil, o pasá ?mode=fuerza|hipertrofia|mantenimiento",
        });
      }
      mode = profile.training_mode;
    }

    const rows = await db.all<{ reps: number; rir: number | null }>(
      `SELECT se.reps, se.rir
       FROM session_exercises se
       JOIN sessions s ON s.id = se.session_id
       WHERE s.client_id = ? AND se.exercise_name = ? AND se.is_warmup = 0
         AND s.date = (
           SELECT MAX(s2.date) FROM sessions s2
           JOIN session_exercises se2 ON se2.session_id = s2.id
           WHERE s2.client_id = ? AND se2.exercise_name = ? AND se2.is_warmup = 0
         )`,
      [clientId, req.params.exerciseName, clientId, req.params.exerciseName]
    );

    const config = TRAINING_MODES[mode as keyof typeof TRAINING_MODES];
    const suggestion = computeSuggestion(config, rows);
    res.json({ mode, ...suggestion });
  })
);

// GET /api/history/:exerciseName/rest-suggestion?weight_kg= -> descanso
// sugerido para la serie que se acaba de cargar, según su intensidad relativa
// al PR de peso actual del ejercicio. Sin PR o sin weight_kg, devuelve el
// default de referencia (90s) con zone: null — no es bloqueante.
historyRouter.get(
  "/:exerciseName/rest-suggestion",
  asyncHandler(async (req, res) => {
    const weightKg = Number(req.query.weight_kg);
    if (!req.query.weight_kg || Number.isNaN(weightKg) || weightKg <= 0) {
      return res.status(400).json({ error: "Falta ?weight_kg= (número positivo)" });
    }
    const pr = await db.get<{ best_weight_kg: number }>(
      `SELECT best_weight_kg FROM personal_records WHERE client_id = ? AND exercise_name = ?`,
      [await resolveEffectiveClientId(req), req.params.exerciseName]
    );

    const intensidadPct = pr ? (weightKg / pr.best_weight_kg) * 100 : null;
    res.json(suggestRestSeconds(intensidadPct));
  })
);

// GET /api/history/:exerciseName/records -> récord personal de ese ejercicio
historyRouter.get(
  "/:exerciseName/records",
  asyncHandler(async (req, res) => {
    const row = await db.get(`SELECT * FROM personal_records WHERE client_id = ? AND exercise_name = ?`, [
      await resolveEffectiveClientId(req),
      req.params.exerciseName,
    ]);
    res.json(row ?? null);
  })
);

// GET /api/history/:exerciseName -> evolución completa del ejercicio (incluye
// series de calentamiento marcadas con is_warmup para que el cliente decida
// si mostrarlas, pero deben excluirse de cálculos de 1RM/volumen/PR). Para
// las series de trabajo agrega tonelaje, intensidad_pct (vs. PR de peso
// actual) y zona — null en las tres para series de calentamiento.
historyRouter.get(
  "/:exerciseName",
  asyncHandler(async (req, res) => {
    const clientId = await resolveEffectiveClientId(req);
    const rows = await db.all<{ date: string; weight_kg: number; reps: number; set_number: number; is_warmup: number }>(
      `SELECT s.date, se.weight_kg, se.reps, se.set_number, se.is_warmup
       FROM session_exercises se
       JOIN sessions s ON s.id = se.session_id
       WHERE s.client_id = ? AND se.exercise_name = ?
       ORDER BY s.date ASC, se.set_number ASC`,
      [clientId, req.params.exerciseName]
    );

    const pr = await db.get<{ best_weight_kg: number }>(
      `SELECT best_weight_kg FROM personal_records WHERE client_id = ? AND exercise_name = ?`,
      [clientId, req.params.exerciseName]
    );

    res.json(
      rows.map((r) => {
        const is_warmup = !!r.is_warmup;
        if (is_warmup) {
          return { ...r, is_warmup, tonelaje: null, intensidad_pct: null, zona: null };
        }
        const tonelaje = r.weight_kg * r.reps;
        const intensidad_pct = pr ? (r.weight_kg / pr.best_weight_kg) * 100 : null;
        return { ...r, is_warmup, tonelaje, intensidad_pct, zona: classifyZone(intensidad_pct) };
      })
    );
  })
);
