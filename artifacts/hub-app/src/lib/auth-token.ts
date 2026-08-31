/**
 * Module-level access token store.
 * Lives outside React so the fetch interceptor in main.tsx can read it.
 * The auth context writes here on login/refresh; the interceptor reads here.
 */
let _token: string | null = null;

/**
 * In-flight refresh promise — shared across all concurrent callers so only
 * one POST /auth-service/refresh is ever sent at a time.
 */
let _refreshPromise: Promise<string> | null = null;

export function setToken(t: string | null): void {
  _token = t;
}

export function getToken(): string | null {
  return _token;
}

/**
 * Calls POST /auth-service/refresh to obtain a new access token.
 * Deduplicates concurrent callers: all pending calls await the same promise.
 * On success, stores and returns the new token.
 * On failure, clears the stored token and throws so the caller can redirect.
 */
export async function refreshAccessToken(): Promise<string> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    const res = await fetch('/auth-service/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-TaktKoord-App': 'HUB' },
    });
    if (!res.ok) {
      _token = null;
      throw new Error('Session abgelaufen');
    }
    const { accessToken } = (await res.json()) as { accessToken: string };
    _token = accessToken;
    return accessToken;
  })().finally(() => {
    _refreshPromise = null;
  });
  return _refreshPromise;
}
