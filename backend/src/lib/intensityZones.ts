// Zonas de intensidad relativa al PR de peso del ejercicio (Manual Anselmi):
// 90-100% fuerza máxima, 75-90% hipertrofia, 50-75% adaptación, 25-35%
// potencia (a máxima velocidad, no aplica acá pero se clasifica igual por
// rango), cualquier otro valor queda como "otra". Usado tanto en el resumen
// de sesión (sessions.ts) como en el detalle de ejercicio (history.ts).
export type IntensityZone = "fuerza_maxima" | "hipertrofia" | "adaptacion" | "potencia" | "otra";

export function classifyZone(pct: number | null): IntensityZone | null {
  if (pct === null) return null;
  if (pct >= 90 && pct <= 100) return "fuerza_maxima";
  if (pct >= 75 && pct < 90) return "hipertrofia";
  if (pct >= 50 && pct < 75) return "adaptacion";
  if (pct >= 25 && pct < 35) return "potencia";
  return "otra";
}
