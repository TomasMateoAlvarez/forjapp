// Aritmética de fechas en formato YYYY-MM-DD, siempre en UTC (para no
// corrimientos por timezone local del server) y a mediodía (para no caer del
// otro lado de un cambio de horario de verano si algún día corre en un
// entorno que lo tenga). Antes esta lógica estaba duplicada entre streak.ts
// y weeklyPlan.ts con pequeñas variaciones — se consolida acá para poder
// testear los casos límite (cambio de año, semana parcial) en un solo lugar.

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

// Lunes de la semana que contiene dateISO (0=domingo..6=sábado en getUTCDay).
export function mondayOfISO(dateISO: string): string {
  const d = new Date(dateISO + "T12:00:00Z");
  const daysFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return toISODate(d);
}
