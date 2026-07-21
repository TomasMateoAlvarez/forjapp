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

test("guardar un test de salto simple calcula la altura de salto", async () => {
  const clientId = uniqueClientId();
  const res = await fetch(`${baseUrl}/strength-tests`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ date: "2026-04-01", test_type: "salto_simple", flight_time_sec: 0.5 }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  // (0.5)^2 * 1.226 * 100 = 30.65
  assert.equal(Math.round(body.jump_height_cm * 100) / 100, 30.65);
  assert.equal(body.reactive_stability_q, null);
});

test("guardar un drop jump calcula altura y Q de estabilidad reactiva", async () => {
  const clientId = uniqueClientId();
  const res = await fetch(`${baseUrl}/strength-tests`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      date: "2026-04-01",
      test_type: "drop_jump",
      flight_time_sec: 0.4,
      contact_time_sec: 0.2,
      drop_height_cm: 30,
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.reactive_stability_q, 2);
});

test("drop_jump sin contact_time_sec es rechazado con 400", async () => {
  const clientId = uniqueClientId();
  const res = await fetch(`${baseUrl}/strength-tests`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ date: "2026-04-01", test_type: "drop_jump", flight_time_sec: 0.4 }),
  });
  assert.equal(res.status, 400);
});

test("el historial de tests es aislado por client_id y viene más reciente primero", async () => {
  const clientId = uniqueClientId();
  const other = uniqueClientId();
  await fetch(`${baseUrl}/strength-tests`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ date: "2026-04-01", test_type: "salto_simple", flight_time_sec: 0.45 }),
  });
  await fetch(`${baseUrl}/strength-tests`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ date: "2026-05-01", test_type: "salto_simple", flight_time_sec: 0.5 }),
  });
  await fetch(`${baseUrl}/strength-tests`, {
    method: "POST",
    headers: jsonHeaders(other),
    body: JSON.stringify({ date: "2026-04-15", test_type: "salto_simple", flight_time_sec: 0.6 }),
  });

  const res = await fetch(`${baseUrl}/strength-tests`, { headers: jsonHeaders(clientId) });
  const list = await res.json();
  assert.equal(list.length, 2);
  assert.equal(list[0].date, "2026-05-01");
  assert.equal(list[1].date, "2026-04-01");
});
