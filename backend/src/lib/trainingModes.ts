// Constantes de referencia por modo de entrenamiento (no un algoritmo de
// personalización): rango de reps sugerido, descanso default y umbral de RIR
// para sugerir subir peso. Valores de referencia ajustables, no medidos por
// usuario. Ver PROMPT_CLAUDE_CODE.md (Fase 7) para la justificación de estos
// números — no son mágicos, son un punto de partida razonable.
export type TrainingMode = "fuerza" | "hipertrofia" | "mantenimiento";

export type ModeConfig = {
  mode: TrainingMode;
  label: string;
  rep_range_min: number;
  rep_range_max: number;
  rest_seconds: number;
  // Si TODAS las series de trabajo llegan al techo del rango de reps con RIR
  // menor o igual a este umbral, se sugiere subir peso la próxima vez.
  progression_rir_threshold: number;
};

export const TRAINING_MODES: Record<TrainingMode, ModeConfig> = {
  fuerza: {
    mode: "fuerza",
    label: "Fuerza",
    rep_range_min: 2,
    rep_range_max: 6,
    rest_seconds: 240,
    progression_rir_threshold: 2,
  },
  hipertrofia: {
    mode: "hipertrofia",
    label: "Hipertrofia",
    rep_range_min: 6,
    rep_range_max: 12,
    rest_seconds: 75,
    progression_rir_threshold: 1,
  },
  mantenimiento: {
    mode: "mantenimiento",
    label: "Mantenimiento",
    rep_range_min: 8,
    rep_range_max: 12,
    rest_seconds: 75,
    progression_rir_threshold: 1,
  },
};

export function isTrainingMode(value: unknown): value is TrainingMode {
  return value === "fuerza" || value === "hipertrofia" || value === "mantenimiento";
}
