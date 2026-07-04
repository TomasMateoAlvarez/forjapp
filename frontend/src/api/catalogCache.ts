// Cache local del catálogo (tipos de entreno, rutinas propias, ejercicios por
// tipo) para que "Hoy" pueda mostrar algo aunque el backend no responda. Se
// actualiza automáticamente cada vez que un fetch real tiene éxito.
import { WorkoutType, CustomRoutine, ExerciseInfo } from "./client";

const CACHE_KEY = "forja_catalog_cache_v1";

type CatalogCache = {
  workoutTypes: WorkoutType[];
  customRoutines: CustomRoutine[];
  exercisesByKey: Record<string, ExerciseInfo[]>;
  cachedAt: string;
};

function load(): CatalogCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CatalogCache) : null;
  } catch {
    return null;
  }
}

function save(cache: CatalogCache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage lleno o no disponible: no rompemos el flujo por esto
  }
}

export function saveCatalog(workoutTypes: WorkoutType[], customRoutines: CustomRoutine[]) {
  const current = load();
  save({
    workoutTypes,
    customRoutines,
    exercisesByKey: current?.exercisesByKey ?? {},
    cachedAt: new Date().toISOString(),
  });
}

export function loadCatalog(): { workoutTypes: WorkoutType[]; customRoutines: CustomRoutine[]; cachedAt: string } | null {
  const c = load();
  if (!c) return null;
  return { workoutTypes: c.workoutTypes, customRoutines: c.customRoutines, cachedAt: c.cachedAt };
}

export function saveExercisesFor(key: string, exercises: ExerciseInfo[]) {
  const current = load();
  if (!current) return; // sin catálogo base todavía no tiene sentido cachear esto sólo
  current.exercisesByKey[key] = exercises;
  current.cachedAt = new Date().toISOString();
  save(current);
}

export function loadExercisesFor(key: string): ExerciseInfo[] | null {
  const current = load();
  return current?.exercisesByKey[key] ?? null;
}
