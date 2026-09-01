---
name: Physical database boundaries
description: Durable rules for maintaining separate AG, AN, and Hub PostgreSQL stores
---

AG, AN, and Hub must use distinct PostgreSQL databases and credentials. The
application must fail closed when a role URL is missing or points to the same
database as another role. Cross-domain business data must travel through the
Dataspace exchange; the Hub may retain transport metadata, not full domain
records.

**Why:** A shared ORM connection and shared foreign-key graph can expose private
project or resource data even when route-level organisation checks are correct.

**How to apply:** Use named role handles and role-specific migration schemas.
Never reintroduce `DATABASE_URL` as a fallback or add SQL joins/transactions
between AG and AN data. Treat cross-database workflows as idempotent message
projections/sagas.

The physical boundary test suite is opt-in: it skips only when no role URLs are
configured, but a partial role configuration must fail loudly. Run it after
migrating each role-specific schema.

**Why:** Shared-PoC tests cannot detect a handler accidentally querying a
private table on the other side, while silently skipping a partially configured
physical run would hide the same deployment error.

**How to apply:** Set all three role URLs for the dedicated suite; keep the
normal suite on the explicit non-production shared-PoC flag when no role URLs
are available.

Bilateral coordination endpoints are a deliberate exception to the canonical
AG planning-path guard: proposal history and actions are public coordination
data owned by the AG-side coordination service, while ordinary Leistungsanfrage
planning paths must remain AG-only and AN users must use local projections.

**Why:** Coordination needs both parties to exercise proposal/counter/decision
authorization against the shared AG-owned coordination record without exposing
private AN planning data.

**How to apply:** When tightening the canonical route guard, keep only
`coordination` and `change-proposals` paths in this exception; do not broaden it
to general requests, Leistung data, or dependencies.