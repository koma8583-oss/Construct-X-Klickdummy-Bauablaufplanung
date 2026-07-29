/**
 * AN-App entry point.
 *
 * Installs a fetch interceptor BEFORE any other imports so that all
 * api-client-react calls (which target /api/*) are transparently rewritten
 * to /api/an/* — the isolated AN API namespace — AND carry the JWT Bearer token.
 *
 * Exceptions:
 * - paths already starting with /api/an/ are left untouched (no double-prefix)
 * - /auth-service/* paths are passed through unmodified so auth flows work
 */

import { getToken } from './lib/auth-token';

const _nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string') {
    // Rewrite /api/* → /api/an/* for generated hooks
    if (input.startsWith('/api/') && !input.startsWith('/api/an/')) {
      input = '/api/an/' + input.slice('/api/'.length);
    }

    // Inject Bearer token for all API calls (but not auth-service itself)
    if (input.startsWith('/api/') && !input.startsWith('/auth-service/')) {
      const token = getToken();
      if (token) {
        init = {
          ...init,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init?.headers ?? {}),
          },
        };
      }
    }
  }
  return _nativeFetch(input, init);
};

import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
