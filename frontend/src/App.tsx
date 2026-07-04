import { useState } from "react";
import { UnitProvider } from "./context/UnitContext";
import Today from "./pages/Today";
import Planning from "./pages/Planning";
import Routines from "./pages/Routines";
import Biometrics from "./pages/Biometrics";

type Tab = "today" | "planning" | "routines" | "biom";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "today",    label: "Hoy",           icon: "⚡" },
  { id: "planning", label: "Planificación", icon: "📅" },
  { id: "routines", label: "Rutinas",       icon: "💪" },
  { id: "biom",     label: "Perfil",        icon: "👤" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("today");

  return (
    <UnitProvider>
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
            {tab === "today"    && <Today />}
            {tab === "planning" && <Planning onGoToToday={() => setTab("today")} />}
            {tab === "routines" && <Routines />}
            {tab === "biom"     && <Biometrics />}
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
    </UnitProvider>
  );
}
