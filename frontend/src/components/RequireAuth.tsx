import { useEffect, useState, ReactNode } from "react";
import { getClientId } from "../api/clientId";
import { getToken } from "../api/authToken";

// Guard defensivo: hoy SIEMPRE hay una identidad resoluble — el modo anónimo
// (X-Client-Id autogenerado) es una "sesión válida" a todos los efectos, a
// propósito (ver ARCHITECTURE.md §1) — crear una cuenta no es obligatorio
// para usar la app. Este componente no bloquea el modo anónimo; solo cubre
// el caso límite de que ni siquiera el client_id anónimo se pueda resolver
// (ej. localStorage bloqueado por el navegador/modo privado restrictivo) —
// en ese caso ninguna pantalla puede funcionar igual (todo pasa por ese id),
// así que se corta acá con un mensaje claro en vez de que cada pantalla
// falle de forma distinta y confusa.
export default function RequireAuth({ children }: { children: ReactNode }) {
  const [hasIdentity, setHasIdentity] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      getToken();
      getClientId();
      setHasIdentity(true);
    } catch {
      setHasIdentity(false);
    }
  }, []);

  if (hasIdentity === null) return null;

  if (!hasIdentity) {
    return (
      <div className="card" style={{ margin: 20 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>No pudimos identificar tu sesión</p>
        <p className="muted">
          Este navegador está bloqueando el almacenamiento local (localStorage), que FORJA necesita para guardar tu
          identidad de instalación o tu sesión. Revisá la configuración de privacidad/cookies (o salí del modo
          privado/incógnito) y recargá la página.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
