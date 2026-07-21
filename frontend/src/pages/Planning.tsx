import { useEffect, useState } from "react";
import { Inbox, TrendingUp } from "lucide-react";
import {
  api,
  WorkoutType,
  PlanDay,
  SessionSummary,
  SessionDetail,
  SessionComment,
  ExerciseListEntry,
  HistoryEntry,
  PersonalRecord,
  PrsByWeekdayEntry,
  MesocyclePhase,
  CubanMethodWeek,
  CardioSession,
} from "../api/client";

const MESOCYCLE_LABELS: Record<MesocyclePhase, string> = {
  acumulacion: "Acumulación",
  intensificacion: "Intensificación",
  descarga: "Descarga",
  mantenimiento: "Mantenimiento",
};
import ForjaLineChart from "../components/ForjaLineChart";
import ForjaBarChart from "../components/ForjaBarChart";
import EmptyState from "../components/EmptyState";
import { useUnit } from "../context/UnitContext";

const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function baseMondayDate(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function mondayForOffset(offset: number): Date {
  const base = baseMondayDate();
  base.setDate(base.getDate() + offset * 7);
  return base;
}

function weekLabel(offset: number): string {
  const monday = mondayForOffset(offset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
  return `Semana del ${fmt(monday)} al ${fmt(sunday)}`;
}

function weekDatesFor(offset: number): string[] {
  const monday = mondayForOffset(offset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toISO(d);
  });
}

type SubTab = "calendar" | "history";
type ChartMetric = "orm" | "volume";
type Granularity = "session" | "week" | "month";

type ChartPoint = {
  date: string;
  label: string;
  value: number;
  estOneRM_kg: number;
  volume_kg: number;
  sets: HistoryEntry[];
};

function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const dow = d.getUTCDay();
  const daysFromMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d.toISOString().slice(0, 10);
}

function groupKey(dateStr: string, granularity: Granularity): string {
  if (granularity === "week") return mondayOf(dateStr);
  if (granularity === "month") return dateStr.slice(0, 7);
  return dateStr;
}

function groupLabel(key: string, granularity: Granularity): string {
  if (granularity === "month") return key.slice(0, 7);
  return key.slice(5); // MM-DD
}

function buildChartData(
  history: HistoryEntry[],
  metric: ChartMetric,
  granularity: Granularity,
  toDisplay: (kg: number) => number
): ChartPoint[] {
  const byGroup = new Map<string, HistoryEntry[]>();
  for (const h of history) {
    const key = groupKey(h.date, granularity);
    const arr = byGroup.get(key) ?? [];
    arr.push(h);
    byGroup.set(key, arr);
  }
  return Array.from(byGroup.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, sets]) => {
      // El calentamiento no cuenta para 1RM estimado ni volumen: solo series de trabajo.
      const workingSets = sets.filter((s) => !s.is_warmup);
      if (workingSets.length === 0) return null;

      const estOneRM_kg = Math.max(...workingSets.map((s) => s.weight_kg * (1 + s.reps / 30)));
      // Volume: max session total within the group
      const sessionVolumes = new Map<string, number>();
      for (const s of workingSets) {
        sessionVolumes.set(s.date, (sessionVolumes.get(s.date) ?? 0) + s.weight_kg * s.reps);
      }
      const volume_kg = Math.max(...sessionVolumes.values());
      return {
        date: key,
        label: groupLabel(key, granularity),
        value: toDisplay(metric === "orm" ? estOneRM_kg : volume_kg),
        estOneRM_kg,
        volume_kg,
        sets,
      };
    })
    .filter((pt): pt is ChartPoint => pt !== null);
}

type PlanningProps = {
  onGoToToday?: () => void;
  // Vista de coach: si se pasan, todos los datos son de ese atleta (no los
  // propios) y la UI de edición del plan queda oculta — el coach mira, no toca.
  athleteId?: number;
  readOnly?: boolean;
  // Atajo de navegación (Today.tsx/Routines.tsx → acá): al montar, si viene
  // seteado, abre directo Historial con ese ejercicio ya seleccionado.
  openExerciseOnMount?: string | null;
  onConsumedInitialExercise?: () => void;
};

export default function Planning({ onGoToToday, athleteId, readOnly, openExerciseOnMount, onConsumedInitialExercise }: PlanningProps) {
  const { toDisplay, unitLabel } = useUnit();

  const [subTab, setSubTab] = useState<SubTab>("calendar");

  // Calendar state
  const [types, setTypes] = useState<WorkoutType[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<PlanDay[]>([]);
  const [calStatus, setCalStatus] = useState<string | null>(null);
  const [mesocyclePhase, setMesocyclePhase] = useState<MesocyclePhase | "">("");
  const [cubanWeeks, setCubanWeeks] = useState<CubanMethodWeek[]>([]);
  const [weekIntensityPct, setWeekIntensityPct] = useState<number | null>(null);
  const [mesocycleDiscrepancy, setMesocycleDiscrepancy] = useState<string | null>(null);

  // History state
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [cardioSessions, setCardioSessions] = useState<CardioSession[]>([]);
  const [exercises, setExercises] = useState<ExerciseListEntry[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [exercisePR, setExercisePR] = useState<PersonalRecord | null>(null);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("orm");
  const [chartGranularity, setChartGranularity] = useState<Granularity>("session");
  const [streakWeeks, setStreakWeeks] = useState<number | null>(null);
  const [prsByWeekday, setPrsByWeekday] = useState<PrsByWeekdayEntry[]>([]);
  const [proEnabled, setProEnabled] = useState(false);

  // Detalle de sesión (índices de hipertrofia) + comentarios de coach
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [comments, setComments] = useState<SessionComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [commentStatus, setCommentStatus] = useState<string | null>(null);
  const [addingComment, setAddingComment] = useState(false);

  const weekDates = weekDatesFor(weekOffset);
  const weekStart = weekDates[0];

  useEffect(() => {
    api.getWorkoutTypes().then(setTypes).catch(() => {});
    api.getStreak(athleteId).then((r) => setStreakWeeks(r.weeks)).catch(() => {});
    api.getCubanMethodTemplate().then((r) => setCubanWeeks(r.weeks)).catch(() => {});
    api.getProfile().then((p) => setProEnabled(p.pro_enabled)).catch(() => {});
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId]);

  useEffect(() => {
    if (openExerciseOnMount) {
      setSubTab("history");
      openExercise(openExerciseOnMount);
      onConsumedInitialExercise?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPlan(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, athleteId]);

  async function loadPlan(ws: string) {
    setCalStatus(null);
    setSelections({});
    setPlan([]);
    setMesocyclePhase("");
    setWeekIntensityPct(null);
    setMesocycleDiscrepancy(null);
    const p = await api.getPlan(ws, athleteId).catch(() => null);
    if (p) {
      setPlan(p.days);
      const sel: Record<string, string> = {};
      p.days.forEach((d) => { if (d.planned_workout_type_id) sel[d.date] = d.planned_workout_type_id; });
      setSelections(sel);
      setMesocyclePhase(p.mesocycle_phase ?? "");
      setWeekIntensityPct(p.week_intensity_pct);
      setMesocycleDiscrepancy(p.mesocycle_discrepancy);
    }
  }

  async function loadHistory() {
    const [s, e, prs, cardio] = await Promise.all([
      api.getSessions(undefined, undefined, athleteId).catch(() => []),
      api.getExerciseList(athleteId).catch(() => []),
      api.getPrsByWeekday(athleteId).catch(() => []),
      api.getCardioSessions(athleteId).catch(() => []),
    ]);
    setSessions(s);
    setExercises(e);
    setPrsByWeekday(prs);
    setCardioSessions(cardio);
  }

  async function applySuggestedPlan() {
    setCalStatus(null);
    try {
      const suggested = await api.getSuggestedPlan();
      const sel: Record<string, string> = {};
      suggested.days.forEach((d) => {
        if (d.workout_type_id) sel[weekDates[d.weekday_index]] = d.workout_type_id;
      });
      setSelections(sel);
      setCalStatus("Rutina sugerida cargada — revisala y guardá si te sirve.");
    } catch {
      setCalStatus("No se pudo cargar la rutina sugerida. Probá de nuevo.");
    }
  }

  async function save() {
    const days = weekDates
      .filter((date) => selections[date])
      .map((date) => ({ date, workout_type_id: selections[date] }));
    if (days.length === 0) { setCalStatus("Elegí al menos un día."); return; }
    await api.savePlan({ week_start: weekStart, days, mesocycle_phase: mesocyclePhase || undefined });
    const p = await api.getPlan(weekStart);
    setPlan(p.days);
    setWeekIntensityPct(p.week_intensity_pct);
    setMesocycleDiscrepancy(p.mesocycle_discrepancy);
    setCalStatus("Plan guardado ✓");
  }

  async function markDone(date: string) {
    await api.markPlanDayDone(weekStart, date);
    const p = await api.getPlan(weekStart);
    setPlan(p.days);
  }

  async function openExercise(name: string) {
    setSelectedExercise(name);
    setExercisePR(null);
    setChartMetric("orm");
    setChartGranularity("session");
    const [h, pr] = await Promise.all([
      api.getExerciseHistory(name, athleteId).catch(() => []),
      api.getExerciseRecords(name, athleteId).catch(() => null),
    ]);
    setHistory(h);
    setExercisePR(pr);
  }

  function dayInfo(date: string) {
    return plan.find((d) => d.date === date);
  }

  async function toggleSessionDetail(sessionId: number) {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      setSessionDetail(null);
      setComments([]);
      return;
    }
    setExpandedSessionId(sessionId);
    setSessionDetail(null);
    setComments([]);
    setCommentStatus(null);
    setSessionDetailLoading(true);
    try {
      const [detail, sessionComments] = await Promise.all([
        api.getSessionDetail(sessionId, athleteId),
        api.getSessionComments(sessionId).catch(() => []),
      ]);
      setSessionDetail(detail);
      setComments(sessionComments);
    } catch {
      setCommentStatus("No se pudo cargar el detalle de la sesión.");
    } finally {
      setSessionDetailLoading(false);
    }
  }

  async function submitComment() {
    if (!expandedSessionId || !newComment.trim()) return;
    setAddingComment(true);
    setCommentStatus(null);
    try {
      await api.addSessionComment(expandedSessionId, newComment.trim());
      const updated = await api.getSessionComments(expandedSessionId);
      setComments(updated);
      setNewComment("");
    } catch {
      setCommentStatus("No se pudo agregar el comentario. Probá de nuevo.");
    } finally {
      setAddingComment(false);
    }
  }

  const chartData = buildChartData(history, chartMetric, chartGranularity, toDisplay);

  function renderExerciseTooltip(props: Record<string, unknown>) {
    const { active, payload } = props as { active?: boolean; payload?: Array<{ payload: ChartPoint }> };
    if (!active || !payload?.length) return null;
    const pt = payload[0].payload;
    return (
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 12px" }}>
        <div style={{ color: "var(--steel)", fontSize: 10, fontFamily: "var(--mono)", marginBottom: 4 }}>{pt.date}</div>
        <div style={{ color: "var(--brass)", fontSize: 12, fontFamily: "var(--mono)", marginBottom: 6 }}>
          {chartMetric === "orm"
            ? `1RM est.: ${toDisplay(pt.estOneRM_kg)} ${unitLabel}`
            : `Volumen: ${toDisplay(pt.volume_kg).toFixed(0)} ${unitLabel}`}
        </div>
        {pt.sets.map((s, i) => (
          <div key={i} style={{ color: s.is_warmup ? "var(--steel)" : "var(--chalk)", fontSize: 11, fontFamily: "var(--mono)" }}>
            {toDisplay(s.weight_kg)}{unitLabel} × {s.reps}{s.is_warmup ? " (calentamiento)" : ""}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="eyebrow">Planificación</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ fontSize: 24 }}>Tu entrenamiento</h2>
        {!!streakWeeks && (
          <div
            title="Semanas seguidas cumpliendo el plan"
            style={{
              display: "flex", alignItems: "center", gap: 6, background: "var(--panel-2)",
              border: "1px solid var(--brass)", borderRadius: 20, padding: "5px 12px",
              fontFamily: "var(--mono)", fontSize: 12, color: "var(--brass)", whiteSpace: "nowrap",
            }}
          >
            🔥 {streakWeeks} {streakWeeks === 1 ? "semana" : "semanas"}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)" }}>
        {(["calendar", "history"] as SubTab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setSubTab(t); if (t === "history") loadHistory(); }}
            style={{
              flex: 1,
              background: subTab === t ? "var(--panel-2)" : "none",
              border: "none",
              color: subTab === t ? "var(--chalk)" : "var(--steel)",
              padding: "10px 0",
              fontFamily: "var(--mono)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: ".5px",
              cursor: "pointer",
              borderRight: t === "calendar" ? "1px solid var(--line)" : "none",
            }}
          >
            {t === "calendar" ? "Calendario" : "Historial"}
          </button>
        ))}
      </div>

      {/* CALENDAR SUB-TAB */}
      {subTab === "calendar" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setWeekOffset((o) => o - 1)} disabled={weekOffset <= -8} style={arrowBtn}>‹</button>
            <select
              value={weekOffset}
              onChange={(e) => setWeekOffset(Number(e.target.value))}
              style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--chalk)", padding: "8px 10px", fontFamily: "var(--mono)", fontSize: 12 }}
            >
              {Array.from({ length: 13 }, (_, i) => i - 8).map((o) => (
                <option key={o} value={o}>{weekLabel(o)}{o === 0 ? " (esta semana)" : ""}</option>
              ))}
            </select>
            <button onClick={() => setWeekOffset((o) => o + 1)} disabled={weekOffset >= 4} style={arrowBtn}>›</button>
          </div>

          {!readOnly && (
            <button
              onClick={applySuggestedPlan}
              style={{
                display: "block", width: "100%", marginBottom: 12,
                background: "none", border: "1px dashed var(--brass)", borderRadius: 8,
                color: "var(--brass)", fontFamily: "var(--mono)", fontSize: 12,
                padding: "10px", cursor: "pointer",
              }}
            >
              💡 Sugerir rutina inicial (Full Body / Push / Pull)
            </button>
          )}

          {!readOnly && proEnabled && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <label style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--steel)", whiteSpace: "nowrap" }}>
                Fase de mesociclo
              </label>
              <select
                value={mesocyclePhase}
                onChange={(e) => setMesocyclePhase(e.target.value as MesocyclePhase | "")}
                style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--chalk)", padding: "6px 8px", fontFamily: "var(--mono)", fontSize: 12 }}
              >
                <option value="">Sin declarar</option>
                {(Object.keys(MESOCYCLE_LABELS) as MesocyclePhase[]).map((phase) => (
                  <option key={phase} value={phase}>{MESOCYCLE_LABELS[phase]}</option>
                ))}
              </select>
            </div>
          )}

          {!readOnly && proEnabled && cubanWeeks.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                Método cubano (referencia): repartí tu volumen total del mesociclo en 4 semanas así — clickeá una
                para aplicar su fase sugerida acá.
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                {cubanWeeks.map((w) => (
                  <button
                    key={w.week_number}
                    className="btn-secondary"
                    style={{ flex: 1, padding: "6px 4px", fontSize: 11 }}
                    onClick={() => setMesocyclePhase(w.mesocycle_phase)}
                    title={`Semana ${w.week_number}: ${w.volume_pct}% del volumen — fase sugerida ${MESOCYCLE_LABELS[w.mesocycle_phase]}`}
                  >
                    S{w.week_number} · {w.volume_pct}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {proEnabled && weekIntensityPct != null && (
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--steel)", marginBottom: 8 }}>
              Intensidad real de esta semana: <span style={{ color: "var(--chalk)" }}>{weekIntensityPct.toFixed(0)}%</span>
            </div>
          )}
          {proEnabled && mesocycleDiscrepancy && <div className="alert-banner">⚠ {mesocycleDiscrepancy}</div>}

          <div className="card">
            {weekDates.map((date, i) => {
              const info = dayInfo(date);
              const hasActual = !!info?.actual_label;
              const hasPlanned = !!info?.planned_workout_type_id;
              const done = info?.done ?? false;
              const showMarcar = hasPlanned && !hasActual && !done;
              return (
                <div key={date} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
                  <div className="plan-day" style={{ borderTop: "none", padding: 0 }}>
                    <span className="dow">{DOW[i]}</span>
                    {readOnly ? (
                      <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--steel)" }}>
                        {types.find((t) => t.id === selections[date])?.label ?? "Descanso"}
                      </span>
                    ) : (
                      <select value={selections[date] ?? ""} onChange={(e) => setSelections((prev) => ({ ...prev, [date]: e.target.value }))}>
                        <option value="">Descanso</option>
                        {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    )}
                    {done && <span className="done-badge">Hecho</span>}
                    {!readOnly && showMarcar && <button className="btn-secondary" onClick={() => markDone(date)}>Marcar</button>}
                  </div>
                  {hasActual && (
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--brass)", marginTop: 4, paddingLeft: 4 }}>
                      ✓ {info!.actual_label}
                      {info!.planned_label && info!.planned_label !== info!.actual_label && (
                        <span style={{ color: "var(--steel)", marginLeft: 6 }}>
                          (plan: {info!.planned_label})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!readOnly && <button className="btn-primary" onClick={save}>Guardar plan de la semana</button>}
            {calStatus && <div className="status-msg">{calStatus}</div>}
          </div>

          {!readOnly && <p className="muted" style={{ marginTop: 12 }}>Los recordatorios push quedan para la versión de producción.</p>}
        </>
      )}

      {/* HISTORY SUB-TAB */}
      {subTab === "history" && (
        <>
          <div className="card">
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>Calendario reciente</h3>
            {sessions.length === 0 && (
              <EmptyState
                icon={<Inbox size={40} strokeWidth={1.5} />}
                title={readOnly ? "Este atleta todavía no cargó ningún entreno" : "Todavía no cargaste ningún entreno"}
                subtitle={readOnly ? undefined : "Registrá tu primera sesión para empezar el historial."}
                actionLabel={readOnly ? undefined : "Empezar ahora"}
                onAction={readOnly ? undefined : onGoToToday}
              />
            )}
            {sessions.map((s) => (
              <div key={s.id}>
                <button
                  className="session-item"
                  onClick={() => toggleSessionDetail(s.id)}
                  style={{ display: "flex", justifyContent: "space-between", width: "100%", background: "none", border: "none", cursor: "pointer", padding: "8px 0", textAlign: "left" }}
                >
                  <span className="session-date">{s.date}</span>
                  <span className="session-label">{s.workout_label}{proEnabled && s.rpe ? ` · RPE ${s.rpe}` : ""}</span>
                </button>

                {expandedSessionId === s.id && (
                  <div style={{ padding: "4px 0 14px", borderTop: "1px dashed var(--line)" }}>
                    {sessionDetailLoading && <p className="muted">Cargando…</p>}
                    {proEnabled && sessionDetail && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontFamily: "var(--mono)", fontSize: 11, color: "var(--steel)", margin: "10px 0" }}>
                        <div>Tonelaje total: <span style={{ color: "var(--chalk)" }}>{toDisplay(sessionDetail.tonelaje_total).toFixed(0)}{unitLabel}</span></div>
                        <div>Peso medio: <span style={{ color: "var(--chalk)" }}>{sessionDetail.peso_medio != null ? `${toDisplay(sessionDetail.peso_medio).toFixed(1)}${unitLabel}` : "—"}</span></div>
                        <div>Intensidad promedio: <span style={{ color: "var(--chalk)" }}>{sessionDetail.intensidad_promedio_pct != null ? `${sessionDetail.intensidad_promedio_pct.toFixed(0)}%` : "—"}</span></div>
                        <div title="Tonelaje / duración de la sesión (Peter Sisco)">Índice Hipertrofia: <span style={{ color: "var(--chalk)" }}>{sessionDetail.indice_hipertrofia != null ? sessionDetail.indice_hipertrofia.toFixed(1) : "—"}</span></div>
                        <div title="Tonelaje² / duración de la sesión">Coef. Hipertrofia: <span style={{ color: "var(--chalk)" }}>{sessionDetail.coeficiente_hipertrofia != null ? sessionDetail.coeficiente_hipertrofia.toFixed(0) : "—"}</span></div>
                      </div>
                    )}

                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--brass)", textTransform: "uppercase", marginBottom: 6 }}>
                      Comentarios del coach
                    </div>
                    {comments.length === 0 && <p className="muted" style={{ marginBottom: 8 }}>Sin comentarios todavía.</p>}
                    {comments.map((c) => (
                      <div key={c.id} style={{ marginBottom: 8 }}>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--brass)" }}>{c.coach_email} · {c.created_at.slice(0, 10)}</div>
                        <div style={{ fontSize: 13, color: "var(--chalk)" }}>{c.comment}</div>
                      </div>
                    ))}
                    {athleteId && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <input
                          type="text"
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Dejale feedback a tu atleta sobre esta sesión…"
                          style={{
                            flex: 1, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6,
                            color: "var(--chalk)", padding: 8, fontFamily: "var(--body)", fontSize: 13, boxSizing: "border-box",
                          }}
                        />
                        <button className="btn-secondary" onClick={submitComment} disabled={!newComment.trim() || addingComment}>
                          {addingComment ? "…" : "Comentar"}
                        </button>
                      </div>
                    )}
                    {commentStatus && <div className="status-msg">{commentStatus}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {proEnabled && sessions.filter((s) => s.rpe != null).length >= 2 && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>RPE de sesión en el tiempo</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Esfuerzo percibido (1-10) de cada sesión — útil para ver si sentís más o menos esfuerzo del que
                marca la intensidad real calculada.
              </p>
              <ForjaLineChart
                data={sessions
                  .filter((s) => s.rpe != null)
                  .slice()
                  .reverse()
                  .map((s) => ({ date: s.date, label: s.date.slice(5), value: s.rpe }))}
                xKey="label"
                yKey="value"
                color="var(--ember)"
                yUnit=""
              />
            </div>
          )}

          {proEnabled && cardioSessions.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>Cardio / técnico-táctico reciente</h3>
              {cardioSessions.map((c) => (
                <div key={c.id} className="session-item">
                  <span className="session-date">{c.date}</span>
                  <span className="muted">
                    {c.activity_type === "cardio" ? "Cardio" : c.activity_type === "tecnico_tactico" ? "Técnico-táctico" : "Otro"} · {c.duration_min} min
                    {c.notes ? ` · ${c.notes}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          {prsByWeekday.some((d) => d.count > 0) && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>PRs por día de la semana</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                En qué día tendés a marcar más récords personales — útil para decidir qué día conviene la sesión más exigente.
              </p>
              <ForjaBarChart
                data={prsByWeekday.map((d) => ({ label: DOW[d.weekday_index], count: d.count }))}
                xKey="label"
                yKey="count"
                color="var(--brass)"
              />
            </div>
          )}

          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>Progreso por ejercicio</h3>
            {exercises.length === 0 && <p className="muted">Cargá una sesión para ver evolución acá.</p>}
            <div className="hist-list">
              {exercises.map((e) => (
                <button key={e.exercise_name} onClick={() => openExercise(e.exercise_name)}>
                  {e.exercise_name}
                  <div className="meta">{e.entries} registro{e.entries !== 1 ? "s" : ""} · último {e.last_date}</div>
                </button>
              ))}
            </div>

            {selectedExercise && (
              <>
                <h4 style={{ marginTop: 16, fontSize: 13, color: "var(--brass)" }}>{selectedExercise}</h4>

                {chartData.length >= 2 && (
                  <div style={{ marginBottom: 12 }}>
                    {/* Metric toggle */}
                    <div style={{ display: "flex", gap: 0, marginBottom: 8, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)", width: "fit-content" }}>
                      {([["orm", "Fuerza (1RM est.)"], ["volume", "Volumen"]] as [ChartMetric, string][]).map(([m, label]) => (
                        <button
                          key={m}
                          onClick={() => setChartMetric(m)}
                          style={{
                            background: chartMetric === m ? "var(--panel-2)" : "none",
                            border: "none",
                            color: chartMetric === m ? "var(--chalk)" : "var(--steel)",
                            fontFamily: "var(--mono)",
                            fontSize: 10,
                            padding: "5px 10px",
                            cursor: "pointer",
                            textTransform: "uppercase",
                            letterSpacing: ".5px",
                            borderRight: m === "orm" ? "1px solid var(--line)" : "none",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Granularity toggle */}
                    <div className="seg-ctrl" style={{ marginBottom: 8 }}>
                      {([["session", "Sesión"], ["week", "Semana"], ["month", "Mes"]] as [Granularity, string][]).map(([g, label]) => (
                        <button key={g} className={chartGranularity === g ? "active" : ""} onClick={() => setChartGranularity(g)}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <ForjaLineChart
                      data={chartData as Array<Record<string, unknown>>}
                      xKey="label"
                      yKey="value"
                      color={chartMetric === "orm" ? "var(--brass)" : "var(--ember)"}
                      yUnit={unitLabel}
                      renderTooltip={renderExerciseTooltip}
                    />
                  </div>
                )}
                {chartData.length < 2 && (
                  <EmptyState
                    icon={<TrendingUp size={36} strokeWidth={1.5} />}
                    title="Necesitás al menos 2 registros"
                    subtitle="de este ejercicio para ver tu progreso."
                  />
                )}

                {exercisePR && (
                  <div style={{
                    fontFamily: "var(--mono)", fontSize: 11, color: "var(--brass)",
                    background: "#1f1c14", border: "1px solid var(--brass)", borderRadius: 6,
                    padding: "6px 10px", marginBottom: 10,
                  }}>
                    🏆 PR Peso: {toDisplay(exercisePR.best_weight_kg)}{unitLabel} ({exercisePR.best_weight_date})
                    &nbsp;·&nbsp;
                    PR Vol: {toDisplay(exercisePR.best_volume).toFixed(0)}{unitLabel} ({exercisePR.best_volume_date})
                  </div>
                )}

                <table className="hist-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Serie</th>
                      <th>Peso</th>
                      <th>Reps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={i} style={h.is_warmup ? { opacity: 0.55 } : undefined}>
                        <td>{h.date}</td>
                        <td>{h.set_number}{h.is_warmup ? " 🔥" : ""}</td>
                        <td>{toDisplay(h.weight_kg)}{unitLabel}</td>
                        <td>{h.reps}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const arrowBtn: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  color: "var(--brass)",
  fontSize: 20,
  padding: "4px 12px",
  cursor: "pointer",
  lineHeight: 1.4,
};
