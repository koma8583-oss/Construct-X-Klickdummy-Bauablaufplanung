---
name: Wouter test router base
description: Wouter's test Router base prop affects generated hrefs differently when set to slash.
---

Use an empty base in component tests when asserting root-relative links such as `/resource-bookings`; `base="/"` can generate a double-slash href (`//resource-bookings`).

**Why:** Wouter concatenates the configured base and target path literally, so a slash base plus a slash-prefixed target is not normalized in the test DOM.

**How to apply:** Prefer `Router base=""` for isolated root-path link assertions; keep the production app's configured artifact base unchanged. For pages using `useParams`, mount them through a matching dynamic `Route` so the parameter context exists.