# Abschlussbericht: Task 6.3 – Service und REST-Endpunkt für GU-Entscheidungen

**Datum:** August 2026  
**Status:** ✅ Abgeschlossen

---

## Neuer Service und Endpunkt

**Service:** `artifacts/api-server/src/services/gu-decision-service.ts`  
**Endpunkt:** `POST /api/takt-requests/:id/gu-decisions`

---

## Entscheidungsregeln

| NU-Response | Erlaubte GU-Entscheidungen |
|---|---|
| ACCEPTED | CONFIRM_ACCEPTED, REQUEST_REVISION, CLOSE_WITHOUT_AGREEMENT |
| ALTERNATIVES_PROPOSED | ACCEPT_ALTERNATIVE, REQUEST_REVISION, CLOSE_WITHOUT_AGREEMENT |
| REJECTED | REQUEST_REVISION, CLOSE_WITHOUT_AGREEMENT |

`CONFIRM_ACCEPTED` auf `REJECTED` → 400  
`ACCEPT_ALTERNATIVE` auf `ACCEPTED` oder `REJECTED` → 400  
`ACCEPT_ALTERNATIVE` ohne `acceptedAlternativeId` → 400  
`acceptedAlternativeId` auf anderer Entscheidungstyp → 400  
Alternative aus fremder Response → 400

---

## Statusänderungen

| Entscheidungstyp | Requeststatus-Übergang | Takt-Lifecycle |
|---|---|---|
| CONFIRM_ACCEPTED | Bleibt ACCEPTED | → CONFIRMED |
| ACCEPT_ALTERNATIVE | ALTERNATIVES_PROPOSED → ACCEPTED | → CONFIRMED |
| REQUEST_REVISION | → REVISION_REQUIRED | unverändert |
| CLOSE_WITHOUT_AGREEMENT | → CANCELLED | → PLANNED (reset) |

**Takt wird NICHT auf CANCELLED gesetzt** beim Schließen ohne Vereinbarung — nur auf PLANNED zurückgesetzt.

---

## Transaktionsverhalten

Die folgenden Schritte erfolgen atomar in einer Drizzle-Transaktion:
1. GU-Entscheidung in `takt_response_decisions` speichern
2. `takt_requests.status` aktualisieren (nur wenn Übergang nötig)
3. `takte.lifecycle_status` aktualisieren (für CONFIRM_ACCEPTED, ACCEPT_ALTERNATIVE, CLOSE_WITHOUT_AGREEMENT)

---

## Idempotenz

| Szenario | Verhalten |
|---|---|
| Gleicher Key + gleicher Inhalt | 200, vorhandene Entscheidung, `idempotent: true` |
| Gleicher Key + anderer Inhalt | 409 GuDecisionIdempotencyConflict |
| Zweite Entscheidung für dieselbe Response | 409 GuDecisionError |
| Kein Key, zweiter Versuch | 409 GuDecisionError |

Idempotency-Key kann entweder im `Idempotency-Key` HTTP-Header oder im Body-Feld `idempotencyKey` übergeben werden. Body hat Vorrang.

---

## Berechtigungen

| Aufrufer | Ergebnis |
|---|---|
| GU-Organisation des TaktRequests | 201/200 |
| Andere GU-Organisation | 403 |
| NU (AN) | 403 |
| Hub-Admin | 403 |
| Unauthentifiziert | 401 |

---

## OpenAPI

Neue Schemas: `GuDecisionCreate`, `GuDecisionResponse`  
Neuer Pfad: `POST /takt-requests/{requestId}/gu-decisions`  
Codegen: ✅ `useCreateGuDecision()` Hook generiert

---

## Testergebnisse

**`gu-decisions.test.ts`** (20 Tests):

| Gruppe | Tests | Ergebnis |
|---|---|---|
| Auth Guards | 401 ohne Token, 403 NU, 403 Hub, 403 fremde GU, 404 unbekannte ID | ✅ 5/5 |
| Entscheidungstyp-Validierung | no response, CONFIRM auf REJECTED, ACCEPT_ALT auf REJECTED, ACCEPT_ALT auf ACCEPTED, keine altId, fremde altId | ✅ 6/6 |
| Happy Path | CONFIRM_ACCEPTED, ACCEPT_ALTERNATIVE, REQUEST_REVISION, CLOSE_WITHOUT_AGREEMENT, Takt nicht CANCELLED | ✅ 5/5 |
| Idempotenz | zweiter Versuch → 409, zweiter abweichender → 409, gleicher Key → 200, gleicher Key anderer Inhalt → 409 | ✅ 4/4 |

**Gesamt: 456/456 Tests bestanden ✅**

---

## Codegenerierung, Typecheck, Build

```
Codegen (orval): ✅ useCreateGuDecision() generiert
Typecheck: alle Artefakte Done ✅
Tests: 456/456 ✅
```

---

## Noch nicht in Scope (folgt in 6.4)

- Automatische Übernahme der Alternative in den Takt (neue `takt_versions`-Eintrag)
- Erstellung einer neuen Abstimmungsrunde nach REQUEST_REVISION
- Transportnachricht an den NU über die GU-Entscheidung
- UI-Änderungen
