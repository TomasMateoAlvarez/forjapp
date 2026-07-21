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
  return `coach-test-${counter}-${process.pid}@example.com`;
}

async function register(email: string): Promise<{ token: string; userId: number }> {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const body = await res.json();
  return { token: body.token, userId: body.user.id };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createSession(token: string, date: string) {
  await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(token) },
    body: JSON.stringify({
      date,
      workout_type_id: "pecho",
      exercises: [{ exercise_name: "Press banca", sets: [{ weight_kg: 40, reps: 5 }] }],
    }),
  });
}

test("las rutas de coach exigen una cuenta real (X-Client-Id legacy no alcanza)", async () => {
  const res = await fetch(`${baseUrl}/coach/invite-code`, { headers: jsonHeaders("legacy-sin-cuenta") });
  assert.equal(res.status, 403);
});

test("un atleta genera su código y puede volver a consultarlo", async () => {
  const { token } = await register(uniqueEmail());
  const genRes = await fetch(`${baseUrl}/coach/invite-code`, { method: "POST", headers: auth(token) });
  const { code } = await genRes.json();
  assert.equal(typeof code, "string");

  const getRes = await fetch(`${baseUrl}/coach/invite-code`, { headers: auth(token) });
  assert.deepEqual(await getRes.json(), { code });
});

test("regenerar el código invalida el anterior", async () => {
  const { token } = await register(uniqueEmail());
  const first = await (await fetch(`${baseUrl}/coach/invite-code`, { method: "POST", headers: auth(token) })).json();
  const second = await (await fetch(`${baseUrl}/coach/invite-code`, { method: "POST", headers: auth(token) })).json();
  assert.notEqual(first.code, second.code);

  const { token: coachToken } = await register(uniqueEmail());
  const res = await fetch(`${baseUrl}/coach/link-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(coachToken) },
    body: JSON.stringify({ code: first.code }),
  });
  assert.equal(res.status, 404);
});

test("un coach no puede vincularse consigo mismo usando su propio código", async () => {
  const { token } = await register(uniqueEmail());
  const { code } = await (await fetch(`${baseUrl}/coach/invite-code`, { method: "POST", headers: auth(token) })).json();
  const res = await fetch(`${baseUrl}/coach/link-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(token) },
    body: JSON.stringify({ code }),
  });
  assert.equal(res.status, 400);
});

test("flujo completo: código -> pedido -> pendiente -> aceptar -> aparece en /coach/athletes", async () => {
  const { token: athleteToken, userId: athleteId } = await register(uniqueEmail());
  const { token: coachToken } = await register(uniqueEmail());

  const { code } = await (await fetch(`${baseUrl}/coach/invite-code`, { method: "POST", headers: auth(athleteToken) })).json();

  const linkRes = await fetch(`${baseUrl}/coach/link-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(coachToken) },
    body: JSON.stringify({ code }),
  });
  assert.equal(linkRes.status, 201);

  // pedido duplicado -> 409
  const dupRes = await fetch(`${baseUrl}/coach/link-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(coachToken) },
    body: JSON.stringify({ code }),
  });
  assert.equal(dupRes.status, 409);

  const pending = await (await fetch(`${baseUrl}/coach/pending-requests`, { headers: auth(athleteToken) })).json();
  assert.equal(pending.length, 1);

  const acceptRes = await fetch(`${baseUrl}/coach/link-requests/${pending[0].id}/accept`, {
    method: "POST",
    headers: auth(athleteToken),
  });
  assert.equal(acceptRes.status, 200);

  const athletes = await (await fetch(`${baseUrl}/coach/athletes`, { headers: auth(coachToken) })).json();
  assert.equal(athletes.length, 1);
  assert.equal(athletes[0].athlete_user_id, athleteId);
  assert.equal(athletes[0].adherence_pct, null); // sin planes cargados
  assert.equal(athletes[0].last_check_in, null); // sin check-ins
});

test("rechazar un pedido lo saca de pendientes y no aparece como aceptado", async () => {
  const { token: athleteToken } = await register(uniqueEmail());
  const { token: coachToken } = await register(uniqueEmail());
  const { code } = await (await fetch(`${baseUrl}/coach/invite-code`, { method: "POST", headers: auth(athleteToken) })).json();
  await fetch(`${baseUrl}/coach/link-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(coachToken) },
    body: JSON.stringify({ code }),
  });
  const pending = await (await fetch(`${baseUrl}/coach/pending-requests`, { headers: auth(athleteToken) })).json();

  const rejectRes = await fetch(`${baseUrl}/coach/link-requests/${pending[0].id}/reject`, {
    method: "POST",
    headers: auth(athleteToken),
  });
  assert.equal(rejectRes.status, 200);

  const stillPending = await (await fetch(`${baseUrl}/coach/pending-requests`, { headers: auth(athleteToken) })).json();
  assert.equal(stillPending.length, 0);
  const athletes = await (await fetch(`${baseUrl}/coach/athletes`, { headers: auth(coachToken) })).json();
  assert.equal(athletes.length, 0);
});

test("con vínculo aceptado, el coach ve las sesiones del atleta vía ?as_athlete_id", async () => {
  const { token: athleteToken, userId: athleteId } = await register(uniqueEmail());
  const { token: coachToken } = await register(uniqueEmail());

  await createSession(athleteToken, "2026-03-01");

  const { code } = await (await fetch(`${baseUrl}/coach/invite-code`, { method: "POST", headers: auth(athleteToken) })).json();
  await fetch(`${baseUrl}/coach/link-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(coachToken) },
    body: JSON.stringify({ code }),
  });
  const pending = await (await fetch(`${baseUrl}/coach/pending-requests`, { headers: auth(athleteToken) })).json();
  await fetch(`${baseUrl}/coach/link-requests/${pending[0].id}/accept`, { method: "POST", headers: auth(athleteToken) });

  const res = await fetch(`${baseUrl}/sessions?as_athlete_id=${athleteId}`, { headers: auth(coachToken) });
  const sessions = await res.json();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].date, "2026-03-01");
});

test("sin vínculo aceptado, ?as_athlete_id se ignora y cada quien ve lo suyo", async () => {
  const { token: athleteToken, userId: athleteId } = await register(uniqueEmail());
  const { token: strangerToken } = await register(uniqueEmail());

  await createSession(athleteToken, "2026-03-02");

  // stranger nunca pidió vínculo con este atleta
  const res = await fetch(`${baseUrl}/sessions?as_athlete_id=${athleteId}`, { headers: auth(strangerToken) });
  const sessions = await res.json();
  assert.equal(sessions.length, 0); // ve las suyas propias (ninguna), no las del atleta
});

test("comentario de coach: solo con vínculo aceptado se puede comentar, y el atleta lo ve", async () => {
  const { token: athleteToken } = await register(uniqueEmail());
  const { token: coachToken } = await register(uniqueEmail());
  const { token: strangerToken } = await register(uniqueEmail());

  await createSession(athleteToken, "2026-03-03");
  const sessionsRes = await fetch(`${baseUrl}/sessions`, { headers: auth(athleteToken) });
  const [{ id: sessionId }] = await sessionsRes.json();

  // sin vínculo, no puede comentar
  const forbiddenRes = await fetch(`${baseUrl}/coach/sessions/${sessionId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(strangerToken) },
    body: JSON.stringify({ comment: "no debería poder" }),
  });
  assert.equal(forbiddenRes.status, 403);

  const { code } = await (await fetch(`${baseUrl}/coach/invite-code`, { method: "POST", headers: auth(athleteToken) })).json();
  await fetch(`${baseUrl}/coach/link-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(coachToken) },
    body: JSON.stringify({ code }),
  });
  const pending = await (await fetch(`${baseUrl}/coach/pending-requests`, { headers: auth(athleteToken) })).json();
  await fetch(`${baseUrl}/coach/link-requests/${pending[0].id}/accept`, { method: "POST", headers: auth(athleteToken) });

  const commentRes = await fetch(`${baseUrl}/coach/sessions/${sessionId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(coachToken) },
    body: JSON.stringify({ comment: "Buena sesión, la próxima subí un poco el peso." }),
  });
  assert.equal(commentRes.status, 201);

  const athleteView = await (await fetch(`${baseUrl}/coach/sessions/${sessionId}/comments`, { headers: auth(athleteToken) })).json();
  assert.equal(athleteView.length, 1);
  assert.match(athleteView[0].comment, /Buena sesión/);
});
