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

async function createSession(clientId: string, date: string, workoutTypeId: string) {
  await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      date,
      workout_type_id: workoutTypeId,
      exercises: [{ exercise_name: "Ejercicio", sets: [{ weight_kg: 20, reps: 10 }] }],
    }),
  });
}

async function checkAlert(clientId: string, workoutTypeId: string, date: string) {
  const res = await fetch(`${baseUrl}/alerts/check?workout_type_id=${workoutTypeId}&date=${date}`, {
    headers: jsonHeaders(clientId),
  });
  return { status: res.status, body: await res.json() };
}

test("sin sesiones previas, no hay alerta", async () => {
  const clientId = uniqueClientId();
  const { status, body } = await checkAlert(clientId, "pecho", "2026-01-10");
  assert.equal(status, 200);
  assert.equal(body.warning, false);
});

test("mismo grupo muscular entrenado el día anterior dispara la alerta", async () => {
  const clientId = uniqueClientId();
  await createSession(clientId, "2026-01-09", "pecho");
  const { body } = await checkAlert(clientId, "pecho", "2026-01-10");
  assert.equal(body.warning, true);
  assert.match(body.message, /Pecho/);
});

test("mismo grupo muscular hace más de 48hs no dispara la alerta", async () => {
  const clientId = uniqueClientId();
  await createSession(clientId, "2026-01-07", "pecho"); // 3 días antes del target
  const { body } = await checkAlert(clientId, "pecho", "2026-01-10");
  assert.equal(body.warning, false);
});

test("grupo muscular distinto en las últimas 48hs no dispara la alerta", async () => {
  const clientId = uniqueClientId();
  await createSession(clientId, "2026-01-09", "piernas");
  const { body } = await checkAlert(clientId, "pecho", "2026-01-10");
  assert.equal(body.warning, false);
});

test("tipo de entreno inexistente devuelve 404", async () => {
  const clientId = uniqueClientId();
  const { status } = await checkAlert(clientId, "no-existe", "2026-01-10");
  assert.equal(status, 404);
});

test("faltan parámetros devuelve 400", async () => {
  const clientId = uniqueClientId();
  const res = await fetch(`${baseUrl}/alerts/check`, { headers: jsonHeaders(clientId) });
  assert.equal(res.status, 400);
});
