import { useState } from "react";
import { UnitProvider } from "./context/UnitContext";
import Today from "./pages/Today";
import Planning from "./pages/Planning";
import Routines from "./pages/Routines";
import Profile from "./pages/Profile";
import Biometrics from "./pages/Biometrics";
import Coach from "./pages/Coach";
import RequireAuth from "./components/RequireAuth";

type Tab = "today" | "planning" | "routines" | "profile" | "biom" | "coach";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "today",    label: "Hoy",           icon: "⚡" },
  { id: "planning", label: "Planificación", icon: "📅" },
  { id: "routines", label: "Rutinas",       icon: "💪" },
  { id: "profile",  label: "Perfil",        icon: "👤" },
  { id: "biom",     label: "Biometría",     icon: "📈" },
  { id: "coach",    label: "Coach",         icon: "🧑‍🏫" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("today");
  // Atajo "ver historial de este ejercicio": Today.tsx/Routines.tsx piden
  // abrir un ejercicio puntual en Planificación → Historial. Se limpia apenas
  // Planning lo consume (ver onConsumedInitialExercise) para que volver a la
  // tab de Planificación por la nav normal no reabra el mismo ejercicio.
  const [pendingExercise, setPendingExercise] = useState<string | null>(null);

  function goToExerciseHistory(name: string) {
    setPendingExercise(name);
    setTab("planning");
  }

  return (
    <UnitProvider>
      <RequireAuth>
      <div className="app-shell">

        {/* ── Sidebar — visible only on desktop (≥1024px via CSS) ── */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo">FOR<span>JA</span></div>
          </div>
          <nav className="sidebar-nav">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`sidebar-nav-btn${tab === t.id ? " active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <span className="sidebar-nav-icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* ── Main area ─────────────────────────────────────────── */}
        <div className="main-area">

          {/* Topbar — visible only on mobile/tablet (hidden on desktop via CSS) */}
          <div className="topbar">
            <div className="logo">FOR<span>JA</span></div>
          </div>

          <div className="content">
            {tab === "today"    && <Today onOpenExerciseHistory={goToExerciseHistory} />}
            {tab === "planning" && (
              <Planning
                onGoToToday={() => setTab("today")}
                openExerciseOnMount={pendingExercise}
                onConsumedInitialExercise={() => setPendingExercise(null)}
              />
            )}
            {tab === "routines" && <Routines onOpenExerciseHistory={goToExerciseHistory} />}
            {tab === "profile"  && <Profile />}
            {tab === "biom"     && <Biometrics />}
            {tab === "coach"    && <Coach />}
          </div>
        </div>

        {/* ── Bottom tab bar — visible only on mobile/tablet ────── */}
        <div className="tabbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

      </div>
      </RequireAuth>
    </UnitProvider>
  );
}
