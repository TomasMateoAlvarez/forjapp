import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { api, CoachAthlete, PendingRequest } from "../api/client";
import EmptyState from "../components/EmptyState";
import Planning from "./Planning";

export default function Coach() {
  const [code, setCode] = useState<string | null>(null);
  const [codeStatus, setCodeStatus] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  const [linkCode, setLinkCode] = useState("");
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);

  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [athletes, setAthletes] = useState<CoachAthlete[]>([]);
  const [selectedAthlete, setSelectedAthlete] = useState<CoachAthlete | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function loadAll() {
    setLoadError(false);
    try {
      const [c, p, a] = await Promise.all([
        api.getInviteCode(),
        api.getPendingRequests(),
        api.getCoachAthletes(),
      ]);
      setCode(c?.code ?? null);
      setPending(p);
      setAthletes(a);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function generateCode() {
    setCodeLoading(true);
    setCodeStatus(null);
    try {
      const result = await api.generateInviteCode();
      setCode(result.code);
    } catch {
      setCodeStatus("No se pudo generar el código. Probá de nuevo.");
    } finally {
      setCodeLoading(false);
    }
  }

  async function requestLink() {
    const trimmed = linkCode.trim();
    if (!trimmed) return;
    setLinkLoading(true);
    setLinkStatus(null);
    try {
      await api.requestCoachLink(trimmed);
      setLinkStatus("Pedido enviado ✓ — cuando el atleta lo acepte vas a verlo en \"Mis atletas\".");
      setLinkCode("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("404")) setLinkStatus("Código inválido.");
      else if (message.includes("409")) setLinkStatus("Ya existe un vínculo con ese atleta.");
      else setLinkStatus("No se pudo enviar el pedido. Probá de nuevo.");
    } finally {
      setLinkLoading(false);
    }
  }

  async function accept(id: number) {
    await api.acceptLinkRequest(id).catch(() => {});
    await loadAll();
  }

  async function reject(id: number) {
    await api.rejectLinkRequest(id).catch(() => {});
    await loadAll();
  }

  if (selectedAthlete) {
    return (
      <div>
        <div className="eyebrow">Coach · viendo a {selectedAthlete.athlete_email}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Progreso del atleta</h2>
          <button className="btn-secondary" onClick={() => setSelectedAthlete(null)}>← Volver a mis atletas</button>
        </div>
        <p className="muted" style={{ marginBottom: 12 }}>Vista de solo lectura — no podés editar el plan ni las series de tu atleta.</p>
        <Planning athleteId={selectedAthlete.athlete_user_id} readOnly />
      </div>
    );
  }

  return (
    <div>
      <p className="eyebrow">Coach</p>
      <h2 style={{ marginBottom: 16 }}>Vínculo con tu coach o atletas</h2>

      {loadError && (
        <EmptyState
          icon={<span style={{ fontSize: 40 }}>📡</span>}
          title="No pudimos cargar esta sección"
          subtitle="Revisá tu conexión con el backend."
          actionLabel="Reintentar"
          onAction={loadAll}
        />
      )}

      {!loadError && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <p className="eyebrow" style={{ marginBottom: 8 }}>Tu código para compartir con tu coach</p>
            <p className="muted" style={{ marginBottom: 10 }}>
              Generá un código y pasáselo a tu coach de palabra o por mensaje. Vos decidís si aceptás el pedido de vínculo.
            </p>
            {code ? (
              <div style={{ fontFamily: "var(--mono)", fontSize: 22, color: "var(--brass)", letterSpacing: 2, marginBottom: 10 }}>
                {code}
              </div>
            ) : (
              <p className="muted" style={{ marginBottom: 10 }}>Todavía no generaste un código.</p>
            )}
            <button className="btn-secondary" onClick={generateCode} disabled={codeLoading}>
              {codeLoading ? "…" : code ? "Regenerar código" : "Generar código"}
            </button>
            {codeStatus && <div className="status-msg">{codeStatus}</div>}
          </div>

          {pending.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <p className="eyebrow" style={{ marginBottom: 8 }}>Pedidos de vínculo pendientes</p>
              {pending.map((req) => (
                <div key={req.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 13, color: "var(--chalk)" }}>{req.coach_email}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-primary" style={{ marginTop: 0, padding: "6px 14px", width: "auto" }} onClick={() => accept(req.id)}>
                      Aceptar
                    </button>
                    <button className="btn-secondary" onClick={() => reject(req.id)}>Rechazar</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ marginBottom: 12 }}>
            <p className="eyebrow" style={{ marginBottom: 8 }}>Vincularte como coach con un atleta</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="Código del atleta"
                value={linkCode}
                onChange={(e) => setLinkCode(e.target.value.toUpperCase())}
                style={{
                  flex: 1, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6,
                  color: "var(--chalk)", padding: 8, fontFamily: "var(--mono)", fontSize: 14, boxSizing: "border-box",
                }}
              />
              <button className="btn-primary" style={{ marginTop: 0, width: "auto", padding: "8px 16px" }} onClick={requestLink} disabled={!linkCode.trim() || linkLoading}>
                {linkLoading ? "…" : "Pedir vínculo"}
              </button>
            </div>
            {linkStatus && <div className="status-msg">{linkStatus}</div>}
          </div>

          <div className="card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>Mis atletas</p>
            {athletes.length === 0 && (
              <EmptyState
                icon={<Users size={32} strokeWidth={1.5} />}
                title="Todavía no tenés atletas vinculados"
                subtitle="Pedí un código a tu atleta y usá el formulario de arriba."
              />
            )}
            {athletes.map((a) => (
              <button
                key={a.athlete_user_id}
                onClick={() => setSelectedAthlete(a)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
                  background: "none", border: "none", borderTop: "1px solid var(--line)", padding: "10px 0",
                  cursor: "pointer", textAlign: "left",
                }}
              >
                <span style={{ fontSize: 14, color: "var(--chalk)" }}>{a.athlete_email}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--steel)" }}>
                  {a.adherence_pct != null ? `${a.adherence_pct}% adherencia` : "sin plan"}
                  {" · "}
                  {a.last_check_in ? `último check-in ${a.last_check_in}` : "sin check-ins"}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
