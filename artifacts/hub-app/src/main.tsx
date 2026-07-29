/**
 * Hub-App entry point.
 *
 * Installs a fetch interceptor that injects the JWT Bearer token into all
 * /api/hub/* requests. Auth-service calls (/auth-service/*) are passed
 * through unmodified so refresh/login/logout flows work before a token exists.
 */

import { getToken } from './lib/auth-token';

const _nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (
    typeof input === 'string' &&
    input.startsWith('/api/') &&
    !input.startsWith('/auth-service/')
  ) {
    const token = getToken();
    if (token) {
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
