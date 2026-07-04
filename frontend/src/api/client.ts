import { getClientId } from "./clientId";

const API_BASE = "http://localhost:4000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Error ${res.status}`);
  }
  return res.json();
}

export type WorkoutType = { id: string; label: string; muscle_group: string };

export type SetInput = { weight_kg: number; reps: number; is_warmup?: boolean };

export type SessionExerciseInput = {
  exercise_name: string;
  sets: SetInput[];
};

export type SessionSummary = {
  id: number;
  date: string;
  workout_type_id: string;
  workout_label: string;
};

export type HistoryEntry = { date: string; weight_kg: number; reps: number; set_number: number; is_warmup: boolean };
export type LatestSet = { weight_kg: number; reps: number; set_number: number };
export type ExerciseListEntry = { exercise_name: string; entries: number; last_date: string };
export type ExerciseInfo = { exercise_name: string; default_rest_seconds: number; target_sets: number | null; target_reps: string | null };
export type NewRecord = { exercise_name: string; type: "weight" | "volume" };
export type SessionResult = { id: number; date: string; new_records: NewRecord[] };
export type CustomRoutine = { id: number; name: string; created_at: string };
export type PlannedDay = { workout_type_id: string; workout_label: string };
export type PersonalRecord = {
  exercise_name: string;
  best_weight_kg: number;
  best_weight_date: string;
  best_volume: number;
  best_volume_date: string;
};

export type Biometric = {
  id: number;
  date: string;
  weight_kg: number | null;
  height_cm: number | null;
  feeling: number | null;
};

export type UserProfile = { height_cm: number | null };

export type PlanDay = {
  date: string;
  planned_workout_type_id: string | null;
  planned_label: string | null;
  actual_workout_type_id: string | null;
  actual_label: string | null;
  done: boolean;
};

export const api = {
  getWorkoutTypes: () => request<WorkoutType[]>("/workout-types"),
  getWorkoutTypeExercises: (id: string) => request<ExerciseInfo[]>(`/workout-types/${id}/exercises`),
  addExercise: (id: string, exercise_name: string, target_sets?: number | null, target_reps?: string | null) =>
    request(`/workout-types/${id}/exercises`, { method: "POST", body: JSON.stringify({ exercise_name, target_sets, target_reps }) }),
  patchExercise: (id: string, exerciseName: string, target_sets: number | null, target_reps: string | null) =>
    request(`/workout-types/${id}/exercises/${encodeURIComponent(exerciseName)}`, { method: "PATCH", body: JSON.stringify({ target_sets, target_reps }) }),
  removeExercise: (id: string, exerciseName: string) =>
    request(`/workout-types/${id}/exercises/${encodeURIComponent(exerciseName)}`, { method: "DELETE" }),

  createSession: (payload: { date: string; workout_type_id?: string; custom_routine_id?: number; exercises: SessionExerciseInput[] }) =>
    request<SessionResult>("/sessions", { method: "POST", body: JSON.stringify(payload) }),
  getSessions: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<SessionSummary[]>(`/sessions${suffix}`);
  },

  checkAlert: (workoutTypeId: string, date: string) =>
    request<{ warning: boolean; message: string | null }>(
      `/alerts/check?workout_type_id=${workoutTypeId}&date=${date}`
    ),

  getExerciseNames: () => request<string[]>("/exercises"),
  getExerciseList: () => request<ExerciseListEntry[]>("/history"),
  getExerciseHistory: (exerciseName: string) =>
    request<HistoryEntry[]>(`/history/${encodeURIComponent(exerciseName)}`),
  getLatestSets: (exerciseName: string) =>
    request<LatestSet[]>(`/history/${encodeURIComponent(exerciseName)}/latest`),
  getExerciseRecords: (exerciseName: string) =>
    request<PersonalRecord | null>(`/history/${encodeURIComponent(exerciseName)}/records`),

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
  getBiometrics: () => request<Biometric[]>("/biometrics"),

  getProfile: () => request<UserProfile>("/profile"),
  putProfile: (height_cm: number) =>
    request("/profile", { method: "PUT", body: JSON.stringify({ height_cm }) }),

  savePlan: (payload: { week_start: string; days: { date: string; workout_type_id: string }[] }) =>
    request("/weekly-plan", { method: "POST", body: JSON.stringify(payload) }),
  getPlan: (weekStart: string) => request<{ week_start: string; days: PlanDay[] }>(`/weekly-plan/${weekStart}`),
  markPlanDayDone: (weekStart: string, date: string) =>
    request(`/weekly-plan/${weekStart}/mark-done`, { method: "POST", body: JSON.stringify({ date }) }),
  getPlannedForDate: (date: string) =>
    request<PlannedDay | null>(`/weekly-plan/for-date/${date}`),

  getStreak: () => request<{ weeks: number }>("/streak"),

  exportData: () => request<Record<string, unknown>>("/export"),
};
