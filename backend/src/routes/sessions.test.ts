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

async function postSession(clientId: string, body: unknown) {
  const res = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("primera sesión de un ejercicio nuevo genera PR de peso y de volumen", async () => {
  const clientId = uniqueClientId();
  const { status, body } = await postSession(clientId, {
    date: "2026-01-05",
    workout_type_id: "pecho",
    exercises: [{ exercise_name: "Press banca", sets: [{ weight_kg: 60, reps: 8 }] }],
  });
  assert.equal(status, 201);
  const types = body.new_records.map((r: { type: string }) => r.type).sort();
  assert.deepEqual(types, ["volume", "weight"]);
});

test("las series marcadas como calentamiento no cuentan para el PR", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, {
    date: "2026-01-05",
    workout_type_id: "pecho",
    exercises: [{ exercise_name: "Sentadilla", sets: [{ weight_kg: 80, reps: 5 }] }],
  });

  // Serie de calentamiento con peso muy superior al PR real: no debe generar un nuevo récord.
  const { body } = await postSession(clientId, {
    date: "2026-01-08",
    workout_type_id: "pecho",
    exercises: [
      {
        exercise_name: "Sentadilla",
        sets: [
          { weight_kg: 200, reps: 1, is_warmup: true },
          { weight_kg: 80, reps: 5, is_warmup: false },
        ],
      },
    ],
  });
  assert.deepEqual(body.new_records, []);
});

test("nuevo PR de peso pero no de volumen", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, {
    date: "2026-01-05",
    workout_type_id: "pecho",
    exercises: [{ exercise_name: "Peso muerto", sets: [{ weight_kg: 100, reps: 10 }] }], // volumen 1000
  });

  const { body } = await postSession(clientId, {
    date: "2026-01-08",
    workout_type_id: "pecho",
    // peso 120 > 100 (nuevo PR de peso); volumen 120 < 1000 (no PR de volumen)
    exercises: [{ exercise_name: "Peso muerto", sets: [{ weight_kg: 120, reps: 1 }] }],
  });
  assert.deepEqual(body.new_records, [{ exercise_name: "Peso muerto", type: "weight" }]);
});

test("nuevo PR de volumen pero no de peso", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, {
    date: "2026-01-05",
    workout_type_id: "pecho",
    exercises: [{ exercise_name: "Remo con barra", sets: [{ weight_kg: 80, reps: 5 }] }], // peso 80, volumen 400
  });

  const { body } = await postSession(clientId, {
    date: "2026-01-08",
    workout_type_id: "pecho",
    // peso 60 < 80 (no PR de peso); volumen 1200 > 400 (nuevo PR de volumen)
    exercises: [{ exercise_name: "Remo con barra", sets: [{ weight_kg: 60, reps: 20 }] }],
  });
  assert.deepEqual(body.new_records, [{ exercise_name: "Remo con barra", type: "volume" }]);
});

test("sin PR nuevo si la sesión siguiente no supera ni peso ni volumen previos", async () => {
  const clientId = uniqueClientId();
  await postSession(clientId, {
    date: "2026-01-05",
    workout_type_id: "pecho",
    exercises: [{ exercise_name: "Press militar", sets: [{ weight_kg: 50, reps: 8 }] }],
  });

  const { body } = await postSession(clientId, {
    date: "2026-01-08",
    workout_type_id: "pecho",
    exercises: [{ exercise_name: "Press militar", sets: [{ weight_kg: 40, reps: 6 }] }],
  });
  assert.deepEqual(body.new_records, []);
});
