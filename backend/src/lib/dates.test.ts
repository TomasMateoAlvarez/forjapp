import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO, mondayOfISO, toISODate } from "./dates.js";

test("mondayOfISO: un martes cae al lunes de esa misma semana", () => {
  assert.equal(mondayOfISO("2026-07-14"), "2026-07-13"); // martes -> lunes
});

test("mondayOfISO: si ya es lunes, se devuelve la misma fecha", () => {
  assert.equal(mondayOfISO("2026-07-13"), "2026-07-13");
});

test("mondayOfISO: un domingo cae al lunes anterior (no al siguiente)", () => {
  assert.equal(mondayOfISO("2026-07-19"), "2026-07-13"); // domingo -> lunes de la semana que termina ese día
});

test("mondayOfISO: cambio de año — jueves 1/1 cae en el lunes de la semana previa (29/12)", () => {
  assert.equal(mondayOfISO("2026-01-01"), "2025-12-29");
});

test("mondayOfISO: miércoles 31/12 cae en el lunes de esa semana (29/12), mismo año", () => {
  assert.equal(mondayOfISO("2025-12-31"), "2025-12-29");
});

test("mondayOfISO: año bisiesto — martes 31/12/2024 cae en el lunes 30/12/2024", () => {
  assert.equal(mondayOfISO("2024-12-31"), "2024-12-30");
});

test("addDaysISO: suma simple dentro del mismo mes", () => {
  assert.equal(addDaysISO("2026-07-13", 6), "2026-07-19");
});

test("addDaysISO: cruza fin de año hacia adelante", () => {
  assert.equal(addDaysISO("2025-12-29", 6), "2026-01-04");
});

test("addDaysISO: cruza fin de año hacia atrás (negativo)", () => {
  assert.equal(addDaysISO("2026-01-01", -7), "2025-12-25");
});

test("addDaysISO: cruza año bisiesto (29 de febrero existe)", () => {
  assert.equal(addDaysISO("2024-02-28", 1), "2024-02-29");
  assert.equal(addDaysISO("2024-02-29", 1), "2024-03-01");
});

test("toISODate: formatea a YYYY-MM-DD en UTC", () => {
  assert.equal(toISODate(new Date("2026-03-05T23:59:59Z")), "2026-03-05");
});
