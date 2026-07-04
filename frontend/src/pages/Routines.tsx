import { useEffect, useRef, useState } from "react";
import { Dumbbell } from "lucide-react";
import { api, WorkoutType, ExerciseInfo, CustomRoutine } from "../api/client";
import EmptyState from "../components/EmptyState";

type RoutineItem = { kind: "system"; type: WorkoutType } | { kind: "custom"; routine: CustomRoutine };
type EditTarget = { exerciseName: string; sets: string; reps: string };

function targetLabel(ex: ExerciseInfo): string | null {
  if (!ex.target_sets && !ex.target_reps) return null;
  if (ex.target_sets && ex.target_reps) return `${ex.target_sets} × ${ex.target_reps}`;
  if (ex.target_sets) return `${ex.target_sets} series`;
  return ex.target_reps!;
}

function itemKey(item: RoutineItem) {
  return item.kind === "system" ? `sys-${item.type.id}` : `cust-${item.routine.id}`;
}

// Normaliza para detectar casi-duplicados como "Press banca" vs "Press de banca"
function normalizeExerciseName(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(de|del|con)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function Routines() {
  const [types, setTypes] = useState<WorkoutType[]>([]);
  const [customRoutines, setCustomRoutines] = useState<CustomRoutine[]>([]);
  const [selected, setSelected] = useState<RoutineItem | null>(null);
  const [exercises, setExercises] = useState<ExerciseInfo[]>([]);
  const [newName, setNewName] = useState("");
  const [newSets, setNewSets] = useState("");
  const [newReps, setNewReps] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [swipedExercise, setSwipedExercise] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRoutineName, setNewRoutineName] = useState("");
  const [newRoutineExercises, setNewRoutineExercises] = useState("");
  const [isCreatingRoutine, setIsCreatingRoutine] = useState(false);
  const [exerciseNames, setExerciseNames] = useState<string[]>([]);

  const touchStartX = useRef(0);
  const touchWasDrag = useRef(false);

  const allItems: RoutineItem[] = [
    ...types.map((t) => ({ kind: "system" as const, type: t })),
    ...customRoutines.map((r) => ({ kind: "custom" as const, routine: r })),
  ];

  useEffect(() => {
    api.getWorkoutTypes().then(setTypes).catch(() => {});
    api.getCustomRoutines().then(setCustomRoutines).catch(() => {});
    api.getExerciseNames().then(setExerciseNames).catch(() => {});
  }, []);

  async function refreshExercises(item: RoutineItem) {
    const list =
      item.kind === "system"
        ? await api.getWorkoutTypeExercises(item.type.id).catch(() => [])
        : await api.getCustomRoutineExercises(item.routine.id).catch(() => []);
    setExercises(list);
  }

  async function selectItem(item: RoutineItem) {
    setSelected(item);
    setEditTarget(null);
    setSwipedExercise(null);
    setNewName(""); setNewSets(""); setNewReps("");
    await refreshExercises(item);
  }

  async function handleRemove(name: string) {
    if (!selected) return;
    if (selected.kind === "system") await api.removeExercise(selected.type.id, name).catch(() => {});
    else await api.removeExerciseFromRoutine(selected.routine.id, name).catch(() => {});
    setSwipedExercise(null);
    setEditTarget(null);
    await refreshExercises(selected);
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name || !selected || isAdding) return;
    setIsAdding(true);
    const sets = newSets ? Number(newSets) : null;
    const reps = newReps.trim() || null;
    if (selected.kind === "system") await api.addExercise(selected.type.id, name, sets, reps).catch(() => {});
    else await api.addExerciseToRoutine(selected.routine.id, name, sets, reps).catch(() => {});
    await refreshExercises(selected);
    if (!exerciseNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      setExerciseNames((prev) => [...prev, name].sort((a, b) => a.localeCompare(b)));
    }
    setNewName(""); setNewSets(""); setNewReps("");
    setIsAdding(false);
  }

  async function handleSaveEdit() {
    if (!editTarget || !selected) return;
    const sets = editTarget.sets ? Number(editTarget.sets) : null;
    const reps = editTarget.reps.trim() || null;
    if (selected.kind === "system") await api.patchExercise(selected.type.id, editTarget.exerciseName, sets, reps).catch(() => {});
    else await api.patchRoutineExercise(selected.routine.id, editTarget.exerciseName, sets, reps).catch(() => {});
    await refreshExercises(selected);
    setEditTarget(null);
  }

  async function handleCreateRoutine() {
    const name = newRoutineName.trim();
    const exNames = newRoutineExercises.split(",").map((s) => s.trim()).filter(Boolean);
    if (!name || exNames.length === 0 || isCreatingRoutine) return;
    setIsCreatingRoutine(true);
    await api.createCustomRoutine({ name, exercises: exNames }).catch(() => {});
    const updated = await api.getCustomRoutines().catch(() => []);
    setCustomRoutines(updated);
    setNewRoutineName(""); setNewRoutineExercises("");
    setIsCreatingRoutine(false);
    setShowCreateForm(false);
  }

  async function handleDeleteRoutine(id: number) {
    await api.deleteCustomRoutine(id).catch(() => {});
    setCustomRoutines((prev) => prev.filter((r) => r.id !== id));
    if (selected?.kind === "custom" && selected.routine.id === id) {
      setSelected(null); setExercises([]);
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchWasDrag.current = false;
  }

  function handleTouchMove(exerciseName: string, e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 8) touchWasDrag.current = true;
    if (dx < -60) setSwipedExercise(exerciseName);
    else if (dx > 20 && swipedExercise === exerciseName) setSwipedExercise(null);
  }

  function handleRowClick(exerciseName: string, ex: ExerciseInfo) {
    if (touchWasDrag.current) { touchWasDrag.current = false; return; }
    if (swipedExercise === exerciseName) { setSwipedExercise(null); return; }
    setEditTarget(
      editTarget?.exerciseName === exerciseName
        ? null
        : { exerciseName, sets: ex.target_sets?.toString() ?? "", reps: ex.target_reps ?? "" }
    );
  }

  const selectedLabel = selected?.kind === "system" ? selected.type.label : selected?.routine.name;

  const trimmedNewName = newName.trim();
  const similarExisting = trimmedNewName
    ? exerciseNames.find(
        (n) => n.toLowerCase() !== trimmedNewName.toLowerCase() && normalizeExerciseName(n) === normalizeExerciseName(trimmedNewName)
      )
    : undefined;

  return (
    <div>
      <p className="eyebrow">Rutinas</p>
      <h2 style={{ marginBottom: 16 }}>Mis ejercicios</h2>

      <div className="routines-layout">

        {/* ── Left col: type/routine list + create button ─── */}
        <div className="routines-list-col">
          <div className="card">
            <p className="eyebrow" style={{ marginBottom: 4 }}>Tipo de entreno</p>
            {allItems.map((item) => {
              const key = itemKey(item);
              const label = item.kind === "system" ? item.type.label : item.routine.name;
              const isSelected =
                selected &&
                selected.kind === item.kind &&
                (item.kind === "system"
                  ? (selected as { kind: "system"; type: WorkoutType }).type.id === item.type.id
                  : (selected as { kind: "custom"; routine: CustomRoutine }).routine.id === item.routine.id);

              return (
                <div key={key} style={{ display: "flex", alignItems: "center", borderTop: "1px solid var(--line)" }}>
                  <button
                    onClick={() => selectItem(item)}
                    style={{
                      flex: 1, display: "flex", alignItems: "center", gap: 8,
                      background: "none", border: "none",
                      color: isSelected ? "var(--ember)" : "var(--chalk)",
                      padding: "10px 0",
                      fontFamily: "var(--disp)", fontSize: 15, textTransform: "uppercase", cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ flex: 1 }}>{label}</span>
                    {item.kind === "custom" && (
                      <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--ember)" }}>PROPIA</span>
                    )}
                    <span style={{ color: "var(--steel)", fontSize: 12 }}>›</span>
                  </button>
                  {item.kind === "custom" && (
                    <button
                      className="routine-delete-btn"
                      onClick={(e) => { e.stopPropagation(); handleDeleteRoutine(item.routine.id); }}
                      title="Eliminar rutina"
                      style={{
                        background: "none", border: "none", color: "var(--ember)",
                        cursor: "pointer", fontSize: 16, padding: "6px 4px 6px 10px", lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Create custom routine — bottom of left col */}
          {customRoutines.length === 0 && !showCreateForm && (
            <EmptyState
              icon={<Dumbbell size={32} strokeWidth={1.5} />}
              title="No creaste ninguna rutina propia todavía"
            />
          )}
          {!showCreateForm ? (
            <button
              onClick={() => setShowCreateForm(true)}
              style={{
                display: "block", width: "100%", marginTop: 12,
                background: "none", border: "1px dashed var(--brass)", borderRadius: 8,
                color: "var(--brass)", fontFamily: "var(--disp)", fontSize: 14,
                textTransform: "uppercase", letterSpacing: ".5px",
                padding: "14px", cursor: "pointer",
              }}
            >
              + Crear rutina personalizada
            </button>
          ) : (
            <div className="card" style={{ marginTop: 12 }}>
              <p className="eyebrow" style={{ marginBottom: 8 }}>Nueva rutina propia</p>
              <input
                type="text" placeholder="Nombre de la rutina"
                value={newRoutineName} onChange={(e) => setNewRoutineName(e.target.value)}
                style={{ ...inputStyle, marginBottom: 8 }}
              />
              <input
                type="text" placeholder="Ejercicios separados por coma"
                value={newRoutineExercises} onChange={(e) => setNewRoutineExercises(e.target.value)}
                style={{ ...inputStyle, marginBottom: 10 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-primary" style={{ flex: 1 }} onClick={handleCreateRoutine}
                  disabled={!newRoutineName.trim() || !newRoutineExercises.trim() || isCreatingRoutine}>
                  {isCreatingRoutine ? "Creando…" : "Crear rutina"}
                </button>
                <button className="btn-secondary" onClick={() => { setShowCreateForm(false); setNewRoutineName(""); setNewRoutineExercises(""); }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>{/* .routines-list-col */}

        {/* ── Right col: exercise detail for selected type ── */}
        <div className="routines-detail-col">
          {selected && (
            <>
              <div className="card">
                <p className="eyebrow" style={{ color: "var(--brass)", marginBottom: 4 }}>
                  {selectedLabel}
                  {selected.kind === "custom" && (
                    <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--ember)", marginLeft: 8 }}>PROPIA</span>
                  )}
                </p>
                {exercises.length === 0 && <p className="muted">Sin ejercicios cargados.</p>}
                {exercises.map((ex) => {
                  const isSwiped = swipedExercise === ex.exercise_name;
                  const isEditing = editTarget?.exerciseName === ex.exercise_name;
                  return (
                    <div key={ex.exercise_name} className="swipe-row" style={{ position: "relative", overflow: "hidden" }}>
                      <div
                        style={{
                          position: "absolute", inset: 0, background: "var(--ember)",
                          display: "flex", alignItems: "center", justifyContent: "flex-end",
                          padding: "0 18px",
                        }}
                        onClick={() => handleRemove(ex.exercise_name)}
                      >
                        <span style={{ color: "#fff", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600 }}>
                          Eliminar
                        </span>
                      </div>
                      <div
                        style={{
                          transform: `translateX(${isSwiped ? -88 : 0}px)`,
                          transition: "transform 0.18s ease",
                          background: "var(--panel)",
                          borderTop: "1px solid var(--line)",
                          cursor: "pointer",
                        }}
                        onTouchStart={handleTouchStart}
                        onTouchMove={(e) => handleTouchMove(ex.exercise_name, e)}
                        onClick={() => handleRowClick(ex.exercise_name, ex)}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {ex.exercise_name}
                            </span>
                            {targetLabel(ex) && (
                              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--brass)" }}>
                                {targetLabel(ex)}
                              </span>
                            )}
                          </div>
                          <button
                            className="swipe-row-delete-hover"
                            onClick={(e) => { e.stopPropagation(); handleRemove(ex.exercise_name); }}
                            title="Eliminar"
                            style={{ background: "none", border: "none", color: "var(--ember)", cursor: "pointer", fontSize: 16, padding: "4px 6px", lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </div>
                        {isEditing && (
                          <div style={{ paddingBottom: 12, display: "flex", gap: 8, alignItems: "flex-end" }}>
                            <div style={{ flex: 1 }}>
                              <label style={labelStyle}>Series</label>
                              <input
                                type="number" inputMode="numeric" placeholder="ej. 4"
                                value={editTarget!.sets}
                                onChange={(e) => setEditTarget({ ...editTarget!, sets: e.target.value })}
                                style={inputStyle}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={labelStyle}>Reps</label>
                              <input
                                type="text" placeholder="ej. 8-10"
                                value={editTarget!.reps}
                                onChange={(e) => setEditTarget({ ...editTarget!, reps: e.target.value })}
                                style={inputStyle}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <button
                              className="btn-primary"
                              style={{ marginTop: 0, padding: "8px 14px", width: "auto" }}
                              onClick={(e) => { e.stopPropagation(); handleSaveEdit(); }}
                            >
                              Guardar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <p className="eyebrow" style={{ marginBottom: 8 }}>Agregar ejercicio</p>
                <datalist id="exercise-names-list">
                  {exerciseNames.map((n) => <option key={n} value={n} />)}
                </datalist>
                <input
                  type="text" placeholder="Nombre del ejercicio"
                  list="exercise-names-list"
                  value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  style={{ ...inputStyle, marginBottom: similarExisting ? 4 : 8 }}
                />
                {similarExisting && (
                  <button
                    onClick={() => setNewName(similarExisting)}
                    style={{
                      display: "block", background: "none", border: "none", color: "var(--brass)",
                      fontFamily: "var(--mono)", fontSize: 11, padding: "0 0 8px", cursor: "pointer", textAlign: "left",
                    }}
                  >
                    ¿Quisiste decir "{similarExisting}"? Ya existe un ejercicio parecido — tocá para usar ese nombre.
                  </button>
                )}
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Series objetivo</label>
                    <input type="number" inputMode="numeric" placeholder="ej. 4"
                      value={newSets} onChange={(e) => setNewSets(e.target.value)} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Reps objetivo</label>
                    <input type="text" placeholder="ej. 8-10"
                      value={newReps} onChange={(e) => setNewReps(e.target.value)} style={inputStyle} />
                  </div>
                </div>
                <button className="btn-primary" onClick={handleAdd} disabled={!newName.trim() || isAdding}>
                  {isAdding ? "Agregando…" : "Agregar ejercicio"}
                </button>
              </div>
            </>
          )}
          {!selected && (
            <div className="card" style={{ color: "var(--steel)", fontFamily: "var(--mono)", fontSize: 12 }}>
              Seleccioná un tipo de entreno para ver sus ejercicios.
            </div>
          )}
        </div>{/* .routines-detail-col */}

      </div>{/* .routines-layout */}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)",
  borderRadius: 6, color: "var(--chalk)", padding: 8,
  fontFamily: "var(--body)", fontSize: 14, boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontFamily: "var(--mono)", fontSize: 10,
  color: "var(--steel)", textTransform: "uppercase", marginBottom: 4,
};
