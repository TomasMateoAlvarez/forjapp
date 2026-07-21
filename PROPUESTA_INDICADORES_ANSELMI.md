# Propuesta: indicadores y modalidades de trabajo para FORJA
### A partir del "Manual de Fuerza, Potencia y Acondicionamiento Físico" (Horacio Anselmi)

**Fecha:** 2026-07-17
**Fuente:** Manual-Fuerza-y-Potencia-Anselmi.pdf (201 páginas, 13 capítulos) — ver también `INFORME_RELEVAMIENTO.md` para el estado actual del código.

Este documento cruza el contenido del manual con lo que FORJA ya tiene implementado (`sessions.ts`, `history.ts`, `biometrics.ts`, `weeklyPlan.ts`, `alerts.ts`, `Planning.tsx`) para proponer qué agregar. No es una implementación — es un catálogo priorizado para decidir qué encarar primero.

---

## 1. Indicadores nuevos a implementar

### 1.1 Ya cubierto hoy (referencia)
FORJA ya calcula, por ejercicio: **1RM estimado** (fórmula Epley-like: `peso × (1 + reps/30)`) y **volumen**, excluyendo series de calentamiento (`is_warmup`), con vistas por sesión/semana/mes en `Planning.tsx`. El cálculo vive duplicado en el frontend en vez de venir ya resuelto del backend (deuda ya anotada en el informe).

### 1.2 Indicadores del manual que faltan y son de bajo esfuerzo (se calculan con datos que ya existen: peso, reps, 1RM)

| Indicador | Fórmula | Para qué sirve |
|---|---|---|
| **Tonelaje** | Σ(peso × reps) de una sesión/ejercicio | Complementa al volumen (que hoy solo cuenta repeticiones); da la carga real movida. |
| **Peso Medio** | Tonelaje / Volumen | Más fiable que tonelaje o volumen solos para comparar calidad de entrenamiento entre sesiones — indicador "resumen" ideal para un dashboard. |
| **Intensidad (%)** | (Peso Medio / 1RM) × 100 | Qué tan cerca del máximo se entrenó, en términos relativos, no solo en kg. |
| **Carga porcentual e Intensidad promedio** | Σ(%1RM de cada serie) / Volumen | Mide qué tan intensa fue la sesión en conjunto, útil para detectar sesiones "livianas" vs. "pesadas" sin mirar kg absolutos. |
| **Distribución por zonas de intensidad** | Clasificar cada serie en: 90–100% (fuerza máxima), 75–90% (hipertrofia), 50–75% (adaptación), 25–35% a máx. velocidad (potencia) | Es el indicador más accionable del manual: mostrar "esta semana entrenaste 60% en zona hipertrofia, 10% en fuerza máxima..." da información de periodización que hoy no existe en absoluto. |

Todos estos son cálculos derivados de `session_exercises` (peso, reps) + el histórico de PRs (`personal_records`) que ya existe. Se podrían exponer como campos nuevos en la respuesta de `GET /api/history` y `GET /api/sessions`, resolviendo de paso la deuda de "cálculo duplicado en frontend".

### 1.3 Indicadores que requieren un dato nuevo (duración/tiempo)

| Indicador | Fórmula | Qué falta en el modelo |
|---|---|---|
| **Índice de Hipertrofia** (Peter Sisco) | Tonelaje / Tiempo empleado | Agregar `started_at`/`ended_at` (o `duration_min`) a `sessions`. Hoy no se registra cuánto duró el entrenamiento. |
| **Coeficiente de Hipertrofia** (variante que prioriza carga sobre velocidad) | Tonelaje² / Tiempo | Mismo requisito. |

Con solo dos timestamps por sesión (inicio/fin, capturables automáticamente al abrir/cerrar `Today.tsx`) se habilita este par de indicadores sin pedirle nada extra al usuario.

### 1.4 Indicadores que requieren un módulo nuevo (tests periódicos)

El manual describe protocolos de test de potencia/elasticidad (salto con plataforma de contacto, test de Abalakov, drop jumps). No hace falta plataforma real: alcanza con que el usuario cargue manualmente altura de salto o tiempo de vuelo/contacto (medido con una app de cronómetro o celular) cada cierto tiempo (ej. mensual), igual que hoy carga peso corporal en `Biometrics.tsx`.

- **Altura de salto (cm)** = (tiempo de vuelo, seg)² × 1.226 × 100
- **Q de estabilidad reactiva** = tiempo de vuelo / tiempo de contacto — se repite el test desde alturas crecientes de caída; el punto de Q máximo indica la altura óptima de trabajo pliométrico para ese atleta.

Esto encajaría como una tabla nueva `strength_tests` (fecha, tipo de test, valor, unidad), con su propio gráfico de evolución igual al de peso corporal — mismo patrón que ya usa `Biometrics.tsx`, solo que para tests de potencia en vez de biometría pasiva.

### 1.5 Indicador de bajo esfuerzo, alto valor: RPE por sesión

El manual no usa escala de Borg explícitamente, pero sí insiste mucho en percepción de esfuerzo y fatiga acumulada. Agregar un campo simple **RPE 1–10 al cerrar la sesión** (un selector, no un formulario) permite cruzar esfuerzo percibido vs. intensidad real calculada (1.2) — deja ver si el usuario "siente" más o menos esfuerzo del que el número dice, señal temprana de fatiga acumulada o de sobreestimación de 1RM.

### 1.6 Indicador "gratis": PR por día de la semana

El manual cita que, en series estadísticas soviéticas grandes, el pico de rendimiento semanal tiende a caer los viernes (tras carga lunes-miércoles y descarga el jueves) — supercompensación. FORJA ya tiene todos los datos (`sessions.date`, `personal_records`) para cruzar en qué día de la semana el usuario tiende a marcar más PRs, sin pedir ningún dato nuevo. Es un gráfico de barras (día de semana → cantidad de PRs históricos) que ayuda a decidir qué día conviene programar la sesión más exigente.

---

## 2. Modalidades de trabajo — mejoras a planificación y periodización

Hoy `weeklyPlan.ts` es una planificación semana a semana con estado "cumplido/no cumplido", sin ningún concepto de bloque de entrenamiento (mesociclo) ni de variación programada de intensidad. El manual aporta tres ideas concretas y aplicables:

### 2.1 Mesociclos con fase asignada
El manual organiza el entrenamiento en macrociclo → mesociclos (2–5 semanas: base, específico, competitivo, mantenimiento) → microciclos semanales. Traducido a FORJA: agregar un campo opcional `mesocycle_phase` a `weekly_plans` (valores: acumulación / intensificación / descarga / mantenimiento). Con eso más la distribución por zonas de intensidad (1.2), la app podría avisar cuándo la intensidad real no coincide con la fase declarada (ej. "planificaste una semana de descarga pero tu intensidad promedio fue la más alta del mes").

### 2.2 Reparto de intensidad tipo "método cubano" (opcional, como plantilla)
El manual trae una fórmula concreta para repartir % de volumen entre microciclos de distinta intensidad dentro de un mesociclo (35%/28%/22%/15% del volumen a distintas intensidades relativas). Podría ofrecerse como una **plantilla de plan** seleccionable al crear un mesociclo, en vez de que el usuario arme la progresión de intensidad a mano.

### 2.3 Ondulación semanal en vez de carga fija
El manual muestra con un ejemplo numérico que ondular la carga día a día (en vez de entrenar "al máximo" todos los días) permite acumular ~30% más de volumen semanal total sin llegar al agotamiento. Esto es más una recomendación de contenido/guía dentro de la app que una feature de código: al generar o sugerir una rutina semanal, alternar días de intensidad alta/media/baja en vez de repetir el mismo esfuerzo relativo cada sesión.

### 2.4 Refinar la alerta de 48hs (`alerts.ts`)
Hoy la regla es fija y binaria: no repetir grupo muscular antes de 48hs. El manual sugiere mirar tendencia, no solo repetición: si un grupo muscular acumula intensidad promedio alta (zona 75–90%+) durante 3+ semanas seguidas sin una semana de descarga, es momento de bajar la carga (deload). Con los indicadores de 1.2 ya calculados, `alerts.ts` podría sumar una segunda alerta: "volumen/intensidad de [grupo muscular] en aumento sostenido — considerá una semana de descarga", complementando (no reemplazando) la regla de 48hs que ya funciona bien para lo suyo.

### 2.5 Descansos entre series según intensidad, no un timer fijo
`Today.tsx` ya tiene timer de descanso entre series. El manual da una referencia concreta: 2–3 min de descanso en trabajo a 90–100% 1RM para atletas livianos, hasta 6 min para atletas pesados; y series de "transferencia"/potencia que nunca deben superar 6 segundos de ejecución. Se podría sugerir automáticamente el tiempo de descanso según el %1RM de la serie recién cargada, en vez de un valor fijo configurado a mano.

### 2.6 Orden y duración de sesiones mixtas
Si en algún momento FORJA suma trabajo aeróbico o técnico-táctico además de sobrecarga (hoy no lo hace), el manual es explícito: sobrecarga siempre antes que aeróbico, nunca al revés, y la sesión completa idealmente no debería superar los 90 minutos (ventana hormonal de testosterona). Vale como guía de producto si se agrega ese tipo de sesión más adelante — no aplica al alcance actual.

---

## 3. Nutrición (fuera del alcance actual, catalogado para fase futura)

El manual dedica un capítulo entero a esto con cifras concretas y aplicables si algún día FORJA suma un módulo de nutrición:

- Proteína objetivo: 0.9 g/kg/día (sedentario) hasta 2.0 g/kg/día (atleta en hipertrofia o restricción calórica) — calculable automáticamente con el peso corporal que ya está en `Biometrics.tsx`.
- Carbohidratos: 4–6 g/kg/día (fuerza) o 6–10 g/kg/día (resistencia).
- Hidratación post-sesión: reponer 120–150% del peso perdido en líquido (requeriría pesarse antes/después, hoy no se hace).

No lo recomiendo para esta iteración — implica pedirle datos nuevos al usuario (objetivo de composición corporal, etc.) que hoy la app no maneja. Queda anotado por si en el futuro se evalúa.

---

## 4. Priorización sugerida

**Quick wins (se calculan con datos que ya existen, sin tocar el modelo):**
1. Tonelaje, Peso Medio, Intensidad %, distribución por zonas de intensidad — mover el cálculo al backend (`history.ts`) de paso resuelve la deuda de duplicación con el frontend.
2. Gráfico de PRs por día de la semana.

**Esfuerzo medio (requieren 1 campo nuevo en el modelo):**
3. RPE por sesión (selector 1–10 al cerrar sesión en `Today.tsx`).
4. `started_at`/`ended_at` en `sessions` → habilita Índice y Coeficiente de Hipertrofia.
5. Alerta de tendencia de sobrecarga por grupo muscular en `alerts.ts` (usa los indicadores del punto 1).

**Esfuerzo mayor (requieren tabla o concepto nuevo):**
6. Tabla `strength_tests` para tests de salto/potencia periódicos.
7. `mesocycle_phase` en `weekly_plans` + comparación plan vs. intensidad real.
8. Descanso sugerido dinámico según %1RM en `Today.tsx`.

Nada de esto está implementado — es catálogo para decidir qué encarar primero, igual que la sección 7 de `INFORME_RELEVAMIENTO.md`.
