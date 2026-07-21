// Guardamos el token de sesión en localStorage por simplicidad. Trade-off
// conocido: un XSS en el frontend podría robarlo, igual que ya podría leer
// cualquier otro dato que se guarda ahí (client_id, unidades, cache de
// catálogo). Para una SPA sin inputs de terceros ni dependencias con
// historial de XSS conocido, se acepta ese riesgo a cambio de no tener que
// levantar un backend de sesiones con cookies httpOnly + CSRF. Si este
// backend se expone alguna vez más allá de la red local, reconsiderar
// cookies httpOnly + SameSite en vez de este enfoque.
const TOKEN_KEY = "forja_auth_token";
const USER_KEY = "forja_auth_user";

export type AuthUser = { id: number; email: string };

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
