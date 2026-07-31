# Abschlussbericht – Task 4.8: NU-Response API (neue Format-Version)

## Aufgabe
Neuer Endpunkt `POST /api/takt-requests/:id/responses` (Plural) als saubere, datenschutzkonforme Alternative zum bestehenden `/response`-Endpunkt. GU-Inbox wird organisationsneutral gemacht.

## Implementierter Endpunkt

### `POST /api/takt-requests/:id/responses`
- **Berechtigung**: Nur die adressierte NU-Org (AN-Typ); GU, Hub-Admin → 403.
- **Privacy-Filter** (vor Zod-Parsing):
  - Erlaubte Felder: `decision`, `acceptedTimeWindow`, `reasonCode`, `comment`, `alternatives`, `nextAvailableDate`.
  - Verbotene Felder: `resourceId`, `localProjectId`, `internalResultPayload`, `localProjectCode`, `customerAlias`, `resourceName`, `employeeId` u. a. → 400.
  - Unbekannte Felder → 400.
- **Zod-Validierung**:
  - `decision`: ACCEPTED | ALTERNATIVES_PROPOSED | REJECTED
  - `alternatives[].timeWindow.start/end`: flexible Strings (ISO-Datum `YYYY-MM-DD` oder Datetime-String)
  - Max. 3 Alternativen.
- **Idempotenz** (`messageId = taktresponse-{requestId}`):
  - Gleiche Entscheidung → 200, vorhandene Antwort zurückgegeben (kein zweiter DB-Row).
  - Verschiedene Entscheidung → 409.
  - Retry-Pfad liest den bestehenden Outbox-Eintrag direkt (kein Re-Send, um Payload-Mismatches zu vermeiden).
- **Statusübergänge**:
  - DETAILS_RETRIEVED | UNDER_REVIEW → ACCEPTED | ALTERNATIVES_PROPOSED | REJECTED.
- **GU-Benachrichtigung**:
  - `TAKT_RESPONSE_SUBMITTED`-Nachricht via `LocalHubTransport` in GU-Inbox.
  - Payload enthält ausschließlich öffentliche Felder (kein `internalResultPayload`, `resourceId` etc.).

## Inbox-Neutralität
`requireNuOrg` in `messages.ts` wurde zu `requireOrg` erweitert (akzeptiert jetzt AG und AN):
- GU kann jetzt ihre eigene Inbox lesen (200, leer sofern keine GU-Nachrichten).
- Hub-Admin bleibt ausgesperrt (403, kein `orgId`).
- GU kann fremde NU-Nachrichten weiterhin nicht lesen (404).

## Tests
- `takt-response-api.test.ts` – 17 neue Integrationstests:
  - Berechtigungsprüfungen (foreign NU, GU, Hub-Admin → 403)
  - Privacy-Filter (verbotene Felder → 400)
  - Entscheidungen: ACCEPTED, ALTERNATIVES_PROPOSED, REJECTED
  - GU-Inbox erhält `TAKT_RESPONSE_SUBMITTED` ohne interne NU-Felder
  - Idempotenz: identischer Retry → 200, verschiedener → 409, Re-Deliver ohne zweiten Row
- `inbox-api.test.ts` – 3 Tests aktualisiert (GU-Verhalten nach Org-Neutralisierung)

## OpenAPI / Codegen
- Pfad `/takt-requests/{requestId}/responses` ergänzt.
- Schemata: `NuResponseAlternative`, `NuResponseCreate`, `NuResponseResult`.
- Orval-Codegen erfolgreich ausgeführt.

## Status
**Abgeschlossen** – 404/404 Tests grün, Typecheck sauber.
