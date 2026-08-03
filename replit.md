# Takt Coordination Flow – Federated Dataspace PoC

A proof-of-concept for federated Takt coordination in construction projects. A Generalunternehmer (GU) or Generalplaner creates a complete Takt schedule and delegates individual Takte to Nachunternehmer (NU) for review. The NU checks the request against their local resource plan and responds with an acceptance, alternative proposal, or rejection. The information exchange is currently simulated via REST APIs and JSON messages; the architecture is designed so the local transport layer can later be replaced by an Eclipse Dataspace Connector (EDC) without changing the domain logic or message contracts.

## Planned coordination flow

1. GU sends a Takt-request notification (push).
2. NU retrieves the released Takt details (pull).
3. NU checks the Takt against its local resource plan.
4. NU confirms, proposes alternatives, or rejects (push).
5. GU receives the response and acts on it.

Currently there is no real dataspace. The exchange is simulated with REST endpoints, JSON messages, and the shared Hub component.

---

## Projektname / Product

**TaktKoord** — Takt Coordination Flow

### High-level capabilities

- Taktplanung durch Generalunternehmer und Generalplaner (vollständiger Taktplan beim GU)
- Abstimmung mit mehreren Nachunternehmern (pro Takt je ein adressierter NU)
- Dezentrale Datenhaltung: GU hält den Taktplan, NU hält die Ressourcenplanung, Hub hält nur Nachrichten
- Lokale Ressourcenprüfung beim NU gegen seine eigene Planung
- Push einer Benachrichtigung vom GU an den NU (TaktRequest-Notification)
- Pull der freigegebenen Taktdetails durch den NU
- Push einer Antwort vom NU an den GU (TaktResponse)
- Spätere Ersetzbarkeit des lokalen HTTP-Transports durch EDC (Eclipse Dataspace Connector)

---

## Architecture rules (binding)

1. The GU owns the complete Takt schedule.
2. The NU owns their complete local resource plan.
3. The Hub holds no complete project or resource data — only messages and transport metadata.
4. The GU may not retrieve internal resource data of the NU.
5. The NU may not retrieve the full Takt schedule.
6. The NU receives only the Takt details that have been explicitly released for them.
7. Data of other NU organisations must not be disclosed.
8. Data of other GU clients of the NU must not be disclosed.
9. Domain logic and transport logic must remain separated.
10. No EDC, DSP, Wallet, or Verifiable Credential is implemented in this PoC.

---

## Term mapping

| Current code term      | Future domain term    | Notes                                              |
| ---------------------- | --------------------- | -------------------------------------------------- |
| `AG`                   | `GU`                  | Auftraggeber ≙ Generalunternehmer/Generalplaner    |
| `AN`                   | `NU`                  | Auftragnehmer ≙ Nachunternehmer                    |
| `Delegation`           | `TaktRequest`         | The act of assigning a Takt to a NU for review     |
| Delegation response    | `TaktResponse`        | The NU's answer (confirm/alternative/reject)       |
| Hub message            | `DataspaceMessage`    | Envelope carrying typed payloads through the Hub   |
| Resource assignment    | `ResourceBooking`     | NU-internal assignment of a resource to a Takt     |

No global code rename is performed in this step. Both term sets may appear in the codebase; the mapping above is the authoritative reference.

---

## Domain objects

| Object                    | Description                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Project**               | A construction project owned by a GU organisation. Contains the Takt schedule and a list of invited NUs.    |
| **Takt**                  | One schedule entry (cycle) within a project. Has trade (`gewerk`), zone, planned dates, and status.          |
| **ProjectContractor**     | A project-scoped assignment of an AN organisation to a GU project. Has status (PLANNED/ACTIVE/INACTIVE/COMPLETED/CANCELLED), trade, work package reference, and validity period. Only ACTIVE assignments may receive TaktRequests. |
| **TaktRequest**           | (current: `Delegation`) A request from GU to NU to take on a specific Takt. Contains the requested window.  |
| **TaktRequestSnapshot**   | An immutable copy of the Takt data at the moment of the request.                                             |
| **TaktResponse**          | (current: `DelegationResponse`) The NU's answer — confirmed, alternative proposed, or rejected.              |
| **TaktResponseAlternative** | A ranked alternative time window proposed by the NU when it cannot accept the original window.             |
| **DataspaceMessage**      | (current: `HubMessage`) Transport envelope with typed payload, routing IDs, and correlation/causation IDs.   |
| **Resource**              | An AN-owned entity (employee, equipment, machine, other) used in resource planning.                          |
| **ResourceBooking**       | (current: `ResourceAssignment`) An NU-internal assignment of a resource to a TaktRequest period.             |
| **AvailabilityCheck**     | NU-local check of resource availability for a requested window. Not exposed externally. Planned for later.   |

---

## Development rules

- Extend the existing architecture; do not start over.
- OpenAPI (`lib/api-spec/openapi.yaml`) is the single source of truth for all API contracts.
- Never edit generated files manually (`lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/`).
- Existing `Delegation` endpoints must not be removed.
- New features are added incrementally.
- All timestamps use ISO 8601 format; internally UTC.
- Typecheck and build must pass after every change.

---

## Where things live

```
lib/
  api-spec/          OpenAPI 3.1 spec (source of truth)
  api-client-react/  Generated React Query hooks (do not edit)
  api-zod/           Generated Zod schemas (do not edit)
  db/                Drizzle ORM schema + migrations

artifacts/
  ag-app/            GU (Auftraggeber) React/Vite SPA  →  /
  an-app/            NU (Nachunternehmer) React/Vite SPA  →  /an/
  hub-app/           Hub / Koordination React/Vite SPA  →  /hub/
  api-server/        Express 5 API server (port 8080)

docs/
  data-ownership.md  Roles, data sovereignty, and privacy rules
  json-contracts.md  Canonical JSON examples for all message types
  message-flow.md    End-to-end message flow documentation
```

---

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Auth: JWT (HS256, `jsonwebtoken`) + httpOnly refresh cookie

---

## Run & Operate

```bash
# Install
pnpm install

# Development — start all services (run each in a separate terminal)
pnpm --filter @workspace/api-server run dev          # API server (port 8080)
pnpm --filter @workspace/ag-app run dev              # GU app
pnpm --filter @workspace/an-app run dev              # NU app
pnpm --filter @workspace/hub-app run dev             # Hub app

# OpenAPI code generation (run after every openapi.yaml change)
pnpm --filter @workspace/api-spec run codegen

# Database schema push (development only — never against production)
pnpm --filter @workspace/db run push

# Typecheck (all packages)
pnpm run typecheck

# Build (typecheck + bundle all packages)
pnpm run build

# Tests
# No automated test suite is currently configured.
# Schema validation is performed via the generated Zod schemas.
```

---

## Architecture decisions

- **Single API server** — all three frontends (AG/GU, AN/NU, Hub) share one Express server. Isolation is enforced by JWT `orgType` claims and route-level guards, not by separate services.
- **JWT auth with refresh rotation** — access token (15 min), httpOnly refresh cookie (7 days), stored in `refresh_tokens` table. Centralised at `/auth-service/*`.
- **OpenAPI-first** — `lib/api-spec/openapi.yaml` drives both the React Query hooks and the Zod validation schemas. Never modify generated output.
- **Flat explicit schemas over `allOf`** — Orval's `allOf` support is inconsistent; typed message schemas are defined as explicit flat objects referencing base enums and payload schemas.
- **No EDC in PoC** — Transport is plain HTTPS/JSON. The architecture keeps domain logic and transport separate so EDC can be substituted later without touching business rules.

---

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

---

## Gotchas

- After every `openapi.yaml` change, run `pnpm --filter @workspace/api-spec run codegen` before typechecking.
- `lib/db` uses TypeScript project references; run `pnpm exec tsc -p lib/db/tsconfig.json` after schema changes to regenerate `dist/*.d.ts`.
- The fetch interceptor in each app's `main.tsx` uses `new Headers(init?.headers)` — never spread a `Headers` instance with `...` (silently drops headers).
- Always restart the `artifacts/api-server: API Server` workflow after backend changes.

---

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- OpenAPI spec: `lib/api-spec/openapi.yaml`
- DB schema: `lib/db/src/schema/`
- Auth service: `artifacts/api-server/src/routes/auth-service.ts`
- JWT middleware: `artifacts/api-server/src/middlewares/requireJwt.ts`
