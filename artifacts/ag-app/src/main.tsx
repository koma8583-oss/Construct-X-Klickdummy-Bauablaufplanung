/**
 * AG-App entry point.
 *
 * Installs a fetch interceptor BEFORE any other imports so that all API calls
 * (including generated hooks) automatically carry the JWT Bearer token.
 * Auth-service calls (/auth-service/*) are passed through without modification
 * so the refresh/login/logout flows work correctly before a token exists.
 */

import { getToken } from './lib/auth-token';

const _nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  // Only inject Bearer token for API calls — skip auth-service itself
  if (
    typeof input === 'string' &&
    input.startsWith('/api/') &&
    !input.startsWith('/auth-service/')
  ) {
    const token = getToken();
    if (token) {
      // Use new Headers() so existing headers (e.g. Content-Type set by
      // customFetch as a Headers instance) are preserved, not silently dropped.
      const merged = new Headers(init?.headers);
      merged.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers: merged };
    }
  }
  return _nativeFetch(input, init);
};

import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
