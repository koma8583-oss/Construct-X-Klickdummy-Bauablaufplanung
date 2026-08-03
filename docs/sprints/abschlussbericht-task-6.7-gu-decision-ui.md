# Abschlussbericht Task 6.7 — GU-Entscheidungs-UI im AG-App

## Zusammenfassung

Implementation der vollständigen GU-Entscheidungs-UI in der AG-App. GUs können jetzt alle vier Entscheidungstypen direkt aus der Takt-Anfragendetailseite heraus treffen, ohne Seitenreload oder manuelle API-Aufrufe.

## Implementierte Komponenten

### `artifacts/ag-app/src/components/gu-decision-panel.tsx`
- Vollständige Entscheidungs-UI für alle vier Typen:
  - **CONFIRM_ACCEPTED** — Bestätigt die Originalantwort; Takt wird CONFIRMED
  - **ACCEPT_ALTERNATIVE** — Zeigt Vergleichstabelle aller Alternativen; GU wählt eine aus
  - **REQUEST_REVISION** — Öffnet einen Dialog mit optionalem Kommentar; Takt erhält REVISION_REQUIRED
  - **CLOSE_WITHOUT_AGREEMENT** — Schliesst die Anfrage ohne Einigung
- Bestätigungsdialog vor jeder destruktiven Aktion
- Idempotency-Key-Generierung per `crypto.randomUUID()`
- Transport-Status-Anzeige (ausstehend, zugestellt, fehlgeschlagen)
- Read-only-Ansicht, wenn eine Entscheidung bereits existiert
- Vollständig i18n-fähig (de.json + en.json Schlüssel unter `taktRequestDetail.guDecision.*`)

### `artifacts/ag-app/src/pages/takt-request-detail.tsx`
- `GUDecisionPanel` unterhalb von `ResponsePanel` eingebunden (zeigt nur wenn `detail.response` vorhanden)
- `RevisionTrigger` erscheint in der Response-Sektion wenn `status === 'REVISION_REQUIRED'`

## API-Vertrag

- `POST /api/takt-requests/:id/gu-decisions`
  - Body: `{ decisionType, acceptedAlternativeId?, comment?, idempotencyKey? }`
  - `acceptedAlternativeId` ist die UUID-Spalte `id` der `takt_response_alternatives`-Zeile (nicht der Business-String)
- `GET /api/takt-requests/:id` gibt jetzt `taktLifecycleStatus` und `guDecision` zurück (via Repository-JOIN)

## Codegen

`pnpm --filter @workspace/api-spec run codegen` ausgeführt — `lib/api-client-react/src/generated/api.ts` enthält `taktLifecycleStatus` und `guDecision` in `TaktRequestDetail`.

## Tests

Covered durch Task 6.9 (e2e-coordination-scenarios.test.ts).
