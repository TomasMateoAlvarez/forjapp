import { useEffect, useRef, useState } from "react";
import { api, WorkoutType, CustomRoutine, NewRecord, SessionExerciseInput, ProgressionSuggestion } from "../api/client";
import { useUnit } from "../context/UnitContext";
import { saveCatalog, loadCatalog, saveExercisesFor, loadExercisesFor } from "../api/catalogCache";
import EmptyState from "../components/EmptyState";

type SetRow = { id: number; weight: string; reps: string; isWarmup: boolean; rir: string };
type LastSetRef = { weight_kg: number; reps: number };
type ExerciseState = {
  name: string;
  sets: SetRow[];
  lastSets: LastSetRef[];
  restSeconds: number;
  targetReps: string | null;
  suggestion: ProgressionSuggestion | null;
};
type ActiveTimer = { remaining: number; total: number } | null;
type Selection = { kind: "system"; type: WorkoutType } | { kind: "custom"; routine: CustomRoutine };
type PendingSession = {
  id: string;
  date: string;
  workout_type_id?: string;
  custom_routine_id?: number;
  exercises: SessionExerciseInput[];
  rpe?: number;
  started_at?: string;
  ended_at?: string;
};

const PENDING_KEY = "forja_pending_sessions";

function loadPendingQueue(): PendingSession[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]"); }
  catch { return []; }
}

function savePendingQueue(q: PendingSession[]) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(q));
}

async function syncQueue(onSynced?: () => void) {
  const pending = loadPendingQueue();
  if (pending.length === 0) return;
  const remaining: PendingSession[] = [];
  for (const item of pending) {
    try {
      await api.createSession({
        date: item.date,
        workout_type_id: item.workout_type_id,
        custom_routine_id: item.custom_routine_id,
        exercises: item.exercises,
        rpe: item.rpe,
        started_at: item.started_at,
        ended_at: item.ended_at,
      });
    }
    catch { remaining.push(item); }
  }
  savePendingQueue(remaining);
  if (remaining.length < pending.length) onSynced?.();
}

let nextId = 0;
function newRow(weight = "", reps = "", isWarmup = false): SetRow {
  return { id: nextId++, weight, reps, isWarmup, rir: "" };
}

const SUGGESTION_LABEL: Record<string, string> = {
  subir_peso: "💡 Subí peso",
  mantener: "➡️ Mantené el peso",
  bajar: "🔻 Bajá el peso",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${sec}s`;
}

type TodayProps = {
  onOpenExerciseHistory?: (name: string) => void;
};

export default function Today({ onOpenExerciseHistory }: TodayProps) {
  const { toDisplay, fromDisplay, unitLabel } = useUnit();

  const [types, setTypes] = useState<WorkoutType[]>([]);
  const [customRoutines, setCustomRoutines] = useState<CustomRoutine[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [exercises, setExercises] = useState<ExerciseState[]>([]);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [trendMsg, setTrendMsg] = useState<string | null>(null);
  const sessionStartedAt = useRef<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newRecords, setNewRecords] = useState<NewRecord[]>([]);
  const [sessionRpe, setSessionRpe] = useState<number | null>(null);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer>(null);
  const [cardioType, setCardioType] = useState<"cardio" | "tecnico_tactico" | "otro">("cardio");
  const [cardioDuration, setCardioDuration] = useState("");
  const [cardioNotes, setCardioNotes] = useState("");
  const [cardioStatus, setCardioStatus] = useState<string | null>(null);
  const [proEnabled, setProEnabled] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const date = todayISO();

  // selectType is used by auto-select and manual select, defined before useEffect
  async function selectType(sel: Selection) {
    setSelected(sel);
    setStatus(null);
    setNewRecords([]);
    setSessionRpe(null);
    setActiveTimer(null);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setLoading(true);

    const cacheKey = sel.kind === "system" ? `sys-${sel.type.id}` : `cust-${sel.routine.id}`;
    let infos;
    try {
      infos = sel.kind === "system"
        ? await api.getWorkoutTypeExercises(sel.type.id)
        : await api.getCustomRoutineExercises(sel.routine.id);
      saveExercisesFor(cacheKey, infos);
    } catch {
      const cached = loadExercisesFor(cacheKey);
      if (!cached) {
        setStatus("No se pudo cargar este entreno (sin conexión y sin datos guardados).");
        setLoading(false);
        return;
      }
      infos = cached;
      setStatus("Sin conexión — mostrando ejercicios guardados de la última vez.");
    }

    const alert = sel.kind === "system"
      ? await api.checkAlert(sel.type.id, date).catch(() => ({ warning: false, message: null, trend_warning: false, trend_message: null }))
      : { warning: false, message: null, trend_warning: false, trend_message: null };
    setAlertMsg(alert.warning ? alert.message : null);
    setTrendMsg(alert.trend_warning ? alert.trend_message : null);
    sessionStartedAt.current = new Date().toISOString();

    const states: ExerciseState[] = await Promise.all(
      infos.map(async (info) => {
        const latest = await api.getLatestSets(info.exercise_name).catch(() => []);
        const lastSets: LastSetRef[] = latest.map((s) => ({ weight_kg: s.weight_kg, reps: s.reps }));
        let sets: SetRow[];
        if (lastSets.length > 0) {
          sets = lastSets.map((s) => newRow(String(toDisplay(s.weight_kg)), String(s.reps)));
        } else {
          const count = info.target_sets ?? 1;
          sets = Array.from({ length: count }, () => newRow());
        }
        // Sugerencia de progresión: solo tiene sentido si ya hay un modo de
        // entrenamiento elegido en el perfil — si no, el backend devuelve 400
        // y acá simplemente no se muestra nada (no es bloqueante).
        const suggestion = await api.getProgressionSuggestion(info.exercise_name).catch(() => null);
        return {
          name: info.exercise_name,
          sets,
          lastSets,
          restSeconds: info.default_rest_seconds,
          targetReps: info.target_reps,
          suggestion: suggestion?.action === "sin_datos" ? null : suggestion,
        };
      })
    );
    setExercises(states);
    setLoading(false);
  }

  async function loadInitialCatalog() {
    setCatalogError(false);
    setStatus(null);
    try {
      const [wt, cr] = await Promise.all([api.getWorkoutTypes(), api.getCustomRoutines()]);
      saveCatalog(wt, cr);
      setTypes(wt);
      setCustomRoutines(cr);
      syncQueue();

      const planned = await api.getPlannedForDate(date).catch(() => null);
      if (planned) {
        const matched = wt.find((t) => t.id === planned.workout_type_id);
        if (matched) await selectType({ kind: "system", type: matched });
      }
    } catch {
      const cached = loadCatalog();
      if (!cached) {
        setCatalogError(true);
        return;
      }
      setTypes(cached.workoutTypes);
      setCustomRoutines(cached.customRoutines);
      const when = new Date(cached.cachedAt).toLocaleString("es-AR");
      setStatus(`Sin conexión — mostrando catálogo guardado (última sincronización: ${when}).`);
      syncQueue();
    }
  }

  useEffect(() => {
    const onOnline = () => syncQueue(() => setStatus("Sesiones pendientes sincronizadas ✓"));
    window.addEventListener("online", onOnline);

    loadInitialCatalog();
    api.getProfile().then((p) => setProEnabled(p.pro_enabled)).catch(() => {});

    return () => {
      window.removeEventListener("online", onOnline);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startTimer(restSeconds: number) {
    if (timerRef.current) clearInterval(timerRef.current);
    setActiveTimer({ remaining: restSeconds, total: restSeconds });
    timerRef.current = setInterval(() => {
      setActiveTimer((prev) => {
        if (!prev || prev.remaining <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          return null;
        }
        return { ...prev, remaining: prev.remaining - 1 };
      });
    }, 1000);
  }

  // Descanso dinámico según %1RM (Manual Anselmi §2.5): si la serie tiene un
  // peso cargado, le pregunta al backend cuánto descanso conviene según su
  // intensidad relativa al PR — si falla o no hay peso, usa el default fijo
  // del ejercicio (no bloqueante).
  async function startTimerForSet(exIdx: number, setIdx: number) {
    const ex = exercises[exIdx];
    const weight = Number(ex.sets[setIdx]?.weight);
    if (!weight || weight <= 0) {
      startTimer(ex.restSeconds);
      return;
    }
    try {
      const suggestion = await api.getRestSuggestion(ex.name, fromDisplay(weight));
      startTimer(suggestion.rest_seconds);
    } catch {
      startTimer(ex.restSeconds);
    }
  }

  async function saveCardioSession() {
    const duration = Number(cardioDuration);
    if (!duration || duration <= 0) {
      setCardioStatus("Cargá la duración en minutos.");
      return;
    }
    try {
      await api.createCardioSession({ date, activity_type: cardioType, duration_min: duration, notes: cardioNotes.trim() || undefined });
      setCardioStatus("Sesión de cardio guardada ✓");
      setCardioDuration(""); setCardioNotes("");
    } catch {
      setCardioStatus("No se pudo guardar. Revisá tu conexión.");
    }
  }

  function dismissTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setActiveTimer(null);
  }

  function updateSet(exIdx: number, setIdx: number, field: "weight" | "reps" | "rir", value: string) {
    setExercises((prev) => {
      const next = [...prev];
      next[exIdx] = {
        ...next[exIdx],
        sets: next[exIdx].sets.map((s, i) => (i === setIdx ? { ...s, [field]: value } : s)),
      };
      return next;
    });
  }

  function toggleWarmup(exIdx: number, setIdx: number) {
    setExercises((prev) => {
      const next = [...prev];
      next[exIdx] = {
        ...next[exIdx],
        sets: next[exIdx].sets.map((s, i) => (i === setIdx ? { ...s, isWarmup: !s.isWarmup } : s)),
      };
      return next;
    });
  }

  function addSet(exIdx: number) {
    setExercises((prev) => {
      const next = [...prev];
      next[exIdx] = { ...next[exIdx], sets: [...next[exIdx].sets, newRow()] };
      return next;
    });
  }

  function removeSet(exIdx: number, setIdx: number) {
    setExercises((prev) => {
      const next = [...prev];
      next[exIdx] = { ...next[exIdx], sets: next[exIdx].sets.filter((_, i) => i !== setIdx) };
      return next;
    });
  }

  async function submit() {
    if (!selected) return;
    const payload = exercises
      .map((ex) => ({
        exercise_name: ex.name,
        sets: ex.sets
          .filter((s) => s.weight && s.reps)
          .map((s) => ({
            weight_kg: fromDisplay(Number(s.weight)),
            reps: Number(s.reps),
            is_warmup: s.isWarmup,
            ...(s.rir !== "" ? { rir: Number(s.rir) } : {}),
          })),
      }))
      .filter((ex) => ex.sets.length > 0);

    if (payload.length === 0) {
      setStatus("Cargá al menos un ejercicio con peso y reps.");
      return;
    }

    const rpe = sessionRpe ?? undefined;
    const started_at = sessionStartedAt.current ?? undefined;
    const ended_at = new Date().toISOString();
    const sessionPayload = selected.kind === "system"
      ? { date, workout_type_id: selected.type.id, exercises: payload, rpe, started_at, ended_at }
      : { date, custom_routine_id: selected.routine.id, exercises: payload, rpe, started_at, ended_at };

    try {
      const result = await api.createSession(sessionPayload);
      setNewRecords(result.new_records ?? []);
      setStatus("Sesión guardada en tu historial ✓");
    } catch {
      const pending = loadPendingQueue();
      pending.push({ id: crypto.randomUUID(), ...sessionPayload });
      savePendingQueue(pending);
      setStatus("Sin conexión — guardado localmente. Se sincroniza al reconectarte.");
    }

    setSelected(null);
    setExercises([]);
    setAlertMsg(null);
    setTrendMsg(null);
    setSessionRpe(null);
    sessionStartedAt.current = null;
    dismissTimer();
  }

  return (
    <div>
      <div className="eyebrow">Hoy · {date}</div>
      <h2 style={{ fontSize: 24 }}>¿Qué entrenás hoy?</h2>

      {/* On desktop this becomes a 2-col grid: type selector left, session right */}
      <div className={`today-layout${selected ? " today-layout--active" : ""}`}>
        {/* Type selector — left col on desktop, full width on mobile when no session */}
        <div className="today-selector">
          <div className="type-grid">
            {types.map((t) => (
              <button
                key={t.id}
                className={`type-btn${selected?.kind === "system" && selected.type.id === t.id ? " active" : ""}`}
                onClick={() => selectType({ kind: "system", type: t })}
              >
                {t.label}
              </button>
            ))}
          </div>
          {customRoutines.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginTop: 16, marginBottom: 8 }}>Mis rutinas</div>
              <div className="type-grid">
                {customRoutines.map((r) => (
                  <button
                    key={r.id}
                    className={`type-btn${selected?.kind === "custom" && selected.routine.id === r.id ? " active" : ""}`}
                    onClick={() => selectType({ kind: "custom", routine: r })}
                    style={{ position: "relative" }}
                  >
                    {r.name}
                    <span style={{ position: "absolute", top: 6, right: 8, fontFamily: "var(--mono)", fontSize: 8, color: "var(--ember)" }}>
                      PROPIA
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {!selected && types.length > 0 && <p className="muted" style={{ marginTop: 16 }}>Seleccioná un tipo de entreno para empezar.</p>}
          {!selected && catalogError && (
            <EmptyState
              icon={<span style={{ fontSize: 40 }}>📡</span>}
              title="No pudimos cargar tus rutinas"
              subtitle="Revisá tu conexión."
              actionLabel="Reintentar"
              onAction={loadInitialCatalog}
            />
          )}
        </div>

        {/* Active session — right col on desktop, hidden on mobile when no session */}
        <div className="today-session">
        {selected && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: 16 }}>
              {selected.kind === "system" ? selected.type.label : selected.routine.name}
              {selected.kind === "custom" && (
                <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--ember)", marginLeft: 6 }}>PROPIA</span>
              )}
            </h3>
            <button className="btn-secondary" onClick={() => { setSelected(null); setExercises([]); dismissTimer(); }}>
              Cambiar
            </button>
          </div>

          {alertMsg && <div className="alert-banner">⚠ {alertMsg}</div>}
          {proEnabled && trendMsg && <div className="alert-banner">📈 {trendMsg}</div>}
          {loading && <p className="muted" style={{ marginTop: 12 }}>Cargando ejercicios…</p>}

          {activeTimer && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--panel-2)", border: "1px solid var(--brass)", borderRadius: 8, padding: "10px 14px", marginTop: 12 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 22, color: "var(--brass)", minWidth: 52 }}>
                {formatTime(activeTimer.remaining)}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--steel)", marginBottom: 4 }}>Descanso</div>
                <div style={{ height: 4, background: "var(--line)", borderRadius: 2 }}>
                  <div style={{ height: "100%", borderRadius: 2, background: "var(--brass)", width: `${(activeTimer.remaining / activeTimer.total) * 100}%`, transition: "width 1s linear" }} />
                </div>
              </div>
              <button onClick={dismissTimer} style={{ background: "none", border: "none", color: "var(--steel)", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
          )}

          {exercises.map((ex, exIdx) => (
            <div className="exercise-row" key={ex.name}>
              <h4>
                {onOpenExerciseHistory ? (
                  <button
                    onClick={() => onOpenExerciseHistory(ex.name)}
                    title="Ver historial de este ejercicio"
                    style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textDecoration: "underline", textDecorationColor: "var(--line)", textUnderlineOffset: 3 }}
                  >
                    {ex.name}
                  </button>
                ) : (
                  ex.name
                )}
              </h4>
              {ex.suggestion && (
                <div
                  style={{
                    fontFamily: "var(--mono)", fontSize: 11, color: "var(--brass)",
                    marginBottom: 8, padding: "4px 0",
                  }}
                  title={ex.suggestion.reason}
                >
                  {SUGGESTION_LABEL[ex.suggestion.action] ?? ex.suggestion.action}
                </div>
              )}
              {ex.sets.map((s, setIdx) => (
                <div key={s.id} style={{ marginBottom: 8 }}>
                  <div className="set-row-inputs">
                    <div>
                      <label className="set-label">Peso ({unitLabel})</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={s.weight}
                        onChange={(e) => updateSet(exIdx, setIdx, "weight", e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label className="set-label">Reps{ex.targetReps && ex.lastSets.length === 0 ? ` (obj: ${ex.targetReps})` : ""}</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder={ex.lastSets.length === 0 && ex.targetReps ? ex.targetReps : ""}
                        value={s.reps}
                        onChange={(e) => updateSet(exIdx, setIdx, "reps", e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label className="set-label">RIR</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="opc."
                        min={0}
                        max={10}
                        value={s.rir}
                        onChange={(e) => updateSet(exIdx, setIdx, "rir", e.target.value)}
                        style={{ ...inputStyle, width: 56 }}
                      />
                    </div>
                    <button
                      className="set-row-timer-btn"
                      onClick={() => startTimerForSet(exIdx, setIdx)}
                      title="Marcar serie lista e iniciar descanso"
                    >
                      ✓
                    </button>
                    {ex.sets.length > 1 && (
                      <button
                        className="set-row-remove-btn"
                        onClick={() => removeSet(exIdx, setIdx)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, gap: 8 }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--steel)" }}>
                      {ex.lastSets[setIdx] && `Última vez: ${toDisplay(ex.lastSets[setIdx].weight_kg)}${unitLabel} × ${ex.lastSets[setIdx].reps}`}
                    </div>
                    <button
                      onClick={() => toggleWarmup(exIdx, setIdx)}
                      style={{
                        flexShrink: 0,
                        background: "none",
                        border: `1px solid ${s.isWarmup ? "var(--brass)" : "var(--line)"}`,
                        borderRadius: 20,
                        color: s.isWarmup ? "var(--brass)" : "var(--steel)",
                        fontFamily: "var(--mono)", fontSize: 10, padding: "3px 8px", cursor: "pointer",
                      }}
                    >
                      {s.isWarmup ? "🔥 Calentamiento" : "Marcar calentamiento"}
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={() => addSet(exIdx)}
                style={{ background: "none", border: "none", color: "var(--brass)", fontFamily: "var(--mono)", fontSize: 12, cursor: "pointer", padding: "4px 0" }}
              >
                + Agregar serie
              </button>
            </div>
          ))}

          {proEnabled && (
            <div style={{ marginTop: 12 }}>
              <label className="set-label" style={{ display: "block", marginBottom: 6 }}>
                Esfuerzo percibido de la sesión (RPE, opcional)
              </label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setSessionRpe(sessionRpe === n ? null : n)}
                    style={{
                      width: 28, height: 28, borderRadius: 6, cursor: "pointer",
                      background: sessionRpe === n ? "var(--brass)" : "var(--panel-2)",
                      color: sessionRpe === n ? "var(--bg)" : "var(--steel)",
                      border: `1px solid ${sessionRpe === n ? "var(--brass)" : "var(--line)"}`,
                      fontFamily: "var(--mono)", fontSize: 12,
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button className="btn-primary" style={{ marginTop: 12 }} onClick={submit}>
            Guardar sesión
          </button>
        </div>
      )}

        {status && types.length > 0 && <div className="status-msg">{status}</div>}
        {newRecords.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {newRecords.map((r, i) => (
              <div key={i} style={{ background: "#1f1c14", border: "1px solid var(--brass)", borderRadius: 8, padding: "8px 12px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--brass)", marginBottom: 6 }}>
                🏆 Nuevo PR en <strong>{r.exercise_name}</strong> ({r.type === "weight" ? "peso máximo" : "volumen"})
              </div>
            ))}
          </div>
        )}
        </div>{/* .today-session */}
      </div>{/* .today-layout */}

      {/* Sesión de cardio/técnico-táctico (Manual Anselmi §2.6): módulo aparte
          de la sobrecarga — no hay forma confiable de saber si ya cargaste
          la sesión de fuerza de hoy, así que la guía de orden es solo texto.
          Métricas Pro: solo visible con pro_enabled. */}
      {proEnabled && (
      <div className="card" style={{ marginTop: 16 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Cardio / técnico-táctico</p>
        <p className="muted" style={{ marginBottom: 10 }}>
          Si hacés cardio el mismo día que sobrecarga, hacelo después — nunca antes. La sesión completa (fuerza +
          cardio) idealmente no debería superar los 90 minutos.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ flex: "1 1 160px" }}>
            <label className="set-label">Tipo</label>
            <select
              value={cardioType}
              onChange={(e) => setCardioType(e.target.value as typeof cardioType)}
              style={{ width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--chalk)", padding: 8, fontFamily: "var(--body)", fontSize: 14 }}
            >
              <option value="cardio">Cardio</option>
              <option value="tecnico_tactico">Técnico-táctico</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div style={{ flex: "1 1 100px" }}>
            <label className="set-label">Duración (min)</label>
            <input
              type="number" inputMode="numeric" min={1}
              value={cardioDuration} onChange={(e) => setCardioDuration(e.target.value)}
              style={{ width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--chalk)", padding: 8, fontFamily: "var(--body)", fontSize: 14, boxSizing: "border-box" }}
            />
          </div>
        </div>
        <label className="set-label">Notas (opcional)</label>
        <input
          type="text"
          value={cardioNotes} onChange={(e) => setCardioNotes(e.target.value)}
          placeholder="ej. trote suave, pileta, boxeo técnico…"
          style={{ width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--chalk)", padding: 8, fontFamily: "var(--body)", fontSize: 14, boxSizing: "border-box", marginBottom: 10 }}
        />
        <button className="btn-secondary" onClick={saveCardioSession}>Guardar sesión de cardio</button>
        {cardioStatus && <div className="status-msg">{cardioStatus}</div>}
      </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--panel-2)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  color: "var(--chalk)",
  padding: 8,
  fontFamily: "var(--mono)",
  fontSize: 14,
  boxSizing: "border-box",
};
