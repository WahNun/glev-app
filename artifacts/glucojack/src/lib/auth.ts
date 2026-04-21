const AUTH_KEY = "glev_auth";
const PASSWORD_ENV = import.meta.env.VITE_APP_PASSWORD as string | undefined;

export function isAuthenticated(): boolean {
  if (!PASSWORD_ENV) return true;
  return localStorage.getItem(AUTH_KEY) === "true";
}

export function login(password: string): boolean {
  if (!PASSWORD_ENV || password === PASSWORD_ENV) {
    localStorage.setItem(AUTH_KEY, "true");
    return true;
  }
  return false;
}

export function logout(): void {
  localStorage.removeItem(AUTH_KEY);
}
