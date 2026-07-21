import { db } from "../db.js";

// Promedio simple de %PR (peso de la serie / mejor peso histórico del
// ejercicio × 100) sobre un conjunto de series de trabajo. Series de
// ejercicios sin PR todavía se excluyen del promedio (no hay con qué
// comparar). Compartido entre el resumen de sesión, la alerta de tendencia
// y la comparación de fase de mesociclo — antes esta cuenta vivía duplicada
// en cada lugar que la necesitaba.
export async function averageIntensityPct(
  clientId: string,
  sets: { exercise_name: string; weight_kg: number }[]
): Promise<number | null> {
  if (sets.length === 0) return null;

  const prCache = new Map<string, number | null>();
  const intensities: number[] = [];
  for (const s of sets) {
    if (!prCache.has(s.exercise_name)) {
      const pr = await db.get<{ best_weight_kg: number }>(
        `SELECT best_weight_kg FROM personal_records WHERE client_id = ? AND exercise_name = ?`,
        [clientId, s.exercise_name]
      );
      prCache.set(s.exercise_name, pr?.best_weight_kg ?? null);
    }
    const prWeight = prCache.get(s.exercise_name);
    if (prWeight) intensities.push((s.weight_kg / prWeight) * 100);
  }

  return intensities.length > 0 ? intensities.reduce((a, b) => a + b, 0) / intensities.length : null;
}
