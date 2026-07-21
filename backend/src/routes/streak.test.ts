import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestApp, jsonHeaders, uniqueClientId } from "../test-helpers.js";
import { addDaysISO, mondayOfISO, toISODate } from "../lib/dates.js";

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

// Lunes de la semana que empezó hace n semanas (n=1 -> última semana ya terminada).
function weekStartNAgo(n: number): string {
  const currentMonday = mondayOfISO(toISODate(new Date()));
  return addDaysISO(currentMonday, -7 * n);
}

async function markWeekFulfilled(clientId: string, n: number, dayOffset = 1) {
  const weekStart = weekStartNAgo(n);
  const date = addDaysISO(weekStart, dayOffset);
  await fetch(`${baseUrl}/weekly-plan`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ week_start: weekStart, days: [{ date, workout_type_id: "pecho" }] }),
  });
  await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      date,
      workout_type_id: "pecho",
      exercises: [{ exercise_name: "Press banca", sets: [{ weight_kg: 40, reps: 5 }] }],
    }),
  });
}

async function getStreak(clientId: string): Promise<number> {
  const res = await fetch(`${baseUrl}/streak`, { headers: jsonHeaders(clientId) });
  const body = (await res.json()) as { weeks: number };
  return body.weeks;
}

test("sin ningún plan cargado, la racha es 0", async () => {
  const clientId = uniqueClientId();
  assert.equal(await getStreak(clientId), 0);
});

test("3 semanas consecutivas cumplidas dan racha de 3, sin contar la semana actual", async () => {
  const clientId = uniqueClientId();
  await markWeekFulfilled(clientId, 1);
  await markWeekFulfilled(clientId, 2);
  await markWeekFulfilled(clientId, 3);
  // La semana en curso (n=0) deliberadamente no se toca: no debe hacer falta
  // para que la racha cuente las 3 semanas anteriores ya cerradas.
  assert.equal(await getStreak(clientId), 3);
});

test("una semana sin ningún plan cargado corta la racha", async () => {
  const clientId = uniqueClientId();
  await markWeekFulfilled(clientId, 1);
  // n=2 no tiene plan en absoluto
  await markWeekFulfilled(clientId, 3);
  assert.equal(await getStreak(clientId), 1);
});

test("una semana con un día planificado y no cumplido corta la racha (semana parcial)", async () => {
  const clientId = uniqueClientId();
  await markWeekFulfilled(clientId, 1);

  // n=2: se planifican 2 días, pero solo se entrena/marca uno de ellos.
  const weekStart = weekStartNAgo(2);
  const doneDate = addDaysISO(weekStart, 1);
  const missedDate = addDaysISO(weekStart, 3);
  await fetch(`${baseUrl}/weekly-plan`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      week_start: weekStart,
      days: [
        { date: doneDate, workout_type_id: "pecho" },
        { date: missedDate, workout_type_id: "piernas" },
      ],
    }),
  });
  await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({
      date: doneDate,
      workout_type_id: "pecho",
      exercises: [{ exercise_name: "Press banca", sets: [{ weight_kg: 40, reps: 5 }] }],
    }),
  });
  // missedDate queda sin sesión real ni mark-done -> semana incompleta.

  await markWeekFulfilled(clientId, 3);

  assert.equal(await getStreak(clientId), 1);
});
