# FORJA — Base del proyecto

![CI](https://github.com/TomasMateoAlvarez/forjapp/actions/workflows/ci.yml/badge.svg)

Backend + frontend web + app iOS, todo hablando con la misma API. Probado end-to-end en este entorno (backend levantado, frontend levantado, sesión creada, alerta de "no repetir grupo muscular" funcionando).

Este README es feature-por-feature. Para el *cómo* y el *por qué* de las piezas que cruzan todo el sistema (identidad/multi-tenancy, migraciones, el contrato OpenAPI, tests), ver [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Estructura

```
forja-app/
  backend/    API REST (Node + Express + TypeScript + Postgres vía `pg`)
  frontend/   Web app responsive (React + Vite + TypeScript)
  ios/        App nativa (SwiftUI) — necesita Xcode para compilar
```

## 1. Backend

Requiere **Node 22+** y un **Postgres** corriendo (Fase 11.1: se reemplazó `node:sqlite` por el cliente `pg` — ver sección 17 para el porqué). Para desarrollo local, lo más simple es levantarlo con Docker:

```bash
docker run -d --name forja-postgres -e POSTGRES_USER=forja -e POSTGRES_PASSWORD=forja -e POSTGRES_DB=forja -p 5432:5432 postgres:16-alpine
```

```bash
cd backend
npm install
cp .env.example .env   # completá DATABASE_URL si tu Postgres no es el de arriba
npm run dev
```

Levanta en `http://localhost:4000`. El schema (tablas + índices) se crea solo la primera vez que arranca contra una base vacía, con los tipos de entreno y ejercicios predeterminados ya cargados (Pecho, Espalda, Piernas, Push, Pull, Full Body, Hombro y brazo) — ver "Migraciones de base de datos" abajo para el detalle de cómo.

**Variables de entorno** (copiá `backend/.env.example` a `backend/.env`):
- `DATABASE_URL` — connection string de Postgres. **Requerida, no tiene fallback** (a diferencia de `PORT`): el server no arranca sin ella.
- `PORT` — puerto donde escucha la API (default `4000`; en Render se ignora, la inyecta la plataforma).
- `FRONTEND_ORIGIN` — dominio del frontend en producción, para restringir CORS (ver sección 17). Sin definirla, CORS queda abierto (desarrollo local).

`npm run dev`/`npm start` leen `.env` automáticamente (vía `--env-file-if-exists` de Node, sin dependencia `dotenv`).

**Tests:**

```bash
cd backend
cp .env.test.example .env.test   # una vez, apunta al mismo Postgres de arriba
npm test
```

Corre con `node:test` (nativo desde Node 18+, sin sumar dependencia — se eligió por sobre Vitest porque el proyecto ya no tiene bundler/transformador propio más que `tsx`, que `node:test` reutiliza tal cual). Cada archivo de test levanta la API real (`app.ts`) contra una **base de Postgres temporal propia** (creada con `CREATE DATABASE` al arrancar el archivo de test, destruida con `DROP DATABASE` al terminar — ver `test-helpers.ts`) y un puerto efímero, y le pega por HTTP con `fetch` — no se mockea la base de datos. Antes de la Fase 11.1 esto era un archivo SQLite temporal por proceso; con Postgres el equivalente más simple es una base física temporal por archivo de test en vez de, por ejemplo, un schema compartido con `SET search_path` (se probó esa alternativa primero y generaba una condición de carrera real entre la conexión nueva del pool y el primer query — quedó descartada). El usuario de `DATABASE_URL` necesita permiso para crear/borrar bases; el usuario `forja` del contenedor Docker de arriba lo tiene por default. Cubre: cálculo de PRs y exclusión de series de calentamiento (`sessions.ts`), aritmética de fechas y racha semanal incluyendo cambio de año (`lib/dates.ts`, `streak.ts`), y la regla de alertas de 48hs (`alerts.ts`), entre otras — 89 tests en total, corriendo contra Postgres real tanto en local como en CI.

**Migraciones de base de datos:**

Con SQLite, el esquema se había ido armando con bloques `if (!cols.some(...))` a mano en `db.ts`. La migración a Postgres (Fase 11.1) fue la oportunidad de simplificar eso: como Neon arranca siempre vacío (no hay ninguna instalación Postgres existente que migrar paso a paso), `db.ts` declara directo la **forma final** de cada tabla en sintaxis Postgres, en vez de reproducir la historia completa de rebuilds (`sessions_v2`, `biometrics_v2`, etc.) que tenía sentido para SQLite pero no para un target nuevo. Los 9 ids de migración que ya existían (`0001_indices_sessions_biometrics` ... `0009_profile_pro_enabled`) se mantienen en `backend/src/migrations.ts` como registro histórico (sus `up()` son no-ops, porque su efecto ya está en el schema base), así la tabla `schema_migrations` conserva la misma numeración/auditoría de siempre.

**Toda migración nueva de acá en adelante se agrega al final de `backend/src/migrations.ts`**, con `up()` async (recibe el `DbApi` de `db.ts`, no un cliente de `pg` crudo):

```ts
// backend/src/migrations.ts
export const migrations: Migration[] = [
  // ...las 9 existentes (no-ops)...
  {
    id: "0010_mi_migracion_nueva",
    up: async (db) => {
      await db.run(`ALTER TABLE sessions ADD COLUMN mi_columna INTEGER`);
    },
  },
];
```

Cada migración corre una única vez (se registra por `id` en la tabla `schema_migrations`); el orden del array importa porque se aplican en secuencia en cada arranque del server sobre las que falten. Usá un prefijo numérico (`0010_`, `0011_`...) para que el orden quede legible con solo mirar el nombre del archivo/id.

**Contrato de API (OpenAPI generado desde zod):**

```bash
cd backend && npm run openapi:generate   # regenera backend/openapi.json
cd frontend && npm run gen:api-types     # regenera frontend/src/api/schema.d.ts
```

`backend/src/openapi/schemas.ts` define los schemas de respuesta (reusando los de request que ya existían en cada ruta: `sessionSchema`, `biometricSchema`, `planSchema`, `credentialsSchema`, `createRoutineSchema` — ahora exportados). `backend/src/openapi/registry.ts` registra los ~26 endpoints y genera el documento OpenAPI 3.0; corre completamente aislado del server real (nunca se importa desde `app.ts`/`index.ts`). El frontend consume ese contrato en `frontend/src/api/client.ts` (`export type WorkoutType = components["schemas"]["WorkoutType"]`, etc.) en vez de redefinir los tipos a mano — **si el backend cambia o renombra un campo que el frontend usa, `npm run build` del frontend falla en vez de romperse en producción** (verificado a propósito durante esta implementación). iOS queda fuera de esta generación automática por ahora — es deuda conocida, sus `structs` en `Models.swift` se siguen manteniendo a mano.

Endpoints principales:
- `GET /api/workout-types` — tipos de entreno disponibles
- `GET /api/workout-types/:id/exercises` — set predeterminado de ese tipo
- `POST /api/sessions` — guardar la sesión del día
- `GET /api/sessions` — calendario de sesiones
- `GET /api/history/:exerciseName` — evolución de un ejercicio
- `GET /api/alerts/check?workout_type_id=&date=` — alerta por reglas simples (no IA)
- `POST/GET /api/biometrics` — check-in diario (peso, altura, sensación)
- `POST/GET /api/weekly-plan/:week_start` — planificación semanal

## 2. Frontend web

```bash
cd frontend
npm install
npm run dev
```

Levanta en `http://localhost:5173`. Andá con el backend corriendo en paralelo (otra terminal). Es responsive — anda igual en el navegador del Mac o del iPhone, y se puede "instalar" desde Safari (Compartir → Agregar a pantalla de inicio) como PWA.

**Variables de entorno** (opcional — copiá `frontend/.env.example` a `frontend/.env.local`):
- `VITE_API_BASE` — URL base de la API (default `http://localhost:4000/api`). Usalo para apuntar a un backend en otra máquina/puerto sin tocar código.
- `VITE_CLIENT_ID` — fija el `client_id` de esta instalación en vez del que se autogenera en `localStorage`.

## 3. App iOS

Necesita **Xcode** (macOS) y, la primera vez, [XcodeGen](https://github.com/yonaskolb/XcodeGen) para generar el `.xcodeproj` a partir de `project.yml`:

```bash
brew install xcodegen
cd ios
xcodegen generate
open Forja.xcodeproj
```

Corré el target en el simulador o en tu iPhone conectado por cable (con tu cuenta de Apple gratuita alcanza para testear en tu propio dispositivo).

**Importante sobre la conexión al backend:**
- En el **simulador**, `http://localhost:4000` apunta a tu Mac — funciona tal cual.
- En un **iPhone físico**, "localhost" es el propio iPhone, no tu Mac. Necesitás:
  1. Que el Mac y el iPhone estén en la misma red WiFi.
  2. Averiguar la IP local de tu Mac: `ipconfig getifaddr en0`
  3. Editar `API_BASE_URL` en `ios/Config/Debug.xcconfig` (o `Release.xcconfig` si corrés esa configuración) y poner `http://TU_IP:4000/api` — **no hace falta tocar código Swift ni regenerar el proyecto**, `APIClient.swift` lo lee de `Info.plist` en tiempo de ejecución vía ese build setting.

Ya dejé `NSAllowsArbitraryLoads = true` en el `project.yml` para que iOS no bloquee las llamadas HTTP (sin esto, iOS exige HTTPS por default). Es una config solo para desarrollo local — antes de producción hay que sacarla y servir el backend con HTTPS.

## 4. Autenticación (opcional)

Cada instalación (web/iOS) sigue generando un `X-Client-Id` propio y anónimo — eso **no cambió** y sigue funcionando exactamente igual que antes para quien no quiera crear cuenta. Encima de eso, ahora existe una capa de cuentas reales, opcional, pensada para el día que se comparta el backend entre más de una persona o se sume el panel de coach:

- `POST /api/auth/register` / `POST /api/auth/login` — email + password (hasheado con `scrypt` nativo de `node:crypto`, sin sumar `bcrypt`). Devuelven un token de sesión opaco (no JWT — un random de 32 bytes guardado hasheado en `auth_tokens`, revocable con un simple `DELETE`).
- Mandando `Authorization: Bearer <token>` en vez de (o además de) `X-Client-Id`, el backend deriva la identidad del usuario autenticado y la usa como `client_id` — ver `backend/src/middleware/auth.ts`.
- `POST /api/auth/logout` revoca el token.
- **Frontend**: pantalla de cuenta dentro de "Perfil" (`AccountPanel.tsx`, reusado también en "Biometría"). El token se guarda en `localStorage` (trade-off documentado en `frontend/src/api/authToken.ts`: más simple que cookies httpOnly, aceptable mientras el backend no salga de la red local).
- **iOS**: misma pantalla dentro de "Perfil" (`AccountView.swift`, reusado también en "Biometría"). El token se guarda en **Keychain** (`Auth/KeychainStore.swift`), no en `UserDefaults` (donde sigue viviendo solo el `client_id` legacy).
- **Migración de datos anónimos**: crear una cuenta (no loguearse en una existente) dispara automáticamente `POST /api/auth/migrate-anonymous-data` con el `client_id` anónimo de ese dispositivo — mueve `sessions`, `custom_routines`, `biometrics`, `personal_records`, `weekly_plans`, `user_profile`, `strength_tests` y `cardio_sessions` a la cuenta nueva (las tablas hijas como `session_exercises` viajan solas por FK). Es best-effort (si falla, la cuenta igual se crea) e idempotente (correrlo dos veces no duplica ni rompe nada — la segunda vez no encuentra filas para mover). Si una fila puntual choca con una constraint UNIQUE de la cuenta destino (poco probable en una cuenta recién creada), esa fila se deja en el anónimo en vez de abortar toda la migración. Loguearse en una cuenta **ya existente** no migra nada — evita mezclar por sorpresa el historial de este dispositivo con el de una cuenta que ya tenía datos propios en otro dispositivo.

## 5. Perfil y Métricas Pro

FORJA se vende como una app simple: lo que hace falta para que alguien sin plan sepa qué entrenar (rutina sugerida, RIR/RPE por serie, sugerencia de progresión) es parte del producto base y va **siempre visible**. Todo lo que agrega complejidad analítica (indicadores del Manual Anselmi, tests de salto, método cubano, RPE de sesión, cardio/mixtas) vive detrás de un toggle **"Métricas Pro"** en el perfil, apagado por default — es un flag de UI, no un paywall real (no hay infraestructura de billing).

- **Columna `pro_enabled`** en `user_profile` (boolean, default `false`). `GET/PUT /api/profile` la exponen junto a `height_cm`/`training_mode` — ver `backend/src/routes/profile.ts`. El backend sigue calculando todos los indicadores igual sin importar este valor (no hay gating del lado del servidor); el gating es enteramente del frontend/iOS, a propósito, para no complicar las respuestas de la API con variantes condicionales.
- **Pantalla "Perfil" nueva y acotada** (`frontend/src/pages/Profile.tsx`, `ios/Forja/Views/ProfileView.swift`) — separada de "Biometría" (antes la única pantalla "Perfil", ahora renombrada; sigue teniendo altura, check-in de sensación diaria, gráfico de peso, historial y export tal cual estaban). "Perfil" muestra únicamente: estado de sesión, peso actual editable (mismo endpoint de `biometrics`, sin tabla nueva), objetivo de entrenamiento (`training_mode`, movido acá desde "Biometría") y el switch de Métricas Pro.
- **Qué queda gateado** (solo visible/interactuable con `pro_enabled = true`): índices de sesión (tonelaje, peso medio, intensidad, Índice/Coeficiente de Hipertrofia) en el detalle expandible de Planificación → Historial; selector de fase de mesociclo + discrepancia + reparto "método cubano"; RPE de sesión (selector en Hoy y su gráfico en el tiempo); tests de salto/pliometría; sesiones de cardio/técnico-táctico (tanto la tarjeta para cargarlas en Hoy como el listado en Historial).
- **Qué NO se gatea** (siempre visible, es parte del producto base o es gratis/no abruma): rutina inicial sugerida, RIR por serie, sugerencia de progresión por ejercicio, PRs por día de la semana, y el descanso dinámico según %1RM del timer de descanso.
- Al desactivar el toggle, los datos ya cargados (RPE de sesiones viejas, tests de salto, sesiones de cardio) no se borran — vuelven a verse si se reactiva. Es puramente una cuestión de qué se renderiza.

## 6. Panel del coach (requiere cuenta real)

- El atleta genera un código en la tab **Coach** (`POST/GET /api/coach/invite-code`) y se lo pasa a su coach de palabra o por mensaje. Regenerar el código invalida el anterior.
- El coach usa ese código para pedir vínculo (`POST /api/coach/link-requests`) — queda en estado `pending`.
- El atleta ve el pedido en "Pedidos pendientes" y decide aceptar o rechazar (`POST /api/coach/link-requests/:id/accept|reject`) — **el coach nunca puede agregarse solo**.
- Con vínculo `accepted`, el coach ve en `GET /api/coach/athletes` la lista de sus atletas con adherencia agregada (% de las últimas 8 semanas cumplidas) y último check-in biométrico.
- Al entrar al detalle de un atleta, el coach ve exactamente la misma pantalla de `Planning.tsx` que el atleta (calendario + historial + gráficos + PRs), pero en modo **solo lectura** (`<Planning athleteId readOnly />`) — no puede editar el plan ni cargar series.
- Por debajo, esto reutiliza los endpoints de lectura ya existentes (`sessions`, `history`, `biometrics`, `weekly-plan`, `streak`): todos aceptan `?as_athlete_id=<id>`, que el backend solo respeta si hay un vínculo `accepted` entre el usuario autenticado y ese atleta (`backend/src/auth/coachAccess.ts`) — si no hay vínculo, se ignora el parámetro y cada quien ve lo suyo.
- Un coach puede además dejar un comentario en una sesión puntual del atleta (`POST /api/coach/sessions/:sessionId/comments`), visible para ambos — feedback asincrónico simple, sin chat en vivo.
- **Paridad iOS**: `CoachView.swift` replica el mismo flujo (código propio, pedidos pendientes, vincularse con un atleta, lista de atletas) y reusa `PlanningView` con `athleteId`/`readOnly` para ver el progreso del atleta, igual que el frontend web reusa `Planning.tsx`. Los comentarios de coach sobre una sesión puntual quedan solo en frontend web por ahora.

## 7. Guía de entrenamiento (fuerza / hipertrofia / mantenimiento)

Pensado para alguien que llega sin rutina propia y sin coach — no es un algoritmo de personalización, son constantes de referencia (`backend/src/lib/trainingModes.ts`) y una plantilla fija:

| Modo | Reps por serie | Descanso sugerido | Sube peso si RIR ≤ |
|---|---|---|---|
| Fuerza | 2–6 | 4 min | 2 |
| Hipertrofia | 6–12 | 75 s | 1 |
| Mantenimiento | 8–12 | 75 s | 1 |

- **Elegir modo**: en "Perfil" (`PUT /api/profile` con `training_mode`). Se puede cambiar cuando quieras, no es un compromiso permanente.
- **Rutina inicial sugerida**: botón "💡 Sugerir rutina inicial" en Planificación → Calendario (`GET /api/weekly-plan/suggested`). Es una plantilla fija de 3 días no consecutivos (Lun Full Body, Mié Push, Vie Pull, resto descanso) para ondular el esfuerzo en vez de repetir el mismo tipo seguido — no depende del modo elegido, solo llena los selects para que los revises antes de guardar.
- **RIR opcional por serie**: campo nuevo en `Today.tsx` al cargar peso/reps (columna "RIR"), guardado en `session_exercises.rir`. Es reps-in-reserve (0 = al fallo), no RPE de sesión completa (eso es la Fase 8).
- **Sugerencia de progresión**: al seleccionar un tipo de entreno en "Hoy", cada ejercicio con historial muestra un badge (💡 Subí peso / ➡️ Mantené / 🔻 Bajá) según `GET /api/history/:exerciseName/suggestion` — compara las reps/RIR de tu última sesión de ese ejercicio contra el rango del modo elegido. Si todavía no elegiste un modo, simplemente no se muestra nada (no es bloqueante); se puede forzar un modo puntual con `?mode=`.

## 8. Indicadores de entrenamiento (Manual Anselmi)

Ver `PROPUESTA_INDICADORES_ANSELMI.md` para el detalle completo (tests de salto/potencia, plantilla "método cubano" y descanso dinámico se implementaron después, ver secciones 12-14). Estos son los quick wins: se calculan con datos que ya existen (más el RPE de sesión, único campo nuevo), en el backend — dejan de calcularse dos veces en el frontend. **Métricas Pro** (ver sección 5): todo lo de esta sección, salvo PRs por día de la semana, queda detrás del toggle.

- **Tonelaje, intensidad % y zona por serie de trabajo**: `GET /api/history/:exerciseName` agrega `tonelaje` (peso × reps), `intensidad_pct` (peso ÷ PR de peso actual del ejercicio × 100) y `zona` (`fuerza_maxima` 90-100% / `hipertrofia` 75-90% / `adaptacion` 50-75% / `potencia` 25-35% / `otra`) a cada serie — `null` en series de calentamiento, que quedan excluidas del cálculo. Ver `backend/src/lib/intensityZones.ts`.
- **Resumen de sesión**: `GET /api/sessions/:id` agrega `tonelaje_total`, `peso_medio` (tonelaje ÷ reps de trabajo) e `intensidad_promedio_pct` (promedio simple del %PR de cada serie de trabajo), todo excluyendo calentamiento.
- **RPE de sesión (1-10, opcional)**: selector al pie de la sesión en `Today.tsx`, antes de "Guardar sesión" — es el esfuerzo percibido de la SESIÓN completa, distinto del RIR por serie de la Fase 7. Columna `sessions.rpe`, se devuelve en `GET /api/sessions` y `GET /api/sessions/:id`.
- **PRs por día de la semana**: gráfico de barras nuevo en Planificación → Historial (`GET /api/history/prs-by-weekday`, componente `ForjaBarChart.tsx`) — cruza `personal_records.best_weight_date`/`best_volume_date` para mostrar en qué día tendés a marcar más récords. Siempre devuelve los 7 días, con 0 si no hay datos.
- El 1RM estimado y el volumen que ya se graficaban en `Planning.tsx` **siguen calculándose en el frontend** a propósito (son fórmulas derivadas, no indicadores nuevos de esta fase) — no se tocaron.

## 9. Indicadores derivados y alerta de tendencia

**Métricas Pro** (ver sección 5): todo lo de esta sección queda detrás del toggle.

- **Índice y Coeficiente de Hipertrofia (Peter Sisco)**: `Today.tsx` captura automáticamente `started_at` (al elegir el tipo de entreno) y `ended_at` (al guardar) — sin pedirle nada al usuario. Con eso, `GET /api/sessions/:id` agrega `indice_hipertrofia` (tonelaje ÷ minutos) y `coeficiente_hipertrofia` (tonelaje² ÷ minutos); quedan en `null` si el cliente no mandó ambos timestamps (por ejemplo, sesiones sincronizadas desde la cola offline de una versión vieja del cliente).
- **Alerta de tendencia** (`GET /api/alerts/check`, campo `trend_warning`/`trend_message`, independiente de la alerta fija de 48hs que ya existía): si un grupo muscular acumula 3+ semanas **consecutivas** de intensidad promedio ≥75% sin ninguna semana de menor intensidad de por medio, sugiere una semana de descarga. Se muestra en `Today.tsx` como un segundo banner junto al de 48hs.
- **Fase de mesociclo** (`weekly_plans.mesocycle_phase`: `acumulacion` / `intensificacion` / `descarga` / `mantenimiento`) — campo declarativo simple, sin motor de periodización. `POST /api/weekly-plan` la acepta opcionalmente; `GET /api/weekly-plan/:week_start` devuelve `week_intensity_pct` (intensidad real promedio de esa semana) y `mesocycle_discrepancy`: un mensaje si la intensidad real superó lo esperable para la fase declarada (ej. "planificaste descarga pero tu intensidad fue la más alta"). Los umbrales por fase son una referencia orientativa (`PHASE_MAX_EXPECTED_INTENSITY_PCT` en `weeklyPlan.ts`), no una regla estricta.
- El cálculo de intensidad promedio (%PR por serie) que ya existía en el resumen de sesión (Fase 7) se extrajo a `backend/src/lib/intensity.ts` para reusarlo acá en vez de duplicarlo una tercera vez.
- **UI en los 3 clientes**: en Planificación → Historial (web e iOS), cada sesión del "Calendario reciente" es clickeable y expande tonelaje total/peso medio/intensidad promedio/índice y coeficiente de hipertrofia (`Planning.tsx` y `PlanningView.swift`, ambos contra `GET /api/sessions/:id`). El selector de fase de mesociclo y el banner de discrepancia viven en Planificación → Calendario, junto al botón de rutina sugerida (solo frontend web por ahora — iOS todavía no tiene este selector puntual, aunque sí reusa el resto de la pantalla).

## 10. Comentarios de coach en sesiones (solo frontend web)

Al expandir una sesión en Planificación → Historial, se ve la sección "Comentarios del coach" (`GET /api/coach/sessions/:sessionId/comments`) y, si estás viendo el progreso de un atleta como coach (`athleteId` seteado), un campo para dejar feedback puntual sobre esa sesión (`POST /api/coach/sessions/:sessionId/comments`) — requiere vínculo `accepted` con ese atleta.

## 11. Notificaciones locales del plan semanal (solo iOS)

Al guardar el plan de la semana en `PlanningView.swift`, se agenda un recordatorio local (`UNUserNotificationCenter`, sin backend ni APNs — no hay deploy a la nube) a las 9am de cada día planificado que todavía no esté marcado como hecho (`Notifications/NotificationManager.swift`). Se piden permisos la primera vez que hace falta, se cancelan y reprograman en cada guardado, y marcar un día como hecho cancela puntualmente su recordatorio. Sin equivalente en frontend web (los navegadores de escritorio no tienen un análogo directo a notificaciones locales programadas sin un service worker + permiso de push, fuera de alcance).

## 12. Tests de salto/pliometría (`strength_tests`)

En Biometría → "Test de salto" (web e iOS, **Métricas Pro**): el usuario cronometra el tiempo de vuelo del salto (con el celular alcanza, sin plataforma real) y lo carga junto con la fecha. `POST/GET /api/strength-tests` guarda `flight_time_sec` (y, para drop jump, `contact_time_sec` + `drop_height_cm`) y la API deriva — no se guardan calculados — **altura de salto** (`(tiempo de vuelo)² × 1.226 × 100`, Manual Anselmi) y, si es drop jump, **Q de estabilidad reactiva** (`tiempo de vuelo ÷ tiempo de contacto`). Se ve un gráfico de evolución de altura de salto igual al de peso corporal.

## 13. Reparto de volumen "método cubano" (referencia, solo frontend web, Métricas Pro)

`GET /api/weekly-plan/cuban-method-template` devuelve el reparto de volumen del manual (35/28/22/15% del volumen total del mesociclo en 4 semanas). Se muestra como referencia junto al selector de fase de mesociclo en Planificación → Calendario: cada semana tiene un botón que aplica la fase sugerida para esa posición del ciclo (no hay un campo de "volumen planificado" en el modelo para aplicar el reparto automáticamente — es una plantilla informativa, no una regla que se guarda o valida).

## 14. Descanso dinámico según %1RM

**No es Métricas Pro** — a diferencia del resto de los indicadores del Manual Anselmi (secciones 8-9, 12-13), esta queda siempre visible: ayuda directamente a decidir cuánto descansar hoy, no es un dato analítico para revisar después.

`GET /api/history/:exerciseName/rest-suggestion?weight_kg=` (`backend/src/lib/restSuggestion.ts`) sugiere cuánto descansar según la intensidad relativa al PR de la serie que se acaba de cargar (Manual Anselmi §2.5): ~4 min en zona fuerza máxima (90-100%), 2 min en hipertrofia (75-90%), 1.5 min en adaptación/potencia — con una nota aparte para series de potencia ("no superar 6s de ejecución"). En `Today.tsx`/`TodayView.swift`, al tocar "✓" en una serie con peso cargado, el timer de descanso usa este valor en vez del `default_rest_seconds` fijo del ejercicio; si falla o no hay peso cargado, cae al valor fijo de siempre (no bloqueante).

## 15. Sesiones de cardio/técnico-táctico

Módulo separado de `sessions` (que es sobrecarga con series/reps): en Hoy (web e iOS), debajo de la sesión de sobrecarga, hay una tarjeta "Cardio / técnico-táctico" para cargar tipo (cardio / técnico-táctico / otro), duración en minutos y notas opcionales (`POST/GET /api/cardio-sessions`, tabla `cardio_sessions`). Se ve un historial reciente en Planificación → Historial. El manual (§2.6) es explícito: si hay cardio el mismo día que sobrecarga, va siempre después, nunca antes, y la sesión completa no debería superar los 90 minutos — como no hay una relación confiable entre una sesión de cardio y una de fuerza del mismo día en el modelo actual, esa guía queda como texto en la tarjeta, no como una validación. **Métricas Pro** (ver sección 5): tanto la tarjeta de carga como el listado quedan detrás del toggle.

## 16. Piloto cerrado: auditoría de auth, guard de identidad y atajo a historial

Pensado para el día que un puñado de personas afuera de tu red usen la app con su propia cuenta — pasos de endurecimiento que no dependen de exponer nada a internet todavía (ver "Exponer la app a testers externos" más abajo para esa parte, que quedó explícitamente sin implementar).

- **Auditoría de `requireIdentity`**: confirmado que `app.use("/api", requireIdentity)` (`backend/src/app.ts`) se monta antes de *todos* los routers de datos, sin excepción — el único código que corre sin pasar por ahí es `/api/health` (no necesita identidad) y `/api/auth/*` (es, por definición, cómo se consigue una identidad). No había ningún endpoint viejo que se hubiera colado sin autenticación.
- **`RequireAuth` (`frontend/src/components/RequireAuth.tsx`)**: envuelve toda la app en `App.tsx`. Importante — **no bloquea el modo anónimo**: crear una cuenta sigue siendo opcional, tal como está documentado en toda la sección 4. Lo único que cubre es el caso límite de que ni siquiera el `client_id` anónimo se pueda resolver (`localStorage` bloqueado por el navegador o modo privado restrictivo) — ahí sí corta con un mensaje claro en vez de que cada pantalla falle de forma distinta. En la práctica, con el fallback anónimo que ya existe, esto casi nunca se dispara — es una red de seguridad, no un cambio de comportamiento.
- **Atajo de navegación a historial de ejercicio**: en `Today.tsx` (durante el registro de series) y `Routines.tsx` (gestión de ejercicios de una rutina), el nombre de cada ejercicio es ahora un link que navega directo a Planificación → Historial con ese ejercicio ya seleccionado y su gráfico abierto — mismo `ForjaLineChart` de siempre, sin duplicar nada. Técnicamente: el estado de "qué ejercicio abrir" se levantó a `App.tsx` (`pendingExercise`), que se lo pasa a `Planning` como prop (`openExerciseOnMount`) al cambiar de tab; `Planning` lo consume en un efecto de montaje (llama al `openExercise` que ya existía) y avisa a `App.tsx` para limpiarlo, así volver a la tab de Planificación por la navegación normal no reabre el mismo ejercicio. Solo frontend web — no se portó a iOS en esta fase.

## 17. Piloto cerrado: Postgres (Neon), backend en Render, frontend en Vercel

Objetivo: un puñado de personas afuera de tu red usan FORJA con su propia cuenta, sin ver datos ajenas, durante ~30 días sin que se pierda nada en el medio. Reemplaza la idea original de túnel (Cloudflare Tunnel corriendo en tu Mac): un piloto de 30 días necesita que el backend y la base sigan vivos sin depender de que tu máquina esté prendida, y el free tier de Render Postgres expira a los 30 días de creado — por eso la base va en Neon (free, sin expiración, scale-to-zero) en vez de en Render.

### 17.1 — Base de datos en Neon

1. Creá una cuenta en [neon.tech](https://neon.tech) y un proyecto nuevo (el plan free alcanza para un piloto chico).
2. Copiá la **connection string** que te da Neon (botón "Connect", forma `postgresql://usuario:password@host/basededatos?sslmode=require`).
3. Guardala como `DATABASE_URL` en las variables de entorno de Render (paso siguiente) — **nunca la commitees ni la pegues en código**. Neon fuerza SSL (`sslmode=require`), que el cliente `pg` respeta automáticamente porque viene incluido en la connection string.
4. No hace falta correr ninguna migración a mano: el mismo `initDb()` que corre en cada arranque del backend (ver sección 1) crea el schema completo y siembra el catálogo de `workout_types` la primera vez que se conecta a una base vacía — Neon queda listo apenas el backend de Render arranca por primera vez.

### 17.2 — Backend en Render

1. En [render.com](https://render.com), creá un **Web Service** nuevo apuntando al repo de GitHub, carpeta raíz `backend/`.
2. Build command: `npm install && npm run build`
3. Start command: `npm start`
4. Variables de entorno del servicio (Render → Environment):
   - `DATABASE_URL` — la connection string de Neon del paso anterior.
   - `FRONTEND_ORIGIN` — la URL pública que te va a dar Vercel (paso 17.3) una vez creada, ej. `https://forjapp.vercel.app` — sin esto, CORS queda abierto y cualquier origen podría pegarle a la API.
   - `PORT` — **no la definas**: Render la inyecta solo, y `index.ts` ya la lee de `process.env.PORT` (ver sección 1).
5. `GET /api/health` (sin `X-Client-Id`, ya existía desde antes de esta fase) es el endpoint que usa Render para healthchecks del servicio y el que pega el cron de keep-alive (17.4).

### 17.3 — Frontend en Vercel

1. En [vercel.com](https://vercel.com), importá el repo, carpeta raíz `frontend/` (framework preset: Vite).
2. Variable de entorno del proyecto (Vercel → Settings → Environment Variables): `VITE_API_BASE` = `https://tu-backend.onrender.com/api` (la URL pública que te dio Render en el paso anterior, con `/api` al final).
3. Build command / output quedan los defaults de Vite (`npm run build` / `dist`) — Vercel los detecta solo.
4. `frontend/vercel.json` ya está commiteado con un rewrite de fallback a `index.html` — hoy la app no usa un router de URLs (todo es estado de tabs dentro de una sola página), así que no es estrictamente necesario, pero evita cualquier 404 si en algún momento se agrega ruteo por URL.
5. Una vez deployado, actualizá `FRONTEND_ORIGIN` en Render (paso 17.2) con la URL real que te asignó Vercel, si todavía tenía un valor provisorio.

### 17.4 — Keep-alive (workaround, no soportado oficialmente)

El plan free de Render duerme el servicio tras ~15 min sin tráfico, y el primer request después de eso tarda ~1 minuto en responder (cold start) — molesto para el primer tester que entra en un rato. Para minimizarlo (no eliminarlo del todo):

1. Creá una cuenta gratis en [cron-job.org](https://cron-job.org) o [UptimeRobot](https://uptimerobot.com).
2. Configurá un monitor/cron que haga `GET https://tu-backend.onrender.com/api/health` cada 5-10 minutos.
3. Esto **no es una feature soportada por Render** (activamente desalientan mantener el servicio despierto en el plan free) — es un workaround conocido y puede dejar de funcionar si Render cambia su política. Incluso con esto activo, puede haber una espera ocasional si el cron y el primer tester coinciden con una ventana de suspensión.

### 17.5 — Checklist antes de mandar el link a alguien

- [ ] Backend responde en `https://tu-backend.onrender.com/api/health`.
- [ ] Frontend en Vercel carga y puede loguearse/registrarse contra ese backend (probar `VITE_API_BASE` correcto revisando la pestaña Network del navegador).
- [ ] `FRONTEND_ORIGIN` en Render coincide exactamente con la URL de Vercel (con `https://`, sin `/` final) — si no coincide, CORS bloquea todo desde el navegador aunque `curl` funcione.
- [ ] Dos cuentas de prueba distintas no ven datos una de la otra en ningún endpoint (sección 16 ya audita que todo pasa por `requireIdentity`; esto es la verificación manual end-to-end).
- [ ] Cron de keep-alive corriendo (17.4).

## Qué es MVP hoy y qué falta

**Ya funciona (probado):**
- Selector "¿Qué entrenás hoy?" → carga set predeterminado de ejercicios
- Registro de peso/reps/series por ejercicio, guardado con fecha
- Historial por ejercicio (evolución en el tiempo)
- Calendario de sesiones
- Alerta por reglas simples (mismo grupo muscular en 48hs)
- Planificación semanal con marcado de días cumplidos
- Perfil biométrico diario (peso, altura, cómo te sentís)
- Cuentas de usuario opcionales (registro/login/logout) en los 3 clientes, en paralelo al modo anónimo legacy
- Vínculo coach-atleta con invitación por código, vista de solo lectura del progreso del atleta y comentarios de coach por sesión, en los 3 clientes (comentarios solo en frontend web)
- Modo de entrenamiento (fuerza/hipertrofia/mantenimiento), rutina inicial sugerida, RIR por serie y sugerencia de progresión por ejercicio, en los 3 clientes
- Tonelaje/intensidad%/zona por serie, resumen de sesión expandible, RPE de sesión y gráfico de PRs por día de la semana (Manual Anselmi, quick wins), en los 3 clientes
- Índice/Coeficiente de Hipertrofia (duración capturada automáticamente), alerta de tendencia de intensidad sostenida y fase de mesociclo con comparación vs. intensidad real (selector solo en frontend web)
- Notificaciones locales del plan semanal en iOS
- Migración automática (best-effort, idempotente) del historial anónimo a una cuenta recién creada, en los 3 clientes
- Tests de salto/pliometría (`strength_tests`) con altura de salto y Q de estabilidad reactiva derivados, en web e iOS
- Reparto de volumen "método cubano" como referencia junto al selector de fase de mesociclo (solo frontend web)
- Descanso dinámico según %1RM de la serie recién cargada, en los 3 clientes
- Sesiones de cardio/técnico-táctico (tipo, duración, notas), separadas de la sobrecarga, en los 3 clientes
- Gráfico de RPE de sesión en el tiempo (solo frontend web)
- Toggle "Métricas Pro" en Perfil (apagado por default) que gatea del lado del frontend/iOS todos los indicadores/módulos avanzados de arriba (Manual Anselmi, tests de salto, método cubano, RPE de sesión, cardio/mixtas) — el resto de la app (rutina sugerida, RIR, sugerencia de progresión, PRs por día, descanso dinámico) sigue siempre visible como parte del producto base
- Pantalla "Perfil" nueva y minimalista (sesión, peso actual, objetivo de entrenamiento, toggle Pro), separada de "Biometría" (altura, check-in, gráfico de peso, historial, export — sigue igual, solo cambió de nombre), en los 3 clientes
- Auditoría confirmada de que todo endpoint pasa por `requireIdentity`, guard `RequireAuth` en el frontend (sin bloquear el modo anónimo) y atajo para tocar el nombre de un ejercicio en Hoy/Rutinas y saltar directo a su historial (solo frontend web)
- Backend migrado de `node:sqlite` a Postgres (`pg`), con schema/migraciones/queries traducidos y probados contra Postgres real (Docker en local y CI); código listo para Render (`PORT`/`FRONTEND_ORIGIN`/`DATABASE_URL` por variable de entorno, CORS restringido en producción) y para Vercel (`VITE_API_BASE`, `vercel.json`) — ver sección 17

**Todavía no implementado (pasos manuales, no código):**
- El deploy en sí: crear las cuentas/proyectos reales en Neon, Render y Vercel, y configurar sus variables de entorno — la sección 17 documenta los pasos exactos, pero ejecutarlos (crear cuentas, pegar connection strings) queda pendiente de que decidas hacerlo.
- Configurar el cron de keep-alive externo (17.4) una vez el backend esté deployado.
- Nutrición y sesiones mixtas con cardio combinado (fuera de alcance — ver `PLAN_DESARROLLO_SPRINTS.md`)
- Animaciones/badges de PR, templates de rutina compartibles y chat coach-atleta en vivo (mejoras de UX de "nice to have", no bloqueantes)
- Túnel de Cloudflare para exponer la app a testers externos (descartado a propósito, es deploy/HTTPS — ver sección 16 para los pasos manuales si algún día se decide hacerlo)
