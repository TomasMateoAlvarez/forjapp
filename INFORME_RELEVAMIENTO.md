# Informe de relevamiento — FORJA

**Fecha:** 2026-07-17
**Repo:** https://github.com/TomasMateoAlvarez/forjapp (1 solo commit: "Initial commit")

## 1. Resumen ejecutivo

FORJA es una app de seguimiento de entrenamiento de fuerza (registro de series/pesos/reps, historial, PRs, planificación semanal, biometría). Es un **monorepo con 3 clientes contra la misma API**:

```
forjapp/
  backend/   API REST — Node + Express + TypeScript + node:sqlite
  frontend/  Web app — React 18 + Vite + TypeScript (responsive, PWA)
  ios/       App nativa — SwiftUI (iOS 17+)
```

Es un **MVP de uso personal**, no un producto multi-usuario todavía:
- No hay login ni contraseñas. El "aislamiento" de datos es un `client_id` que cada instalación genera solo y manda por header — es *namespacing*, no autenticación.
- No hay tests, ni CI/CD, ni deploy: todo corre en `localhost` en la máquina del desarrollador.
- Un solo commit en git — no hay historia de decisiones para rastrear.

El código está limpio, con comentarios puntuales que explican decisiones no obvias (multi-tenancy, qué cuenta como serie de calentamiento, etc.), y las migraciones de esquema están hechas a mano de forma idempotente dentro de `db.ts`. Es una base sólida para iterar, pero le falta todo lo que hace falta para pasar de "proyecto personal en mi Mac" a "producto".

## 2. Arquitectura general

```
┌─────────────┐     ┌──────────────┐
│  Frontend   │     │   iOS App    │
│  (React)    │     │  (SwiftUI)   │
└──────┬──────┘     └──────┬───────┘
       │  fetch()          │  URLSession
       │  X-Client-Id      │  X-Client-Id
       └─────────┬──────────┘
                  ▼
         ┌─────────────────┐
         │  Express API     │  http://localhost:4000/api
         │  (TypeScript)    │
         └────────┬─────────┘
                  ▼
         ┌─────────────────┐
         │  SQLite          │  backend/forja.sqlite
         │  (node:sqlite)   │  (archivo local, sin server de BD)
         └─────────────────┘
```

No hay backend-for-frontend ni gateway: los 3 clientes hablan directo con la misma API REST, compartiendo tipos "a mano" (no hay generación de cliente ni contrato compartido — cada cliente redefine sus tipos por su cuenta, ver §6).

## 3. Backend

### 3.1 Stack técnico

| Componente | Elección | Nota |
|---|---|---|
| Runtime | Node.js 22+ | Requerido por `node:sqlite` |
| Framework HTTP | Express 4 | Clásico, sin middlewares extra salvo `cors` |
| Lenguaje | TypeScript 5.6 (strict) | Compilado con `tsc`, corrido en dev con `tsx watch` |
| Base de datos | **`node:sqlite`** (módulo nativo de Node, no `better-sqlite3` ni Prisma) | Sin ORM, SQL crudo con prepared statements |
| Validación | `zod` | Solo en los endpoints que reciben body complejo |
| Módulos | ESM puro (`"type": "module"`) | Imports con extensión `.js` explícita (típico de ESM+TS) |

No hay: ORM, migraciones versionadas (tipo Prisma/Knex), logging estructurado, rate limiting, autenticación, tests, variables de entorno (`.env`) más allá de `PORT`.

### 3.2 Estructura

```
backend/src/
  index.ts              # bootstrap Express, monta todos los routers
  db.ts                  # conexión SQLite + DDL + migraciones inline + seed de catálogo
  middleware/clientId.ts # exige header X-Client-Id (multi-tenant simple)
  routes/
    workoutTypes.ts      # catálogo de tipos de entreno (Pecho, Espalda, Push, Pull...)
    sessions.ts          # registrar/leer sesiones de entreno + cálculo de PRs
    history.ts           # evolución por ejercicio, últimas series, récords
    biometrics.ts        # check-in diario (peso/altura/sensación)
    weeklyPlan.ts         # planificación semanal + estado cumplido/no
    alerts.ts            # regla fija "no repetir grupo muscular en 48hs"
    customRoutines.ts    # rutinas propias del usuario (CRUD)
    exercises.ts         # lista de nombres de ejercicios para autocompletar
    profile.ts           # altura (master data separada de biometrics)
    streak.ts            # racha de semanas consecutivas con plan cumplido
    export.ts            # backup completo en JSON (sin endpoint de import)
  seed-demo-data.ts      # script aparte para poblar datos ficticios de demo
```

### 3.3 Modelo de datos (SQLite)

Tablas principales: `workout_types`, `workout_type_exercises`, `sessions`, `session_exercises`, `biometrics`, `custom_routines`, `custom_routine_exercises`, `personal_records`, `weekly_plans`, `plan_days`, `user_profile`.

Puntos a destacar:
- **`workout_types` / `workout_type_exercises` son catálogo global** (no llevan `client_id`): el mismo catálogo predeterminado (Pecho, Espalda, Piernas, Push, Pull, Full Body, Hombro y brazo) se comparte entre todas las instalaciones.
- El resto de las tablas sí llevan `client_id`, agregado vía **migraciones idempotentes escritas a mano** en `db.ts` (se ejecutan en cada arranque, chequean `PRAGMA table_info` antes de alterar). Funciona, pero no es un sistema de migraciones real — no hay versionado, ni rollback, ni forma de saber en qué "versión" de esquema está una base sin leer todo `db.ts`.
- `sessions.workout_type_id` es nullable y coexiste con `custom_routine_id` (una sesión es de un tipo de catálogo *o* de una rutina propia, nunca ambos — validado con `.refine()` de zod).
- Los **PRs (personal records)** se recalculan en cada `POST /sessions`, comparando contra el máximo histórico guardado, y **excluyen series marcadas como calentamiento** (`is_warmup`) — tanto para el cálculo de 1RM estimado como de volumen.
- Índices: no hay ningún `CREATE INDEX` explícito más allá de las PK/UNIQUE. Con el volumen actual (uso personal) no importa, pero a futuro con más usuarios/datos, las queries por `client_id + date` en `sessions`/`biometrics` se beneficiarían de un índice compuesto.

### 3.4 Endpoints (resumen)

| Recurso | Métodos | Función |
|---|---|---|
| `/api/health` | GET | Health check (sin `X-Client-Id`) |
| `/api/workout-types` | GET, POST/PATCH/DELETE `:id/exercises` | Catálogo global + sus ejercicios |
| `/api/sessions` | GET, GET `:id`, POST | Registrar/consultar sesiones, dispara cálculo de PRs |
| `/api/history` | GET, GET `:name`, `:name/latest`, `:name/records` | Evolución, última sesión, récord de un ejercicio |
| `/api/biometrics` | GET, POST (upsert) | Check-in diario peso/altura/sensación |
| `/api/weekly-plan` | GET `:week_start`, GET `for-date/:date`, POST, POST `mark-done` | Planificación semanal |
| `/api/alerts/check` | GET | Regla fija de 48hs por grupo muscular (sin IA/ML) |
| `/api/custom-routines` | CRUD completo + sub-recurso exercises | Rutinas propias del usuario |
| `/api/exercises` | GET | Nombres únicos para autocompletar |
| `/api/profile` | GET, PUT | Altura (master data) |
| `/api/streak` | GET | Semanas consecutivas de plan cumplido |
| `/api/export` | GET | Backup JSON completo (no hay import) |

Todos (salvo `/health`) pasan por el middleware `requireClientId`, que exige el header `X-Client-Id` y devuelve 400 si falta.

### 3.5 Riesgos/deudas puntuales del backend

- **`node:sqlite` es un módulo relativamente nuevo/experimental de Node** (estabilizado recién en versiones 22.x avanzadas). Es una elección válida para simplificar (cero dependencias de BD), pero es una apuesta menos probada que `better-sqlite3` o Postgres — vale la pena confirmar en qué versión de Node dejó de ser "experimental" antes de escalarlo.
- **No hay autenticación real.** `X-Client-Id` es autogenerado por el cliente y no se verifica contra nada — cualquiera que conozca (o adivine) el `client_id` de otro puede leer/escribir sus datos. Hoy no importa (una sola persona, corriendo local), pero es el bloqueador #1 para cualquier despliegue compartido.
- **CORS abierto sin restricciones** (`app.use(cors())` sin opciones) — aceptable en local, no en producción.
- **Sin manejo de errores centralizado**: los `throw err` dentro de los bloques `try/catch` de las transacciones terminan en el handler default de Express (traza cruda al cliente si `NODE_ENV` no está en producción).
- **Sin tests** de ningún tipo (unitarios, de integración, contra la lógica de PRs/streak que tiene bastante lógica de fechas non-trivial).
- **Migraciones a mano en cada boot**: funciona bien para un proyecto chico, pero escala mal — cuando el archivo `db.ts` tenga 500 líneas de migraciones si/no, va a ser difícil de auditar.

## 4. Frontend web

### 4.1 Stack técnico

| Componente | Elección |
|---|---|
| Framework | React 18 + Vite 5 |
| Lenguaje | TypeScript |
| Gráficos | Recharts (`ForjaLineChart`, wrapper propio) |
| Iconos | lucide-react |
| Estilos | CSS puro (`styles.css`, ~365 líneas) con variables CSS (paleta oscura "forja": ember/brass/steel/chalk), sin Tailwind ni CSS-in-JS |
| Estado | `useState`/`useEffect` locales por página + un único Context (`UnitContext` para kg/lb) — **no hay Redux/Zustand/React Query** |
| PWA | `manifest.json` básico (sin service worker, sin íconos cargados todavía — `icons: []`) |

### 4.2 Estructura

```
frontend/src/
  App.tsx              # shell con sidebar (desktop) + tabbar (mobile), 4 tabs
  api/
    client.ts           # wrapper fetch + todos los tipos + todas las llamadas a la API
    clientId.ts          # genera/persiste client_id en localStorage
    catalogCache.ts       # cache local del catálogo para modo offline
  context/UnitContext.tsx # kg↔lb, persistido en localStorage
  components/
    EmptyState.tsx
    ForjaLineChart.tsx    # wrapper de Recharts con el theming de la app
  pages/
    Today.tsx (445 líneas)      # selector de entreno + registro de series + timer de descanso + cola offline
    Planning.tsx (471 líneas)   # calendario semanal + historial con gráficos (1RM est./volumen, por sesión/semana/mes) + streak
    Routines.tsx (428 líneas)   # gestión de ejercicios por tipo/rutina propia, detección de casi-duplicados
    Biometrics.tsx (298 líneas) # check-in diario, altura, IMC, export de datos, gráfico de peso
```

### 4.3 Funcionalidad y patrones notables

- **Responsive real**: un solo código sirve tabbar+stack en mobile y sidebar+grid 2 columnas en desktop, resuelto con CSS (clases condicionales), no con dos componentes separados.
- **Modo offline en `Today.tsx`**: si falla la carga del catálogo o el guardado de una sesión, cae a una cache en `localStorage` (`catalogCache.ts`) y encola la sesión pendiente (`forja_pending_sessions`) para reintentar cuando vuelva la conexión (`window.addEventListener("online", ...)`). Es una implementación manual, sin service worker — si se cierra la pestaña antes de reconectar, se pierde el listener pero la cola persiste en localStorage y se reintenta en el próximo `loadInitialCatalog()`.
- **Timer de descanso** entre series, con barra de progreso, en `Today.tsx`.
- **Detección de "casi duplicados"** de nombres de ejercicios en `Routines.tsx` (`normalizeExerciseName`, quita tildes/preposiciones) — mitiga tener "Press banca" y "Press de banca" como cosas distintas, pero es solo client-side y no bloquea la creación real de duplicados en el backend.
- **Gráficos con 3 granularidades** (por sesión / semana / mes) tanto en progreso de ejercicios como en peso corporal, con 1RM estimado (fórmula Epley-like: `peso * (1 + reps/30)`) y volumen — el cálculo vive duplicado en frontend (`Planning.tsx`) en vez de pedírselo ya calculado al backend.
- **Unidades kg/lb** con conversión centralizada en `UnitContext`, pero el backend siempre persiste en kg — el front convierte en el borde (bien resuelto).

### 4.4 Riesgos/deudas puntuales del frontend

- **`API_BASE` hardcodeado** a `http://localhost:4000/api` en `client.ts` — no hay `.env`/`VITE_API_BASE`, así que para apuntar a un backend real hay que tocar código y buildear de nuevo.
- **Duplicación de tipos con el backend**: `client.ts` redefine a mano todos los tipos de las respuestas de la API. Si el backend cambia un campo, no hay ningún chequeo automático que lo detecte (rompe en runtime, no en compile time).
- **Sin manejo de errores consistente**: muchos `.catch(() => {})` silenciosos (p.ej. en `Routines.tsx` la carga de tipos/rutinas/ejercicios) — si falla, el usuario no se entera de nada.
- **Sin tests** (ni unitarios ni e2e).
- **PWA incompleta**: hay `manifest.json` pero sin service worker registrado y sin íconos (`icons: []`), así que "agregar a pantalla de inicio" funciona pero no hay verdadero soporte offline más allá de lo que la propia app resuelve a mano con localStorage.
- **Estilos inline mezclados con CSS**: gran parte de `Today.tsx`/`Biometrics.tsx` usa `style={{...}}` en vez de clases de `styles.css`, lo que dificulta mantener consistencia visual a futuro.

## 5. App iOS

### 5.1 Stack técnico

| Componente | Elección |
|---|---|
| UI | SwiftUI, `iOS 17.0` deployment target |
| Arquitectura de proyecto | Generado con **XcodeGen** desde `project.yml` (no hay `.xcodeproj` versionado a mano, se regenera) |
| Networking | `URLSession` + `async/await` propio, sin Alamofire ni otra lib |
| Modelos | `Codable` structs a mano en `Models.swift` (tercera copia de los mismos tipos, después de zod en backend y TS en frontend) |

### 5.2 Estructura

```
ios/
  project.yml                        # config de XcodeGen: bundle id, deployment target, ATS
  Forja/
    ForjaApp.swift                   # entry point, fuerza dark mode
    Networking/APIClient.swift        # singleton con todos los métodos de la API (205 líneas)
    Models/Models.swift               # structs Codable espejo de los tipos del backend
    Views/
      RootTabView.swift               # TabView con 4 tabs (Hoy/Planificación/Rutinas/Perfil)
      TodayView.swift (451 líneas)
      PlanningView.swift (512 líneas)
      RoutinesView.swift (342 líneas)
      BiometricsView.swift (320 líneas)
      Theme.swift                     # paleta de colores (forjaEmber, forjaBg...) espejo del CSS web
```

### 5.3 Notas técnicas

- **`NSAllowsArbitraryLoads: true`** en `project.yml` — necesario para hablar HTTP (no HTTPS) con el backend en desarrollo, pero **es un flag que hay que sacar antes de cualquier build de producción** (Apple lo rechazaría en review, y es inseguro en general).
- **`baseURL` hardcodeado** a `http://localhost:4000/api` en `APIClient.swift`. En simulador funciona porque "localhost" apunta al Mac; en dispositivo físico el README documenta que hay que editar el archivo a mano con la IP local del Mac — no hay ninguna configuración por Info.plist/build setting, es edición manual de código.
- **`ClientIdentity`** replica exactamente la misma lógica que `clientId.ts` del frontend (genera y persiste un `client_id` en `UserDefaults`), coherente entre plataformas pero, de nuevo, sin ningún tipo de autenticación real detrás.
- Los tipos opcionales anidados (`PersonalRecord?`, `PlannedDay?`) requieren un wrapper `NullableRecord`/`NullableDay` manual para poder decodificar `null` desde JSON — funciona pero es un patrón repetido que podría simplificarse.
- **Sin tests** (ni `XCTest` ni snapshot tests).
- Requiere Xcode + XcodeGen instalados para siquiera abrir el proyecto (no hay `.xcodeproj` commiteado) — más fricción para alguien que solo quiere mirar el código sin compilar.

## 6. Transversal (aplica a los 3 clientes)

| Tema | Estado actual | Impacto |
|---|---|---|
| **Autenticación** | Ninguna. `client_id` autogenerado, sin verificación | Bloqueante para multi-usuario real o exponer el backend fuera de la LAN |
| **Tests** | Cero en los 3 proyectos | Cualquier refactor es a ciegas; los cálculos de PR/1RM/streak tienen lógica de fechas que se presta a bugs sutiles |
| **CI/CD** | No existe (`.github/` vacío) | No hay chequeo automático de build/lint antes de mergear |
| **Deploy** | No existe. Todo corre en `localhost` | El backend no tiene Dockerfile, ni config de ningún PaaS, ni HTTPS |
| **Contrato compartido API** | Ninguno — 3 copias manuales de los mismos tipos (zod en backend, TS en frontend, Swift structs en iOS) | Alto riesgo de desincronización silenciosa a medida que crece la API |
| **Logging/observabilidad** | Solo `console.log` puntual | Sin forma de diagnosticar errores en producción |
| **Seguridad** | CORS abierto, sin rate limiting, sin sanitización más allá de zod, ATS deshabilitado en iOS (dev-only) | Aceptable para localhost, no para producción |
| **Documentación** | Un solo `README.md`, bueno y claro para "cómo levantar cada parte", pero no hay documentación de arquitectura/decisiones más allá de comentarios inline | — |

## 7. Posibles mejoras y cómo las haríamos

Esta sección es un catálogo de mejoras posibles con el approach concreto para cada una. **Nada de esto está implementado ni se va a implementar todavía** — es insumo para decidir qué priorizar más adelante.

### Quick wins (bajo esfuerzo, alto valor, no rompen nada)

1. **Sacar `API_BASE` del código a variables de entorno**
   - *Frontend*: Vite ya soporta `import.meta.env` — se movería `http://localhost:4000/api` a `VITE_API_BASE` en un `.env` (con `.env.example` commiteado), y `client.ts` leería `import.meta.env.VITE_API_BASE ?? "http://localhost:4000/api"` como fallback de dev.
   - *iOS*: se crearía un `.xcconfig` por esquema (Debug/Release) o se leería de `Info.plist` vía `Bundle.main.object(forInfoDictionaryKey:)`, en vez de editar `APIClient.swift` a mano cada vez que se prueba en un dispositivo físico.

2. **Íconos reales para el `manifest.json`** — generar un set de PNG (192/512px) a partir de un logo de FORJA y referenciarlos en `icons: []`, para que "agregar a pantalla de inicio" se vea bien en vez de con el ícono genérico del navegador.

3. **Índices compuestos en SQLite** — agregar `CREATE INDEX IF NOT EXISTS idx_sessions_client_date ON sessions(client_id, date)` y equivalente en `biometrics`, dentro del mismo bloque de `db.ts` donde ya viven las migraciones. Cambio de una línea por índice, sin tocar lógica.

4. **Manejo de errores visible en frontend** — reemplazar los `.catch(() => {})` silenciosos (`Routines.tsx`, `Biometrics.tsx`, etc.) por un patrón consistente: guardar el error en un estado `error` de la página y mostrar un mensaje o un `<EmptyState>` (el componente ya existe y se usa en `Today.tsx`), en vez de que la pantalla se quede vacía sin explicación.

5. **Documentar variables de entorno** — un `.env.example` en `backend/` y `frontend/` con cada variable usada (`PORT`, `VITE_API_BASE`, `VITE_CLIENT_ID`) y una nota en el README.

### Mediano plazo (requiere diseño, pero no reescritura completa)

6. **Autenticación real** — reemplazar el header `X-Client-Id` autogenerado por un login real (email + password con sesión, o algo más simple tipo magic link). Implicaría: tabla `users`, un endpoint de login que emita un token (JWT o sesión con cookie), y adaptar `requireClientId` para que derive el `client_id` del usuario autenticado en vez de confiar en un header que manda el cliente. Es el prerequisito técnico para la feature de "vínculo entrenador-alumno" que el README ya marca como fase 2.

7. **Tests de la lógica de negocio del backend** — arrancar por lo que tiene más riesgo y cero cobertura: cálculo de PRs (`sessions.ts`), streak semanal (`streak.ts`, tiene bastante aritmética de fechas con `mondayOf`/`getUTCDay`), y la regla de alertas de 48hs (`alerts.ts`). Se haría con un test runner liviano (Vitest o `node:test`, que ya viene con Node) montando una SQLite en memoria o un archivo temporal por test, sin mockear la DB (para no repetir el error que a veces pasa de que el mock oculte bugs reales de la query).

8. **Migraciones versionadas** — en vez de los bloques `if (!cols.some(...))` que se van acumulando en `db.ts`, pasar a un sistema con migraciones numeradas y aplicadas una sola vez (tabla `schema_migrations` con el listado de las ya corridas). Se podría mantener `node:sqlite` y escribir el runner de migraciones a mano (no es mucho código), o migrar a `better-sqlite3` + Drizzle/Knex si se quiere algo ya hecho.

9. **Contrato compartido entre backend/frontend/iOS** — hoy los tipos están triplicados a mano. El camino más directo dado que el backend ya usa `zod`: generar JSON Schema/OpenAPI a partir de los schemas de `zod` (librería `zod-to-openapi` o similar), y desde ahí generar los tipos TS del frontend automáticamente. Para iOS no hay generación automática realista sin más tooling, pero al menos backend↔frontend dejarían de desincronizarse en silencio.

10. **Deploy real del backend con HTTPS** — subirlo a un PaaS chico (Railway, Fly.io) o un VPS con Caddy/Nginx + certificado automático. Esto es lo que permite sacar `NSAllowsArbitraryLoads` de iOS (hoy necesario solo porque el backend habla HTTP plano) y dejar de depender de que el iPhone esté en la misma WiFi que el Mac.

### Largo plazo (si el producto crece más allá de uso personal)

11. **Push notifications reales** para los recordatorios semanales — requiere backend con APNs (iOS) y Web Push (frontend), más lógica de scheduling que hoy no existe (hoy todo el recordatorio es pasivo, el usuario entra a la app y ve su plan).

12. **Migrar de SQLite a Postgres** si hay múltiples usuarios activos escribiendo en simultáneo — `node:sqlite` (como cualquier SQLite) sirve bien para un tenant activo a la vez, pero no es la elección correcta para concurrencia real de escritura entre muchos usuarios.

13. **CI con GitHub Actions** (build + lint + test en cada PR) — tiene sentido una vez que exista una suite de tests real corriendo (punto 7); antes de eso, un CI solo validaría que compila.

## 8. Notas para cuando decidamos qué implementar

Este informe es solo relevamiento + catálogo de mejoras — **no se implementó ni se va a implementar nada de la sección 7 todavía**. Cuando quieras avanzar con alguna, lo charlamos puntualmente por ítem.
