# Abschlussbericht: Task 6.5 – Neue Überarbeitungsrunde

**Datum:** August 2026  
**Status:** ✅ Abgeschlossen

---

## Neuer Endpunkt

`POST /api/takt-requests/:id/revisions`

**Berechtigung:** GU-Organisation (`requireGuOrg`), muss `guOrgId` des Requests sein.

---

## Neuer Service

**Service:** `artifacts/api-server/src/services/revision-service.ts`  
**Funktion:** `createRevision(params)`

### Parameter

| Feld | Typ | Bedeutung |
|---|---|---|
| `oldRequestId` | string | ID des `REVISION_REQUIRED`-Requests |
| `plannedTimeWindow` | `{start, end}` | Neues Zeitfenster für den Takt |
| `taktUpdates` | optional | Weitere Taktfelder (Beschreibung, etc.) |
| `responseRequiredBy` | optional | Antwortfrist |
| `subject` / `message` | optional | Anschreiben |
| `sendImmediately` | boolean | Sofortversand nach Erstellung |
| `idempotencyKey` | optional | Idempotenz-Schlüssel |

### Transaktionsschritte (atomar)

1. Alten Request laden — muss `REVISION_REQUIRED` sein
2. GU-Entscheidung (`REQUEST_REVISION`) vorhanden prüfen
3. Keinen Nachfolger-Request prüfen (kein `supersedes_request_id` zeigt auf alten Request)
4. Neue `takt_versions` anlegen (`sourceType = REVISION`)
5. Takt mit Optimistic Lock aktualisieren (`planned_start/end`, `version++`, `lifecycle_status = IN_COORDINATION`)
6. Neuen `takt_requests` anlegen (`status = DRAFT`, `supersedesRequestId = oldRequestId`)
7. Neuen Snapshot anlegen
8. Alten Request auf `SUPERSEDED` setzen

### Post-Commit (bei `sendImmediately = true`)

- `TAKT_REQUEST_REVISED`-Nachricht wird über Transport gesendet
- Neuer Request: `status → DELIVERED`, `sentAt`, `deliveredAt` werden gesetzt
- Antwort enthält `sent: true`, `newRequestStatus: "DELIVERED"`
- Transport-Fehler sind **nicht-fatal** — Request bleibt `DRAFT`, Outbox erhält `FAILED`

---

## Fehlerbehandlung

| Fehler | HTTP |
|---|---|
| Request nicht gefunden | 404 |
| Falsche GU-Org | 403 |
| NU-Org-Zugriff | 403 |
| Request nicht in `REVISION_REQUIRED` | 409 |
| Keine `REQUEST_REVISION`-Entscheidung | 400 |
| Nachfolger bereits vorhanden | 409 |
| Optimistic Lock Konflikt | 409 |

---

## API-Antwort

```json
{
  "oldRequestId": "...",
  "oldRequestStatus": "SUPERSEDED",
  "newRequestId": "...",
  "newRequestStatus": "DRAFT",
  "newTaktVersionId": "...",
  "newTaktVersion": 2,
  "sent": false
}
```

---

## OpenAPI

Neue Schemas in `lib/api-spec/openapi.yaml`:
- `RevisionCreate` — Request-Body
- `RevisionResponse` — Antwort-Body
- Pfad: `POST /takt-requests/{requestId}/revisions`

---

## Tests

**Datei:** `artifacts/api-server/src/__tests__/revisions.test.ts` (15 Tests, Fixture-Prefix `t65-`)

| Testgruppe | Inhalt |
|---|---|
| Fehler-Guards | 403, 404, 409 für falsche Org/Status/fehlende Entscheidung |
| Happy Path (sendImmediately=false) | Neuer Request, neue Version, Snapshot, Vorgängerkette, Idempotenz |
| sendImmediately=true | `sent=true`, `DELIVERED`-Status, Inbox-Nachricht |

---

## Vorgängerkette

Die Kette bleibt navigierbar:
```
newRequest.supersedesRequestId → oldRequest.id
oldRequest.status = SUPERSEDED
newVersion.sourceDecisionId → REQUEST_REVISION-Entscheidung
```
