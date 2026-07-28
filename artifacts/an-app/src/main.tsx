/**
 * AN-App entry point.
 *
 * Installs a fetch interceptor BEFORE any other imports so that all
 * api-client-react calls (which target /api/*) are transparently rewritten
 * to /api/an/* — the isolated AN API namespace that uses its own session
 * cookie (tk_an_sid) independent of the AG-App's session.
 *
 * Exceptions: paths already starting with /api/an/ are left untouched.
 */

const _nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (
    typeof input === "string" &&
    input.startsWith("/api/") &&
    !input.startsWith("/api/an/")
  ) {
    input = "/api/an/" + input.slice("/api/".length);
  }
  return _nativeFetch(input, init);
};

import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
