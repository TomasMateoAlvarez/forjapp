import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestApp, jsonHeaders, uniqueClientId } from "../test-helpers.js";

let baseUrl: string;
let close: () => Promise<void>;

before(async () => {
  const app = await setupTestApp();
  baseUrl = app.baseUrl;
  close = app.close;
});

after(async () => {
  await close();
});

async function postSession(
  clientId: string,
  date: string,
  weight_kg: number,
  extra: Record<string, unknown> = {}
) {
  const res = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      date,
      workout_type_id: "pecho",
      exercises: [{ exercise_name: "Press banca", sets: [{ weight_kg, reps: 5 }] }],
      ...extra,
    }),
  });
  return res.json();
}

test("Índice y Coeficiente de Hipertrofia se calculan cuando hay started_at/ended_at", async () => {
  const clientId = uniqueClientId();
  const started = "2026-05-11T10:00:00.000Z";
  const ended = "2026-05-11T10:10:00.000Z"; // 10 minutos
  const created = await postSession(clientId, "2026-05-11", 100, { started_at: started, ended_at: ended });

  const res = await fetch(`${baseUrl}/sessions/${created.id}`, { headers: jsonHeaders(clientId) });
  const detail = await res.json();

  assert.equal(detail.tonelaje_total, 500); // 100kg * 5 reps
  assert.equal(detail.indice_hipertrofia, 50); // 500 / 10 min
  assert.equal(detail.coeficiente_hipertrofia, 25000); // 500^2 / 10
});

test("sin started_at/ended_at, los índices de hipertrofia quedan en null", async () => {
  const clientId = uniqueClientId();
  const created = await postSession(clientId, "2026-05-11", 100);

  const res = await fetch(`${baseUrl}/sessions/${created.id}`, { headers: jsonHeaders(clientId) });
  const detail = await res.json();

  assert.equal(detail.indice_hipertrofia, null);
  assert.equal(detail.coeficiente_hipertrofia, null);
});

test("alerta de tendencia: 3 semanas seguidas de intensidad alta (75%+) la dispara", async () => {
  const clientId = uniqueClientId();
  // PR final: 100kg (semana más reciente). Las anteriores quedan relativas a ESE PR.
  await postSession(clientId, "2026-05-11", 60); // 60% del PR final -> corta la racha si se llega hasta acá
  await postSession(clientId, "2026-05-18", 80); // 80%
  await postSession(clientId, "2026-05-25", 90); // 90%
  await postSession(clientId, "2026-06-01", 100); // 100% (PR)

  const res = await fetch(`${baseUrl}/alerts/check?workout_type_id=pecho&date=2026-06-08`, { headers: jsonHeaders(clientId) });
  const body = await res.json();

  assert.equal(body.trend_warning, true);
  assert.match(body.trend_message, /descarga/);
});

test("alerta de tendencia: solo 2 semanas seguidas de intensidad alta no la dispara", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-05-25", 90); // 90% del PR final
  await postSession(clientId, "2026-06-01", 100); // 100% (PR)

  const res = await fetch(`${baseUrl}/alerts/check?workout_type_id=pecho&date=2026-06-08`, { headers: jsonHeaders(clientId) });
  const body = await res.json();

  assert.equal(body.trend_warning, false);
  assert.equal(body.trend_message, null);
});

test("alerta de tendencia: una semana de intensidad baja en el medio corta la racha", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-05-11", 90); // semana más vieja: alta, pero no es consecutiva con las de abajo
  await postSession(clientId, "2026-05-18", 50); // semana de intensidad baja: corta la racha reciente
  await postSession(clientId, "2026-05-25", 90);
  await postSession(clientId, "2026-06-01", 100); // PR

  const res = await fetch(`${baseUrl}/alerts/check?workout_type_id=pecho&date=2026-06-08`, { headers: jsonHeaders(clientId) });
  const body = await res.json();

  // Desde la semana más reciente hacia atrás: 100%(1), 90%(2), luego 50% corta -> racha de 2, no alcanza el umbral de 3.
  assert.equal(body.trend_warning, false);
});

test("mesocycle_phase: intensidad real por encima de lo esperado para 'descarga' genera discrepancia", async () => {
  const clientId = uniqueClientId();
  // PR previo para que la sesión de la semana tenga una intensidad relativa alta.
  await postSession(clientId, "2026-06-29", 100);

  await fetch(`${baseUrl}/weekly-plan`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      week_start: "2026-07-06",
      days: [{ date: "2026-07-07", workout_type_id: "pecho" }],
      mesocycle_phase: "descarga",
    }),
  });
  // 90% de intensidad en una semana declarada como "descarga" (esperado <= 60%).
  await postSession(clientId, "2026-07-07", 90);

  const res = await fetch(`${baseUrl}/weekly-plan/2026-07-06`, { headers: jsonHeaders(clientId) });
  const body = await res.json();

  assert.equal(body.mesocycle_phase, "descarga");
  assert.equal(body.week_intensity_pct, 90);
  assert.match(body.mesocycle_discrepancy, /descarga/);
});

test("mesocycle_phase: la misma intensidad no genera discrepancia si la fase declarada es 'intensificacion'", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-06-29", 100);

  await fetch(`${baseUrl}/weekly-plan`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      week_start: "2026-07-06",
      days: [{ date: "2026-07-07", workout_type_id: "pecho" }],
      mesocycle_phase: "intensificacion",
    }),
  });
  await postSession(clientId, "2026-07-07", 90);

  const res = await fetch(`${baseUrl}/weekly-plan/2026-07-06`, { headers: jsonHeaders(clientId) });
  const body = await res.json();

  assert.equal(body.mesocycle_discrepancy, null);
});

test("mesocycle_phase: sin fase declarada, no hay intensidad ni discrepancia calculadas", async () => {
  const clientId = uniqueClientId();
  await fetch(`${baseUrl}/weekly-plan`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ week_start: "2026-07-06", days: [{ date: "2026-07-07", workout_type_id: "pecho" }] }),
  });

  const res = await fetch(`${baseUrl}/weekly-plan/2026-07-06`, { headers: jsonHeaders(clientId) });
  const body = await res.json();

  assert.equal(body.mesocycle_phase, null);
  assert.equal(body.week_intensity_pct, null);
  assert.equal(body.mesocycle_discrepancy, null);
});
