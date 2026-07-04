# FORJA — Base del proyecto

Backend + frontend web + app iOS, todo hablando con la misma API. Probado end-to-end en este entorno (backend levantado, frontend levantado, sesión creada, alerta de "no repetir grupo muscular" funcionando).

## Estructura

```
forja-app/
  backend/    API REST (Node + Express + TypeScript + node:sqlite)
  frontend/   Web app responsive (React + Vite + TypeScript)
  ios/        App nativa (SwiftUI) — necesita Xcode para compilar
```

## 1. Backend

Requiere **Node 22+** (usa el módulo nativo `node:sqlite`, no hace falta instalar ninguna base de datos aparte).

```bash
cd backend
npm install
npm run dev
```

Levanta en `http://localhost:4000`. La base de datos (`forja.sqlite`) se crea sola la primera vez, con los tipos de entreno y ejercicios predeterminados ya cargados (Pecho, Espalda, Piernas, Push, Pull, Full Body, Hombro y brazo).

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
  3. Reemplazar `baseURL` en `ios/Forja/Networking/APIClient.swift` por `http://TU_IP:4000/api`

Ya dejé `NSAllowsArbitraryLoads = true` en el `project.yml` para que iOS no bloquee las llamadas HTTP (sin esto, iOS exige HTTPS por default). Es una config solo para desarrollo local — antes de producción hay que sacarla y servir el backend con HTTPS.

## Qué es MVP hoy y qué falta

**Ya funciona (probado):**
- Selector "¿Qué entrenás hoy?" → carga set predeterminado de ejercicios
- Registro de peso/reps/series por ejercicio, guardado con fecha
- Historial por ejercicio (evolución en el tiempo)
- Calendario de sesiones
- Alerta por reglas simples (mismo grupo muscular en 48hs)
- Planificación semanal con marcado de días cumplidos
- Perfil biométrico diario (peso, altura, cómo te sentís)

**Todavía no implementado (fase 2 en adelante, según lo charlado):**
- Vínculo entrenador-alumno (invitación + vista de datos del coach)
- Notificaciones push reales para los recordatorios semanales
- Autenticación / multi-usuario (hoy es una sola base de datos local, pensada para tu uso personal)
- Deploy a un servidor real (hoy el backend corre en tu máquina)
