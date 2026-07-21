import { getClientId } from "./clientId";
import { getToken, AuthUser } from "./authToken";
import type { components } from "./schema";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": getClientId(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Error ${res.status}`);
  }
  return res.json();
}

// Tipos generados desde el contrato OpenAPI del backend (backend/openapi.json
// -> schema.d.ts vía `npm run gen:api-types`), en vez de redefinirlos a mano.
// Si el backend cambia un campo, correr `npm run openapi:generate` en backend/
// y `npm run gen:api-types` acá: un campo roto se ve en este archivo en build
// time, no en runtime.
export type WorkoutType = components["schemas"]["WorkoutType"];
export type ExerciseInfo = components["schemas"]["ExerciseInfo"];
export type NewRecord = components["schemas"]["NewRecord"];
export type SessionResult = components["schemas"]["SessionResult"];
export type SessionSummary = components["schemas"]["SessionSummary"];
export type SessionDetail = components["schemas"]["SessionDetail"];
export type HistoryEntry = components["schemas"]["HistoryEntry"];
export type LatestSet = components["schemas"]["LatestSet"];
export type ExerciseListEntry = components["schemas"]["ExerciseListEntry"];
export type PersonalRecord = components["schemas"]["PersonalRecord"];
export type Biometric = components["schemas"]["Biometric"];
export type UserProfile = components["schemas"]["UserProfile"];
export type PlanDay = components["schemas"]["PlanDay"];
export type PlannedDay = components["schemas"]["PlannedDay"];
export type WeeklyPlanResponse = components["schemas"]["WeeklyPlanResponse"];
export type MesocyclePhase = components["schemas"]["MesocyclePhase"];
export type CustomRoutine = components["schemas"]["CustomRoutine"];

// Shapes de request que arma el frontend antes de mandarlas (no son
// respuestas del server, quedan a mano — son simples y estables).
export type SetInput = { weight_kg: number; reps: number; is_warmup?: boolean; rir?: number };
export type SessionExerciseInput = {
  exercise_name: string;
  sets: SetInput[];
};

export type InviteCode = components["schemas"]["InviteCode"];
export type PendingRequest = components["schemas"]["PendingRequest"];
export type CoachAthlete = components["schemas"]["CoachAthlete"];
export type SessionComment = components["schemas"]["SessionComment"];
export type TrainingMode = components["schemas"]["TrainingModeConfig"]["mode"];
export type TrainingModeConfig = components["schemas"]["TrainingModeConfig"];
export type SuggestedPlanResponse = components["schemas"]["SuggestedPlanResponse"];
export type CubanMethodWeek = components["schemas"]["CubanMethodWeek"];
export type RestSuggestion = components["schemas"]["RestSuggestion"];
export type ProgressionSuggestion = components["schemas"]["ProgressionSuggestion"];
export type PrsByWeekdayEntry = components["schemas"]["PrsByWeekdayEntry"];
export type StrengthTest = components["schemas"]["StrengthTest"];
export type CardioSession = components["schemas"]["CardioSession"];

// Endpoints de lectura que soportan modo coach: si se pasa asAthleteId y hay
// vínculo aceptado, el server devuelve los datos del atleta en vez de los
// propios (ver backend/src/auth/coachAccess.ts). Se ignora silenciosamente
// del lado del server si no hay vínculo — acá solo arma el query param.
function withAthleteParam(path: string, asAthleteId?: number): string {
  if (!asAthleteId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}as_athlete_id=${asAthleteId}`;
}

export const api = {
  getWorkoutTypes: () => request<WorkoutType[]>("/workout-types"),
  getWorkoutTypeExercises: (id: string) => request<ExerciseInfo[]>(`/workout-types/${id}/exercises`),
  addExercise: (id: string, exercise_name: string, target_sets?: number | null, target_reps?: string | null) =>
    request(`/workout-types/${id}/exercises`, { method: "POST", body: JSON.stringify({ exercise_name, target_sets, target_reps }) }),
  patchExercise: (id: string, exerciseName: string, target_sets: number | null, target_reps: string | null) =>
    request(`/workout-types/${id}/exercises/${encodeURIComponent(exerciseName)}`, { method: "PATCH", body: JSON.stringify({ target_sets, target_reps }) }),
  removeExercise: (id: string, exerciseName: string) =>
    request(`/workout-types/${id}/exercises/${encodeURIComponent(exerciseName)}`, { method: "DELETE" }),

  createSession: (payload: {
    date: string;
    workout_type_id?: string;
    custom_routine_id?: number;
    exercises: SessionExerciseInput[];
    rpe?: number;
    started_at?: string;
    ended_at?: string;
  }) => request<SessionResult>("/sessions", { method: "POST", body: JSON.stringify(payload) }),
  getSessions: (from?: string, to?: string, asAthleteId?: number) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<SessionSummary[]>(withAthleteParam(`/sessions${suffix}`, asAthleteId));
  },
  getSessionDetail: (id: number, asAthleteId?: number) =>
    request<SessionDetail>(withAthleteParam(`/sessions/${id}`, asAthleteId)),

  checkAlert: (workoutTypeId: string, date: string) =>
    request<components["schemas"]["AlertCheck"]>(`/alerts/check?workout_type_id=${workoutTypeId}&date=${date}`),

  getExerciseNames: () => request<string[]>("/exercises"),
  getExerciseList: (asAthleteId?: number) => request<ExerciseListEntry[]>(withAthleteParam("/history", asAthleteId)),
  getPrsByWeekday: (asAthleteId?: number) => request<PrsByWeekdayEntry[]>(withAthleteParam("/history/prs-by-weekday", asAthleteId)),
  getRestSuggestion: (exerciseName: string, weightKg: number) =>
    request<RestSuggestion>(`/history/${encodeURIComponent(exerciseName)}/rest-suggestion?weight_kg=${weightKg}`),
  getExerciseHistory: (exerciseName: string, asAthleteId?: number) =>
    request<HistoryEntry[]>(withAthleteParam(`/history/${encodeURIComponent(exerciseName)}`, asAthleteId)),
  getLatestSets: (exerciseName: string) =>
    request<LatestSet[]>(`/history/${encodeURIComponent(exerciseName)}/latest`),
  getExerciseRecords: (exerciseName: string, asAthleteId?: number) =>
    // PersonalRecord ya incluye `| null` (así lo expone el contrato: sin PR todavía).
    request<PersonalRecord>(withAthleteParam(`/history/${encodeURIComponent(exerciseName)}/records`, asAthleteId)),
  getProgressionSuggestion: (exerciseName: string, mode?: TrainingMode, asAthleteId?: number) => {
    const path = `/history/${encodeURIComponent(exerciseName)}/suggestion`;
    const withMode = mode ? `${path}?mode=${mode}` : path;
    return request<ProgressionSuggestion>(withAthleteParam(withMode, asAthleteId));
  },

  getCustomRoutines: () => request<CustomRoutine[]>("/custom-routines"),
  createCustomRoutine: (payload: { name: string; exercises: string[] }) =>
    request<{ id: number; name: string }>("/custom-routines", { method: "POST", body: JSON.stringify(payload) }),
  deleteCustomRoutine: (id: number) =>
    request(`/custom-routines/${id}`, { method: "DELETE" }),
  getCustomRoutineExercises: (id: number) =>
    request<ExerciseInfo[]>(`/custom-routines/${id}/exercises`),
  addExerciseToRoutine: (id: number, exercise_name: string, target_sets?: number | null, target_reps?: string | null) =>
    request(`/custom-routines/${id}/exercises`, { method: "POST", body: JSON.stringify({ exercise_name, target_sets, target_reps }) }),
  patchRoutineExercise: (id: number, exerciseName: string, target_sets: number | null, target_reps: string | null) =>
    request(`/custom-routines/${id}/exercises/${encodeURIComponent(exerciseName)}`, { method: "PATCH", body: JSON.stringify({ target_sets, target_reps }) }),
  removeExerciseFromRoutine: (id: number, name: string) =>
    request(`/custom-routines/${id}/exercises/${encodeURIComponent(name)}`, { method: "DELETE" }),

  upsertBiometric: (payload: { date: string; weight_kg?: number; feeling?: number }) =>
    request("/biometrics", { method: "POST", body: JSON.stringify(payload) }),
  getBiometrics: (asAthleteId?: number) => request<Biometric[]>(withAthleteParam("/biometrics", asAthleteId)),

  getProfile: () => request<UserProfile>("/profile"),
  putProfile: (payload: { height_cm?: number; training_mode?: TrainingMode; pro_enabled?: boolean }) =>
    request("/profile", { method: "PUT", body: JSON.stringify(payload) }),
  getTrainingModes: () => request<TrainingModeConfig[]>("/profile/training-modes"),

  savePlan: (payload: {
    week_start: string;
    days: { date: string; workout_type_id: string }[];
    mesocycle_phase?: MesocyclePhase;
  }) => request("/weekly-plan", { method: "POST", body: JSON.stringify(payload) }),
  getPlan: (weekStart: string, asAthleteId?: number) =>
    request<WeeklyPlanResponse>(withAthleteParam(`/weekly-plan/${weekStart}`, asAthleteId)),
  markPlanDayDone: (weekStart: string, date: string) =>
    request(`/weekly-plan/${weekStart}/mark-done`, { method: "POST", body: JSON.stringify({ date }) }),
  getPlannedForDate: (date: string) =>
    // PlannedDay ya incluye `| null` (sin nada planificado para ese día exacto).
    request<PlannedDay>(`/weekly-plan/for-date/${date}`),
  getSuggestedPlan: () => request<SuggestedPlanResponse>("/weekly-plan/suggested"),
  getCubanMethodTemplate: () => request<{ weeks: CubanMethodWeek[] }>("/weekly-plan/cuban-method-template"),

  getStreak: (asAthleteId?: number) =>
    request<components["schemas"]["StreakResponse"]>(withAthleteParam("/streak", asAthleteId)),

  exportData: () => request<Record<string, unknown>>("/export"),

  register: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<components["schemas"]["OkResponse"]>("/auth/logout", { method: "POST" }),
  // Se llama con el token de la cuenta recién creada, ANTES de setSession
  // (por eso no puede pasar por request(), que usa el token ya guardado) —
  // ver AccountPanel.tsx.
  migrateAnonymousData: (token: string, anonymousClientId: string) =>
    fetch(`${API_BASE}/auth/migrate-anonymous-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonymous_client_id: anonymousClientId }),
    }).then((res) => {
      if (!res.ok) throw new Error(`Error ${res.status}`);
      return res.json();
    }),

  getInviteCode: () => request<InviteCode | null>("/coach/invite-code"),
  generateInviteCode: () => request<InviteCode>("/coach/invite-code", { method: "POST" }),
  requestCoachLink: (code: string) =>
    request<components["schemas"]["OkResponse"]>("/coach/link-requests", { method: "POST", body: JSON.stringify({ code }) }),
  getPendingRequests: () => request<PendingRequest[]>("/coach/pending-requests"),
  acceptLinkRequest: (id: number) =>
    request<components["schemas"]["OkResponse"]>(`/coach/link-requests/${id}/accept`, { method: "POST" }),
  rejectLinkRequest: (id: number) =>
    request<components["schemas"]["OkResponse"]>(`/coach/link-requests/${id}/reject`, { method: "POST" }),
  getCoachAthletes: () => request<CoachAthlete[]>("/coach/athletes"),
  getSessionComments: (sessionId: number) => request<SessionComment[]>(`/coach/sessions/${sessionId}/comments`),
  addSessionComment: (sessionId: number, comment: string) =>
    request<components["schemas"]["OkResponse"]>(`/coach/sessions/${sessionId}/comments`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),

  createStrengthTest: (payload: {
    date: string;
    test_type: "salto_simple" | "drop_jump";
    flight_time_sec: number;
    contact_time_sec?: number;
    drop_height_cm?: number;
  }) => request<StrengthTest>("/strength-tests", { method: "POST", body: JSON.stringify(payload) }),
  getStrengthTests: (asAthleteId?: number) => request<StrengthTest[]>(withAthleteParam("/strength-tests", asAthleteId)),

  createCardioSession: (payload: { date: string; activity_type: "cardio" | "tecnico_tactico" | "otro"; duration_min: number; notes?: string }) =>
    request<CardioSession>("/cardio-sessions", { method: "POST", body: JSON.stringify(payload) }),
  getCardioSessions: (asAthleteId?: number) => request<CardioSession[]>(withAthleteParam("/cardio-sessions", asAthleteId)),
};
