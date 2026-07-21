import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestApp, jsonHeaders } from "../test-helpers.js";

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

let counter = 0;
function uniqueEmail(): string {
  counter += 1;
  return `user${counter}-${process.pid}@example.com`;
}

async function register(email: string, password: string) {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

async function login(email: string, password: string) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

test("registrar una cuenta nueva devuelve un token y el usuario creado", async () => {
  const email = uniqueEmail();
  const { status, body } = await register(email, "password123");
  assert.equal(status, 201);
  assert.equal(body.user.email, email);
  assert.equal(typeof body.token, "string");
  assert.ok(body.token.length > 20);
});

test("no se puede registrar dos veces el mismo email", async () => {
  const email = uniqueEmail();
  await register(email, "password123");
  const { status, body } = await register(email, "otraPassword123");
  assert.equal(status, 409);
  assert.match(body.error, /ya existe/i);
});

test("contraseña corta es rechazada con 400", async () => {
  const { status } = await register(uniqueEmail(), "corta");
  assert.equal(status, 400);
});

test("login con credenciales correctas devuelve token", async () => {
  const email = uniqueEmail();
  await register(email, "password123");
  const { status, body } = await login(email, "password123");
  assert.equal(status, 200);
  assert.equal(body.user.email, email);
});

test("login con contraseña incorrecta devuelve 401", async () => {
  const email = uniqueEmail();
  await register(email, "password123");
  const { status } = await login(email, "otra-contra-cualquiera");
  assert.equal(status, 401);
});

test("login con email inexistente devuelve 401 (no filtra si el email existe)", async () => {
  const { status } = await login(uniqueEmail(), "cualquier-cosa-123");
  assert.equal(status, 401);
});

test("un token válido da acceso a endpoints protegidos con la identidad del usuario", async () => {
  const email = uniqueEmail();
  const { body: registered } = await register(email, "password123");

  const res = await fetch(`${baseUrl}/sessions`, {
    headers: { Authorization: `Bearer ${registered.token}` },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []); // usuario nuevo, sin sesiones todavía
});

test("un token inválido devuelve 401 en vez de caer al modo legacy", async () => {
  const res = await fetch(`${baseUrl}/sessions`, {
    headers: { Authorization: "Bearer token-que-no-existe" },
  });
  assert.equal(res.status, 401);
});

test("sin Authorization, X-Client-Id legacy sigue funcionando igual que antes", async () => {
  const res = await fetch(`${baseUrl}/sessions`, {
    headers: jsonHeaders("legacy-client-sin-cuenta"),
  });
  assert.equal(res.status, 200);
});

test("logout revoca el token: usarlo después devuelve 401", async () => {
  const email = uniqueEmail();
  const { body: registered } = await register(email, "password123");

  const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${registered.token}` },
  });
  assert.equal(logoutRes.status, 200);

  const res = await fetch(`${baseUrl}/sessions`, {
    headers: { Authorization: `Bearer ${registered.token}` },
  });
  assert.equal(res.status, 401);
});

test("dos usuarios distintos ven historiales aislados entre sí", async () => {
  const emailA = uniqueEmail();
  const emailB = uniqueEmail();
  const { body: a } = await register(emailA, "password123");
  const { body: b } = await register(emailB, "password123");

  await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` },
    body: JSON.stringify({
      date: "2026-02-01",
      workout_type_id: "pecho",
      exercises: [{ exercise_name: "Press banca", sets: [{ weight_kg: 50, reps: 5 }] }],
    }),
  });

  const resA = await fetch(`${baseUrl}/sessions`, { headers: { Authorization: `Bearer ${a.token}` } });
  const resB = await fetch(`${baseUrl}/sessions`, { headers: { Authorization: `Bearer ${b.token}` } });
  assert.equal((await resA.json()).length, 1);
  assert.equal((await resB.json()).length, 0);
});

let anonCounter = 0;
function uniqueAnonClientId(): string {
  anonCounter += 1;
  return `anon-${anonCounter}-${process.pid}`;
}

async function migrate(token: string, anonymousClientId: string) {
  const res = await fetch(`${baseUrl}/auth/migrate-anonymous-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ anonymous_client_id: anonymousClientId }),
  });
  return { status: res.status, body: await res.json() };
}

test("migrar datos anónimos mueve sesiones y biometrics a la cuenta y los limpia del anónimo", async () => {
  const anonId = uniqueAnonClientId();
  await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: jsonHeaders(anonId),
    body: JSON.stringify({
      date: "2026-03-01",
      workout_type_id: "pecho",
      exercises: [{ exercise_name: "Press banca", sets: [{ weight_kg: 40, reps: 8 }] }],
    }),
  });
  await fetch(`${baseUrl}/biometrics`, {
    method: "POST",
    headers: jsonHeaders(anonId),
    body: JSON.stringify({ date: "2026-03-01", weight_kg: 80 }),
  });

  const { body: registered } = await register(uniqueEmail(), "password123");
  const { status, body } = await migrate(registered.token, anonId);
  assert.equal(status, 200);
  assert.equal(body.migrated.sessions, 1);
  assert.equal(body.migrated.biometrics, 1);

  const afterMigration = await fetch(`${baseUrl}/sessions`, { headers: { Authorization: `Bearer ${registered.token}` } });
  assert.equal((await afterMigration.json()).length, 1);

  const stillAnon = await fetch(`${baseUrl}/sessions`, { headers: jsonHeaders(anonId) });
  assert.equal((await stillAnon.json()).length, 0);
});

test("migrar sin token de cuenta devuelve 401", async () => {
  const res = await fetch(`${baseUrl}/auth/migrate-anonymous-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anonymous_client_id: uniqueAnonClientId() }),
  });
  assert.equal(res.status, 401);
});

test("migrar es idempotente: correrlo de nuevo no falla y no mueve nada más", async () => {
  const anonId = uniqueAnonClientId();
  await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: jsonHeaders(anonId),
    body: JSON.stringify({
      date: "2026-03-02",
      workout_type_id: "piernas",
      exercises: [{ exercise_name: "Sentadilla", sets: [{ weight_kg: 60, reps: 5 }] }],
    }),
  });
  const { body: registered } = await register(uniqueEmail(), "password123");
  await migrate(registered.token, anonId);
  const { status, body } = await migrate(registered.token, anonId);
  assert.equal(status, 200);
  assert.equal(body.migrated.sessions, 0);
});
