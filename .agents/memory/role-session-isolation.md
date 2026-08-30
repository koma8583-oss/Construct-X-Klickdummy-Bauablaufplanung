---
name: Role-specific browser sessions
description: AG and AN apps share an origin but must never share refresh-cookie state.
---

AG and AN auth flows identify their app when calling the auth service, which stores refresh tokens in separate role-specific cookies; the legacy shared cookie remains only for backward-compatible untagged clients.

**Why:** Both apps run under the same browser origin, so a shared refresh cookie can rotate the wrong organisation's session and make otherwise valid AN or AG API calls appear unauthorized.

**How to apply:** Preserve the app header on login, register, refresh, and logout. Do not restore a single shared refresh-cookie name when changing auth flows.