import { useEffect, useState } from "react";
import { api, TrainingMode, TrainingModeConfig } from "../api/client";
import AccountPanel from "../components/AccountPanel";
import { useUnit } from "../context/UnitContext";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Pantalla deliberadamente acotada: solo sesión, peso actual, objetivo de
// entrenamiento y el toggle de Métricas Pro. Altura, check-in de sensación
// diaria, gráfico de peso, historial y export siguen viviendo en Biometría
// (Biometrics.tsx) — no se duplican acá.
export default function Profile() {
  const { toDisplay, fromDisplay, unitLabel } = useUnit();

  const [weight, setWeight] = useState("");
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [weightStatus, setWeightStatus] = useState<string | null>(null);

  const [trainingMode, setTrainingMode] = useState<TrainingMode | null>(null);
  const [modeCatalog, setModeCatalog] = useState<TrainingModeConfig[]>([]);
  const [modeStatus, setModeStatus] = useState<string | null>(null);

  const [proEnabled, setProEnabled] = useState(false);
  const [proStatus, setProStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function loadAll() {
    setLoadError(false);
    try {
      const [profile, modes, bio] = await Promise.all([api.getProfile(), api.getTrainingModes(), api.getBiometrics()]);
      setTrainingMode(profile.training_mode);
      setProEnabled(profile.pro_enabled);
      setModeCatalog(modes);
      setLatestWeight(bio.find((b) => b.weight_kg != null)?.weight_kg ?? null);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveWeight() {
    const w = Number(weight);
    if (!w || w <= 0) {
      setWeightStatus("Cargá un peso válido.");
      return;
    }
    try {
      await api.upsertBiometric({ date: todayISO(), weight_kg: fromDisplay(w) });
      setLatestWeight(fromDisplay(w));
      setWeightStatus("Peso guardado ✓");
      setWeight("");
    } catch {
      setWeightStatus("No se pudo guardar. Revisá tu conexión.");
    }
  }

  async function selectTrainingMode(mode: TrainingMode) {
    setModeStatus(null);
    try {
      await api.putProfile({ training_mode: mode });
      setTrainingMode(mode);
    } catch {
      setModeStatus("No se pudo guardar el modo. Probá de nuevo.");
    }
  }

  async function toggleProEnabled() {
    const next = !proEnabled;
    setProStatus(null);
    setProEnabled(next); // optimista: la pantalla debe sentirse instantánea
    try {
      await api.putProfile({ pro_enabled: next });
    } catch {
      setProEnabled(!next);
      setProStatus("No se pudo guardar. Probá de nuevo.");
    }
  }

  return (
    <div>
      <div className="eyebrow">Perfil · {todayISO()}</div>
      <h2 style={{ fontSize: 24, marginBottom: 16 }}>Tu cuenta</h2>

      <AccountPanel />

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Peso actual</p>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Peso ({unitLabel})</label>
            <input
              type="number" inputMode="decimal"
              placeholder={latestWeight != null ? String(toDisplay(latestWeight)) : "ej. 78"}
              value={weight} onChange={(e) => setWeight(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button className="btn-primary" style={{ marginTop: 0, padding: "8px 14px", width: "auto" }} onClick={saveWeight}>
            Guardar
          </button>
        </div>
        {weightStatus && <div className="status-msg">{weightStatus}</div>}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Objetivo de entrenamiento</p>
        <div className="type-grid">
          {modeCatalog.map((m) => (
            <button
              key={m.mode}
              className={`type-btn${trainingMode === m.mode ? " active" : ""}`}
              onClick={() => selectTrainingMode(m.mode)}
              title={`${m.rep_range_min}-${m.rep_range_max} reps · descanso ${Math.round(m.rest_seconds / 60)} min`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {modeStatus && <div className="status-msg">{modeStatus}</div>}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Métricas Pro</p>
            <p className="muted">
              Activá métricas avanzadas de entrenamiento: tonelaje, zonas de intensidad, tests de potencia y más.
            </p>
          </div>
          <button
            onClick={toggleProEnabled}
            aria-pressed={proEnabled}
            style={{
              flexShrink: 0, width: 46, height: 26, borderRadius: 13, border: "none", cursor: "pointer",
              background: proEnabled ? "var(--brass)" : "var(--panel-2)",
              position: "relative", transition: "background 0.15s",
            }}
          >
            <span
              style={{
                position: "absolute", top: 3, left: proEnabled ? 23 : 3,
                width: 20, height: 20, borderRadius: "50%", background: "var(--chalk)",
                transition: "left 0.15s",
              }}
            />
          </button>
        </div>
        {proStatus && <div className="status-msg">{proStatus}</div>}
      </div>

      {loadError && <div className="status-msg">No se pudo cargar tu perfil. Revisá tu conexión con el backend.</div>}
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
