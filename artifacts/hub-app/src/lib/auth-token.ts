/**
 * Module-level access token store.
 * Lives outside React so the fetch interceptor in main.tsx can read it.
 * The auth context writes here on login/refresh; the interceptor reads here.
 */
let _token: string | null = null;

export function setToken(t: string | null): void {
  _token = t;
}

export function getToken(): string | null {
  return _token;
}
