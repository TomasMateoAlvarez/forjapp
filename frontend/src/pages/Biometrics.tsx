import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { api, Biometric, StrengthTest } from "../api/client";
import ForjaLineChart from "../components/ForjaLineChart";
import EmptyState from "../components/EmptyState";
import AccountPanel from "../components/AccountPanel";
import { useUnit, Unit } from "../context/UnitContext";

type Granularity = "session" | "week" | "month";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const daysFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d.toISOString().slice(0, 10);
}

function groupKey(date: string, g: Granularity) {
  if (g === "week") return mondayOf(date);
  if (g === "month") return date.slice(0, 7);
  return date;
}

function groupLabel(key: string, g: Granularity) {
  return g === "month" ? key.slice(0, 7) : key.slice(5);
}

function imcCategory(imc: number): string {
  if (imc < 18.5) return "Bajo peso";
  if (imc < 25) return "Normal";
  if (imc < 30) return "Sobrepeso";
  return "Obesidad";
}

const FEELINGS = [
  { value: 1, label: "🪫 Muy cansado" },
  { value: 2, label: "😐 Flojo" },
  { value: 3, label: "🙂 Normal" },
  { value: 4, label: "💪 Con energía" },
  { value: 5, label: "🔥 Excelente" },
];

export default function Biometrics() {
  const { unit, setUnit, toDisplay, fromDisplay, unitLabel } = useUnit();

  const [weight, setWeight] = useState("");
  const [feeling, setFeeling] = useState<number | null>(null);
  const [history, setHistory] = useState<Biometric[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [editingHeight, setEditingHeight] = useState(false);
  const [heightInput, setHeightInput] = useState("");
  const [heightStatus, setHeightStatus] = useState<string | null>(null);

  const [weightGranularity, setWeightGranularity] = useState<Granularity>("session");
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [strengthTests, setStrengthTests] = useState<StrengthTest[]>([]);
  const [testType, setTestType] = useState<"salto_simple" | "drop_jump">("salto_simple");
  const [flightTime, setFlightTime] = useState("");
  const [contactTime, setContactTime] = useState("");
  const [dropHeight, setDropHeight] = useState("");
  const [testStatus, setTestStatus] = useState<string | null>(null);

  const [proEnabled, setProEnabled] = useState(false);

  async function loadAll() {
    setLoadError(false);
    try {
      const [bio, profile, tests] = await Promise.all([
        api.getBiometrics(),
        api.getProfile(),
        api.getStrengthTests(),
      ]);
      setHistory(bio);
      setHeightCm(profile.height_cm);
      setProEnabled(profile.pro_enabled);
      setStrengthTests(tests);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function save() {
    if (!weight && !feeling) {
      setStatus("Cargá al menos un dato.");
      return;
    }
    const weight_kg = weight ? fromDisplay(Number(weight)) : undefined;
    try {
      await api.upsertBiometric({ date: todayISO(), weight_kg, feeling: feeling ?? undefined });
      setHistory(await api.getBiometrics());
      setStatus("Check-in de hoy guardado ✓");
      setWeight(""); setFeeling(null);
    } catch {
      setStatus("No se pudo guardar el check-in. Revisá tu conexión.");
    }
  }

  async function handleExport() {
    setExportStatus(null);
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `forja-backup-${todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportStatus("No se pudo generar el backup. Verificá la conexión con el backend.");
    }
  }

  async function saveHeight() {
    const h = Number(heightInput);
    if (!h || h < 50 || h > 280) { setHeightStatus("Altura inválida."); return; }
    try {
      await api.putProfile({ height_cm: h });
      setHeightCm(h);
      setEditingHeight(false);
      setHeightStatus(null);
      setHeightInput("");
    } catch {
      setHeightStatus("No se pudo guardar la altura. Probá de nuevo.");
    }
  }

  async function saveStrengthTest() {
    const flight = Number(flightTime);
    if (!flight || flight <= 0) { setTestStatus("Cargá el tiempo de vuelo (segundos)."); return; }
    if (testType === "drop_jump" && (!contactTime || Number(contactTime) <= 0)) {
      setTestStatus("Drop jump requiere el tiempo de contacto (segundos).");
      return;
    }
    try {
      await api.createStrengthTest({
        date: todayISO(),
        test_type: testType,
        flight_time_sec: flight,
        contact_time_sec: testType === "drop_jump" ? Number(contactTime) : undefined,
        drop_height_cm: testType === "drop_jump" && dropHeight ? Number(dropHeight) : undefined,
      });
      setStrengthTests(await api.getStrengthTests());
      setTestStatus("Test guardado ✓");
      setFlightTime(""); setContactTime(""); setDropHeight("");
    } catch {
      setTestStatus("No se pudo guardar el test. Revisá tu conexión.");
    }
  }

  const jumpChartData = strengthTests
    .filter((t) => t.test_type === "salto_simple")
    .slice()
    .reverse()
    .map((t) => ({ date: t.date, label: t.date.slice(5), value: Math.round(t.jump_height_cm * 10) / 10 }));

  // Weight chart with granularity
  const weightChartData = (() => {
    const byGroup = new Map<string, number[]>();
    for (const b of history) {
      if (b.weight_kg == null) continue;
      const key = groupKey(b.date, weightGranularity);
      const arr = byGroup.get(key) ?? [];
      arr.push(b.weight_kg);
      byGroup.set(key, arr);
    }
    return Array.from(byGroup.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, weights]) => ({
        date: key,
        label: groupLabel(key, weightGranularity),
        value: toDisplay(Math.max(...weights)),
      }));
  })();

  // IMC: latest weight + height from profile
  const latestWeight = history.find((h) => h.weight_kg != null)?.weight_kg ?? null;
  const imc =
    latestWeight != null && heightCm != null
      ? latestWeight / Math.pow(heightCm / 100, 2)
      : null;

  return (
    <div>
      <div className="eyebrow">Biometría · {todayISO()}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 24, margin: 0 }}>¿Cómo estás hoy?</h2>
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
          {(["kg", "lb"] as Unit[]).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              style={{
                background: unit === u ? "var(--panel-2)" : "none",
                border: "none",
                color: unit === u ? "var(--chalk)" : "var(--steel)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                padding: "6px 14px",
                cursor: "pointer",
                borderRight: u === "kg" ? "1px solid var(--line)" : "none",
              }}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      <AccountPanel />

      {/* Height — master data, not in check-in */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--steel)", flex: 1 }}>
            Altura:{" "}
            {heightCm != null
              ? <span style={{ color: "var(--chalk)" }}>{heightCm} cm</span>
              : <span style={{ color: "var(--steel)" }}>— (no cargada)</span>}
          </span>
          <button
            onClick={() => { setEditingHeight(!editingHeight); setHeightInput(heightCm?.toString() ?? ""); setHeightStatus(null); }}
            style={{ background: "none", border: "none", color: "var(--brass)", fontFamily: "var(--mono)", fontSize: 11, cursor: "pointer" }}
          >
            ✏ {editingHeight ? "Cancelar" : "Editar"}
          </button>
        </div>
        {editingHeight && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Altura (cm)</label>
              <input
                type="number" inputMode="decimal" placeholder="ej. 178"
                value={heightInput} onChange={(e) => setHeightInput(e.target.value)}
                style={inputStyle}
              />
            </div>
            <button className="btn-primary" style={{ marginTop: 0, padding: "8px 14px", width: "auto" }} onClick={saveHeight}>
              Guardar
            </button>
          </div>
        )}
        {heightStatus && <div className="status-msg">{heightStatus}</div>}

        {/* IMC (BLOQUE 6) */}
        {imc != null && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--steel)", marginBottom: 2 }}>IMC estimado</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 18, color: "var(--brass)" }}>
              {imc.toFixed(1)}{" "}
              <span style={{ fontSize: 12, color: "var(--chalk)" }}>({imcCategory(imc)})</span>
            </div>
          </div>
        )}
      </div>

      {/* Daily check-in */}
      <div className="card">
        <div>
          <label style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--steel)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
            Peso ({unitLabel})
          </label>
          <input
            type="number" inputMode="decimal"
            value={weight} onChange={(e) => setWeight(e.target.value)}
            style={{ width: "100%", maxWidth: 200, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--chalk)", padding: 8, fontFamily: "var(--body)", fontSize: 14 }}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--steel)", textTransform: "uppercase" }}>
            Cómo te sentís
          </label>
          <div className="type-grid" style={{ marginTop: 8 }}>
            {FEELINGS.map((f) => (
              <button
                key={f.value}
                className={`type-btn ${feeling === f.value ? "active" : ""}`}
                onClick={() => setFeeling(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <button className="btn-primary" onClick={save}>Guardar check-in</button>
        {status && <div className="status-msg">{status}</div>}
      </div>

      {/* Tests de salto/pliometría (Manual Anselmi §1.4) — sin plataforma
          real: tiempo de vuelo medido con una app de cronómetro alcanza.
          Métricas Pro: solo visible con pro_enabled (Perfil → Métricas Pro). */}
      {proEnabled && (
      <div className="card" style={{ marginTop: 12 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Test de salto</p>
        <p className="muted" style={{ marginBottom: 10 }}>
          Cronometrá el tiempo de vuelo del salto (con el celular alcanza) y cargalo acá. Para drop jump, sumá el
          tiempo de contacto y la altura de caída.
        </p>
        <div className="seg-ctrl" style={{ marginBottom: 10 }}>
          {([["salto_simple", "Salto simple"], ["drop_jump", "Drop jump"]] as [typeof testType, string][]).map(([t, label]) => (
            <button key={t} className={testType === t ? "active" : ""} onClick={() => setTestType(t)}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={labelStyle}>Tiempo de vuelo (s)</label>
            <input type="number" inputMode="decimal" step="0.01" value={flightTime} onChange={(e) => setFlightTime(e.target.value)} style={inputStyle} />
          </div>
          {testType === "drop_jump" && (
            <>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={labelStyle}>Tiempo de contacto (s)</label>
                <input type="number" inputMode="decimal" step="0.01" value={contactTime} onChange={(e) => setContactTime(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={labelStyle}>Altura de caída (cm)</label>
                <input type="number" inputMode="decimal" value={dropHeight} onChange={(e) => setDropHeight(e.target.value)} style={inputStyle} />
              </div>
            </>
          )}
        </div>
        <button className="btn-primary" onClick={saveStrengthTest}>Guardar test</button>
        {testStatus && <div className="status-msg">{testStatus}</div>}

        {jumpChartData.length >= 2 && (
          <div style={{ marginTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Altura de salto (cm)</div>
            <ForjaLineChart data={jumpChartData as Array<Record<string, unknown>>} xKey="label" yKey="value" color="var(--brass)" yUnit="cm" />
          </div>
        )}

        {strengthTests.length > 0 && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            {strengthTests.map((t) => (
              <div className="session-item" key={t.id}>
                <span className="session-date">{t.date}</span>
                <span className="muted">
                  {t.test_type === "drop_jump" ? "Drop jump" : "Salto simple"} · {t.jump_height_cm.toFixed(1)}cm
                  {t.reactive_stability_q != null ? ` · Q ${t.reactive_stability_q.toFixed(2)}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {weightChartData.length >= 2 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Peso corporal ({unitLabel})</div>
          <div className="seg-ctrl" style={{ marginBottom: 8 }}>
            {([["session", "Sesión"], ["week", "Semana"], ["month", "Mes"]] as [Granularity, string][]).map(([g, label]) => (
              <button key={g} className={weightGranularity === g ? "active" : ""} onClick={() => setWeightGranularity(g)}>
                {label}
              </button>
            ))}
          </div>
          <ForjaLineChart
            data={weightChartData as Array<Record<string, unknown>>}
            xKey="label"
            yKey="value"
            color="var(--ember)"
            yUnit={unitLabel}
          />
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>Historial</h3>
        {loadError && (
          <EmptyState
            icon={<span style={{ fontSize: 36 }}>📡</span>}
            title="No pudimos cargar tu historial"
            subtitle="Revisá tu conexión con el backend."
            actionLabel="Reintentar"
            onAction={loadAll}
          />
        )}
        {!loadError && history.length === 0 && (
          <EmptyState
            icon={<User size={36} strokeWidth={1.5} />}
            title="Cargá tu primer check-in"
            subtitle="para empezar a ver tu evolución."
          />
        )}
        {!loadError && history.map((h) => (
          <div className="session-item" key={h.id}>
            <span className="session-date">{h.date}</span>
            <span className="muted">
              {h.weight_kg != null ? `${toDisplay(h.weight_kg)}${unitLabel}` : "—"}{" "}
              {h.feeling ? FEELINGS.find((f) => f.value === h.feeling)?.label : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>Backup</h3>
        <p className="muted" style={{ marginBottom: 10 }}>Descargá todo tu historial (sesiones, biometrics, rutinas, PRs) en un archivo JSON.</p>
        <button className="btn-secondary" onClick={handleExport}>⬇ Exportar datos (JSON)</button>
        {exportStatus && <div className="status-msg">{exportStatus}</div>}
      </div>
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
