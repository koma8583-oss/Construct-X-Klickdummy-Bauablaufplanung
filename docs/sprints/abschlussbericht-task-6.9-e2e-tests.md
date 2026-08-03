# Abschlussbericht Task 6.9 — End-to-End-Tests Koordinationsszenarien

## Zusammenfassung

Vollständige E2E-Testabdeckung aller fünf Koordinationsszenarien in `e2e-coordination-scenarios.test.ts`. **526/526 Tests bestehen** nach Abschluss dieser Aufgabe.

## Testdatei

`artifacts/api-server/src/__tests__/e2e-coordination-scenarios.test.ts`

## Abgedeckte Szenarien

### Szenario A — CONFIRM_ACCEPTED (t69-A1 bis A7)
- GU bestätigt Originalantwort → Takt wird CONFIRMED
- Keine neuen takt_versions-Zeilen wenn Daten gleich bleiben
- TAKT_RESPONSE_ACCEPTED-Nachricht im Outbox
- Idempotenter Retry mit gleichen Key → 200 (idempotent: true)
- Zweiter Entscheid mit anderem Key → 409
- Keine NU-internen Daten im Nachrichteninhalt

### Szenario B — ACCEPT_ALTERNATIVE (t69-B1 bis B5)
- GU akzeptiert eine Alternative → Takt CONFIRMED, Version 2
- Neue takt_versions-Zeile mit sourceType=ACCEPTED_ALTERNATIVE
- Takt-Zeitfenster auf akzeptierte Alternative aktualisiert
- Nicht ausgewählte Alternative bleibt in DB erhalten

### Szenario C — REQUEST_REVISION → createRevision → erneute Runde (t69-C1 bis C8)
- GU verlangt Revision → Anfrage in REVISION_REQUIRED
- GU erstellt neue Revision (sendImmediately:true) → neue Anfrage DELIVERED, Takt v2
- Alte Anfrage ist SUPERSEDED, neue verweist auf Vorgänger
- takt_versions-Zeile mit sourceType=REVISION
- NU bestätigt Version 2 → GU akzeptiert → Takt CONFIRMED

### Szenario D — REJECTED → REQUEST_REVISION (t69-D1 bis D3)
- GU verlangt Revision nach Ablehnung → REVISION_REQUIRED
- GU erstellt neue Revision (sendImmediately:false) → DRAFT
- Alte Antwort und Entscheidung bleiben unverändert

### Szenario E — CLOSE_WITHOUT_AGREEMENT (t69-E1 bis E5)
- GU schliesst ohne Einigung → Request CANCELLED
- Takt bleibt PLANNED/IN_COORDINATION (nicht automatisch storniert)
- TAKT_REQUEST_CANCELLED-Nachricht im Outbox, keine internen NU-Daten

### Datenintegrität (t69-I1 bis I4)
- Jede Antwort hat höchstens eine GU-Entscheidung (UNIQUE-Constraint)
- takt_versions: eindeutige (taktId, version)-Paare
- takt_versions: kein updatedAt (write-once)
- Anfragekette: jede supersedesRequestId zeigt auf SUPERSEDED-Anfrage

## Behobene Fehler während der Implementierung

| Problem | Ursache | Fix |
|---|---|---|
| `organizations` INSERT NOT NULL | Falsche Feldname `orgType` statt `type` | Korrigiert zu `type: "AG" as const` |
| `project_contractors` NOT NULL | Falscher Feldname `contractorOrgId` statt `anOrgId` | Korrigiert |
| Globale `taktResponseAlternatives`-Löschungen | `execute()` ohne WHERE-Klausel | Ersetzt durch gefilterte `inArray`-Löschungen |
| 401 bei allen API-Aufrufen | Named import `{ app }` statt Default-Import | Korrigiert zu `import app from "../app"` |
| 400 beim Erstellen von Anfragen via API | API-basierter Setup ist fragil | Auf direkte DB-Einfügungen umgestellt (etabliertes Muster) |
| 400 bei NU-Antwort-Body | Falscher Feldname `acceptedStart` statt `acceptedTimeWindow` | Korrigiert; alternatives brauchen `alternativeId` + `timeWindow.{start,end}` |
| 400 bei GU ACCEPT_ALTERNATIVE | `acceptedAlternativeId` ist row-UUID nicht Business-Key | UUID direkt aus DB abgefragt |
| 409 bei C8 NU-Antwort | req-c2 in DELIVERED-Status, nicht UNDER_REVIEW | Status vor `nuSubmitResponse` auf UNDER_REVIEW gesetzt |
| 7 statt 2 Alternativen in B5 | Globaler SELECT ohne Filter | Gefiltert nach `alternativeId IN ["ALT-t69-1", "ALT-t69-2"]` |

## Fixture-Konventionen (Prefix t69-)

Alle Fixture-IDs verwenden `t69-*` Prefix um Kollisionen mit anderen Testdateien zu vermeiden. Cleanup ist immer gefiltert (nie global). Tokens werden via `jwt.sign()` direkt erstellt (kein API-Login), entsprechend dem etablierten Muster aller anderen Testdateien.
