---
name: Authenticated API cache policy
description: Authenticated operational API data must not be served through conditional browser caching.
---

Protected `/api` responses must use `Cache-Control: no-store` and must not emit ETags.

**Why:** After direct database cleanup, conditional requests returned `304 Not Modified` and the AG browser continued displaying deleted Leistungsanfragen from its cached response.

**How to apply:** Keep authenticated data endpoints uncached, and make critical worklists refetch when mounted or when the browser regains focus.