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
  exercise: string,
  sets: { weight_kg: number; reps: number; is_warmup?: boolean }[],
  rpe?: number
) {
  const res = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      date,
      workout_type_id: "pecho",
      exercises: [{ exercise_name: exercise, sets }],
      ...(rpe ? { rpe } : {}),
    }),
  });
  return res.json();
}

test("primera sesión: intensidad_pct es 100% (el peso ES el PR) y la zona es fuerza_maxima", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-05-04", "Press banca", [{ weight_kg: 80, reps: 5 }]);

  const res = await fetch(`${baseUrl}/history/Press%20banca`, { headers: jsonHeaders(clientId) });
  const [row] = await res.json();
  assert.equal(row.tonelaje, 400); // 80 * 5
  assert.equal(row.intensidad_pct, 100);
  assert.equal(row.zona, "fuerza_maxima");
});

test("series de calentamiento devuelven tonelaje/intensidad_pct/zona en null", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-05-04", "Sentadilla", [
    { weight_kg: 40, reps: 10, is_warmup: true },
    { weight_kg: 100, reps: 5 },
  ]);

  const res = await fetch(`${baseUrl}/history/Sentadilla`, { headers: jsonHeaders(clientId) });
  const rows = await res.json();
  const warmup = rows.find((r: { is_warmup: boolean }) => r.is_warmup);
  const working = rows.find((r: { is_warmup: boolean }) => !r.is_warmup);
  assert.equal(warmup.tonelaje, null);
  assert.equal(warmup.intensidad_pct, null);
  assert.equal(warmup.zona, null);
  assert.notEqual(working.tonelaje, null);
});

test("zonas de intensidad se clasifican según el %PR", async () => {
  const clientId = uniqueClientId();
  // PR = 100kg (primera sesión)
  await postSession(clientId, "2026-05-04", "Peso muerto", [{ weight_kg: 100, reps: 3 }]);
  // segunda sesión con distintos pesos relativos al PR de 100kg
  await postSession(clientId, "2026-05-05", "Peso muerto", [
    { weight_kg: 80, reps: 8 }, // 80% -> hipertrofia
    { weight_kg: 60, reps: 12 }, // 60% -> adaptacion
    { weight_kg: 30, reps: 3 }, // 30% -> potencia
    { weight_kg: 40, reps: 6 }, // 40% -> otra
  ]);

  const res = await fetch(`${baseUrl}/history/Peso%20muerto`, { headers: jsonHeaders(clientId) });
  const rows = await res.json();
  const byWeight = (w: number) => rows.find((r: { weight_kg: number; date: string }) => r.weight_kg === w && r.date === "2026-05-05");
  assert.equal(byWeight(80).zona, "hipertrofia");
  assert.equal(byWeight(60).zona, "adaptacion");
  assert.equal(byWeight(30).zona, "potencia");
  assert.equal(byWeight(40).zona, "otra");
});

test("GET /history/:exerciseName/rest-suggestion devuelve más descanso a mayor intensidad relativa al PR", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-05-04", "Sentadilla", [{ weight_kg: 100, reps: 5 }]); // PR = 100kg

  const heavy = await fetch(`${baseUrl}/history/Sentadilla/rest-suggestion?weight_kg=95`, { headers: jsonHeaders(clientId) });
  const heavyBody = await heavy.json();
  assert.equal(heavyBody.zone, "fuerza_maxima");
  assert.equal(heavyBody.rest_seconds, 240);

  const light = await fetch(`${baseUrl}/history/Sentadilla/rest-suggestion?weight_kg=60`, { headers: jsonHeaders(clientId) });
  const lightBody = await light.json();
  assert.equal(lightBody.zone, "adaptacion");
  assert.ok(lightBody.rest_seconds < heavyBody.rest_seconds);

  const power = await fetch(`${baseUrl}/history/Sentadilla/rest-suggestion?weight_kg=30`, { headers: jsonHeaders(clientId) });
  const powerBody = await power.json();
  assert.equal(powerBody.zone, "potencia");
  assert.match(powerBody.note, /6s/);
});

test("GET /history/:exerciseName/rest-suggestion sin PR todavía devuelve el default sin zona", async () => {
  const res = await fetch(`${baseUrl}/history/Ejercicio%20nuevo/rest-suggestion?weight_kg=50`, { headers: jsonHeaders(uniqueClientId()) });
  const body = await res.json();
  assert.equal(body.zone, null);
  assert.equal(body.rest_seconds, 90);
});

test("GET /history/:exerciseName/rest-suggestion sin ?weight_kg= devuelve 400", async () => {
  const res = await fetch(`${baseUrl}/history/Sentadilla/rest-suggestion`, { headers: jsonHeaders(uniqueClientId()) });
  assert.equal(res.status, 400);
});

test("GET /sessions/:id devuelve tonelaje_total, peso_medio e intensidad_promedio_pct, excluyendo calentamiento", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-05-04", "Press banca", [{ weight_kg: 100, reps: 5 }]); // fija PR en 100kg
  const created = await postSession(clientId, "2026-05-05", "Press banca", [
    { weight_kg: 200, reps: 20, is_warmup: true }, // no debe contar
    { weight_kg: 50, reps: 10 }, // tonelaje 500, intensidad 50%
    { weight_kg: 100, reps: 5 }, // tonelaje 500, intensidad 100%
  ]);

  const res = await fetch(`${baseUrl}/sessions/${created.id}`, { headers: jsonHeaders(clientId) });
  const detail = await res.json();

  assert.equal(detail.tonelaje_total, 1000); // 500 + 500, sin contar el calentamiento
  assert.equal(detail.peso_medio, 1000 / 15); // tonelaje / reps de trabajo (10+5)
  assert.equal(detail.intensidad_promedio_pct, (50 + 100) / 2); // promedio simple de %PR por serie de trabajo
});

test("el RPE de sesión se guarda y se devuelve en GET / y GET /:id", async () => {
  const clientId = uniqueClientId();
  const created = await postSession(clientId, "2026-05-04", "Press banca", [{ weight_kg: 60, reps: 8 }], 7);

  const listRes = await fetch(`${baseUrl}/sessions`, { headers: jsonHeaders(clientId) });
  const [listed] = await listRes.json();
  assert.equal(listed.rpe, 7);

  const detailRes = await fetch(`${baseUrl}/sessions/${created.id}`, { headers: jsonHeaders(clientId) });
  const detail = await detailRes.json();
  assert.equal(detail.rpe, 7);
});

test("GET /history/prs-by-weekday siempre devuelve los 7 días, con 0 si no hay PRs", async () => {
  const res = await fetch(`${baseUrl}/history/prs-by-weekday`, { headers: jsonHeaders(uniqueClientId()) });
  const days = await res.json();
  assert.equal(days.length, 7);
  assert.deepEqual(
    days.map((d: { label: string }) => d.label),
    ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
  );
  assert.ok(days.every((d: { count: number }) => d.count === 0));
});

test("GET /history/prs-by-weekday cuenta un PR de peso y de volumen en el día correcto (2026-05-04 = lunes)", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-05-04", "Press banca", [{ weight_kg: 60, reps: 8 }]); // PR nuevo: peso Y volumen, ambos el lunes

  const res = await fetch(`${baseUrl}/history/prs-by-weekday`, { headers: jsonHeaders(clientId) });
  const days = await res.json();
  const monday = days.find((d: { label: string }) => d.label === "Lunes");
  assert.equal(monday.count, 2); // best_weight_date y best_volume_date caen el mismo lunes
});
