# Reporting und KPIs – Konzeptdokumentation

> **Aufgabe 8.1 – Analyse und Konzeptdokumentation**
> Keine Code-, Datenbank- oder UI-Änderungen in diesem Schritt.
> Stand: August 2026

---

## 1  Zusammenfassung der Analyseergebnisse

### 1.1  Vorhandene Reporting-Funktionen

| Bereich | Vorhanden | Details |
|---------|-----------|---------|
| AG-Dashboard | ✅ | Projekt- und Delegationsstatus-Zähler; Upcoming Takte (7 Tage); Recent Activity |
| AN-Dashboard | ✅ | Delegationsstatus-Zähler; Ressourcenauslastung (einfach); Upcoming Deadlines |
| Hub-Dashboard | ✅ | hub_messages-Zähler nach Typ (Pending, Confirmed, Rejected, Cancelled) |
| Statistik-Endpunkte | ❌ | Keine dedizierten Reporting-Endpunkte vorhanden |
| Diagrammkomponenten | ❌ | Keine Diagrammbibliothek eingebunden |
| Exportfunktionen | ❌ | Kein CSV-, Excel- oder PDF-Export vorhanden |
| KPI-Service | ❌ | Keine KPI-Berechungsschicht vorhanden |
| Audit-Endpunkt | ❌ | Kein strukturierter Audit-Trail-Endpunkt vorhanden |

Das bestehende Dashboard wertet ausschließlich **Delegationen** (altes Modell) aus — keine TaktRequest-basierten Kennzahlen.

---

### 1.2  Verfügbare Zeitstempel

#### `takt_requests` (lib/db/src/schema/takt-requests.ts)

| Zeitstempel | Nullable | Bedeutung | Für Kennzahl |
|-------------|----------|-----------|-------------|
| `createdAt` | Nein | Anfrage erstellt | Startzeitpunkt Abstimmung |
| `sentAt` | Ja | GU hat gesendet | Verzögerung Erstellung→Versand |
| `deliveredAt` | Ja | Technisch zugestellt | Beginn der messbaren NU-Zeit |
| `detailsRetrievedAt` | Ja | NU hat Details abgerufen | Startpunkt Prüfzeit |
| `responseRequiredBy` | Ja | Antwortfrist | Fristgerechtigkeitsgrundlage |
| `expiresAt` | Ja | Ablaufzeitpunkt | Ablaufstatus |
| `expiredAt` | Ja | Tatsächlich abgelaufen | Ist-Ablaufdatum |
| `lastReminderAt` | Ja | Letzte Erinnerung | Erinnerungsfrequenz |
| `updatedAt` | Nein | Letzte Änderung | Allgemeine Überwachung |

**Datenlücke:** `deliveredAt` ist nullable. Wenn es fehlt, kann die NU-Antwortzeit nicht seriös berechnet werden (siehe §4.1).

#### `takt_responses` (lib/db/src/schema/takt-responses.ts)

| Zeitstempel | Nullable | Bedeutung |
|-------------|----------|-----------|
| `createdAt` | Nein | NU-Antwort abgegeben |
| `acceptedStart` / `acceptedEnd` | Ja | Angenommener Zeitfenstervorschlag |

**Datenlücke:** Kein eigener `deliveredAt`-Zeitstempel auf der Response — Zustellung über `message_outbox`.

#### `availability_checks` (lib/db/src/schema/availability-checks.ts)

| Zeitstempel | Nullable | Bedeutung |
|-------------|----------|-----------|
| `checkedAt` | Ja | Abschluss der Machbarkeitsprüfung |
| `createdAt` | Nein | Beginn der Prüfung |

#### `takt_response_decisions` (lib/db/src/schema/takt-response-decisions.ts)

| Zeitstempel | Nullable | Bedeutung |
|-------------|----------|-----------|
| `decidedAt` | Nein | GU-Entscheidung getroffen |
| `createdAt` | Nein | Row erstellt |

#### `message_outbox` (lib/db/src/schema/messages.ts)

| Feld | Typ | Bedeutung |
|------|-----|-----------|
| `createdAt` | Timestamp | Nachricht in Outbox eingestellt |
| `sentAt` | Nullable Timestamp | Technischer Versandversuch |
| `deliveredAt` | Nullable Timestamp | Bestätigte Zustellung |
| `lastAttemptAt` | Nullable Timestamp | Letzter Versuchszeitpunkt |
| `nextAttemptAt` | Nullable Timestamp | Nächster geplanter Retry |
| `attemptCount` | Integer | Anzahl Versuche |
| `failureReason` | Nullable Text | Fehlerursache bei Zustellfehler |
| `status` | Enum | `PENDING` / `SENT` / `DELIVERED` / `FAILED` |

#### `takt_request_reminders` (lib/db/src/schema/takt-request-reminders.ts)

| Zeitstempel | Nullable | Bedeutung |
|-------------|----------|-----------|
| `scheduledFor` | Nein | Geplanter Versandzeitpunkt |
| `sentAt` | Ja | Tatsächlich versendet |
| `deliveredAt` | Ja | Zugestellt |
| `createdAt` | Nein | Row erstellt |

---

### 1.3  Vorhandene Datenbankindizes (Reporting-relevant)

| Tabelle | Index | Spalten | Nutzung |
|---------|-------|---------|---------|
| `takt_requests` | `takt_requests_status_idx` | `status` | Status-Verteilungen |
| `takt_requests` | `takt_requests_nu_org_status_idx` | `nuOrgId, status` | NU-seitige Abfragen |
| `takt_requests` | `takt_requests_status_expires_at_idx` | `status, expiresAt` | Ablauf-Worker |
| `takt_request_reminders` | `reminders_status_scheduled_for_idx` | `status, scheduledFor` | Worker-Auswahl |
| `message_outbox` | `msg_outbox_status_idx` | `status` | Zustellstatus |
| `message_outbox` | `msg_outbox_recipient_status_idx` | `recipientOrgId, status` | Org-Zustellkennzahlen |
| `availability_checks` | `availability_checks_request_nu_run_idx` | `taktRequestId, nuOrgId, runNumber` | NU-Prüfungen |

**Fehlende Indizes für Reporting** (noch nicht anlegen — dokumentiert für Task 8.2):
- `takt_requests (guOrgId, createdAt)` — GU-Zeitraumfilter
- `takt_requests (guOrgId, status, createdAt)` — GU-Status-Zeitreihe
- `takt_responses (taktRequestId, createdAt)` — Antwortzeit-Joins
- `takt_response_decisions (taktRequestId, decidedAt)` — Entscheidungszeit
- `message_outbox (correlationId, createdAt)` — korrelierte Zustellkennzahlen

---

### 1.4  Revisions- und Abstimmungsketten

- `takt_requests.supersedesRequestId` — Self-Referenz FK; verbindet Revisionsrequests mit dem Vorgänger
- `takt_versions` — vollständiger Snapshot jeder Taktversion (sourceType: INITIAL / MANUAL_EDIT / …)
- `takt_response_decisions.decisionType` — `CONFIRM_ACCEPTED | ACCEPT_ALTERNATIVE | REQUEST_REVISION | CLOSE_WITHOUT_AGREEMENT`

Die Anzahl der Abstimmungsrunden ergibt sich aus der Länge der `supersedesRequestId`-Kette + 1.

---

### 1.5  Erkannte Datenlücken

| Lücke | Auswirkung |
|-------|-----------|
| `deliveredAt` in `takt_requests` nullable | NU-Antwortzeit teilweise nicht berechenbar |
| Kein `deliveredAt` auf `takt_responses` | Response-Zustellung nur über message_outbox verfolgbar |
| Bestehende Dashboard-Metriken auf Delegationsbasis | TaktRequest-basierte KPIs noch nicht vorhanden |
| Kein Audit-Trail-Endpunkt | Prozessverlauf muss aus mehreren Tabellen rekonstruiert werden |
| Kein `orgRole`-Feld auf Benutzerebene | Rollenbasierter Zugriff muss über `user_organizations.role` erfolgen |
| availability_checks.checkedAt nullable | Prüfzeit nicht immer berechenbar |

---

### 1.6  Erkannte Datenschutzrisiken

| Risiko | Maßnahme |
|--------|---------|
| `availability_checks.internalResultPayload` enthält NU-interne Ressourcendaten | Niemals in GU- oder Hub-Reports ausgeben; nur im NU-Service verwenden |
| `takt_versions.snapshotPayload` enthält vollständige Takt-Inhaltsdaten | In Reports nur Metadaten (Version, Zeitpunkt, Quelle) ausgeben, nie Snapshot-Payload |
| `nu_local_projects` / `resource_bookings` enthalten betriebsgeheime NU-Daten | Ausschließlich im NU-Service, streng nach nuOrgId gefiltert |
| `message_outbox.payload` kann fachliche Nutzdaten enthalten | Im Hub-Reporting nur Metadaten (Status, Zeitstempel, Zähler) auswerten |
| `decidedByUserId` in GU-Entscheidungen | Personenbezogene Kennzahl — in aggregierten Reports nicht einzeln ausgeben |

---

## 2  Grundsätze

Diese Grundsätze sind verbindlich für alle Reporting-Implementierungen:

1. **Organisationsisolation** — Jede Organisation sieht ausschließlich ihre eigenen fachlichen Daten. Die Organisation wird immer aus dem JWT des authentifizierten Nutzers abgeleitet — niemals aus einem Client-Parameter.
2. **GU-Bericht ohne NU-Interna** — GU-Reports enthalten keine NU-Ressourcen, lokalen Projekte, internen Konflikte, Mitarbeiterdaten, internen Kosten oder Prioritäten.
3. **NU-Daten im NU-System** — NU-interne Ressourcen- und Auslastungskennzahlen werden ausschließlich im NU-Service berechnet und niemals über GU- oder Hub-Endpunkte ausgeliefert.
4. **Hub = technisch** — Der Hub-Report beschränkt sich auf Nachrichten- und Zustellkennzahlen. Keine fachlichen Prozessdaten.
5. **Kein Personenbezug in Aggregaten** — Keine Ranglisten einzelner Mitarbeiter. Kein Ausweis von `decidedByUserId` in öffentlichen Berichten.
6. **Eindeutige Definitionen** — Alle Kennzahlen haben eine kanonische Berechnungsgrundlage (siehe §4). Keine impliziten Berechnungen.
7. **Durchschnitt ≠ Median** — Beide Maße werden getrennt und korrekt berechnet (PostgreSQL-`percentile_cont` oder äquivalent).
8. **UTC intern** — Alle Berechnungen erfolgen auf UTC-Zeitstempeln. Frontend-Darstellung in lokaler Zeitzone ist Aufgabe der UI.
9. **Auswertungszeitraum erforderlich** — Jeder Bericht verlangt explizit `from` und `to`. Halb offenes Intervall: `from <= timestamp < to`.
10. **Technisch ≠ fachlich** — Technische Zustellkennzahlen (message_outbox) und fachliche Bearbeitungskennzahlen (taktRequest-Status) bleiben getrennte Kennzahlengruppen.
11. **Historisch auswertbar** — Abgeschlossene Prozesse, alte Taktversionen und archivierte Requests bleiben jederzeit auswertbar.
12. **Datenqualität explizit** — Requests ohne vollständige Zeitstempel werden als Datenqualitätsproblem markiert, nicht als `0` gezählt.

---

## 3  Zielgruppen und Sichten

| Zielgruppe | Datenperimeter | Beschreibung |
|------------|----------------|-------------|
| **GU (Generalunternehmer)** | Eigene `guOrgId` | Koordinationseffizienz, Antwortzeiten, Fristerreichung, Abstimmungsrunden |
| **NU (Nachunternehmer)** | Eigene `nuOrgId` | Eingehende Anfragen, Prüfzeiten, Antwortquoten, Ressourcenauslastung |
| **Hub-Administration** | Alle Orgs — nur technisch | Transport-Kennzahlen, Zustellquoten, Fehleranalyse |
| **Projektbericht** | `projectId` innerhalb `guOrgId` | Prozessfortschritt eines einzelnen Projekts |
| **Revisionssicherer Audit** | Request-ID | Chronologischer Ereignisverlauf einer einzelnen Anfrage |

---

## 4  Definitionen zentraler Zeitkennzahlen

### 4.1  NU-Antwortzeit

```
NU-Antwortzeit = taktResponse.createdAt − taktRequest.deliveredAt
```

- **Voraussetzung:** `taktRequest.deliveredAt` muss gesetzt sein.
- **Bei fehlendem `deliveredAt`:** Kennzahl wird **nicht berechnet** und als Datenqualitätsproblem markiert. Kein Ersatz durch `sentAt` oder `createdAt` — das würde Transportverzögerungen fälschlich der NU anlasten.
- **Einheit:** Sekunden (Frontend rechnet in Stunden/Tage um).
- **Gruppierfähig nach:** nuOrgId, projectId, Gewerk, Zeitraum.

### 4.2  NU-Prüfzeit

```
Prüfzeit = availabilityCheck.checkedAt − taktRequest.detailsRetrievedAt
```

- **Voraussetzung:** Beide Zeitstempel müssen gesetzt sein.
- **Bedeutung:** Zeit zwischen „NU hat Anfragedetails gelesen" und „Machbarkeitsprüfung abgeschlossen".

### 4.3  Zeit bis Taktbestätigung (GU-Sicht)

```
Zeit bis Taktbestätigung = guDecision.decidedAt − taktRequest.createdAt
```

- **Begründung:** `createdAt` ist immer gesetzt und stellt den frühestmöglichen Startpunkt dar. Alternativdefinition ab `sentAt` möglich, aber inkonsistent bei Draft-Phasen — `createdAt` ist die bevorzugte Definition.
- **Nur auswertbar:** wenn `decisionType IN ('CONFIRM_ACCEPTED', 'ACCEPT_ALTERNATIVE')`.

### 4.4  Zustellzeit

```
Zustellzeit = message_outbox.deliveredAt − message_outbox.createdAt
```

- **Voraussetzung:** `deliveredAt` muss gesetzt sein (status = 'DELIVERED').
- **Einheit:** Sekunden.

### 4.5  Fristgerechte Antwort

```
Fristgerecht = taktResponse.createdAt <= taktRequest.responseRequiredBy
```

- **Ausgeschlossen aus Berechnung:** Requests ohne `responseRequiredBy` — sie werden weder als fristgerecht noch als verspätet gewertet.
- **Fristquote:** `Anzahl fristgerechter Antworten / Anzahl Requests mit gesetzter Frist und vorhandener Antwort`.

### 4.6  Abstimmungsrunde

- Eine Abstimmungsrunde = ein TaktRequest.
- Revisionsrequests (`supersedesRequestId IS NOT NULL`) sind neue Abstimmungsrunden.
- Anzahl Runden je Takt = Länge der `supersedesRequestId`-Kette + 1.
- Zur Auflösung der Kette: rekursive Abfrage über `supersedesRequestId` oder Zählung über `taktId + guOrgId`.

---

## 5  GU-Kennzahlen

Alle GU-Kennzahlen sind nach `guOrgId` isoliert. Kein NU-internes Datum.

### 5.1  Übersichts-KPIs

| Kennzahl | Berechnung | Datenquelle |
|----------|-----------|------------|
| Anzahl Taktanfragen gesamt | `COUNT(id)` | takt_requests WHERE guOrgId = ? |
| Offene Taktanfragen | `COUNT` WHERE status IN (SENT, DELIVERED, DETAILS_RETRIEVED, UNDER_REVIEW, ALTERNATIVES_PROPOSED, REVISION_REQUIRED) | takt_requests |
| Überfällige Taktanfragen | `COUNT` WHERE responseRequiredBy < now AND status IN offene Status | takt_requests |
| Abgelaufene Taktanfragen | `COUNT` WHERE status = 'EXPIRED' | takt_requests |
| Bestätigte Taktanfragen | `COUNT` WHERE status = 'ACCEPTED' AND guDecision.decisionType IN (CONFIRM_ACCEPTED, ACCEPT_ALTERNATIVE) | takt_requests JOIN takt_response_decisions |
| Anfragen mit Alternativen | `COUNT` WHERE status = 'ALTERNATIVES_PROPOSED' (aktuell) oder taktResponse mit Alternativen | takt_requests / takt_responses |
| Abgelehnte Taktanfragen | `COUNT` WHERE status = 'REJECTED' | takt_requests |
| Stornierte Taktanfragen | `COUNT` WHERE status = 'CANCELLED' | takt_requests |

### 5.2  Zeitkennzahlen

| Kennzahl | Definition | Einheit |
|----------|-----------|---------|
| Durchschnittliche NU-Antwortzeit | AVG(taktResponse.createdAt − taktRequest.deliveredAt) | Sekunden |
| Mediane NU-Antwortzeit | PERCENTILE_CONT(0.5) über Antwortzeiten | Sekunden |
| Fristgerechte Antwortquote | Fristgerechte Antworten / Requests mit Frist und Antwort | % |
| Durchschnittliche Zeit bis Taktbestätigung | AVG(guDecision.decidedAt − taktRequest.createdAt) | Sekunden |
| Mediane Zeit bis Taktbestätigung | PERCENTILE_CONT(0.5) | Sekunden |

### 5.3  Quoten

| Kennzahl | Berechnung |
|----------|-----------|
| Anteil bestätigter Anfragen | Bestätigte / Abgeschlossene insgesamt |
| Anteil Alternativen | ALTERNATIVES_PROPOSED / Abgeschlossene insgesamt |
| Anteil abgelehnter Anfragen | REJECTED / Abgeschlossene insgesamt |
| Fristgerechte Antwortquote | Fristgerechte Antworten / Requests mit Frist |

Abgeschlossene = ACCEPTED + ALTERNATIVES_PROPOSED (mit Entscheid) + REJECTED + CANCELLED + EXPIRED.

### 5.4  Abstimmungsrunden

| Kennzahl | Berechnung |
|----------|-----------|
| Durchschnittliche Anzahl Abstimmungsrunden | AVG(Kettenlänge je Takt) |
| Maximale Abstimmungsrunden | MAX(Kettenlänge) |
| Laufende Revisionsrunden | COUNT offener Requests mit supersedesRequestId IS NOT NULL |

### 5.5  Gruppierungen

Alle GU-Kennzahlen unterstützen optionale Gruppierung nach:

- `projectId` / `projectName`
- `nuOrgId` / `nuOrgName`
- `gewerk` (trade)
- `taktId`
- Zeitraum (Woche / Monat / Quartal)
- `status`

---

## 6  NU-Kennzahlen

Alle NU-Kennzahlen sind streng nach `nuOrgId` isoliert. NU-interne Ressourcenkennzahlen dürfen **niemals** über GU- oder Hub-Endpunkte ausgeliefert werden.

### 6.1  Übersichts-KPIs

| Kennzahl | Berechnung | Datenquelle |
|----------|-----------|------------|
| Eingegangene Taktanfragen | COUNT WHERE nuOrgId = ? | takt_requests |
| Offene Prüfungen | COUNT WHERE status IN (DELIVERED, DETAILS_RETRIEVED, UNDER_REVIEW) | takt_requests |
| Bald fällige Anfragen | COUNT WHERE responseRequiredBy BETWEEN now AND now+48h | takt_requests |
| Überfällige Anfragen | COUNT WHERE responseRequiredBy < now AND status offen | takt_requests |
| Abgelaufene Anfragen | COUNT WHERE status = 'EXPIRED' | takt_requests |

### 6.2  Antwortquoten

| Kennzahl | Berechnung |
|----------|-----------|
| Fristgerechte Antwortquote | Antworten mit createdAt ≤ responseRequiredBy / Requests mit Frist |
| Anteil ACCEPTED | ACCEPTED-Responses / Abgeschlossene |
| Anteil ALTERNATIVES_PROPOSED | Responses mit decision = ALTERNATIVES_PROPOSED / Abgeschlossene |
| Anteil REJECTED | Responses mit decision = REJECTED / Abgeschlossene |

### 6.3  Zeitkennzahlen

| Kennzahl | Definition | Einheit |
|----------|-----------|---------|
| Durchschnittliche Prüfzeit | AVG(availabilityCheck.checkedAt − taktRequest.detailsRetrievedAt) | Sekunden |
| Mediane Prüfzeit | PERCENTILE_CONT(0.5) | Sekunden |
| Durchschnittliche Gesamtbearbeitungszeit | AVG(taktResponse.createdAt − taktRequest.deliveredAt) | Sekunden |

### 6.4  Alternative-Kennzahlen

| Kennzahl | Berechnung |
|----------|-----------|
| Anzahl erzeugter Alternativen | COUNT takt_response_alternatives |
| Durchschnittliche Anzahl Alternativen | AVG(Alternativen je Response) |

### 6.5  Reason-Codes

| Kennzahl | Berechnung |
|----------|-----------|
| Häufigste generische Reason Codes | COUNT GROUP BY reasonCode ORDER BY COUNT DESC |

Reason Codes werden aggregiert ausgegeben (nie mit Kunden-IDs oder GU-Projekt-Identifikatoren kombiniert). Kein anderer GU-Kunde darf in externen Berichten identifizierbar sein.

### 6.6  Ressourcen- und Auslastungskennzahlen (NU-intern)

Diese Kennzahlen sind ausschließlich im NU-Service verfügbar und niemals extern ausgeliefert:

| Kennzahl | Berechnung | Datenquelle |
|----------|-----------|------------|
| Auslastung lokaler Ressourcen | SUM(utilizationPercent) / Kapazität je Ressource | resource_bookings JOIN resources |
| Anzahl erkannter Ressourcenüberschneidungen | COUNT availability_checks WHERE result = 'CONFLICT' | availability_checks |
| Durchschnittliche Ressourcenauslastung | AVG(utilizationPercent) WHERE status = 'CONFIRMED' | resource_bookings |

---

## 7  Hub-Kennzahlen

Der Hub sieht ausschließlich technische Nachrichten- und Zustellkennzahlen. Keine fachlichen Snapshot- oder Ressourcenfelder.

### 7.1  Transport-Übersicht

| Kennzahl | Berechnung | Datenquelle |
|----------|-----------|------------|
| Anzahl Nachrichten gesamt | COUNT | message_outbox |
| Nachrichten nach Typ | COUNT GROUP BY messageType | message_outbox |
| Nachrichten nach Status | COUNT GROUP BY status | message_outbox |
| Ausstehende Nachrichten | COUNT WHERE status = 'PENDING' | message_outbox |
| Älteste ausstehende Nachricht | MIN(createdAt) WHERE status = 'PENDING' | message_outbox |

### 7.2  Zustellkennzahlen

| Kennzahl | Berechnung | Einheit |
|----------|-----------|---------|
| Zustellquote | DELIVERED / Gesamt | % |
| Fehlerquote | FAILED / Gesamt | % |
| Durchschnittliche Zustellzeit | AVG(deliveredAt − createdAt) WHERE deliveredAt IS NOT NULL | Sekunden |
| Mediane Zustellzeit | PERCENTILE_CONT(0.5) | Sekunden |
| Minimale Zustellzeit | MIN | Sekunden |
| Maximale Zustellzeit | MAX | Sekunden |

### 7.3  Retry-Kennzahlen

| Kennzahl | Berechnung |
|----------|-----------|
| Anzahl Retries | SUM(attemptCount − 1) WHERE attemptCount > 1 |
| Erfolgsquote nach Retry | DELIVERED WHERE attemptCount > 1 / Gesamt WHERE attemptCount > 1 |
| Durchschnittliche Retry-Anzahl | AVG(attemptCount) WHERE attemptCount > 1 |
| Maximale Retry-Anzahl | MAX(attemptCount) |

### 7.4  Erinnerungskennzahlen (message_outbox gefiltert auf TAKT_REQUEST_REMINDER)

| Kennzahl | Berechnung |
|----------|-----------|
| Erinnerungen nach Typ | COUNT GROUP BY reminderType (via correlationId + takt_request_reminders) |
| Fehlgeschlagene Erinnerungen | COUNT WHERE status = 'FAILED' AND messageType = 'TAKT_REQUEST_REMINDER' |

---

## 8  Projektbezogene Prozessberichte

Ein Projektbericht fasst alle TaktRequest-Vorgänge innerhalb eines Projekts zusammen.

**Zugriffskontrolle:** Nur die GU-Organisation, der das Projekt gehört (`projects.agOrgId`).

| Kennzahl | Beschreibung |
|----------|-------------|
| Anfragen gesamt | Alle TaktRequests WHERE projectId = ? |
| Anfragen je Takt | Gruppiert nach taktId |
| Anfragen je NU | Gruppiert nach nuOrgId |
| Anfragen je Gewerk | Gruppiert nach gewerk |
| Offene / Abgeschlossene Anfragen | Status-Aufschlüsselung |
| Durchschnittliche Abstimmungsrunden | Über alle Takte des Projekts |
| Fristgerechte Antwortquote | Projektbezogen |
| Zeitplan-Abweichungen | Vergleich `takte.plannedStart/End` mit taktVersions |

---

## 9  Revisionssicherer Audit-Trail

Der Audit-Trail rekonstruiert den vollständigen Ereignisverlauf einer einzelnen TaktRequest-Instanz aus mehreren Tabellen.

**Zugriffskontrolle:**
- GU: sieht eigene Requests (nach `guOrgId`)
- NU: sieht für ihn relevante Ereignisse (nach `nuOrgId`) — ohne GU-interne Entscheidungsnotizen
- Hub: sieht nur technische Nachrichtenereignisse

### 9.1  Ereignisquellen

| Ereignistyp | Tabelle | Zeitstempel-Feld |
|-------------|---------|-----------------|
| Request erstellt | takt_requests | createdAt |
| Snapshot erstellt | takt_request_snapshots | createdAt |
| Notification in Outbox eingestellt | message_outbox | createdAt |
| Notification versendet | message_outbox | sentAt |
| Notification zugestellt | message_outbox | deliveredAt |
| Details abgerufen | takt_requests | detailsRetrievedAt |
| Machbarkeitsprüfung durchgeführt | availability_checks | checkedAt |
| Response erstellt | takt_responses | createdAt |
| GU-Entscheidung erstellt | takt_response_decisions | decidedAt |
| Taktversion erzeugt | takt_versions | createdAt |
| Revision erzeugt | takt_requests (supersedesRequestId) | createdAt des Folge-Requests |
| Reminder gesendet | takt_request_reminders | sentAt |
| Request abgelaufen | takt_requests | expiredAt |

### 9.2  Audit-Event-Struktur (je Eintrag)

```text
eventType         — Kategorie des Ereignisses (REQUEST_CREATED, SNAPSHOT_CREATED, …)
occurredAt        — UTC-Zeitstempel
actorType         — SYSTEM | GU | NU | HUB_ADMIN
actorReference    — orgId (kein personenbezogener Identifier in öffentlicher Ausgabe)
organizationReference — senderOrgId oder recipientOrgId
objectType        — TAKT_REQUEST | TAKT_RESPONSE | MESSAGE | DECISION | …
objectReference   — ID des betroffenen Objekts
messageId         — Outbox-messageId (wenn zutreffend)
correlationId     — taktRequestId (für Korrelation über Systemgrenzen)
summary           — Kurzbeschreibung in Klartext (kein Snapshot-Payload)
```

**Nicht enthalten:** vollständige Snapshot-Payloads, interne Availability-Payloads, lokale NU-Projekte, Mitarbeiterdaten, interne Konflikte, interne Kosten.

---

## 10  Datenqualitätskennzahlen

Diese Kennzahlen sind primär für Administration und Entwicklung bestimmt.

| Kennzahl | Berechnung | Bedeutung |
|----------|-----------|-----------|
| Requests ohne Snapshot | COUNT takt_requests ohne zugehörigen takt_request_snapshots-Eintrag | Schema-Verletzung |
| Requests ohne deliveredAt | COUNT WHERE sentAt IS NOT NULL AND deliveredAt IS NULL AND status != 'PENDING' | Zustelllücke |
| Responses ohne gültigen Request | COUNT takt_responses ohne passendem takt_requests-Eintrag | FK-Verletzung |
| Nachrichten ohne Correlation-ID | COUNT message_outbox WHERE correlationId IS NULL | Korrelationslücke |
| Inkonsistente Statuskombinationen | z.B. status = ACCEPTED ohne guDecision | Zustandsmaschinenfehler |
| Fehlende Antwortfristen | COUNT takt_requests WHERE responseRequiredBy IS NULL AND status NOT IN (DRAFT, CANCELLED) | Konfigurationslücke |
| Abgelaufene Requests ohne expiredAt | COUNT WHERE status = 'EXPIRED' AND expiredAt IS NULL | Worker-Fehler |

---

## 11  Noch nicht implementieren

Folgende Bereiche sind explizit **nicht** Teil von Task 8.1 und werden in folgenden Aufgaben adressiert:

| Bereich | Aufgabe |
|---------|---------|
| Reporting-Service-Schicht | Task 8.2 |
| REST-Endpunkte | Task 8.3 |
| OpenAPI-Schemas | Task 8.3 |
| Frontend-Dashboards | spätere Aufgabe |
| Export (CSV/Excel/PDF) | spätere Aufgabe |
| Externe BI-Systeme | nicht geplant |
| Data Warehouse / EDC | nicht geplant |
| Neue Datenbankindizes | Task 8.2 (nur wenn zwingend erforderlich) |

---

## 12  Abschlussbericht

### Vorhandene Reporting-Funktionen

Das System enthält einfache **Dashboard-Zähler** auf Basis der alten Delegations-Architektur. Es gibt keine dedizierten Reporting-Endpunkte, keine KPI-Berechnung auf TaktRequest-Basis, keine Zeitreihenauswertung, keine Exportfunktionen und keine Diagrammkomponenten.

### Verfügbare Zeitstempel

Alle wesentlichen Zeitstempel für GU- und NU-Kennzahlen sind vorhanden:
- **Vollständig:** `createdAt`, `sentAt`, `expiresAt`, `expiredAt` auf takt_requests
- **Partiell:** `deliveredAt`, `detailsRetrievedAt`, `responseRequiredBy` auf takt_requests (nullable)
- **Vorhanden:** `createdAt` auf takt_responses, `decidedAt` auf takt_response_decisions, `checkedAt` auf availability_checks, vollständige Outbox-Zeitstempel

### Datenlücken

1. `takt_requests.deliveredAt` ist nullable → NU-Antwortzeit nicht immer berechenbar
2. `availability_checks.checkedAt` ist nullable → Prüfzeit nicht immer berechenbar
3. Bestehende Dashboard-Kennzahlen basieren auf Delegationen, nicht TaktRequests
4. Kein Audit-Trail-Endpunkt vorhanden

### Dokumentierte KPI-Definitionen

- NU-Antwortzeit (§4.1) — kanonisch: `taktResponse.createdAt − taktRequest.deliveredAt`
- Prüfzeit (§4.2)
- Zeit bis Taktbestätigung (§4.3) — bevorzugt ab `taktRequest.createdAt`
- Zustellzeit (§4.4)
- Fristgerechte Antwort (§4.5)
- Abstimmungsrunde (§4.6)

### Datenschutzrisiken

- `internalResultPayload` auf availability_checks: NU-intern, nie extern ausgeben
- `snapshotPayload` auf takt_versions: In Reports nur Metadaten
- `nu_local_projects` / `resource_bookings`: Streng NU-intern
- `message_outbox.payload`: Im Hub-Report nur Metadaten
- `decidedByUserId`: Kein Einzelpersonen-Ausweis in öffentlichen Reports

---

## 7  AG-Projektübersicht KPIs (Task 9.2 / 9.3)

### 7.1  Endpunkte

| Endpunkt | Beschreibung |
|---|---|
| `GET /api/ag/projects/overview` | Alle Projekte der GU-Organisation mit KPI-Feldern |
| `GET /api/ag/projects/:projectId/overview` | Einzelprojekt mit AN-Liste, Koordinations-KPIs, letzten Anfragen |

### 7.2  AgProjectSummary — Felder und Herkunft

| Feld | Quelle | Bedeutung |
|---|---|---|
| `assignedAnCount` | `project_contractors` WHERE status=ACTIVE | Aktiv zugeordnete Nachunternehmer |
| `assignedTrades` | `project_contractors.trade` (ACTIVE, DISTINCT) | Gewerke mit aktiven Zuordnungen |
| `totalTaktRequests` | `takt_requests` via takt→project | Alle TaktRequests im Projekt |
| `openTaktRequests` | Status IN (PENDING, SENT, DELIVERED, DETAILS_RETRIEVED, UNDER_REVIEW) | Offene Anfragen |
| `overdueTaktRequests` | `responseRequiredBy < now()` AND Status offen | Überfällige Anfragen |
| `acceptedTaktRequests` | Status = ACCEPTED | Bestätigte Anfragen |
| `revisionRequiredRequests` | Status = REVISION_REQUIRED | Revisionsrunden |
| `lastActivityAt` | MAX(updatedAt) über alle TaktRequests | Letzte Änderung im Projekt |

### 7.3  AgProjectCoordinationSummary — Felder und Herkunft

| Feld | Quelle | Bedeutung |
|---|---|---|
| `numberOfTakts` | `takte` WHERE projectId | Takte gesamt |
| `confirmedTakts` | `takte` WHERE lifecycleStatus=CONFIRMED | Koordiniert abgeschlossen |
| `taktsInCoordination` | `takte` WHERE lifecycleStatus=IN_COORDINATION | Aktuell in Abstimmung |
| `openRequests` | TaktRequests mit offenem Status | Offene Koordinationsanfragen |
| `overdueRequests` | TaktRequests überfällig | Anfragen nach Fristablauf |
| `revisionRounds` | TaktRequests mit Status REVISION_REQUIRED | Laufende Revisionsrunden |

### 7.4  Sichtbarkeitsregeln

- Alle Werte sind auf das jeweilige Projekt beschränkt — kein Zugriff auf fremde Projekte.
- AN-seitige Details (Mitarbeiter, Ressourcen, interne Projekte) werden nie zurückgegeben.
- Für das Hub-Dashboard sind nur aggregierte Zähler auf Nachrichtenebene vorgesehen — keine TaktRequest-Details.
