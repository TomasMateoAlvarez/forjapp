# Plan de desarrollo por sprints — FORJA

**Base:** INFORME_RELEVAMIENTO.md (2026-07-17)
**Supuesto:** 1 desarrollador, sprints de 1 semana. Ajustar duración según disponibilidad real.

## Criterio de ordenamiento

El orden prioriza tres cosas en este orden: (1) lo que bloquea cualquier uso fuera de "mi Mac en localhost" — HTTPS, config por entorno, autenticación —, (2) lo que reduce el riesgo de romper algo sin darse cuenta al tocar código — tests, contrato compartido —, y (3) lo que mejora la experiencia de uso diario. Los quick wins del informe se reparten al principio de cada sprint porque son baratos y no bloquean nada.

## Sprint 1 — Higiene de configuración y observabilidad básica

Objetivo: que el proyecto deje de tener URLs y secretos hardcodeados, y que un error deje de ser invisible.

- Mover `API_BASE` a variables de entorno en frontend (`VITE_API_BASE`) e iOS (`.xcconfig` o `Info.plist`), con `.env.example` en backend y frontend.
- Reemplazar los `.catch(() => {})` silenciosos en `Routines.tsx` y `Biometrics.tsx` por estado de error visible, reutilizando `<EmptyState>`.
- Agregar manejo de errores centralizado en Express (middleware que capture excepciones y devuelva JSON consistente, sin traza cruda al cliente).
- Agregar índices compuestos en SQLite (`sessions(client_id, date)`, `biometrics(client_id, date)`).
- Íconos reales para `manifest.json` (192/512px).

Entregable: la app sigue funcionando igual para el usuario, pero cualquier desarrollador nuevo puede levantar el proyecto sin tocar código fuente para apuntar a otro backend, y los errores dejan rastro.

## Sprint 2 — Tests de la lógica de negocio crítica

Objetivo: cubrir con tests lo que hoy tiene más riesgo y cero cobertura, antes de tocar nada más.

- Elegir test runner (Vitest o `node:test`, ya viene con Node — evitar sumar dependencia si no hace falta).
- Tests de cálculo de PRs (`sessions.ts`): 1RM estimado, exclusión de series de calentamiento, comparación contra histórico.
- Tests de streak semanal (`streak.ts`): la aritmética de fechas (`mondayOf`, `getUTCDay`) es la parte más propensa a bugs sutiles (cambios de año, semanas parciales).
- Tests de la regla de alertas de 48hs (`alerts.ts`).
- Montar SQLite en memoria o archivo temporal por test — no mockear la DB.

Entregable: suite de tests corriendo local (`npm test`), sin necesidad de CI todavía.

## Sprint 3 — CI y migraciones versionadas

Objetivo: automatizar lo que hoy se verifica a mano, y dejar de acumular `if` de migración sin control de versión.

- GitHub Actions: build + lint + test en cada PR (tiene sentido recién ahora que existe la suite del sprint 2).
- Migraciones versionadas: tabla `schema_migrations` + runner simple que aplica cada migración una sola vez, reemplazando los bloques `if (!cols.some(...))` de `db.ts`.
- Documentar en el README cómo correr una migración nueva.

Entregable: cada PR se valida solo; el esquema de la base tiene historial auditable.

## Sprint 4 — Autenticación real

Objetivo: sacar el bloqueador #1 para cualquier despliegue compartido.

- Tabla `users`, endpoint de login (empezar simple: email + password con sesión, o magic link si se quiere evitar manejar passwords).
- Adaptar `requireClientId` para derivar el `client_id` del usuario autenticado en vez de confiar en el header que manda el cliente.
- Migrar frontend e iOS para manejar sesión (guardar token, adjuntarlo en cada request, logout).
- Este sprint es prerequisito directo de la fase 2 mencionada en el README (vínculo entrenador-alumno).

Entregable: ya no cualquiera que adivine un `client_id` puede leer/escribir datos ajenos.

## Sprint 5 — Contrato compartido de API

Objetivo: dejar de tener 3 copias manuales de los mismos tipos desincronizándose en silencio.

- Generar OpenAPI/JSON Schema a partir de los schemas `zod` existentes (`zod-to-openapi` o similar).
- Generar tipos TS del frontend automáticamente a partir del contrato.
- iOS queda fuera de la generación automática por ahora (no hay tooling realista sin más inversión) — se documenta como deuda conocida.

Entregable: un cambio de campo en el backend rompe el build del frontend en vez de fallar en runtime.

## Sprint 6 — Panel del coach (visualización de datos del entrenado)

Objetivo: que un coach pueda ver el progreso de sus atletas sin acceso directo al teléfono de cada uno. Desarrollado en detalle en la sección "Coach + atleta" más abajo.

- Modelo de datos: relación `coach_id` ↔ `athlete_id` (tabla `coach_athletes`), con invitación por código o link (el atleta acepta, no el coach agrega sin permiso).
- Endpoint y vista para que el coach liste sus atletas y entre al detalle de cada uno (sesiones, PRs, adherencia al plan, biometría) en modo solo lectura.
- Reutiliza casi toda la UI ya existente de `Planning.tsx`/`History` — el coach ve las mismas pantallas que el atleta, pero de otro `client_id` y sin poder editar series pasadas.

Entregable: un coach autenticado ve el progreso real de un atleta que lo invitó, sin planillas de Excel ni capturas de pantalla por WhatsApp.

## Sprint 7 — Guía de entrenamiento para el que no sabe qué hacer

Objetivo: la app deja de ser solo una libreta digital y empieza a sugerir qué entrenar. Desarrollado en detalle en la sección "Coach + atleta" más abajo.

- Plan de rutina inicial sugerido para alguien sin rutina propia (a partir de los tipos de catálogo existentes: Push/Pull/Full Body), sin necesidad de que un coach lo arme a mano.
- Sugerencia de progresión (peso/reps) para el próximo set de un ejercicio, basada en el historial que ya se calcula en `history.ts` — no hace falta IA, alcanza con una regla simple (si completaste todas las reps con RIR bajo, subí un escalón).
- Campo de RPE/RIR opcional al registrar una serie, para poder calcular la sugerencia del punto anterior.

Entregable: alguien que llega al gimnasio sin plan tiene una sugerencia concreta de qué hacer, sin depender de un coach humano.

## Sprint 8 — Indicadores de entrenamiento (Manual Anselmi, quick wins)

Objetivo: agregar los indicadores de bajo esfuerzo que se calculan con datos que ya existen, y de paso resolver la deuda de cálculo duplicado frontend/backend. Ver `PROPUESTA_INDICADORES_ANSELMI.md` para el detalle completo y lo que se descartó.

- Tonelaje, Peso Medio, Intensidad % y distribución por zonas de intensidad (90-100 / 75-90 / 50-75 / 25-35%), calculados en el backend (`history.ts`) a partir de `session_exercises` + `personal_records` — se exponen en `GET /api/history` y `GET /api/sessions`, reemplazando el cálculo que hoy vive duplicado en `Planning.tsx`.
- RPE 1–10 opcional al cerrar una sesión en `Today.tsx` (columna nueva en `sessions`).
- Gráfico "PRs por día de la semana" en `Planning.tsx`, cruzando `sessions.date` con `personal_records` — cero campos nuevos.

Entregable: el dashboard muestra calidad de entrenamiento (no solo peso/reps sueltos), y el 1RM/volumen dejan de calcularse dos veces.

## Sprint 9 — Indicadores derivados y alerta de tendencia

Objetivo: sumar lo que se apoya en el sprint 8, con esfuerzo medio (un campo nuevo o una regla nueva, no una tabla nueva).

- `started_at`/`ended_at` en `sessions` (capturado automático al abrir/cerrar la sesión en `Today.tsx`) → habilita Índice y Coeficiente de Hipertrofia (Tonelaje/Tiempo).
- Segunda alerta de tendencia en `alerts.ts`: si un grupo muscular acumula intensidad promedio en zona 75-90%+ durante 3+ semanas sin descarga, avisar — complementa (no reemplaza) la regla de 48hs existente.
- `mesocycle_phase` en `weekly_plans` (acumulación/intensificación/descarga/mantenimiento) en versión liviana: un campo, sin motor de periodización — permite comparar fase declarada vs. intensidad real de la semana.

Entregable: la app avisa cuándo la intensidad real no coincide con lo planificado, y no solo cuando se repite un grupo muscular antes de 48hs.

## Sprint 10 — Perfil minimalista + flag "Pro" (simple por default, avanzado opcional)

Objetivo: que la app se venda como simple por default, y que quien quiera profundizar prenda un toggle en vez de recibir toda la complejidad de entrada. Esto reordena qué es gratis/base y qué queda detrás del flag, sin agregar infraestructura de billing todavía (es un flag, no un tier pago real).

- Columnas nuevas en `user_profile`: `training_mode` (fuerza/hipertrofia/mantenimiento — el objetivo elegido en el onboarding del sprint 7) y `pro_enabled` (boolean, default `false`).
- Pantalla **Perfil** nueva y deliberadamente acotada: solo muestra (a) iniciar/cerrar sesión, (b) peso actual (editable, reusa el mismo endpoint de `biometrics` que ya existe — no duplica toda la pantalla de `Biometrics.tsx`), (c) objetivo de entrenamiento, (d) el toggle "Métricas Pro". Nada más vive ahí — altura, check-in de sensación, gráfico de peso y export siguen en `Biometrics.tsx` como hoy.
- El toggle "Métricas Pro" es puramente de UI/exposición de datos: no bloquea nada con lógica de pago, solo decide qué se muestra. Deja la puerta abierta a un tier pago real más adelante sin haber construido nada que después haya que deshacer.

**Queda detrás del toggle Pro** (antes catalogado como "descartado", ahora incluido pero oculto por default):
- Todos los indicadores del sprint 8: tonelaje, peso medio, intensidad %, distribución por zonas de intensidad.
- Índice y Coeficiente de Hipertrofia del sprint 9 (requieren duración de sesión).
- La alerta de tendencia de sobrecarga por grupo muscular del sprint 9.
- `mesocycle_phase` y la comparación plan vs. intensidad real del sprint 9.
- Tabla `strength_tests` (tests de salto/potencia, Peter Sisco) — antes descartada por apuntar a un perfil de atleta de potencia; ahora tiene sentido como opción avanzada en vez de estar ausente del todo.
- Plantilla de reparto "método cubano" para armar mesociclos — antes descartada por prescriptiva; como opción Pro (no como default) el riesgo de imponerla a todos desaparece.

**Se queda gratis/simple, fuera del toggle** (es la propuesta de valor base, no debe esconderse):
- Registro de series, timer de descanso, historial, PRs — lo que ya existe hoy.
- RPE por sesión (selector simple al cerrar sesión) y RPE/RIR por serie del sprint 7 — es lo que hace funcionar la sugerencia de progresión para el principiante, no es "para expertos".
- Rutina sugerida + sugerencia de progresión del sprint 7 — es el motivo por el que alguien sin plan usa la app.
- Gráfico "PRs por día de la semana" — cero costo de datos, motiva sin abrumar.
- Modo coach (sprint 6) — es un flag aparte, ligado a rol (¿sos coach o tenés uno vinculado?), no a "cuánta complejidad querés ver". No se agrupa con el toggle Pro salvo que se decida lo contrario más adelante.

## Sprint 11 — Piloto cerrado: dar la app a un par de personas para que la prueben, desplegada en Render + Vercel

Objetivo: que un puñado de testers reales puedan usar FORJA desde afuera de tu red, con cuenta propia, sin ver datos de nadie más, durante un piloto de ~30 días sin que se resetee nada en el medio. Requiere Fase 4 (auth) y Fase 5 (perfil) completas.

Decisión de infraestructura (reemplaza la idea original de correr todo en tu PC con Cloudflare Tunnel): dado que el piloto dura ~30 días, se descartó Render Postgres free (expira a los 30 días de creado) y correr desde la PC (depende de que la máquina esté siempre prendida). En su lugar:

1. **Migrar `node:sqlite` a Postgres, hosteado en Neon (free, sin expiración, scale-to-zero).** Es el cambio más grande de este sprint: reemplaza el driver y traduce el DDL/migraciones de `db.ts` y las queries de todas las rutas del backend a sintaxis de Postgres.
2. **Backend en Render (free)**: `PORT` y `DATABASE_URL` por variable de entorno, CORS restringido al dominio del frontend en producción, más un cron externo gratuito (cron-job.org o similar) pegándole a `/api/health` cada 5-10 min para minimizar el cold start de ~1 minuto tras 15 min de inactividad.
3. **Frontend en Vercel (free)**: `VITE_API_BASE` apuntando a la URL pública de Render vía variable de entorno del proyecto, no en código.
4. **Login, perfiles y protección de rutas.** Sobre la autenticación de la Fase 4: agregar guardas de ruta reales en el frontend — sin sesión válida, no se debe poder ver ninguna pantalla (`Today`, `Planning`, `Perfil`, etc.), solo la de login/registro. Verificar que cada endpoint del backend exige el token y devuelve 401 si falta o es inválido, no solo los nuevos. Cada tester crea su propia cuenta y solo ve sus propios datos — este es el requisito no negociable antes de repartir el link a nadie.
5. **Mejora de navegación: acceso rápido al historial de un ejercicio.** Hoy para ver la evolución de un ejercicio hay que ir a Planificación → Historial → buscarlo en la lista. Se agrega: al tocar/clickear el nombre de un ejercicio en cualquier pantalla donde aparezca (`Today.tsx` durante el registro, `Routines.tsx` en la gestión de rutinas), navegar directo a la misma vista de gráfico que ya existe en el historial de `Planning.tsx` para ese ejercicio puntual — mismo componente, mismo `ForjaLineChart`, solo un atajo de navegación.

Entregable: un link (Vercel) que podés mandarle a un par de amigos, cada uno con su cuenta, sus datos en Postgres sobreviviendo los 30 días sin resetearse, y la posibilidad de saltar directo al progreso de un ejercicio tocando su nombre.

## Descanso dinámico según %1RM, sesiones mixtas y nutrición (fuera de alcance)

- Descanso dinámico según %1RM: buena idea, prioridad menor — se retoma después de los sprints de arriba si hay tiempo.
- Sesiones mixtas con cardio: no aplica, FORJA no tiene módulo aeróbico.
- Nutrición: fuera de alcance, catalogado para una fase futura si se decide sumar ese módulo.

## Backlog sin asignar a sprint (largo plazo, condicionado a que el producto crezca)

- Push notifications reales (locales, sin servidor en la nube por ahora — recordatorio semanal vía notificación local programada en el propio dispositivo).
- Migrar de SQLite a Postgres si hay múltiples usuarios escribiendo en simultáneo.
- Documentación de arquitectura más allá de comentarios inline (más relevante si se suma gente al proyecto).
- Deploy a la nube con HTTPS: descartado por ahora a pedido explícito — la app sigue corriendo en red local. Si en algún momento se retoma, queda documentado en el informe original (§7, punto 10) como referencia.

## Coach + atleta: la necesidad real detrás de los sprints 6 y 7

Hay dos perfiles de usuario con problemas distintos, y vale separarlos:

**El que va al gimnasio y no tiene dónde anotar, o no sabe qué entrenar.** Hoy FORJA ya resuelve "dónde anotar" (esto es lo que hace bien: registro rápido de series, timer de descanso, historial). Lo que falta es la parte de "no sé qué entrenar": alguien sin rutina propia y sin coach necesita una sugerencia de partida, y necesita saber si progresó lo suficiente para subir peso la próxima vez. Esto es el sprint 7: una rutina inicial sugerida a partir del catálogo que ya existe (Push/Pull/Full Body), más una sugerencia simple de progresión basada en RPE/RIR — sin necesidad de IA ni de un coach humano detrás.

**El coach que tiene que visualizar los datos de su entrenado.** Hoy esto se resuelve por fuera de la app (WhatsApp, capturas de pantalla, planillas). El coach no necesita una app nueva — necesita ver, en modo lectura, las mismas pantallas que ya existen para el atleta (`Planning.tsx`, historial, PRs, adherencia al plan semanal), pero del lado del atleta que lo invitó. Esto es el sprint 6: una relación `coach_id` ↔ `athlete_id` con invitación explícita (el atleta decide compartir, no al revés) y una vista de "mis atletas" para el coach.

Los dos sprints comparten un requisito: autenticación real (sprint 4), porque sin saber quién es cada usuario no se puede vincular coach con atleta ni personalizar una sugerencia.

## Mejoras visuales y de funcionamiento (investigación de otras plataformas)

Miré cómo resuelven esto Hevy / Hevy Coach, Strong, TrueCoach y Trainerize — las referencias completas están al pie. Esto es catálogo de ideas, no un sprint asignado; conviene priorizarlas después de los sprints 6 y 7.

**Del lado del atleta (inspirado en Hevy/Strong):**
- Autocompletado de peso/reps con el valor de la última vez que se hizo ese ejercicio, precargado en el input — hoy hay que escribirlo de cero cada serie.
- Animación o mensaje de celebración al superar un PR (Hevy y Strong lo usan como refuerzo de motivación, y FORJA ya calcula el PR en el backend — solo falta mostrarlo en el momento).
- Badges o hitos simples ("4 semanas seguidas de plan cumplido", "primer PR del mes") reutilizando el cálculo de streak que ya existe en `streak.ts`.
- Templates de rutina reutilizables entre usuarios (hoy `custom_routines` es 100% privado por `client_id`; se podría sumar una opción de "duplicar rutina de ejemplo" sin necesariamente hacerlo social/público).

**Del lado del coach (inspirado en TrueCoach/Trainerize):**
- Chat simple coach-atleta dentro de la app (aunque sea texto plano al principio) — evita depender de WhatsApp para dar feedback sobre una serie.
- Métricas de adherencia agregadas por atleta (% de semanas con plan cumplido, último check-in de biometría) en la vista de "mis atletas", no solo el detalle sesión por sesión.
- Comentario del coach sobre una sesión puntual del atleta (un campo de texto asociado a `sessions.id`), para feedback asincrónico sin chat en vivo.

**Generales de UX:**
- El informe original ya marcó que `Today.tsx` mezcla mucho `style={{...}}` inline — antes de sumar más pantallas (coach, onboarding) conviene consolidar esos estilos en `styles.css` para no duplicar el problema.
- Onboarding de primera vez: hoy alguien que abre la app sin rutina propia ve una pantalla vacía; con el sprint 7 (rutina sugerida) esto se resuelve, pero vale sumar un flujo de "elegí tu objetivo" (fuerza / hipertrofia / mantenimiento) que determine qué rutina sugerir.
- Gráficos de RPE/RIR a lo largo del tiempo por ejercicio, una vez que ese dato exista (sprint 7), reutilizando el componente `ForjaLineChart` que ya está armado con 3 granularidades.

Sources:
- [Hevy App Feature List](https://www.hevyapp.com/features/)
- [Hevy Coach - For PT & Coaches](https://play.google.com/store/apps/details?id=com.hevycoach.app)
- [TrueCoach Features](https://truecoach.co/features/)
- [Trainerize vs TrueCoach for Personal Trainers](https://www.trainerize.com/blog/trainerize-vs-truecoach-personal-trainers/)
- [Best Apps for Progressive Overload Training (2026 Comparison)](https://mesostrength.com/blog/best-apps-progressive-overload-training)
- [Best Progressive Overload Apps For Beginners In 2026 - JEFIT](https://www.jefit.com/wp/guide/best-progressive-overload-apps-for-beginners-in-2026-top-5-reviewed-and-compared/)

## Notas

- Ningún sprint asume que los anteriores están 100% terminados para arrancar — pero el orden importa: tests (sprint 2) antes de CI (sprint 3) porque un CI sin tests solo valida que compila; autenticación (sprint 4) es prerequisito de los sprints 6 y 7 porque "coach ve datos de atleta" y "sugerencia personalizada" necesitan saber quién es quién, no solo un `client_id` anónimo.
- Este plan no incluye estimaciones de horas — son 1 desarrollador y el informe no midió velocidad real del equipo. Ajustar el tamaño de cada sprint la primera vez que se corra.
