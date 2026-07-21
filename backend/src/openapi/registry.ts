import "./zod-setup.js";
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import { sessionSchema } from "../routes/sessions.js";
import { biometricSchema } from "../routes/biometrics.js";
import { planSchema } from "../routes/weeklyPlan.js";
import { credentialsSchema, migrateAnonymousDataSchema } from "../routes/auth.js";
import { createRoutineSchema } from "../routes/customRoutines.js";
import { strengthTestSchema } from "../routes/strengthTests.js";
import { cardioSessionSchema } from "../routes/cardioSessions.js";

import {
  WorkoutType,
  ExerciseInfo,
  SessionResult,
  SessionSummary,
  SessionDetail,
  HistoryEntry,
  LatestSet,
  ExerciseListEntry,
  PersonalRecord,
  Biometric,
  UserProfile,
  WeeklyPlanResponse,
  MesocyclePhase,
  PlannedDay,
  CustomRoutine,
  AlertCheck,
  StreakResponse,
  OkResponse,
  AuthResponse,
  ErrorResponse,
  ExerciseUpsertBody,
  ExercisePatchBody,
  MarkDoneBody,
  InviteCode,
  LinkRequestBody,
  PendingRequest,
  CoachAthlete,
  SessionCommentBody,
  SessionComment,
  StrengthTest,
  CardioSession,
  TrainingModeConfig,
  SuggestedPlanResponse,
  CubanMethodTemplateResponse,
  ProgressionSuggestion,
  RestSuggestion,
  PrsByWeekdayEntry,
} from "./schemas.js";

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "Token de sesión emitido por /auth/login o /auth/register.",
});
registry.registerComponent("securitySchemes", "clientIdLegacy", {
  type: "apiKey",
  in: "header",
  name: "X-Client-Id",
  description: "Modo legacy sin cuenta: identifica la instalación. Se ignora si viene Authorization Bearer válido.",
});
// mesocycle_phase va inline (no por $ref) en WeeklyPlanResponse y en el body
// de POST /weekly-plan, así que sin este registro explícito el generador
// descarta MesocyclePhase de components.schemas por no estar referenciado.
registry.register("MesocyclePhase", MesocyclePhase);

// Query param opcional que aceptan sessions/history/biometrics/weekly-plan/streak
// en modo lectura: si el usuario autenticado es coach con vínculo aceptado con
// ese athlete_user_id, ve los datos del atleta en vez de los propios.
const asAthleteIdQuery = { as_athlete_id: z.string().optional() };

const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({ content: { "application/json": { schema } } });
const jsonResponse = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});
const security: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { clientIdLegacy: [] }];
const errorResponses = {
  400: jsonResponse("Error de validación", ErrorResponse),
  401: jsonResponse("Falta identidad (token inválido o X-Client-Id ausente)", ErrorResponse),
};

// --- auth (sin identidad previa) ---
registry.registerPath({
  method: "post",
  path: "/api/auth/register",
  tags: ["auth"],
  request: { body: jsonBody(credentialsSchema) },
  responses: {
    201: jsonResponse("Cuenta creada", AuthResponse),
    400: jsonResponse("Email/contraseña inválidos", ErrorResponse),
    409: jsonResponse("Email ya registrado", ErrorResponse),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/auth/login",
  tags: ["auth"],
  request: { body: jsonBody(credentialsSchema) },
  responses: {
    200: jsonResponse("Login OK", AuthResponse),
    401: jsonResponse("Credenciales incorrectas", ErrorResponse),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/auth/migrate-anonymous-data",
  tags: ["auth"],
  security: [{ bearerAuth: [] }],
  request: { body: jsonBody(migrateAnonymousDataSchema) },
  responses: {
    200: jsonResponse("Filas movidas por tabla", z.object({ ok: z.boolean(), migrated: z.record(z.string(), z.number()) })),
    400: jsonResponse("Falta anonymous_client_id", ErrorResponse),
    401: jsonResponse("Requiere una cuenta autenticada", ErrorResponse),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/auth/logout",
  tags: ["auth"],
  security: [{ bearerAuth: [] }],
  responses: { 200: jsonResponse("Token revocado (idempotente)", OkResponse) },
});

// --- workout-types ---
registry.registerPath({
  method: "get",
  path: "/api/workout-types",
  tags: ["workout-types"],
  security,
  responses: { 200: jsonResponse("Catálogo de tipos de entreno", z.array(WorkoutType)), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/workout-types/{id}/exercises",
  tags: ["workout-types"],
  security,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: jsonResponse("Ejercicios predeterminados de ese tipo", z.array(ExerciseInfo)), ...errorResponses, 404: jsonResponse("Tipo no encontrado", ErrorResponse) },
});
registry.registerPath({
  method: "post",
  path: "/api/workout-types/{id}/exercises",
  tags: ["workout-types"],
  security,
  request: { params: z.object({ id: z.string() }), body: jsonBody(ExerciseUpsertBody) },
  responses: { 201: jsonResponse("Agregado", OkResponse), ...errorResponses, 404: jsonResponse("Tipo no encontrado", ErrorResponse) },
});
registry.registerPath({
  method: "patch",
  path: "/api/workout-types/{id}/exercises/{exerciseName}",
  tags: ["workout-types"],
  security,
  request: { params: z.object({ id: z.string(), exerciseName: z.string() }), body: jsonBody(ExercisePatchBody) },
  responses: { 200: jsonResponse("Actualizado", OkResponse), ...errorResponses, 404: jsonResponse("No encontrado", ErrorResponse) },
});
registry.registerPath({
  method: "delete",
  path: "/api/workout-types/{id}/exercises/{exerciseName}",
  tags: ["workout-types"],
  security,
  request: { params: z.object({ id: z.string(), exerciseName: z.string() }) },
  responses: { 200: jsonResponse("Eliminado", OkResponse), ...errorResponses, 404: jsonResponse("No encontrado", ErrorResponse) },
});

// --- sessions ---
registry.registerPath({
  method: "post",
  path: "/api/sessions",
  tags: ["sessions"],
  security,
  request: { body: jsonBody(sessionSchema) },
  responses: { 201: jsonResponse("Sesión guardada, con PRs nuevos si los hay", SessionResult), ...errorResponses, 404: jsonResponse("Tipo/rutina no encontrados", ErrorResponse) },
});
registry.registerPath({
  method: "get",
  path: "/api/sessions",
  tags: ["sessions"],
  security,
  request: { query: z.object({ from: z.string().optional(), to: z.string().optional(), ...asAthleteIdQuery }) },
  responses: { 200: jsonResponse("Calendario de sesiones", z.array(SessionSummary)), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/sessions/{id}",
  tags: ["sessions"],
  security,
  request: { params: z.object({ id: z.string() }), query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("Detalle de una sesión", SessionDetail), ...errorResponses, 404: jsonResponse("No encontrada", ErrorResponse) },
});

// --- history ---
registry.registerPath({
  method: "get",
  path: "/api/history",
  tags: ["history"],
  security,
  request: { query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("Ejercicios con al menos un registro", z.array(ExerciseListEntry)), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/history/prs-by-weekday",
  tags: ["history"],
  security,
  request: { query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("PRs históricos agrupados por día de la semana (siempre 7)", z.array(PrsByWeekdayEntry)), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/history/{exerciseName}/latest",
  tags: ["history"],
  security,
  request: { params: z.object({ exerciseName: z.string() }), query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("Series de trabajo del último día registrado", z.array(LatestSet)), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/history/{exerciseName}/records",
  tags: ["history"],
  security,
  request: { params: z.object({ exerciseName: z.string() }), query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("Récord personal (o null)", PersonalRecord.nullable()), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/history/{exerciseName}/suggestion",
  tags: ["history"],
  security,
  request: {
    params: z.object({ exerciseName: z.string() }),
    query: z.object({ mode: z.enum(["fuerza", "hipertrofia", "mantenimiento"]).optional(), ...asAthleteIdQuery }),
  },
  responses: {
    ...errorResponses,
    200: jsonResponse("Sugerencia de progresión para el próximo set", ProgressionSuggestion),
    400: jsonResponse("Sin modo elegido (ni en el perfil ni por query)", ErrorResponse),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/history/{exerciseName}/rest-suggestion",
  tags: ["history"],
  security,
  request: {
    params: z.object({ exerciseName: z.string() }),
    query: z.object({ weight_kg: z.string() }),
  },
  responses: {
    ...errorResponses,
    200: jsonResponse("Descanso sugerido según intensidad relativa al PR", RestSuggestion),
    400: jsonResponse("Falta ?weight_kg=", ErrorResponse),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/history/{exerciseName}",
  tags: ["history"],
  security,
  request: { params: z.object({ exerciseName: z.string() }), query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("Evolución completa del ejercicio", z.array(HistoryEntry)), ...errorResponses },
});

// --- biometrics ---
registry.registerPath({
  method: "post",
  path: "/api/biometrics",
  tags: ["biometrics"],
  security,
  request: { body: jsonBody(biometricSchema) },
  responses: { 201: jsonResponse("Check-in guardado", OkResponse), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/biometrics",
  tags: ["biometrics"],
  security,
  request: { query: z.object({ from: z.string().optional(), to: z.string().optional(), ...asAthleteIdQuery }) },
  responses: { 200: jsonResponse("Historial biométrico", z.array(Biometric)), ...errorResponses },
});

// --- profile ---
registry.registerPath({
  method: "get",
  path: "/api/profile",
  tags: ["profile"],
  security,
  responses: { 200: jsonResponse("Altura y modo de entrenamiento guardados", UserProfile), ...errorResponses },
});
registry.registerPath({
  method: "put",
  path: "/api/profile",
  tags: ["profile"],
  security,
  request: {
    body: jsonBody(
      z.object({
        height_cm: z.number().positive().optional(),
        training_mode: z.enum(["fuerza", "hipertrofia", "mantenimiento"]).optional(),
        pro_enabled: z.boolean().optional(),
      })
    ),
  },
  responses: { 200: jsonResponse("Actualizado", OkResponse), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/profile/training-modes",
  tags: ["profile"],
  security,
  responses: { 200: jsonResponse("Catálogo de modos con sus constantes de referencia", z.array(TrainingModeConfig)), ...errorResponses },
});

// --- weekly-plan ---
registry.registerPath({
  method: "get",
  path: "/api/weekly-plan/suggested",
  tags: ["weekly-plan"],
  security,
  responses: { 200: jsonResponse("Plantilla de rutina inicial sugerida (Full Body/Push/Pull)", SuggestedPlanResponse), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/weekly-plan/cuban-method-template",
  tags: ["weekly-plan"],
  security,
  responses: { 200: jsonResponse("Reparto de volumen por microciclo (método cubano, referencia)", CubanMethodTemplateResponse), ...errorResponses },
});
registry.registerPath({
  method: "post",
  path: "/api/weekly-plan",
  tags: ["weekly-plan"],
  security,
  request: { body: jsonBody(planSchema) },
  responses: { 201: jsonResponse("Plan creado/reemplazado", z.object({ id: z.number(), week_start: z.string(), days: z.array(z.object({ date: z.string(), workout_type_id: z.string() })) })), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/weekly-plan/for-date/{date}",
  tags: ["weekly-plan"],
  security,
  request: { params: z.object({ date: z.string() }), query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("Tipo planificado para ese día (o null)", PlannedDay.nullable()), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/weekly-plan/{week_start}",
  tags: ["weekly-plan"],
  security,
  request: { params: z.object({ week_start: z.string() }), query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("Los 7 días con planeado + real", WeeklyPlanResponse), ...errorResponses },
});
registry.registerPath({
  method: "post",
  path: "/api/weekly-plan/{week_start}/mark-done",
  tags: ["weekly-plan"],
  security,
  request: { params: z.object({ week_start: z.string() }), body: jsonBody(MarkDoneBody) },
  responses: { 200: jsonResponse("Marcado", OkResponse), ...errorResponses, 404: jsonResponse("No hay plan para esa semana", ErrorResponse) },
});

// --- alerts ---
registry.registerPath({
  method: "get",
  path: "/api/alerts/check",
  tags: ["alerts"],
  security,
  request: { query: z.object({ workout_type_id: z.string(), date: z.string() }) },
  responses: { 200: jsonResponse("Alerta de 48hs por grupo muscular", AlertCheck), ...errorResponses, 404: jsonResponse("Tipo no encontrado", ErrorResponse) },
});

// --- custom-routines ---
registry.registerPath({
  method: "get",
  path: "/api/custom-routines",
  tags: ["custom-routines"],
  security,
  responses: { 200: jsonResponse("Rutinas propias", z.array(CustomRoutine)), ...errorResponses },
});
registry.registerPath({
  method: "post",
  path: "/api/custom-routines",
  tags: ["custom-routines"],
  security,
  request: { body: jsonBody(createRoutineSchema) },
  responses: { 201: jsonResponse("Rutina creada", z.object({ id: z.number(), name: z.string() })), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/custom-routines/{id}/exercises",
  tags: ["custom-routines"],
  security,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: jsonResponse("Ejercicios de la rutina", z.array(ExerciseInfo)), ...errorResponses, 404: jsonResponse("No encontrada", ErrorResponse) },
});
registry.registerPath({
  method: "delete",
  path: "/api/custom-routines/{id}",
  tags: ["custom-routines"],
  security,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: jsonResponse("Eliminada", OkResponse), ...errorResponses, 404: jsonResponse("No encontrada", ErrorResponse) },
});
registry.registerPath({
  method: "post",
  path: "/api/custom-routines/{id}/exercises",
  tags: ["custom-routines"],
  security,
  request: { params: z.object({ id: z.string() }), body: jsonBody(ExerciseUpsertBody) },
  responses: { 201: jsonResponse("Agregado", OkResponse), ...errorResponses, 404: jsonResponse("No encontrada", ErrorResponse) },
});
registry.registerPath({
  method: "patch",
  path: "/api/custom-routines/{id}/exercises/{exerciseName}",
  tags: ["custom-routines"],
  security,
  request: { params: z.object({ id: z.string(), exerciseName: z.string() }), body: jsonBody(ExercisePatchBody) },
  responses: { 200: jsonResponse("Actualizado", OkResponse), ...errorResponses, 404: jsonResponse("No encontrado", ErrorResponse) },
});
registry.registerPath({
  method: "delete",
  path: "/api/custom-routines/{id}/exercises/{exerciseName}",
  tags: ["custom-routines"],
  security,
  request: { params: z.object({ id: z.string(), exerciseName: z.string() }) },
  responses: { 200: jsonResponse("Eliminado", OkResponse), ...errorResponses, 404: jsonResponse("No encontrado", ErrorResponse) },
});

// --- exercises / streak / export ---
registry.registerPath({
  method: "get",
  path: "/api/exercises",
  tags: ["exercises"],
  security,
  responses: { 200: jsonResponse("Nombres únicos de ejercicios usados", z.array(z.string())), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/streak",
  tags: ["streak"],
  security,
  request: { query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("Semanas consecutivas de plan cumplido", StreakResponse), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/export",
  tags: ["export"],
  security,
  responses: { 200: jsonResponse("Backup completo en JSON", z.record(z.string(), z.unknown())), ...errorResponses },
});

// --- coach/atleta (requiere cuenta real, no modo legacy) ---
const accountSecurity = [{ bearerAuth: [] }];
const accountErrorResponses = {
  400: jsonResponse("Error de validación", ErrorResponse),
  403: jsonResponse("Requiere cuenta real (no alcanza con X-Client-Id legacy)", ErrorResponse),
};

registry.registerPath({
  method: "post",
  path: "/api/coach/invite-code",
  tags: ["coach"],
  security: accountSecurity,
  responses: { 201: jsonResponse("Código (re)generado", InviteCode), ...accountErrorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/coach/invite-code",
  tags: ["coach"],
  security: accountSecurity,
  responses: { 200: jsonResponse("Código actual o null", InviteCode.nullable()), ...accountErrorResponses },
});
registry.registerPath({
  method: "post",
  path: "/api/coach/link-requests",
  tags: ["coach"],
  security: accountSecurity,
  request: { body: jsonBody(LinkRequestBody) },
  responses: {
    201: jsonResponse("Pedido creado (pending)", OkResponse),
    404: jsonResponse("Código inválido", ErrorResponse),
    409: jsonResponse("Ya existe un vínculo con ese atleta", ErrorResponse),
    ...accountErrorResponses,
  },
});
registry.registerPath({
  method: "get",
  path: "/api/coach/pending-requests",
  tags: ["coach"],
  security: accountSecurity,
  responses: { 200: jsonResponse("Pedidos de coaches esperando aceptación", z.array(PendingRequest)), ...accountErrorResponses },
});
registry.registerPath({
  method: "post",
  path: "/api/coach/link-requests/{id}/accept",
  tags: ["coach"],
  security: accountSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: jsonResponse("Aceptado", OkResponse), 404: jsonResponse("No encontrado", ErrorResponse), ...accountErrorResponses },
});
registry.registerPath({
  method: "post",
  path: "/api/coach/link-requests/{id}/reject",
  tags: ["coach"],
  security: accountSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: jsonResponse("Rechazado", OkResponse), 404: jsonResponse("No encontrado", ErrorResponse), ...accountErrorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/coach/athletes",
  tags: ["coach"],
  security: accountSecurity,
  responses: { 200: jsonResponse("Atletas vinculados con adherencia agregada", z.array(CoachAthlete)), ...accountErrorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/coach/sessions/{sessionId}/comments",
  tags: ["coach"],
  security: accountSecurity,
  request: { params: z.object({ sessionId: z.string() }) },
  responses: {
    ...accountErrorResponses,
    200: jsonResponse("Comentarios de coach sobre esa sesión", z.array(SessionComment)),
    403: jsonResponse("Sin acceso a esta sesión", ErrorResponse),
    404: jsonResponse("Sesión no encontrada", ErrorResponse),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/coach/sessions/{sessionId}/comments",
  tags: ["coach"],
  security: accountSecurity,
  request: { params: z.object({ sessionId: z.string() }), body: jsonBody(SessionCommentBody) },
  responses: {
    ...accountErrorResponses,
    201: jsonResponse("Comentario creado", OkResponse),
    403: jsonResponse("Sin vínculo aceptado con el dueño de la sesión", ErrorResponse),
    404: jsonResponse("Sesión no encontrada", ErrorResponse),
  },
});

// --- strength-tests (tests de salto/pliometría, Manual Anselmi) ---
registry.registerPath({
  method: "post",
  path: "/api/strength-tests",
  tags: ["strength-tests"],
  security,
  request: { body: jsonBody(strengthTestSchema) },
  responses: { 201: jsonResponse("Test guardado, con altura/Q calculados", StrengthTest), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/strength-tests",
  tags: ["strength-tests"],
  security,
  request: { query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("Historial de tests, más reciente primero", z.array(StrengthTest)), ...errorResponses },
});

// --- cardio-sessions (trabajo aeróbico/técnico-táctico, separado de sessions) ---
registry.registerPath({
  method: "post",
  path: "/api/cardio-sessions",
  tags: ["cardio-sessions"],
  security,
  request: { body: jsonBody(cardioSessionSchema) },
  responses: { 201: jsonResponse("Sesión de cardio guardada", CardioSession), ...errorResponses },
});
registry.registerPath({
  method: "get",
  path: "/api/cardio-sessions",
  tags: ["cardio-sessions"],
  security,
  request: { query: z.object(asAthleteIdQuery) },
  responses: { 200: jsonResponse("Historial de sesiones de cardio, más reciente primero", z.array(CardioSession)), ...errorResponses },
});

export function generateDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "FORJA API",
      version: "0.1.0",
      description:
        "Generado desde los schemas zod del backend (backend/src/openapi). No editar a mano — correr `npm run openapi:generate` después de cambiar una ruta.",
    },
    servers: [{ url: "http://localhost:4000" }],
  });
}
