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

async function postSession(clientId: string, date: string, sets: { weight_kg: number; reps: number; rir?: number }[]) {
  return fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      date,
      workout_type_id: "pecho",
      exercises: [{ exercise_name: "Press banca", sets }],
    }),
  });
}

async function getSuggestion(clientId: string, mode?: string) {
  const qs = mode ? `?mode=${mode}` : "";
  const res = await fetch(`${baseUrl}/history/Press%20banca/suggestion${qs}`, { headers: jsonHeaders(clientId) });
  return { status: res.status, body: await res.json() };
}

test("GET /weekly-plan/suggested devuelve una plantilla de 3 días no consecutivos", async () => {
  const res = await fetch(`${baseUrl}/weekly-plan/suggested`, { headers: jsonHeaders(uniqueClientId()) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.days.length, 7);
  const trainingDays = body.days.filter((d: { workout_type_id: string | null }) => d.workout_type_id !== null);
  assert.equal(trainingDays.length, 3);
  assert.deepEqual(
    trainingDays.map((d: { workout_type_id: string }) => d.workout_type_id),
    ["full_body", "push", "pull"]
  );
  // no consecutivos: hay al menos un descanso entre cada día de entreno
  const indices = trainingDays.map((d: { weekday_index: number }) => d.weekday_index);
  for (let i = 1; i < indices.length; i++) {
    assert.ok(indices[i] - indices[i - 1] >= 2, "los días de entreno deben tener al menos un descanso entre medio");
  }
});

test("GET /weekly-plan/cuban-method-template devuelve 4 semanas con reparto de volumen decreciente", async () => {
  const res = await fetch(`${baseUrl}/weekly-plan/cuban-method-template`, { headers: jsonHeaders(uniqueClientId()) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.weeks.length, 4);
  assert.deepEqual(body.weeks.map((w: { volume_pct: number }) => w.volume_pct), [35, 28, 22, 15]);
  assert.equal(body.weeks.reduce((sum: number, w: { volume_pct: number }) => sum + w.volume_pct, 0), 100);
  assert.equal(body.weeks[3].mesocycle_phase, "descarga");
});

test("GET /profile/training-modes devuelve los 3 modos con sus constantes", async () => {
  const res = await fetch(`${baseUrl}/profile/training-modes`, { headers: jsonHeaders(uniqueClientId()) });
  const modes = await res.json();
  assert.equal(modes.length, 3);
  const fuerza = modes.find((m: { mode: string }) => m.mode === "fuerza");
  assert.equal(fuerza.rep_range_min, 2);
  assert.equal(fuerza.rep_range_max, 6);
});

test("guardar y leer el training_mode del perfil", async () => {
  const clientId = uniqueClientId();
  const putRes = await fetch(`${baseUrl}/profile`, {
    method: "PUT",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ training_mode: "hipertrofia" }),
  });
  assert.equal(putRes.status, 200);

  const getRes = await fetch(`${baseUrl}/profile`, { headers: jsonHeaders(clientId) });
  const body = await getRes.json();
  assert.equal(body.training_mode, "hipertrofia");
});

test("pro_enabled es false por default y se puede activar sin resetear al actualizar otro campo", async () => {
  const clientId = uniqueClientId();
  const initial = await fetch(`${baseUrl}/profile`, { headers: jsonHeaders(clientId) });
  assert.equal((await initial.json()).pro_enabled, false);

  await fetch(`${baseUrl}/profile`, {
    method: "PUT",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ pro_enabled: true }),
  });
  const afterEnable = await fetch(`${baseUrl}/profile`, { headers: jsonHeaders(clientId) });
  assert.equal((await afterEnable.json()).pro_enabled, true);

  // Actualizar un campo distinto (height_cm) sin mandar pro_enabled no debe resetearlo a false.
  await fetch(`${baseUrl}/profile`, {
    method: "PUT",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ height_cm: 180 }),
  });
  const afterHeightUpdate = await fetch(`${baseUrl}/profile`, { headers: jsonHeaders(clientId) });
  const body = await afterHeightUpdate.json();
  assert.equal(body.pro_enabled, true);
  assert.equal(body.height_cm, 180);
});

test("training_mode inválido es rechazado con 400", async () => {
  const res = await fetch(`${baseUrl}/profile`, {
    method: "PUT",
    headers: jsonHeaders(uniqueClientId()),
    body: JSON.stringify({ training_mode: "no-existe" }),
  });
  assert.equal(res.status, 400);
});

test("sugerencia sin sesiones previas: sin_datos", async () => {
  const { status, body } = await getSuggestion(uniqueClientId(), "fuerza");
  assert.equal(status, 200);
  assert.equal(body.action, "sin_datos");
});

test("sugerencia sin modo elegido y sin ?mode= devuelve 400", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-04-01", [{ weight_kg: 60, reps: 6, rir: 1 }]);
  const { status } = await getSuggestion(clientId);
  assert.equal(status, 400);
});

test("fuerza: reps en el techo del rango (6) con RIR bajo sugiere subir peso", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-04-01", [
    { weight_kg: 80, reps: 6, rir: 1 },
    { weight_kg: 80, reps: 6, rir: 2 },
  ]);
  const { body } = await getSuggestion(clientId, "fuerza");
  assert.equal(body.action, "subir_peso");
});

test("fuerza: reps en el techo del rango pero con RIR alto no sugiere subir peso todavía", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-04-01", [
    { weight_kg: 80, reps: 6, rir: 4 },
    { weight_kg: 80, reps: 6, rir: 5 },
  ]);
  const { body } = await getSuggestion(clientId, "fuerza");
  assert.equal(body.action, "mantener");
});

test("fuerza: por debajo del mínimo de reps (2) sugiere bajar peso", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-04-01", [{ weight_kg: 100, reps: 1 }]);
  const { body } = await getSuggestion(clientId, "fuerza");
  assert.equal(body.action, "bajar");
});

test("fuerza: reps dentro del rango medio sugiere mantener", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-04-01", [{ weight_kg: 90, reps: 4 }]);
  const { body } = await getSuggestion(clientId, "fuerza");
  assert.equal(body.action, "mantener");
});

test("el ?mode= de la query pisa el training_mode guardado en el perfil", async () => {
  const clientId = uniqueClientId();
  await fetch(`${baseUrl}/profile`, {
    method: "PUT",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ training_mode: "fuerza" }),
  });
  // 12 reps es el techo de rango para hipertrofia (6-12), muy por encima del de fuerza (2-6)
  await postSession(clientId, "2026-04-01", [{ weight_kg: 40, reps: 12, rir: 0 }]);
  const { body } = await getSuggestion(clientId, "hipertrofia");
  assert.equal(body.mode, "hipertrofia");
  assert.equal(body.action, "subir_peso");
});

test("las series de calentamiento no influyen en la sugerencia", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, "2026-04-01", [
    { weight_kg: 20, reps: 20 }, // calentamiento explícito abajo
  ]);
  // sesión con calentamiento aparte (peso muy alto) que no debería contarse
  await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      date: "2026-04-05",
      workout_type_id: "pecho",
      exercises: [
        {
          exercise_name: "Press banca",
          sets: [
            { weight_kg: 150, reps: 20, is_warmup: true },
            { weight_kg: 90, reps: 4, rir: 3 },
          ],
        },
      ],
    }),
  });
  const { body } = await getSuggestion(clientId, "fuerza");
  // Si el calentamiento (150kg x20) contara, "subir_peso" sería incorrecto acá.
  assert.equal(body.action, "mantener");
});
