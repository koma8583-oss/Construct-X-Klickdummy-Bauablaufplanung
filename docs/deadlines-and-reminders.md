# Fristen und Erinnerungen

> **Stand: Tasks 7.1–7.8 — vollständig implementiert**

---

## 1  Überblick

Das Frist- und Erinnerungssystem verwaltet den gesamten Deadline-Lebenszyklus von TaktAnfragen:

| Aufgabe | Beschreibung |
|---------|--------------|
| Fristüberwachung | Automatischer Worker prüft offene Anfragen regelmäßig |
| Erinnerungsversand | Benachrichtigungen an NU (Antwortfrist) und GU (Entscheidungsfrist) |
| Automatischer Ablauf | Anfragen in `SENT`/`DELIVERED`/`DETAILS_RETRIEVED` laufen nach `expiresAt` ab |
| Frontend-Anzeige | Alle Apps zeigen Friststatus als Badge + Karte |

---

## 2  Datenbankfelder (Task 7.2)

### `takt_requests` — neue Spalten

| Spalte | Typ | Bedeutung |
|--------|-----|-----------|
| `expires_at` | `TIMESTAMPTZ` | Harter Ablaufzeitpunkt = `responseRequiredBy + gracePeriod` |
| `expired_at` | `TIMESTAMPTZ` | Gesetzt wenn die Anfrage tatsächlich abgelaufen ist |
| `last_reminder_at` | `TIMESTAMPTZ` | Zeitstempel der letzten gesendeten Erinnerung |
| `reminder_count` | `INTEGER NOT NULL DEFAULT 0` | Gesamtzahl versendeter Erinnerungen |
| `gu_decision_required_by` | `TIMESTAMPTZ` | Frist für die GU-Entscheidung nach NU-Antwort |

### `takt_request_reminders` — neue Tabelle

Speichert jeden Erinnerungsauftrag mit Deduplizierungsschlüssel.

```
(takt_request_id, reminder_type, deduplication_key)  — UNIQUE
```

### `hub_messages` — neue Spalten und Enum-Werte

- Neue Spalte: `correlation_id TEXT` (verknüpft Nachrichten mit ihrer TaktRequest-ID)
- Neue Enum-Werte: `TAKT_REQUEST_EXPIRED`, `TAKT_REQUEST_REMINDER`

---

## 3  Komponenten (Tasks 7.3–7.6)

### Deadline-Konfiguration (`deadline-config.ts`)

Alle Werte als Umgebungsvariablen konfigurierbar:

| Variable | Standard | Bedeutung |
|----------|---------|-----------|
| `DEADLINE_WORKER_ENABLED` | `false` | Worker aktivieren |
| `DEADLINE_WORKER_INTERVAL_MINUTES` | `5` | Polling-Intervall |
| `FIRST_REMINDER_HOURS_BEFORE_DUE` | `48` | `RESPONSE_DUE_SOON` |
| `SECOND_REMINDER_HOURS_BEFORE_DUE` | `8` | `RESPONSE_DUE_TODAY` |
| `OVERDUE_REMINDER_HOURS_AFTER_DUE` | `24` | `RESPONSE_OVERDUE` |
| `EXPIRATION_GRACE_PERIOD_HOURS` | `48` | Kulanzzeit nach `responseRequiredBy` |
| `GU_DECISION_REMINDER_HOURS` | `24` | `GU_DECISION_DUE_SOON` |
| `MAX_REMINDERS_PER_TYPE` | `1` | Duplikat-Deckel pro Typ |

### Evaluierungsservice (`deadline-evaluation-service.ts`)

Zwei Phasen pro Lauf:
1. **NU-Erinnerungen** für `REMINDER_ELIGIBLE` = `SENT | DELIVERED | DETAILS_RETRIEVED | UNDER_REVIEW`
2. **GU-Entscheidungserinnerungen** für `GU_DECISION_ELIGIBLE` = `ACCEPTED | ALTERNATIVES_PROPOSED`

### Externer Benachrichtigungsanbieter (`external-notification-provider.ts`)

- `LoggingExternalNotificationProvider` — nur Logging, kein echter Versand (Dev/Test)
- `InAppNotificationProvider` — schreibt in `message_outbox` für In-App-Zustellung
- Deutsche Nachrichtentexte für alle 6 Erinnerungstypen

### Lokaler Worker (`local-deadline-worker.ts`)

- PostgreSQL Advisory Lock `pg_try_advisory_lock(7272727272)` verhindert Doppelausführung
- `unref()`'d Intervall: Worker blockiert nicht den Node.js-Exit
- `startDeadlineWorker()` / `stopDeadlineWorker()`

### Interner Endpunkt (`/internal/jobs/deadlines/run`)

- `POST /internal/jobs/deadlines/run` — manueller Auslöser
- In Produktion blockiert, es sei denn `INTERNAL_ROUTES_ENABLED=true`
- Optionaler `now`-Parameter (nur außerhalb Produktion)

---

## 4  6 Erinnerungstypen

| Typ | Auslöser | Empfänger |
|-----|---------|-----------|
| `RESPONSE_DUE_SOON` | `now >= due - 48h && now < due` | NU |
| `RESPONSE_DUE_TODAY` | `now >= due - 8h && now < due` | NU |
| `RESPONSE_OVERDUE` | `now >= due + overdueHours` | NU |
| `GU_DECISION_DUE_SOON` | `now >= guDue - 24h && now < guDue` | GU |
| `GU_DECISION_OVERDUE` | `now >= guDue` | GU |
| `DELIVERY_FAILED` | Transport-Fehler | intern |

---

## 5  Zustandsregeln

### 5.1  Auto-Ablauf

Nur `SENT`, `DELIVERED`, `DETAILS_RETRIEVED` werden automatisch abgelaufen.

### 5.2  Deduplizierung

`deduplicationKey = "<requestNumber>:<reminderType>:<YYYY-MM-DD>"`

Ein vorhandener Row (jeder Status) blockiert einen neuen Insert. `onConflictDoNothing()` stellt sicher, dass keine Ausnahme geworfen wird.

### 5.3  Transport nach Transaktion

`transport.send()` wird **immer nach** `db.transaction()` aufgerufen — nie darin. Andernfalls entsteht ein verschachtelter Verbindungsdeadlock.

### 5.4  UNDER_REVIEW → kein automatischer Ablauf

`UNDER_REVIEW` wird bewusst ausgeschlossen: Der NU hat mit der Prüfung begonnen; automatisches Ablaufen würde begonnene Arbeit verwerfen. Stattdessen: `RESPONSE_OVERDUE`-Erinnerung senden.

### 5.5  GU-Entscheidungserinnerungen

Nur für `ACCEPTED` und `ALTERNATIVES_PROPOSED` — d.h. der NU hat bereits geantwortet. Diese werden in Phase 2 der Evaluierung separat verarbeitet.

---

## 6  Frontend (Task 7.7)

### AG-App

- **`DeadlineStatusBadge`** — kompaktes Badge in der Anfragenliste (Friststatus)
- **`DeadlineCard`** — Detailkarte auf der Einzelansicht (Antwortfrist, Ablauf, GU-Frist, Erinnerungen)
- **Fristen-Filter** in der Liste: Alle / Bald fällig / Heute fällig / Überfällig / Abgelaufen / GU-Entscheidung ausstehend / Zustellung fehlgeschlagen
- **Dreistufiges Status-Modell**: fachlicher Requeststatus | Friststatus | technischer Nachrichtenstatus (visuell getrennt)

### AN-App

- **`/takt-requests`** — neue Inbox-Seite für NU-TaktAnfragen
- Zeigt: Antwortfrist, Friststatus, eingegangene Erinnerungen, ob eine Antwort noch möglich ist
- Abgelaufene Anfragen: Antwort-Button deaktiviert, Hinweis „Antwortfrist überschritten"
- Filtert nach Friststatus und Anfragestatus

### Hub-App

- Neue Nachrichtentypen: `TAKT_REQUEST_EXPIRED`, `TAKT_REQUEST_REMINDER` in Filter + Tabelle
- Neue Spalte: Korrelations-ID (verknüpft Nachrichten mit TaktRequest)
- Nachrichtendetail-Seite unterstützt neue Typen
- Kein Anzeigen von: Snapshots, NU-Ressourcen, internen Konflikten

---

## 7  Datensouveränität

Erinnerungs- und Ablauf-Payloads enthalten **keine** NU-internen Felder:
`snapshotPayload`, `resourcePlanning`, `internalResultPayload`, `localProjectId`,
`customerAlias`, `resourceId`, `employeeName`, `internalCost`, `internalPriority`

Der `deduplicationKey` enthält nur: `requestNumber`, `reminderType`, Datum.

---

## 8  Demo-Seed-Daten (Task 7.8)

`scripts/seed-demo-deadlines.ts` erstellt 6 Demo-Szenarien:

| Szenario | Beschreibung |
|----------|--------------|
| A | Fällig in 48h — `RESPONSE_DUE_SOON` |
| B | Heute fällig — `RESPONSE_DUE_TODAY` |
| C | Überfällig in Kulanzzeit — `RESPONSE_OVERDUE` |
| D | Abgelaufen — Status `EXPIRED` |
| E | GU-Entscheidung überfällig — `GU_DECISION_OVERDUE` |
| F | Erinnerungs-Zustellung fehlgeschlagen — `DELIVERY_FAILED` |

---

## 9  Tests (Task 7.8)

| Testdatei | Tests | Beschreibung |
|-----------|-------|--------------|
| `deadline-schema.test.ts` | 9 | DB-Schema-Validierung |
| `deadline-evaluation-service.test.ts` | 17 | Evaluierungslogik |
| `external-notification-provider.test.ts` | 12 | Benachrichtigungsanbieter |
| `deadline-idempotency.test.ts` | 12 | Idempotenz, Concurrency, Datensouveränität, E2E-Szenarien A–F |

---

## 10  Backward-Kompatibilität

- Alle neuen DB-Spalten sind nullable (außer `reminder_count DEFAULT 0`)
- Bestehende TaktRequests ohne Fristfelder funktionieren unverändert
- Bestehende API-Clients, die `TaktRequestListItem` ohne neue Felder lesen, müssen nur `reminderCount` (integer, immer vorhanden) ergänzen
- Der Worker ist standardmäßig deaktiviert (`DEADLINE_WORKER_ENABLED=false`)
