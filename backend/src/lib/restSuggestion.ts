import { classifyZone, IntensityZone } from "./intensityZones.js";

// Descanso sugerido según la zona de intensidad de la serie recién cargada
// (Manual Anselmi §2.5): 2-3 min de descanso a 90-100% 1RM para atletas
// livianos, hasta 6 min para pesados — se toma un punto medio de referencia
// por zona, no un rango, para que el timer tenga un solo valor por defecto
// (el usuario lo puede cortar o dejar correr igual que con el timer fijo de
// siempre). Las series de "transferencia"/potencia nunca deberían superar 6
// segundos de EJECUCIÓN (no de descanso) — eso no se puede controlar acá,
// queda como nota informativa.
export type RestSuggestion = { rest_seconds: number; zone: IntensityZone | null; note: string | null };

const REST_SECONDS_BY_ZONE: Record<IntensityZone, number> = {
  fuerza_maxima: 240,
  hipertrofia: 120,
  adaptacion: 90,
  potencia: 90,
  otra: 90,
};

const NOTE_BY_ZONE: Partial<Record<IntensityZone, string>> = {
  potencia: "Serie de potencia: no superar 6s de ejecución.",
};

export function suggestRestSeconds(intensidadPct: number | null): RestSuggestion {
  const zone = classifyZone(intensidadPct);
  if (zone === null) return { rest_seconds: 90, zone: null, note: null };
  return { rest_seconds: REST_SECONDS_BY_ZONE[zone], zone, note: NOTE_BY_ZONE[zone] ?? null };
}
