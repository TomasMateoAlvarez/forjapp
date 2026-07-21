import { useState } from "react";
import { api } from "../api/client";
import { getClientId } from "../api/clientId";
import { AuthUser, getStoredUser, setSession, clearSession } from "../api/authToken";

type Mode = "login" | "register";

// Cuenta opcional: hoy los datos se guardan por client_id anónimo en este
// dispositivo (sin cuenta) y eso sigue funcionando igual. Crear una cuenta
// migra automáticamente ese historial anónimo a la cuenta nueva (best-effort,
// no bloquea el alta si falla) — pero solo al REGISTRARSE: loguearse a una
// cuenta ya existente NO migra nada, para no mezclar por sorpresa el
// historial de este dispositivo con el de una cuenta que ya tenía datos
// propios en otro dispositivo.
export default function AccountPanel() {
  // No hace falta setUser: login/logout recargan la página (ver más abajo),
  // así que este valor solo se lee una vez al montar.
  const [user] = useState<AuthUser | null>(getStoredUser());
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const result = mode === "login" ? await api.login(email, password) : await api.register(email, password);
      if (mode === "register") {
        await api.migrateAnonymousData(result.token, getClientId()).catch(() => {});
      }
      setSession(result.token, result.user);
      // Recarga completa a propósito: Today/Planning/Routines ya tienen datos
      // cargados en su propio estado local (no hay store global) y cambiar de
      // identidad los deja desactualizados hasta que se refetchean. Un reload
      // es más simple y confiable acá que plomear un evento global para 4
      // páginas independientes, dado que loguearse/desloguearse no es un flujo
      // frecuente.
      window.location.reload();
    } catch {
      setError(
        mode === "login"
          ? "Email o contraseña incorrectos."
          : "No se pudo crear la cuenta (¿ya existe ese email? ¿contraseña de al menos 8 caracteres?)."
      );
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // revocar el token en el server es best-effort; igual lo borramos localmente.
    }
    clearSession();
    window.location.reload();
  }

  if (user) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--steel)" }}>
            Sesión: <span style={{ color: "var(--chalk)" }}>{user.email}</span>
          </span>
          <button className="btn-secondary" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>
        Cuenta — {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
      </p>
      <p className="muted" style={{ marginBottom: 10 }}>
        Opcional: tus datos ya se guardan en este dispositivo sin necesidad de cuenta. Crear una cuenta migra ese
        historial a la cuenta nueva y te deja entrar desde más de un dispositivo. Si en cambio iniciás sesión en una
        cuenta que ya existe, el historial de este dispositivo no se mezcla automáticamente.
      </p>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={inputStyle}
      />
      <input
        type="password"
        placeholder="Contraseña (mín. 8 caracteres)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ ...inputStyle, marginTop: 8 }}
      />
      {error && <div className="status-msg">{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn-primary" onClick={submit} disabled={!email || password.length < 8 || loading}>
          {loading ? "…" : mode === "login" ? "Entrar" : "Crear cuenta"}
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "Crear cuenta nueva" : "Ya tengo cuenta"}
        </button>
      </div>
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
  fontFamily: "var(--body)",
  fontSize: 14,
  boxSizing: "border-box",
};
