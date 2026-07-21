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

test("guardar una sesión de cardio y leerla en el historial", async () => {
  const clientId = uniqueClientId();
  const res = await fetch(`${baseUrl}/cardio-sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ date: "2026-06-01", activity_type: "cardio", duration_min: 30, notes: "Trote suave" }),
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.activity_type, "cardio");
  assert.equal(created.duration_min, 30);

  const listRes = await fetch(`${baseUrl}/cardio-sessions`, { headers: jsonHeaders(clientId) });
  const list = await listRes.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].notes, "Trote suave");
});

test("notes es opcional", async () => {
  const clientId = uniqueClientId();
  const res = await fetch(`${baseUrl}/cardio-sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ date: "2026-06-01", activity_type: "tecnico_tactico", duration_min: 45 }),
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.notes, null);
});

test("duration_min inválido (0 o negativo) es rechazado con 400", async () => {
  const clientId = uniqueClientId();
  const res = await fetch(`${baseUrl}/cardio-sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ date: "2026-06-01", activity_type: "cardio", duration_min: 0 }),
  });
  assert.equal(res.status, 400);
});

test("el historial de cardio es aislado por client_id y viene más reciente primero", async () => {
  const clientId = uniqueClientId();
  const other = uniqueClientId();
  await fetch(`${baseUrl}/cardio-sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ date: "2026-06-01", activity_type: "cardio", duration_min: 20 }),
  });
  await fetch(`${baseUrl}/cardio-sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ date: "2026-06-10", activity_type: "cardio", duration_min: 25 }),
  });
  await fetch(`${baseUrl}/cardio-sessions`, {
    method: "POST",
    headers: jsonHeaders(other),
    body: JSON.stringify({ date: "2026-06-05", activity_type: "cardio", duration_min: 40 }),
  });

  const res = await fetch(`${baseUrl}/cardio-sessions`, { headers: jsonHeaders(clientId) });
  const list = await res.json();
  assert.equal(list.length, 2);
  assert.equal(list[0].date, "2026-06-10");
  assert.equal(list[1].date, "2026-06-01");
});
