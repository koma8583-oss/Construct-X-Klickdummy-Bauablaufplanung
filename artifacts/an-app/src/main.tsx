/**
 * AN-App entry point.
 *
 * Installs a fetch interceptor BEFORE any other imports so that all
 * api-client-react calls (which target /api/*) are transparently rewritten
 * to /api/an/* — the isolated AN API namespace — AND carry the JWT Bearer token.
 *
 * The interceptor also handles transparent token refresh:
 *  - On a 401 response it calls POST /auth-service/refresh once (concurrent
 *    callers queue behind the same promise) and retries the original request.
 *  - If the refresh itself fails the user is redirected to /login with a
 *    session_expired flag so the login page can show a helpful message.
 *
 * Exceptions:
 * - paths already starting with /api/an/ are left untouched (no double-prefix)
 * - /auth-service/* paths are passed through unmodified so auth flows work
 */

import { getToken, refreshAccessToken } from './lib/auth-token';

const _nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (typeof input === 'string') {
    // Rewrite /api/* → /api/an/* for generated hooks
    if (input.startsWith('/api/') && !input.startsWith('/api/an/')) {
      input = '/api/an/' + input.slice('/api/'.length);
    }

    // Inject Bearer token for all API calls (but not auth-service itself)
    if (input.startsWith('/api/') && !input.startsWith('/auth-service/')) {
      const token = getToken();
      if (token) {
        const merged = new Headers(init?.headers);
        merged.set('Authorization', `Bearer ${token}`);
        init = { ...init, headers: merged };
      }
    }
  }

  const response = await _nativeFetch(input, init);

  // Transparent refresh: retry on 401 for API calls (not auth-service itself)
  if (
    response.status === 401 &&
    typeof input === 'string' &&
    input.startsWith('/api/') &&
    !input.startsWith('/auth-service/')
  ) {
    try {
      const newToken = await refreshAccessToken();
      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set('Authorization', `Bearer ${newToken}`);
      return _nativeFetch(input, { ...init, headers: retryHeaders });
    } catch {
      // Refresh cookie expired — send user to login with a clear message
      window.location.href = `${import.meta.env.BASE_URL}login?session_expired=1`;
      return response;
    }
  }

  return response;
};

import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
