# Abschlussbericht: Task 6.6 – Transport-Nachrichten für GU-Entscheidungen und Revisionen

**Datum:** August 2026  
**Status:** ✅ Abgeschlossen

---

## Neue Nachrichtentypen

Alle Nachrichten werden **post-commit** über `LocalHubTransport` gesendet.  
Transport-Fehler sind **nicht-fatal** — die Entscheidung/Version bleibt committed, Outbox erhält `FAILED`.

---

## GU-Entscheidungen (`gu-decision-service.ts`)

Hilfsfunktion: `sendGuDecisionMessage()` — wird nach der Transaktion aufgerufen.

| Entscheidungstyp | Nachrichtentyp | Empfänger |
|---|---|---|
| `CONFIRM_ACCEPTED` | `TAKT_RESPONSE_ACCEPTED` | NU |
| `ACCEPT_ALTERNATIVE` | `TAKT_RESPONSE_ACCEPTED` | NU |
| `REQUEST_REVISION` | `TAKT_RESPONSE_REVISION_REQUESTED` | NU |
| `CLOSE_WITHOUT_AGREEMENT` | `TAKT_REQUEST_CANCELLED` | NU |

---

## Revisions-Nachrichten (`revision-service.ts`)

| Aktion | Nachrichtentyp | Bedingung |
|---|---|---|
| Neue Überarbeitungsrunde erstellt | `TAKT_REQUEST_REVISED` | nur wenn `sendImmediately = true` |

---

## Payload-Schemata (OpenAPI)

### `TAKT_RESPONSE_ACCEPTED`
```json
{
  "taktRequestId": "...",
  "decisionType": "CONFIRM_ACCEPTED | ACCEPT_ALTERNATIVE",
  "acceptedAlternativeId": "... | null",
  "taktVersion": 2,
  "confirmedStart": "2026-10-01",
  "confirmedEnd": "2026-10-07"
}
```
**Kein** NU-internes Datum (resourceId, internalCost, etc.).

### `TAKT_RESPONSE_REVISION_REQUESTED`
```json
{
  "taktRequestId": "...",
  "comment": "Bitte neuen Zeitraum vorschlagen"
}
```

### `TAKT_REQUEST_CANCELLED`
```json
{
  "taktRequestId": "...",
  "reason": "CLOSE_WITHOUT_AGREEMENT",
  "comment": "..."
}
```
**Kein** Geschäftsdatum (Zeitfenster, Ressourcen).

### `TAKT_REQUEST_REVISED`
```json
{
  "taktRequestId": "...",
  "supersedesRequestId": "...",
  "previousTaktVersion": 1,
  "taktVersion": 2,
  "projectReference": "...",
  "taktReference": "...",
  "responseRequiredBy": "...",
  "detailsRef": "/takt-requests/.../details"
}
```

---

## Datenschutz-Regeln

| Nachrichtentyp | Enthaltene Daten | Verboten |
|---|---|---|
| `TAKT_RESPONSE_ACCEPTED` | Bestätigtes Zeitfenster, Versionsnummer | NU-interne Ressourcendaten |
| `TAKT_RESPONSE_REVISION_REQUESTED` | Kommentar | Zeitfenster, Ressourcen |
| `TAKT_REQUEST_CANCELLED` | Grund-Enum, Kommentar | Volles Snapshot, Geschäftsdaten |
| `TAKT_REQUEST_REVISED` | Referenzen, Versionsnummern, `detailsRef` | Vollständiges Snapshot-Payload |

---

## Idempotenz

`messageId` wird deterministisch aus `decisionId` und `messageType` gebildet:
```
takt-decision-{decisionId}-accepted
takt-decision-{decisionId}-revision
takt-decision-{decisionId}-cancelled
takt-revised-{newRequestId}
```

Ein zweiter Sendeversuch mit derselben `messageId` wird von `LocalHubTransport` als idempotente Wiederholung behandelt — keine Doppelzustellung.

---

## Tests

**Datei:** `artifacts/api-server/src/__tests__/gu-decision-transport.test.ts` (12 Tests, Fixture-Prefix `t66-`)

| Testgruppe | Inhalt |
|---|---|
| CONFIRM_ACCEPTED | Genau eine Outbox-Nachricht, NU-Inbox erhält Nachricht, Payload korrekt (keine internen Daten), Idempotenz |
| ACCEPT_ALTERNATIVE | `acceptedAlternativeId` in Payload |
| REQUEST_REVISION | `TAKT_RESPONSE_REVISION_REQUESTED` in NU-Inbox |
| CLOSE_WITHOUT_AGREEMENT | `TAKT_REQUEST_CANCELLED`, nur erlaubte Felder |

---

## Architekturentscheidungen

- Transport-Fehler sind **immer nicht-fatal** nach Commit — der fachliche Zustand ist bereits gespeichert
- Kein Retry im Service — der Outbox-Relay (falls vorhanden) übernimmt Zustellung
- Kein vollständiger Snapshot in GU→NU-Nachrichten — NU ruft Details über `detailsRef` ab
