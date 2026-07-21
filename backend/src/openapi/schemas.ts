import "./zod-setup.js";
import { z } from "zod";
import { mesocyclePhaseSchema } from "../routes/weeklyPlan.js";

// Schemas de RESPUESTA: no existían como zod en las rutas (que hoy solo
// validan el body de entrada) — se definen acá, a partir de los tipos que
// hasta ahora vivían redefinidos a mano en frontend/src/api/client.ts, para
// que ese archivo pase a generarse desde acá en vez de mantenerse en paralelo.

export const WorkoutType = z
  .object({
    id: z.string(),
    label: z.string(),
    muscle_group: z.string(),
  })
  .openapi("WorkoutType");

export const ExerciseInfo = z
  .object({
    exercise_name: z.string(),
    default_rest_seconds: z.number(),
    target_sets: z.number().nullable(),
    target_reps: z.string().nullable(),
  })
  .openapi("ExerciseInfo");

export const NewRecord = z
  .object({
    exercise_name: z.string(),
    type: z.enum(["weight", "volume"]),
  })
  .openapi("NewRecord");

export const SessionResult = z
  .object({
    id: z.number(),
    date: z.string(),
    workout_type_id: z.string().nullish(),
    custom_routine_id: z.number().nullish(),
    new_records: z.array(NewRecord),
  })
  .openapi("SessionResult");

export const SessionSummary = z
  .object({
    id: z.number(),
    date: z.string(),
    workout_type_id: z.string().nullable(),
    custom_routine_id: z.number().nullable(),
    workout_label: z.string(),
    // RPE de la sesión completa (1-10), distinto del RIR por serie.
    rpe: z.number().nullable(),
  })
  .openapi("SessionSummary");

export const SessionExerciseSet = z
  .object({
    exercise_name: z.string(),
    weight_kg: z.number(),
    reps: z.number(),
    set_number: z.number(),
  })
  .openapi("SessionExerciseSet");

export const SessionDetail = SessionSummary.extend({
  // Resumen de indicadores sobre las series de trabajo (Manual Anselmi).
  tonelaje_total: z.number(),
  peso_medio: z.number().nullable(),
  intensidad_promedio_pct: z.number().nullable(),
  // Capturados por el cliente al abrir/cerrar la sesión; habilitan los dos
  // campos siguientes (Peter Sisco). null si el cliente no los mandó.
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  indice_hipertrofia: z.number().nullable(),
  coeficiente_hipertrofia: z.number().nullable(),
  exercises: z.array(SessionExerciseSet),
}).openapi("SessionDetail");

export const IntensityZone = z.enum(["fuerza_maxima", "hipertrofia", "adaptacion", "potencia", "otra"]);

export const HistoryEntry = z
  .object({
    date: z.string(),
    weight_kg: z.number(),
    reps: z.number(),
    set_number: z.number(),
    is_warmup: z.boolean(),
    // null en series de calentamiento; tonelaje = peso × reps, intensidad_pct
    // relativa al PR de peso actual del ejercicio, zona clasificada a partir de eso.
    tonelaje: z.number().nullable(),
    intensidad_pct: z.number().nullable(),
    zona: IntensityZone.nullable(),
  })
  .openapi("HistoryEntry");

export const PrsByWeekdayEntry = z
  .object({
    weekday_index: z.number(),
    label: z.string(),
    count: z.number(),
  })
  .openapi("PrsByWeekdayEntry");

export const LatestSet = z
  .object({
    weight_kg: z.number(),
    reps: z.number(),
    set_number: z.number(),
  })
  .openapi("LatestSet");

export const ExerciseListEntry = z
  .object({
    exercise_name: z.string(),
    entries: z.number(),
    last_date: z.string(),
  })
  .openapi("ExerciseListEntry");

export const PersonalRecord = z
  .object({
    exercise_name: z.string(),
    best_weight_kg: z.number(),
    best_weight_date: z.string(),
    best_volume: z.number(),
    best_volume_date: z.string(),
  })
  .openapi("PersonalRecord");

export const Biometric = z
  .object({
    id: z.number(),
    date: z.string(),
    weight_kg: z.number().nullable(),
    height_cm: z.number().nullable(),
    feeling: z.number().nullable(),
  })
  .openapi("Biometric");

export const TrainingModeEnum = z.enum(["fuerza", "hipertrofia", "mantenimiento"]);

export const UserProfile = z
  .object({
    height_cm: z.number().nullable(),
    training_mode: TrainingModeEnum.nullable(),
    // Flag de UI (Métricas Pro): controla qué paneles/gráficos "avanzados"
    // (indicadores Anselmi, tests de salto, método cubano, cardio/mixtas, RPE
    // de sesión) renderiza el frontend — no es un paywall real, el backend
    // calcula todo igual sin importar este valor.
    pro_enabled: z.boolean(),
  })
  .openapi("UserProfile");

export const TrainingModeConfig = z
  .object({
    mode: TrainingModeEnum,
    label: z.string(),
    rep_range_min: z.number(),
    rep_range_max: z.number(),
    rest_seconds: z.number(),
    progression_rir_threshold: z.number(),
  })
  .openapi("TrainingModeConfig");

export const SuggestedPlanDay = z
  .object({
    weekday_index: z.number(),
    workout_type_id: z.string().nullable(),
  })
  .openapi("SuggestedPlanDay");

export const SuggestedPlanResponse = z
  .object({
    days: z.array(SuggestedPlanDay),
  })
  .openapi("SuggestedPlanResponse");

export const CubanMethodWeek = z
  .object({
    week_number: z.number(),
    volume_pct: z.number(),
    mesocycle_phase: mesocyclePhaseSchema,
  })
  .openapi("CubanMethodWeek");

export const CubanMethodTemplateResponse = z
  .object({
    weeks: z.array(CubanMethodWeek),
  })
  .openapi("CubanMethodTemplateResponse");

export const RestSuggestion = z
  .object({
    rest_seconds: z.number(),
    zone: IntensityZone.nullable(),
    note: z.string().nullable(),
  })
  .openapi("RestSuggestion");

export const ProgressionSuggestion = z
  .object({
    mode: TrainingModeEnum,
    action: z.enum(["subir_peso", "mantener", "bajar", "sin_datos"]),
    reason: z.string(),
  })
  .openapi("ProgressionSuggestion");

export const PlanDay = z
  .object({
    date: z.string(),
    planned_workout_type_id: z.string().nullable(),
    planned_label: z.string().nullable(),
    actual_workout_type_id: z.string().nullable(),
    actual_label: z.string().nullable(),
    done: z.boolean(),
  })
  .openapi("PlanDay");

// mesocyclePhaseSchema (definido una sola vez en weeklyPlan.ts, reusado acá)
// no está registrado con .openapi(), así que .nullable() sobre él no
// contamina nada: MesocyclePhase (abajo) es la única versión con nombre
// para el contrato, y se registra explícitamente en registry.ts porque no
// queda referenciada por $ref en ningún path (mesocycle_phase va inline).
export const MesocyclePhase = mesocyclePhaseSchema.openapi("MesocyclePhase");

export const WeeklyPlanResponse = z
  .object({
    week_start: z.string(),
    // Campo declarativo simple (sin motor de periodización) + comparación
    // contra la intensidad real de la semana ya calculada.
    mesocycle_phase: mesocyclePhaseSchema.nullable(),
    week_intensity_pct: z.number().nullable(),
    mesocycle_discrepancy: z.string().nullable(),
    days: z.array(PlanDay),
  })
  .openapi("WeeklyPlanResponse");

export const PlannedDay = z
  .object({
    workout_type_id: z.string(),
    workout_label: z.string(),
  })
  .openapi("PlannedDay");

export const CustomRoutine = z
  .object({
    id: z.number(),
    name: z.string(),
    created_at: z.string(),
  })
  .openapi("CustomRoutine");

export const AlertCheck = z
  .object({
    warning: z.boolean(),
    message: z.string().nullable(),
    // Segunda alerta, independiente: 3+ semanas seguidas de intensidad alta
    // (75%+) en el mismo grupo muscular sin una semana de menor intensidad.
    trend_warning: z.boolean(),
    trend_message: z.string().nullable(),
  })
  .openapi("AlertCheck");

export const StreakResponse = z.object({ weeks: z.number() }).openapi("StreakResponse");

export const OkResponse = z.object({ ok: z.boolean() }).openapi("OkResponse");

export const AuthUser = z.object({ id: z.number(), email: z.string() }).openapi("AuthUser");

export const AuthResponse = z
  .object({
    token: z.string(),
    user: AuthUser,
  })
  .openapi("AuthResponse");

export const ErrorResponse = z.object({ error: z.unknown() }).openapi("ErrorResponse");

// Cuerpos de request que hoy no tienen zod en su ruta (workout-types y
// custom-routines exercises usan `req.body as {...}` sin validar en runtime)
// — se definen acá recién para el contrato; no se cablean todavía en el
// handler real, para no cambiar comportamiento de validación en esta fase.
export const ExerciseUpsertBody = z
  .object({
    exercise_name: z.string().min(1),
    target_sets: z.number().nullable().optional(),
    target_reps: z.string().nullable().optional(),
  })
  .openapi("ExerciseUpsertBody");

export const ExercisePatchBody = z
  .object({
    target_sets: z.number().nullable(),
    target_reps: z.string().nullable(),
  })
  .openapi("ExercisePatchBody");

export const MarkDoneBody = z.object({ date: z.string() }).openapi("MarkDoneBody");

// --- coach/atleta ---
export const InviteCode = z.object({ code: z.string() }).openapi("InviteCode");

export const LinkRequestBody = z.object({ code: z.string().min(1) }).openapi("LinkRequestBody");

export const PendingRequest = z
  .object({
    id: z.number(),
    coach_user_id: z.number(),
    coach_email: z.string(),
    created_at: z.string(),
  })
  .openapi("PendingRequest");

export const CoachAthlete = z
  .object({
    athlete_user_id: z.number(),
    athlete_email: z.string(),
    adherence_pct: z.number().nullable(),
    last_check_in: z.string().nullable(),
  })
  .openapi("CoachAthlete");

export const SessionCommentBody = z.object({ comment: z.string().min(1) }).openapi("SessionCommentBody");

export const StrengthTest = z
  .object({
    id: z.number(),
    date: z.string(),
    test_type: z.enum(["salto_simple", "drop_jump"]),
    flight_time_sec: z.number(),
    contact_time_sec: z.number().nullable(),
    drop_height_cm: z.number().nullable(),
    jump_height_cm: z.number(),
    reactive_stability_q: z.number().nullable(),
  })
  .openapi("StrengthTest");

export const CardioSession = z
  .object({
    id: z.number(),
    date: z.string(),
    activity_type: z.enum(["cardio", "tecnico_tactico", "otro"]),
    duration_min: z.number(),
    notes: z.string().nullable(),
  })
  .openapi("CardioSession");

export const SessionComment = z
  .object({
    id: z.number(),
    comment: z.string(),
    created_at: z.string(),
    coach_email: z.string(),
  })
  .openapi("SessionComment");
