import { useEffect, useState } from "react";
import { Inbox, TrendingUp } from "lucide-react";
import { api, WorkoutType, PlanDay, SessionSummary, ExerciseListEntry, HistoryEntry, PersonalRecord } from "../api/client";
import ForjaLineChart from "../components/ForjaLineChart";
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

type PlanningProps = { onGoToToday?: () => void };

export default function Planning({ onGoToToday }: PlanningProps) {
  const { toDisplay, unitLabel } = useUnit();

  const [subTab, setSubTab] = useState<SubTab>("calendar");

  // Calendar state
  const [types, setTypes] = useState<WorkoutType[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<PlanDay[]>([]);
  const [calStatus, setCalStatus] = useState<string | null>(null);

  // History state
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [exercises, setExercises] = useState<ExerciseListEntry[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [exercisePR, setExercisePR] = useState<PersonalRecord | null>(null);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("orm");
  const [chartGranularity, setChartGranularity] = useState<Granularity>("session");
  const [streakWeeks, setStreakWeeks] = useState<number | null>(null);

  const weekDates = weekDatesFor(weekOffset);
  const weekStart = weekDates[0];

  useEffect(() => {
    api.getWorkoutTypes().then(setTypes).catch(() => {});
    api.getStreak().then((r) => setStreakWeeks(r.weeks)).catch(() => {});
    loadHistory();
  }, []);

  useEffect(() => {
    loadPlan(weekStart);
  }, [weekStart]);

  async function loadPlan(ws: string) {
    setCalStatus(null);
    setSelections({});
    setPlan([]);
    const p = await api.getPlan(ws).catch(() => null);
    if (p) {
      setPlan(p.days);
      const sel: Record<string, string> = {};
      p.days.forEach((d) => { if (d.planned_workout_type_id) sel[d.date] = d.planned_workout_type_id; });
      setSelections(sel);
    }
  }

  async function loadHistory() {
    const [s, e] = await Promise.all([
      api.getSessions().catch(() => []),
      api.getExerciseList().catch(() => []),
    ]);
    setSessions(s);
    setExercises(e);
  }

  async function save() {
    const days = weekDates
      .filter((date) => selections[date])
      .map((date) => ({ date, workout_type_id: selections[date] }));
    if (days.length === 0) { setCalStatus("Elegí al menos un día."); return; }
    await api.savePlan({ week_start: weekStart, days });
    const p = await api.getPlan(weekStart);
    setPlan(p.days);
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
      api.getExerciseHistory(name).catch(() => []),
      api.getExerciseRecords(name).catch(() => null),
    ]);
    setHistory(h);
    setExercisePR(pr);
  }

  function dayInfo(date: string) {
    return plan.find((d) => d.date === date);
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
                    <select value={selections[date] ?? ""} onChange={(e) => setSelections((prev) => ({ ...prev, [date]: e.target.value }))}>
                      <option value="">Descanso</option>
                      {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    {done && <span className="done-badge">Hecho</span>}
                    {showMarcar && <button className="btn-secondary" onClick={() => markDone(date)}>Marcar</button>}
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
            <button className="btn-primary" onClick={save}>Guardar plan de la semana</button>
            {calStatus && <div className="status-msg">{calStatus}</div>}
          </div>

          <p className="muted" style={{ marginTop: 12 }}>Los recordatorios push quedan para la versión de producción.</p>
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
                title="Todavía no cargaste ningún entreno"
                subtitle="Registrá tu primera sesión para empezar el historial."
                actionLabel="Empezar ahora"
                onAction={onGoToToday}
              />
            )}
            {sessions.map((s) => (
              <div className="session-item" key={s.id}>
                <span className="session-date">{s.date}</span>
                <span className="session-label">{s.workout_label}</span>
              </div>
            ))}
          </div>

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
