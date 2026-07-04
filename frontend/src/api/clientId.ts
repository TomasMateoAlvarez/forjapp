// Identificador de tenant para el backend multi-cliente. Por default es
// 'default' para TODAS las instalaciones (web e iOS comparten el mismo
// historial de una sola persona, como hasta ahora). Si algún día se despliega
// este backend para más de una persona, cada despliegue puede fijar su propio
// VITE_CLIENT_ID (ej. en un .env) para que cada quien tenga su propio tenant
// aislado, sin tocar código.
const CLIENT_ID_KEY = "forja_client_id";

export function getClientId(): string {
  const envOverride = import.meta.env.VITE_CLIENT_ID as string | undefined;
  if (envOverride) return envOverride;

  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = "default";
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}
