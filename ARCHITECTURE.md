# Arquitectura de FORJA

Este documento complementa al `README.md` (que es feature-por-feature): acá está el *cómo* y el *por qué* de las piezas que cruzan todo el sistema — identidad/multi-tenancy, migraciones, el contrato de API, y las decisiones de diseño que no son obvias mirando un solo archivo.

## 1. Multi-tenancy e identidad (`middleware/auth.ts`)

Todo el backend es un único proceso/base de datos compartido por todas las instalaciones — el aislamiento entre "tenants" (instalaciones anónimas o cuentas reales) es una columna `client_id TEXT` en cada tabla de datos personales, no bases o schemas separados.

Cada request pasa por `requireIdentity` (montado en `app.ts` después de `/api/auth`, antes de todo lo demás) que resuelve `req.clientId` con esta prioridad:

1. **`Authorization: Bearer <token>` válido** → `req.clientId = String(user.id)`. El token es opaco (32 bytes random, no JWT), se guarda hasheado en `auth_tokens` y se resuelve por lookup en `auth/tokens.ts`.
2. **`X-Client-Id: <valor>`** (modo legacy, sin cuenta) → `req.clientId = ese valor tal cual`, sin autenticación — cualquiera que sepa (o adivine) un `client_id` ajeno puede leer/escribir esos datos. Es un trade-off explícito para el modo legacy anónimo: quien crea una cuenta real pasa a autenticarse por token (`Authorization: Bearer`), que sí es lo que exige el README antes de repartir el link del piloto a nadie (sección 17).
3. Ninguno de los dos → `400`.

Todas las rutas de datos (`sessions`, `history`, `biometrics`, `weekly-plan`, `custom-routines`, `profile`) filtran por `req.clientId` sin excepción. La única forma de que un `client_id` vea datos de otro es el modo coach (§2).

**Dónde mirar antes de agregar una tabla nueva con datos "de usuario":** agregarle una columna `client_id TEXT NOT NULL DEFAULT 'default'` (ver el patrón de migración de `sessions`/`custom_routines` en `db.ts`) y sumarla a `CLIENT_SCOPED_TABLES` en `routes/auth.ts` (la usa la migración de datos anónimos, §5).

## 2. Acceso de coach a datos de un atleta (`auth/coachAccess.ts`)

El modo coach **no** cambia `req.clientId` — en cambio, los endpoints de solo-lectura que lo soportan (`sessions`, `history`, `biometrics`, `weekly-plan`, `streak`) aceptan un query param opcional `?as_athlete_id=<id>` y llaman a `resolveEffectiveClientId(req, asAthleteId)`:

- Si no viene el param, devuelve `req.clientId` sin más (comportamiento normal).
- Si viene, verifica que exista una fila en `coach_athletes` con `coach_user_id = req.userId`, `athlete_user_id = as_athlete_id`, `status = 'accepted'`. Si existe, devuelve `String(as_athlete_id)` — el resto de la query corre exactamente igual que si el atleta la hubiera hecho. Si no existe el vínculo, el parámetro se ignora silenciosamente (cada quien ve lo suyo, sin error) — a propósito, para que un cliente que manda el param "por las dudas" nunca vea un 403 inesperado.

Este mecanismo requiere `req.userId` (por lo tanto, cuenta real vía Bearer) — el modo `X-Client-Id` legacy no puede usar `as_athlete_id`.

Escrituras (crear sesión, guardar plan, etc.) **no** aceptan `as_athlete_id` — el coach solo puede leer y comentar (`POST /api/coach/sessions/:id/comments`), nunca editar el plan o cargar series del atleta. Esto se refleja también en el cliente: `Planning`/`PlanningView` reciben un flag `readOnly` que oculta los controles de edición cuando se está viendo a un atleta.

## 3. Migraciones de esquema (`migrations.ts`)

Versionado simple, sin librería externa: un array de `{ id, up(db) }` async en orden, aplicado una única vez cada uno (registrado por `id` en `schema_migrations`), corrido al boot en `db.ts` vía `runMigrations(db)`. Los primeros 9 ids (de la época `node:sqlite`, hasta `0009_profile_pro_enabled`) tienen `up()` no-op: con la migración a Postgres (Fase 11.1) su efecto final quedó declarado directo en el `CREATE TABLE` base de `db.ts` (Neon arranca vacío, no hay instalación existente que migrar paso a paso) — se mantienen en el array solo para no perder la numeración/auditoría de `schema_migrations`.

Regla práctica: **toda migración nueva va a `migrations.ts`**, nunca directo a `db.ts`. Prefijo numérico en el `id` (`0007_...`) para que el orden se lea de un vistazo.

## 4. Contrato de API generado (`openapi/`)

`backend/src/openapi/schemas.ts` (schemas de respuesta) + `registry.ts` (uno por endpoint, ~35 a esta altura) generan `backend/openapi.json` vía `npm run openapi:generate` — corre completamente aislado del server real (`app.ts`/`index.ts` nunca importan nada de `openapi/`). El frontend web regenera `frontend/src/api/schema.d.ts` desde ese JSON (`npm run gen:api-types`, usa `openapi-typescript`) y **no redefine tipos a mano** — un campo renombrado o borrado en el backend rompe `npm run build` del frontend en vez de fallar silenciosamente en producción.

Dos gotchas de `@asteasolutions/zod-to-openapi` (v7, no v9 — v9 pide zod v4 y el proyecto usa zod v3) que costó diagnosticar y vale dejar anotados:

- **Contaminación de `.nullable()`**: llamar `.nullable()` sobre un schema ya registrado con `.openapi("Nombre")` mezcla `nullable: true` en la definición *compartida* del componente, no genera una variante inline independiente. Si un mismo enum/objeto se usa nullable en un lugar y no-nullable en otro, hay que envolver una copia **sin registrar** (`z.enum(valoresBase).nullable()`), nunca `NombreRegistrado.nullable()`. Ver `MesocyclePhase` en `schemas.ts` (la fuente única de valores vive en `mesocyclePhaseSchema`, exportado desde `routes/weeklyPlan.ts`, y `schemas.ts` la reusa en vez de duplicarla).
- **Poda de schemas huérfanos**: un schema con `.openapi("Nombre")` que no queda referenciado por `$ref` en ningún path registrado (porque su único uso real es inline, como el caso de arriba) **desaparece silenciosamente** de `components.schemas` en el JSON generado — no es un error, es la poda por defecto del generador. Si igual querés que ese tipo quede expuesto como componente nombrado (para que `schema.d.ts` lo genere y el cliente pueda importarlo), hay que registrarlo explícitamente: `registry.register("Nombre", Schema)` en `registry.ts`, además de (o en vez de) usarlo por `$ref` en algún path.

iOS queda fuera de esta generación automática — sus `struct`s en `Models.swift` se mantienen a mano, en paralelo al contrato. Es deuda conocida, no un problema resuelto.

## 5. Migración de datos anónimos → cuenta (`routes/auth.ts`)

`POST /api/auth/migrate-anonymous-data` no pasa por `requireIdentity` (necesita **dos** identidades a la vez — la cuenta destino por Bearer y el `client_id` anónimo origen por body — algo que `requireIdentity` no expone) y valida el token a mano, igual que `logout`. Reasigna `client_id` en `CLIENT_SCOPED_TABLES` (la lista corta del §1) fila por fila, cada una en su propio `SAVEPOINT` dentro de la transacción (Postgres no tiene `UPDATE OR IGNORE`, a diferencia de SQLite): si una fila puntual chocara con una constraint UNIQUE de la cuenta destino, se hace `ROLLBACK TO SAVEPOINT` de esa fila y se la deja en el anónimo en vez de abortar toda la migración — pensado para que sea seguro reintentar. Se dispara automáticamente al registrarse (nunca al loguearse en una cuenta ya existente) desde `AccountPanel.tsx`/`AccountView.swift`, con el token de la respuesta de `/register` **antes** de guardar la sesión — por eso ese único call no puede pasar por el `request()`/`APIClient` genérico de cada cliente (que manda el token *ya guardado*), y arma el fetch/URLRequest a mano.

## 6. Tests (`node:test`, sin mocks)

Cada archivo de test en `backend/src/routes/*.test.ts` levanta la app real (`app.ts`, no un mock) contra una base de Postgres temporal propia (creada con `CREATE DATABASE` al arrancar, destruida con `DROP DATABASE` al terminar — `FORJA_TEST_DB` apuntando a ese nombre) y un puerto HTTP efímero (`test-helpers.ts` → `setupTestApp()`), y le pega con `fetch` normal. No se mockea la base de datos ni Express — el costo (tests un poco más lentos que con mocks) se paga a cambio de que un test verde signifique que el flujo HTTP→SQL real funciona, no que una función aislada devuelve lo esperado. Antes de la Fase 11.1 (migración de `node:sqlite` a Postgres) esto era un archivo SQLite temporal por proceso; el equivalente en Postgres es una base física temporal por archivo de test, no un archivo. Cada test genera su propio `client_id`/email únicos (`uniqueClientId()`, `uniqueEmail()`) para poder correr en paralelo sin pisarse.

## 7. Composición de pantallas de solo-lectura (coach) en los clientes

Tanto en frontend web como iOS, la vista "coach viendo a un atleta" **reusa el componente de planificación normal** en vez de duplicar UI: `<Planning athleteId={id} readOnly />` / `PlanningView(athleteId: id, readOnly: true)`. Todas las llamadas de lectura de ese componente aceptan un `athleteId`/`asAthleteId` opcional que se traduce al query param `?as_athlete_id=` (§2), y los controles de edición (guardar plan, marcar día hecho, cargar sesión) se ocultan con `if (!readOnly)`. Extender esa pantalla con una feature nueva de solo-lectura no debería requerir tocar `Coach.tsx`/`CoachView.swift` — alcanza con que la nueva sección respete el mismo flag.

## 8. Gating de "Métricas Pro": solo frontend, nunca backend

`user_profile.pro_enabled` (§ README sección 5) es un flag de UI, no un control de acceso — el backend calcula y devuelve todos los indicadores/módulos "avanzados" (Anselmi, tests de salto, método cubano, RPE de sesión, cardio) exactamente igual sin importar su valor. Cada pantalla que tiene contenido gateado hace su propio `GET /api/profile` al montar y guarda `pro_enabled` en estado local (no hay store global — mismo patrón que el resto de la app), y envuelve el JSX/View correspondiente en `{proEnabled && (...)}` / `if proEnabled { ... }`.

Esta decisión (gating 100% client-side, cero variantes condicionales en las respuestas de API) es deliberada: mantiene el contrato de API con una sola forma por endpoint — más simple de mantener, testear y documentar en OpenAPI — a costa de que un usuario que inspeccione el tráfico de red vea datos "Pro" aunque no haya activado el toggle. Es un trade-off aceptable porque `pro_enabled` nunca fue pensado como control de acceso real (no hay paywall, cualquiera puede activarlo gratis) — es exclusivamente una forma de no abrumar a un usuario nuevo con paneles que no le interesan todavía.

**Qué queda afuera del gating a propósito** (parte del producto base, siempre visible): rutina inicial sugerida, RIR por serie, sugerencia de progresión, PRs por día de la semana, y el descanso dinámico según %1RM — todo esto ayuda a decidir qué hacer *hoy*, no es un dato analítico para revisar después.

**Dónde mirar antes de agregar una feature "Pro" nueva**: replicar el patrón de fetch-propio-por-pantalla (no asumas que `pro_enabled` ya está disponible en un componente por venir de un padre) y sumar la nueva sección a la lista de "qué se gatea" en el README §5 para que no quede desincronizada.

## 9. Navegación entre tabs con estado ("abrir X en la otra pantalla")

El frontend web no tiene router ni state manager — `App.tsx` es un `switch` manual sobre una variable `tab` en `useState`, y cada página se monta/desmonta por completo al cambiar de tab (no hay rutas anidadas). Cuando una acción en una pantalla necesita abrir *otra* pantalla en un estado puntual (ej. el atajo "ver historial de este ejercicio" desde `Today.tsx`/`Routines.tsx` hacia `Planning.tsx`, README §16), el patrón es:

1. El estado de "qué hay que abrir" vive un nivel arriba, en `App.tsx` (ej. `pendingExercise`), no en la página que lo origina ni en la que lo consume.
2. La página origen no recibe una referencia a la página destino — recibe un callback genérico (`onOpenExerciseHistory`) que solo sabe "pedile a `App.tsx` que navegue con este dato".
3. La página destino recibe el dato como prop (`openExerciseOnMount`) y lo consume en un efecto que corre **solo al montar** (`useEffect(..., [])`) — seguro porque la página se remonta entera cada vez que su tab vuelve a estar activa, así que "al montar" y "cuando me pasan este dato" son el mismo momento.
4. La página destino avisa que ya lo consumió (`onConsumedInitialExercise`) para que `App.tsx` lo limpie — si no se limpia, volver a esa tab por la navegación normal (sin pasar por el atajo) reabriría el mismo dato viejo.

Extender este patrón a un atajo nuevo: sumar un campo de estado a `App.tsx` (no a las páginas), un callback de "pedir apertura" en la página origen, y una prop + efecto de montaje + callback de limpieza en la página destino — no hace falta routing real ni Context mientras lo que se pasa sea un valor simple (un nombre, un id).
