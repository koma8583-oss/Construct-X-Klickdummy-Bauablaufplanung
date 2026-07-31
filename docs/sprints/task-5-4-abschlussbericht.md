# Abschlussbericht: Task 5.4 – GU-Detailseite und Prozess-Zeitleiste

**Datum:** 31. Juli 2026  
**Status:** ✅ Abgeschlossen

---

## Zusammenfassung

Task 5.4 hat die GU-Detailseite für Taktanfragen vollständig implementiert: Backend-Endpoint mit umfassendem Join (Takt, Projekt, NU-Org, Snapshot, Outbox, Inbox, Response), Prozess-Zeitleiste, Snapshot-Vorschau, Notification-Vorschau, Fehlerdarstellung bei FAILED und Aktionsschaltflächen je Status.

---

## Neue Route

**Backend:** `GET /api/takt-requests/:id`  
**Frontend:** `/takt-requests/:requestId`

Zugriff: nur die erstellende GU-Organisation. Andere GU → 404 (kein Existenz-Leak), NU → 404, Hub-Admin → 403, Unauthentifiziert → 401.

---

## Dargestellte Metadaten

Der Kopfbereich zeigt:

| Feld | Quelle |
|---|---|
| Anfragenummer | `takt_requests.requestNumber` |
| Projekt | JOIN → `projects.name` |
| Takt | JOIN → `takte.takt_bezeichnung` |
| Version | `takt_requests.takt_version` |
| Nachunternehmer | JOIN → `organizations.name` (NU) |
| Antwortfrist | `takt_requests.response_required_by` (mit Überfällig-Anzeige) |
| Fachlicher Status | `takt_requests.status` (amber/grün/rot Badge) |
| Technischer Status | `message_outbox.status` (blau/indigo/violet Badge, visuell getrennt) |

---

## Aufbau der Prozess-Zeitleiste

Die Zeitleiste zeigt 9 Ereignisse; vorhandene werden mit Zeitstempel und Häkchen dargestellt, fehlende als grau/„Ausstehend":

| Ereignis | Datenquelle |
|---|---|
| Anfrage erstellt | `takt_requests.created_at` |
| Snapshot erzeugt | `takt_request_snapshots.created_at` |
| Nachricht versendet | `takt_requests.sent_at` |
| Nachricht zugestellt | `takt_requests.delivered_at` |
| Nachricht gelesen | `message_inbox.read_at` (LEFT JOIN per messageId) |
| Taktdetails abgerufen | `takt_requests.details_retrieved_at` |
| Prüfung gestartet | — nicht aus GU-Sicht erfasst → Anzeige: „Nicht erfasst" |
| Antwort eingegangen | `takt_responses.created_at` |
| Entscheidung getroffen | `takt_responses.created_at` (Entscheidung und Antwort sind dasselbe Ereignis) |

Unverhanden = grau, kein erfundener Zeitstempel, keine falsche Prozessvollständigkeit.

---

## Snapshot- und Notification-Trennung

**Snapshot-Vorschau:**
- Zeigt: Schema-Version, Taktversion, Zeitraum, Gewerk, Arbeitspaket, Ort, Ressourcenanforderungen, Randbedingungen, Dokumentreferenzen
- Deutliche Immutabilitäts-Kennzeichnung: „Dieser Snapshot ist unveränderlich und entspricht dem Stand beim Erstellen der Anfrage."
- Quelle: `takt_request_snapshots.snapshot_payload` (JSONB)

**Notification-Vorschau (getrennt):**
- Zeigt: Betreff, Nachricht, Projektreferenz, Taktreferenz, Antwortfrist, Detailreferenz
- Quelle: `message_outbox.payload` (die tatsächlich versendete Notification)
- Keine vollständigen Takt-Daten — nur das minimale Notification-Payload
- Beide Sektionen nebeneinander im gleichen Layout, aber als eigenständige Cards

---

## Retry-Darstellung bei FAILED

Wenn `transport.status === 'FAILED'`:
- Roter Fehler-Banner mit:
  - `failureReason` (verständlich formatiert, kein interner Stacktrace)
  - Anzahl Zustellversuche (`attemptCount`)
  - Zeitpunkt des letzten Versuchs (`lastAttemptAt`)
- Schaltfläche „Erneut zustellen" erscheint im Aktionsbereich

Bei anderen Status ist der Fehler-Banner nicht sichtbar.

---

## Berechtigungen

| Aufrufer | Ergebnis |
|---|---|
| Eigene GU-Organisation | 200 mit vollem Detail |
| Andere GU | 404 (kein Existenz-Leak) |
| NU | 404 |
| Hub-Admin | 403 |
| Unauthentifiziert | 401 |

Hub-Admins erhalten keine Snapshot-Vorschau (403 bereits am Endpoint).

---

## Aktionen je Status

| Status | Aktionen |
|---|---|
| DRAFT | Senden |
| Offene Stati + FAILED Outbox | Erneut zustellen |
| ALTERNATIVES_PROPOSED, ACCEPTED | Antwort anzeigen |
| Alle offenen (außer DRAFT) | Stornieren |
| Terminal (außer CANCELLED) | Neue Version erstellen (deaktiviert, Hinweis) |

„Neue Version erstellen" erscheint als deaktivierte Schaltfläche mit erklärendem Hinweis — keine funktionslose Schaltfläche ohne Kennzeichnung.

---

## Testergebnisse

**`artifacts/api-server/src/__tests__/takt-request-detail.test.ts`** (12 Tests)

| Test | Ergebnis |
|---|---|
| 401 ohne Token | ✅ |
| Hub-Admin → 403 | ✅ |
| Fremde GU → 404 | ✅ |
| NU → 404 | ✅ |
| Nicht-existierende ID → 404 | ✅ |
| GU öffnet eigene Anfrage — alle Pflichtfelder | ✅ |
| Fachlicher und technischer Status getrennt | ✅ |
| Timeline-Zeitstempel korrekt | ✅ |
| Snapshot vorhanden und korrekt | ✅ |
| Snapshot und Notification als getrennte Felder | ✅ |
| Keine internen NU-Daten | ✅ |
| Response = null ohne Antwort | ✅ |

**Gesamt: 428/428 Tests bestanden ✅**

---

## Typecheck

```
artifacts/hub-app typecheck: Done
artifacts/api-server typecheck: Done
artifacts/an-app typecheck: Done
scripts typecheck: Done
artifacts/ag-app typecheck: Done
artifacts/mockup-sandbox typecheck: Done
```

Keine Fehler.

---

## Nicht in Scope

- Tatsächliches Senden/Stornieren via Schaltflächen (Stubs ohne Aktion vorhanden)
- Paginierung älterer Anfragen
- Benachrichtigung bei neuem Response (wird via Polling in der Übersicht abgedeckt)
