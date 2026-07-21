# Prompt para Claude Code — implementación completa del plan FORJA

Copiar todo el bloque de abajo (desde "Contexto" hasta el final) y pegarlo como prompt inicial en Claude Code, corriendo desde la raíz del repo `forjapp`.

---

Contexto: estoy en el repo forjapp (monorepo backend/frontend/ios). Backend: Node + Express + TypeScript + `node:sqlite` sin ORM, migraciones idempotentes a mano en `backend/src/db.ts`. Frontend: React + Vite + TypeScript, sin state manager, tipos redefinidos a mano en `frontend/src/api/client.ts`. iOS: SwiftUI, generado con XcodeGen, `Networking/APIClient.swift` + `Models/Models.swift` como tercera copia de los mismos tipos. Todo corre en `localhost`, sin autenticación real (`X-Client-Id` autogenerado por cada instalación, sin verificar). Leé `INFORME_RELEVAMIENTO.md` y `PLAN_DESARROLLO_SPRINTS.md` en la raíz antes de empezar — ahí está el detalle completo de arquitectura actual y el orden de sprints que ya decidimos.

Quiero que implementes el plan completo, **en el orden de fases de abajo, sin saltear fases** (cada una depende de la anterior). No implementes deploy en la nube ni HTTPS — eso está descartado explícitamente. Tampoco implementes nutrición ni sesiones mixtas con cardio — fuera de alcance. Al terminar cada fase, corré build/lint/test de lo que corresponda antes de pasar a la siguiente, y avisame si algo de lo que pedís acá quedó ambiguo antes de improvisar una solución que toque otras partes del sistema.

**Principio de producto que atraviesa todo esto:** FORJA se vende como una app simple. Lo que hace falta para que alguien sin plan sepa qué entrenar (rutina sugerida, RPE/RIR por serie, progresión) es parte del producto base y va SIEMPRE visible. Todo lo que agrega complejidad analítica (indicadores del manual Anselmi, tests de salto, plantillas de periodización) vive detrás de un toggle "Métricas Pro" en el perfil, apagado por default. Es un flag de UI, no un paywall real todavía — no hace falta infraestructura de billing en esta implementación.

## Fase 1 — Higiene de configuración y observabilidad básica

- Mover `API_BASE` (hoy hardcodeado a `http://localhost:4000/api` en `frontend/src/api/client.ts`) a `import.meta.env.VITE_API_BASE` con fallback al valor actual. Crear `.env.example` en `frontend/` y `backend/` documentando cada variable (`PORT`, `VITE_API_BASE`).
- iOS: sacar el `baseURL` hardcodeado de `ios/Forja/Networking/APIClient.swift`, leerlo de `Info.plist` vía `Bundle.main.object(forInfoDictionaryKey:)`, configurable por build setting/xcconfig en vez de editar código a mano.
- Reemplazar los `.catch(() => {})` silenciosos en `frontend/src/pages/Routines.tsx` y `frontend/src/pages/Biometrics.tsx` por un estado de error visible, reutilizando el componente `EmptyState` ya existente.
- Middleware de manejo de errores centralizado en Express (`backend/src/index.ts`): capturar excepciones no manejadas y devolver JSON consistente (`{ error: string }`), sin traza cruda al cliente cuando no estemos en modo desarrollo.
- Agregar índices en `backend/src/db.ts`: `CREATE INDEX IF NOT EXISTS idx_sessions_client_date ON sessions(client_id, date)` y equivalente en `biometrics(client_id, date)`, en el mismo bloque de migraciones idempotentes que ya existe ahí.
- Generar íconos reales (192px/512px) para `frontend/public/manifest.json` (hoy `icons: []`).

## Fase 2 — Tests de la lógica de negocio crítica

- Elegir `node:test` (ya viene con Node, evitar sumar dependencia) o Vitest si preferís mejor DX — decidí vos y documentá la elección en el README.
- Tests de cálculo de PRs en `backend/src/routes/sessions.ts`: 1RM estimado, exclusión de series `is_warmup`, comparación contra histórico (caso: primer registro sin PR previo, caso: nuevo PR de peso pero no de volumen y viceversa).
- Tests de streak semanal en `backend/src/routes/streak.ts` (aritmética de fechas, revisar `mondayOf`/`getUTCDay` — casos límite: cambio de año, semana parcial).
- Tests de la regla de 48hs en `backend/src/routes/alerts.ts`.
- Montar SQLite en memoria o archivo temporal por test — no mockear la base de datos.

## Fase 3 — CI y migraciones versionadas

- GitHub Actions (`.github/workflows/ci.yml`): build + lint + test del backend y del frontend en cada PR.
- Migraciones versionadas: tabla `schema_migrations` (id, applied_at) + runner simple en `backend/src/db.ts` que aplica cada migración una sola vez, reemplazando gradualmente los bloques `if (!cols.some(...))` existentes (no hace falta reescribir las migraciones ya aplicadas en instalaciones existentes, sí que las nuevas usen el sistema versionado).
- Documentar en el README cómo agregar una migración nueva.

## Fase 4 — Autenticación real

- Tabla `users` (id, email, password_hash, created_at). Endpoint `POST /api/auth/register` y `POST /api/auth/login` (email + password, hash con `bcrypt` o el hashing nativo de Node si alcanza) que emite un token de sesión (JWT simple o cookie de sesión — elegí lo más simple de mantener sin agregar Redis ni infraestructura extra).
- Adaptar `backend/src/middleware/clientId.ts` (o reemplazarlo por un nuevo `middleware/auth.ts`) para derivar el `client_id`/`user_id` del usuario autenticado vía el token, en vez de confiar en el header `X-Client-Id` que manda el cliente sin verificar.
- Mantené `X-Client-Id` funcionando en modo "legacy" solo para no romper instalaciones existentes sin cuenta creada, pero todo endpoint nuevo debe exigir autenticación real.
- Frontend: pantalla de login/registro, guardar el token (no en `localStorage` en texto plano si podés evitarlo — al menos documentar el trade-off), adjuntarlo en cada request de `client.ts`, flujo de logout.
- iOS: mismo flujo de login, guardar token en Keychain (no en `UserDefaults`, que es donde hoy vive `ClientIdentity`).

## Fase 5 — Perfil minimalista y flag "Pro"

Requiere Fase 4 (auth) completa.

- Columnas nuevas en `user_profile`: `training_mode` (texto: `fuerza` / `hipertrofia` / `mantenimiento`, nullable hasta que el usuario elija) y `pro_enabled` (boolean, default `false`).
- Pantalla/tab **Perfil** nueva, deliberadamente acotada — no reutilices ni ampliés `Biometrics.tsx` para esto. Debe mostrar únicamente:
  1. Estado de sesión (email logueado, botón cerrar sesión) — usa lo construido en la Fase 4.
  2. Peso actual, editable — reusá el endpoint de `biometrics` ya existente (`POST /api/biometrics` upsert) para guardarlo, no crees una tabla nueva de peso.
  3. Objetivo de entrenamiento (`training_mode`) — selector fuerza/hipertrofia/mantenimiento, persistido en `user_profile`.
  4. Toggle "Métricas Pro" (`pro_enabled`) — un solo switch, con una línea de texto tipo "Activá métricas avanzadas de entrenamiento: tonelaje, zonas de intensidad, tests de potencia y más".
- Nada más va en esta pantalla. Altura, check-in de sensación diaria, gráfico de peso y export de datos siguen viviendo en `Biometrics.tsx` como hoy — no los muevas.
- Endpoint `PATCH /api/profile` (o extender el `PUT /api/profile` existente) para actualizar `training_mode` y `pro_enabled`.
- El toggle es solo control de qué se renderiza en el frontend (y opcionalmente qué calcula el backend, ver Fases 9-10) — no implementes lógica de pago, suscripción ni billing. Es un flag simple.
- iOS: espejo de la misma pantalla mínima en `ios/Forja/Views/`, reusando el patrón de `ClientIdentity`/sesión ya migrado en la Fase 4.

## Fase 6 — Contrato compartido de API

- Generar OpenAPI/JSON Schema a partir de los schemas `zod` ya existentes en las rutas del backend (librería `zod-to-openapi` o similar).
- Generar los tipos TS de `frontend/src/api/client.ts` a partir de ese contrato en vez de redefinirlos a mano.
- iOS queda fuera de la generación automática (documentar como deuda conocida, no hay tooling realista sin más inversión).

## Fase 7 — Panel del coach

- Tabla `coach_athletes` (coach_user_id, athlete_user_id, status: pending/accepted, created_at). Requiere Fase 4 completa (usuarios reales, no `client_id` anónimo).
- Endpoint de invitación: el atleta genera un código/link, el coach lo usa para pedir vínculo; el atleta acepta o rechaza (nunca al revés — el coach no puede agregarse solo).
- Endpoint `GET /api/coach/athletes` (lista de atletas vinculados) y reutilización de los endpoints existentes (`sessions`, `history`, `biometrics`, `weekly-plan`, `streak`) en modo lectura para un `athlete_id` que no es el propio del usuario autenticado, solo si hay vínculo aceptado.
- Frontend: nueva vista "Mis atletas" que reutiliza los componentes ya existentes de `Planning.tsx`/gráficos, pero apuntando a los datos de un atleta seleccionado, sin permitir edición.
- Del catálogo de mejoras de coach (ver `PLAN_DESARROLLO_SPRINTS.md`, sección "Mejoras visuales"): agregar métricas de adherencia agregadas (% semanas cumplidas, último check-in) en la lista de atletas, y un campo de comentario del coach asociado a `sessions.id` (feedback asincrónico simple, sin chat en vivo por ahora).

## Fase 8 — Guía de entrenamiento para el que no sabe qué hacer

Esta fase es parte del producto **base/simple** — va siempre visible, no depende del toggle Pro de la Fase 5.

- Usa el `training_mode` (fuerza/hipertrofia/mantenimiento) ya elegido en el perfil de la Fase 5 — no dupliques ese selector acá, solo léelo.
- Tabla de constantes por modo (no un algoritmo de personalización): rango de reps sugerido, descanso default del timer, umbral de RIR para sugerir subir peso. Ejemplo de referencia (ajustable): fuerza = 2-6 reps, descanso 3-5 min, subir peso si RIR ≥ 2 en el techo del rango; hipertrofia = 6-12 reps, descanso 60-90s; mantenimiento = 8-12 reps, descanso 60-90s, volumen total más bajo.
- Rutina inicial sugerida para alguien sin rutina propia, a partir del catálogo ya existente (`workout_types`/`workout_type_exercises`, tipos Push/Pull/Full Body) — no hace falta contenido nuevo, es una selección/orden por defecto según el modo elegido.
- Sugerencia de progresión para el próximo set de un ejercicio en `backend/src/routes/history.ts`, usando el histórico ya calculado: si se completaron todas las reps del rango alto del modo con RIR bajo (ver más abajo para el campo RPE/RIR por serie), sugerir subir peso; si no se completó el rango mínimo, sugerir mantener o bajar.
- Al armar la rutina semanal sugerida, alternar días de intensidad alta/media/baja en vez de repetir el mismo esfuerzo relativo cada sesión (principio de ondulación semanal del manual Anselmi — esto es una regla de contenido al generar la sugerencia, no una feature de UI aparte).
- Campo de RPE/RIR opcional **por serie** (distinto del RPE por sesión de la Fase 9) en `session_exercises` — necesario para que la sugerencia de progresión de este punto funcione. Este campo es parte del producto base, visible siempre, no depende del toggle Pro.

## Fase 9 — Indicadores de entrenamiento (Manual Anselmi) — todo detrás del toggle Pro

Ver `PROPUESTA_INDICADORES_ANSELMI.md` para el detalle completo. **Todo lo de esta fase debe estar condicionado a `pro_enabled = true`** (Fase 5): si el usuario no activó el toggle, el backend puede seguir calculando estos datos sin problema, pero el frontend no debe renderizar ninguno de estos componentes/gráficos, y las respuestas de API pueden omitir los campos si `pro_enabled` es falso (a tu criterio cuál de las dos capas de gating usar, pero el usuario free no debe verlos).

- Migración: columna `rpe INTEGER` (1-10, nullable) en `sessions` (RPE de la sesión completa, distinto del RIR por serie de la Fase 8).
- En `backend/src/routes/history.ts`, endpoint `GET /:exerciseName`: agregar por serie de trabajo (excluyendo `is_warmup`, mismo criterio que ya se usa para PRs) `tonelaje` (weight_kg × reps), `intensidad_pct` (weight_kg / `personal_records.best_weight_kg` × 100, null si no hay PR todavía) y `zona` (clasificar por `intensidad_pct`: `fuerza_maxima` 90-100%, `hipertrofia` 75-90%, `adaptacion` 50-75%, `potencia` 25-35%, `otra` fuera de esos rangos).
- En `backend/src/routes/sessions.ts`, endpoint `GET /:id`: agregar resumen de sesión (`tonelaje_total`, `peso_medio` = tonelaje_total / volumen en reps, `intensidad_promedio_pct`).
- `sessionSchema` (zod) acepta `rpe` opcional; se guarda y se devuelve en `GET /:id` y `GET /`. El selector de RPE por sesión en `Today.tsx` también queda detrás del toggle Pro (es parte de "métricas avanzadas", a diferencia del RPE/RIR por serie de la Fase 8 que sí es base).
- Nuevo endpoint `GET /api/history/prs-by-weekday`: cuenta PRs históricos por día de semana (lunes→domingo) a partir de `personal_records.best_weight_date`/`best_volume_date`. Devolver los 7 días siempre, con 0 si no hay datos. **Esta sí queda fuera del toggle Pro** (es gratis, cero fricción, motiva sin abrumar) — mostrala siempre en `Planning.tsx`.
- Frontend (`client.ts`, `Planning.tsx`): tipos actualizados, dejar de recalcular tonelaje/intensidad/zona en el frontend cuando `pro_enabled` esté activo (mantener el cálculo de 1RM estimado en frontend siempre, ya que es una fórmula base, no un indicador Pro). Los paneles de tonelaje/peso medio/intensidad/zonas solo se renderizan si `pro_enabled` es true.

## Fase 10 — Indicadores derivados, tests de potencia y método cubano — todo detrás del toggle Pro

Todo lo de esta fase también queda condicionado a `pro_enabled = true`, igual que la Fase 9.

- `started_at`/`ended_at` en `sessions` (capturados automáticamente al abrir/cerrar la sesión en `Today.tsx`) → habilita Índice de Hipertrofia (tonelaje_total / duración) y Coeficiente de Hipertrofia (tonelaje_total² / duración), expuestos en el mismo resumen de sesión de la Fase 9. Mostrar solo si `pro_enabled`.
- Segunda alerta en `backend/src/routes/alerts.ts`: si un grupo muscular acumula `intensidad_promedio_pct` en zona 75-90%+ durante 3+ semanas seguidas sin una semana de intensidad menor, devolver un aviso de tendencia — complementa (no reemplaza) la regla fija de 48hs que ya existe. Esta alerta solo debe dispararse/mostrarse para usuarios con `pro_enabled = true` (depende de datos de zona que son Pro).
- `mesocycle_phase` en `weekly_plans` (valores: acumulación / intensificación / descarga / mantenimiento), campo simple sin motor de periodización. Comparar fase declarada vs. intensidad real promedio de esa semana y mostrar la discrepancia si la hay (ej. "planificaste descarga pero tu intensidad fue la más alta del mes"). Selector de fase visible solo con Pro activado.
- **Tabla `strength_tests`** (fecha, tipo de test, valor, unidad) para tests periódicos de salto/potencia (altura de salto = (tiempo de vuelo)² × 1.226 × 100; Q de estabilidad reactiva = tiempo de vuelo / tiempo de contacto). El usuario carga el valor manualmente (medido con cronómetro/app externa), igual patrón que `Biometrics.tsx` pero en su propia sección dentro del área Pro, con gráfico de evolución. Endpoint `POST/GET /api/strength-tests`. Visible solo con `pro_enabled = true`.
- **Plantilla "método cubano"** de reparto de volumen entre microciclos (35%/28%/22%/15% del volumen a distintas intensidades relativas dentro de un mesociclo): ofrecerla como plantilla seleccionable al crear un mesociclo (usa `mesocycle_phase` de este mismo sprint), en vez de que el usuario arme la progresión de intensidad a mano. Visible solo con `pro_enabled = true`.

## Fase 11 — Piloto cerrado: dar la app a un par de testers reales, desplegada en Render + Vercel

Requiere Fase 4 (auth) y Fase 5 (perfil) completas. El objetivo de esta fase es que un puñado de personas afuera de mi red puedan usar la app con su propia cuenta, sin ver datos ajenos, durante un piloto de ~30 días, sin que se pierdan datos en el medio.

**11.1 — Migrar de `node:sqlite` a Postgres (Neon).**
- Reemplazar el driver: sacar `node:sqlite` de `backend/src/db.ts` y usar el cliente `pg` (node-postgres) contra una base Postgres en Neon (connection string vía variable de entorno `DATABASE_URL`, nunca hardcodeada ni commiteada).
- Traducir el DDL y las migraciones idempotentes existentes en `db.ts` a sintaxis de Postgres: placeholders `?` → `$1, $2, ...`, `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY` (o `GENERATED ALWAYS AS IDENTITY`), y revisar los bloques que reconstruyen tablas enteras (`sessions_v2`, `biometrics_v2`, etc.) porque el patrón de "crear tabla nueva, copiar, dropear, renombrar" sigue siendo válido en Postgres pero la sintaxis de tipos cambia.
- Todas las queries preparadas de `backend/src/routes/*.ts` (`sessions.ts`, `history.ts`, `alerts.ts`, `streak.ts`, `biometrics.ts`, etc.) deben migrar sus placeholders posicionales al estilo de `pg`.
- Si ya migraste los tests de la Fase 2 a correr contra SQLite en memoria, adaptalos para correr contra una base Postgres real (puede ser local con Docker para tests, o un proyecto Neon separado de test) — documentá la decisión en el README.
- Mantené el comportamiento de "instalación limpia siembra el catálogo de `workout_types`" que ya existe, adaptado a Postgres (`INSERT ... ON CONFLICT DO NOTHING` en vez de `INSERT OR IGNORE`).

**11.2 — Preparar el backend para Render.**
- `PORT` debe leerse de `process.env.PORT` (Render lo inyecta, no asumir 4000 en producción).
- CORS: restringir `cors()` al dominio real del frontend en Vercel (vía variable de entorno `FRONTEND_ORIGIN`), no dejarlo abierto en producción — mantené el modo abierto solo para desarrollo local.
- Agregar un endpoint `GET /api/health` si no lo cubre ya el existente, pensado para el keep-alive del punto 11.4.
- Documentar en el README cómo crear el servicio en Render (build command, start command, variables de entorno necesarias: `DATABASE_URL`, `FRONTEND_ORIGIN`, `PORT`).

**11.3 — Preparar el frontend para Vercel.**
- Confirmar que `VITE_API_BASE` (de la Fase 1) apunta a la URL pública del backend en Render vía variable de entorno configurada en el proyecto de Vercel, no en código.
- Agregar `vercel.json` si hace falta configurar rewrites para que las rutas del SPA no den 404 al refrescar.
- Documentar en el README los pasos de deploy en Vercel (conectar repo, configurar variable de entorno, build command).

**11.4 — Keep-alive para evitar el cold start de Render free.**
- Documentar (no como parte de la app, sino como instrucción en el README) cómo configurar un cron externo gratuito (cron-job.org, UptimeRobot, o similar) que pegue cada 5-10 minutos al `GET /api/health` del backend en Render, para minimizar el cold start de ~1 minuto que sufre el primer tester que entra después de 15 min de inactividad. Aclarar en el README que esto no está oficialmente soportado por Render, es un workaround conocido, y que igual puede haber una espera ocasional.

**11.5 — Protección de rutas real en el frontend.**
Agregar un componente guard (ej. `RequireAuth`) que envuelva las rutas/tabs de la app (`Today`, `Planning`, `Perfil`, etc.) y redirija a la pantalla de login si no hay sesión válida — hoy con la Fase 4 el backend ya rechaza requests sin token, pero falta que el frontend no intente siquiera renderizar esas pantallas sin sesión. Auditar que TODOS los endpoints (no solo los nuevos de fases posteriores a la 4) pasen por el middleware de auth, incluyendo los viejos que antes solo exigían `X-Client-Id`.

**11.6 — Atajo de navegación al historial de un ejercicio.**
En `Today.tsx` (durante el registro de series) y en `Routines.tsx` (gestión de ejercicios de una rutina), hacer que el nombre del ejercicio sea clickeable/tocable. Al clickear, navegar a la pestaña "Planificación → Historial" con ese ejercicio ya seleccionado (reusar la función `openExercise` que ya existe en `Planning.tsx`, pasando el nombre del ejercicio como parámetro de navegación entre tabs — hoy el cambio de tab lo maneja `App.tsx`, así que probablemente haga falta levantar el estado de "ejercicio seleccionado" a ese nivel, o pasar un callback similar al `onGoToToday` que ya recibe `Planning`). No dupliques el gráfico ni el componente: es el mismo `ForjaLineChart` de siempre, solo un acceso directo.

Entregable: el backend corre en Render conectado a Postgres en Neon (sin riesgo de expiración ni de perder datos por spin-down), el frontend en Vercel apuntando a esa URL, puedo mandarle el link a un par de personas, cada una entra con su cuenta, ve solo lo suyo, sobrevive 30 días sin resetearse, y de paso puede tocar el nombre de cualquier ejercicio para ver su progreso sin tener que buscarlo en el historial.

## Verificación final

- `npm run build` y el linter corren sin errores en `backend/` y `frontend/`.
- La suite de tests de la Fase 2 sigue pasando después de cada fase posterior (correrla de nuevo antes de dar por terminada cada fase).
- Probar manualmente el toggle Pro con `pro_enabled = false` (default) y confirmar que ningún panel/gráfico de las Fases 9 y 10 aparece — la app debe sentirse simple para un usuario nuevo. Activarlo y confirmar que todo lo de esas fases aparece correctamente.
- Probar la Fase 11 con dos cuentas distintas: confirmar que sin sesión no se puede ver ninguna pantalla salvo login, y que la cuenta A no puede ver datos de la cuenta B en ningún endpoint.
- Confirmar que la migración a Postgres (11.1) preserva toda la lógica de negocio: correr de nuevo la suite completa de la Fase 2 contra Postgres, no contra SQLite.
- Verificar que el backend arranca correctamente leyendo `DATABASE_URL`, `PORT` y `FRONTEND_ORIGIN` desde variables de entorno, sin ningún valor hardcodeado que solo funcione en local.
- Actualizar `README.md` con cualquier variable de entorno, comando o paso manual nuevo que hayas introducido, incluyendo los pasos de deploy a Render, Vercel, Neon y la configuración del keep-alive.
