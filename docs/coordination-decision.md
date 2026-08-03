# Koordinationsentscheidung – Analyse und Architekturregeln

Stand: August 2026

---

## 1. Bestehende Implementierung

### 1.1 Eingehende TaktAntworten

NU-Antworten werden über `POST /api/takt-requests/:id/responses` empfangen.

**Verarbeitungsschritte:**

1. NU-Berechtigung prüfen (`nuOrgId` des Requests muss mit `req.user.orgId` übereinstimmen).
2. Idempotenz prüfen: Falls bereits eine Response mit derselben `messageId` existiert, wird die vorhandene zurückgegeben.
3. Body-Filterung: Interne NU-Felder (z. B. `internalNuResourceId`) werden vor der Speicherung entfernt.
4. Datenbank-Transaktion: `createTaktResponse()` in `takt-response-repository.ts` speichert zuerst `takt_responses`, dann `takt_response_alternatives` (max. 3).
5. Requeststatus-Übergang abhängig vom `decision`-Wert: `ACCEPTED` → `ACCEPTED`, `ALTERNATIVES_PROPOSED` → `ALTERNATIVES_PROPOSED`, `REJECTED` → `REJECTED`.
6. Hub-Nachricht `TAKT_RESPONSE_SUBMITTED` wird über `LocalHubTransport` an die GU-Organisation gesendet.

**Unveränderlichkeit:** `takt_responses` hat kein `updatedAt`. Eine neue Abstimmungsrunde erfordert einen neuen `TaktRequest`.

### 1.2 GU-Aktionen auf Antworten

**Implementiert (Tasks 6.3–6.6).** GU-Entscheidungen werden über einen dedizierten Endpoint erfasst:

- `POST /api/takt-requests/:id/gu-decisions` — GU-Entscheidung speichern (Task 6.3)
- `POST /api/takt-requests/:id/revisions` — Neue Überarbeitungsrunde starten (Task 6.5)
- `GET /api/takt-requests/:id` — Antwort lesen (inkl. Alternativen und Timeline)
- `GET /api/takt-requests` — Übersicht aller eigenen Anfragen

**Service-Dateien:**
- `artifacts/api-server/src/services/gu-decision-service.ts` — Entscheidungslogik, Idempotenz, Transport
- `artifacts/api-server/src/services/takt-version-service.ts` — Versionierung (Aufgaben 6.4)
- `artifacts/api-server/src/services/revision-service.ts` — Neue Abstimmungsrunde (Aufgabe 6.5)

### 1.3 Statusübergänge TaktRequest

Definiert in `artifacts/api-server/src/lib/takt-request-transitions.ts`:

```
DRAFT                → SENT, CANCELLED
SENT                 → DELIVERED, CANCELLED, EXPIRED
DELIVERED            → DETAILS_RETRIEVED, UNDER_REVIEW, CANCELLED, EXPIRED
DETAILS_RETRIEVED    → UNDER_REVIEW, ACCEPTED, ALTERNATIVES_PROPOSED, REJECTED, CANCELLED, EXPIRED
UNDER_REVIEW         → ACCEPTED, ALTERNATIVES_PROPOSED, REJECTED, CANCELLED, EXPIRED
ALTERNATIVES_PROPOSED→ ACCEPTED, REVISION_REQUIRED, SUPERSEDED
REJECTED             → REVISION_REQUIRED, SUPERSEDED
REVISION_REQUIRED    → SUPERSEDED
```

Terminale Zustände (keine ausgehenden Übergänge): `ACCEPTED`, `CANCELLED`, `EXPIRED`, `SUPERSEDED`.

Wichtige Unterscheidung: `DELIVERED` → `ACCEPTED` ist **nicht** erlaubt. Die NU muss aktiv entscheiden.

### 1.4 Takt-Lebenszyklus

`takte.lifecycle_status` (Enum `takt_lifecycle_status`):

```
DRAFT → PLANNED → IN_COORDINATION → CONFIRMED
                                  ↘ CANCELLED
```

`IN_COORDINATION` wird gesetzt, wenn eine TaktRequest erfolgreich zugestellt wird.  
`CONFIRMED` wird gesetzt durch `CONFIRM_ACCEPTED` oder `ACCEPT_ALTERNATIVE` (Tasks 6.3/6.4).  
`PLANNED` wird wiederhergestellt durch `CLOSE_WITHOUT_AGREEMENT` wenn kein anderer aktiver Request existiert.  
`IN_COORDINATION` wird wiederhergestellt durch `POST /revisions` (neue Runde, Task 6.5).

Daneben existiert der ältere `takte.status` (`taktStatusEnum`): `GEPLANT`, `VERGEBEN`, `ALTERNATIV`, `BESTAETIGT`, `ABGELEHNT`, `STORNIERT`. Diese Werte stammen aus der Delegations-Ära und sind **nicht** mit dem neuen Koordinationsprozess synchronisiert.

### 1.5 Taktversionierung (implementiert)

- `takte.version`: Integer, startet bei 1, wird bei inhaltlichen Änderungen inkrementiert. Optimistic-Lock-Pflichtfeld bei allen Takt-Updates.
- `takt_requests.takt_version`: Snapshot des Takt-Versionsstands zum Zeitpunkt der Erstellung — unveränderlich.
- `takt_versions`: Separate Tabelle für unveränderliche Versionshistorie (Task 6.2 angelegt, 6.4/6.5 befüllt). Enthält `sourceType`, `snapshotPayload`, `contentHash`, `sourceDecisionId`.
- `markTaktRequestSuperseded()` in `takt-request-repository.ts` setzt einen Request auf `SUPERSEDED`, verknüpft über `supersedes_request_id`.

### 1.6 Beziehungen zwischen Tabellen

```
takte (1) ─────────────── (*) takt_requests
                                    │
                          (1) ──── takt_request_snapshots (write-once)
                                    │
                          (0..1) ── takt_responses (write-once)
                                         │
                                   (*) ── takt_response_alternatives
```

`takt_responses.takt_request_id` hat einen UNIQUE-Constraint: **eine Antwort pro Request**.  
Alternativen werden bei Löschung der Response kaskadierend entfernt (dev only, nie in Produktion).

### 1.7 Audit- und Änderungsinformationen

Vorhanden:
- `takt_requests.created_at`, `updated_at`, `sent_at`, `delivered_at`, `details_retrieved_at`
- `takt_responses.created_at` (write-once)
- `message_outbox` / `message_inbox` für technische Zustellprotokolle
- `takt_request_snapshots.created_at` (write-once)

Nicht vorhanden: keine Versionstabelle, keine GU-Entscheidungstabelle, kein Audit-Log für Statusänderungen.

### 1.8 Hub-Nachrichten für Entscheidungen

Versendete Typen (vollständig implementiert, Task 6.6):
- `TAKT_REQUEST_NOTIFICATION` → NU (bei Versand)
- `TAKT_RESPONSE_SUBMITTED` → GU (wenn NU geantwortet hat)
- `TAKT_RESPONSE_ACCEPTED` → NU (bei `CONFIRM_ACCEPTED` oder `ACCEPT_ALTERNATIVE`)
- `TAKT_RESPONSE_REVISION_REQUESTED` → NU (bei `REQUEST_REVISION`)
- `TAKT_REQUEST_CANCELLED` → NU (bei `CLOSE_WITHOUT_AGREEMENT`)
- `TAKT_REQUEST_REVISED` → NU (bei `POST /revisions` mit `sendImmediately=true`)

Alle GU→NU-Nachrichten enthalten **keine** internen NU-Daten (keine Ressourcen, keine Kosten). NU ruft Details über `detailsRef` ab.

### 1.9 GU-Antwortansichten

`GET /api/takt-requests/:id` gibt ein `TaktRequestDetail`-Objekt zurück mit:
- `response.decision`, `response.reasonCode`, `response.comment`, `response.acceptedStart/End`
- `response.alternatives[]` mit `rank`, `proposedStart/End`, `crewSize`, `conditions`
- Separate `snapshot` und `transport.notificationPayload`

### 1.10 Neue Abstimmungsrunde

**Implementiert (Task 6.5):** `POST /api/takt-requests/:id/revisions` erstellt eine vollständige neue Abstimmungsrunde:
1. Neuen `takt_versions`-Eintrag (sourceType = `REVISION`)
2. Takt aktualisieren (neues Zeitfenster, `version++`, `lifecycle_status = IN_COORDINATION`)
3. Neuen `takt_requests` anlegen (DRAFT, `supersedesRequestId` = alter Request)
4. Neuen Snapshot anlegen
5. Alten Request auf `SUPERSEDED` setzen

`markTaktRequestSuperseded()` in `takt-request-repository.ts` wird intern von `createRevision()` verwendet.

---

## 2. Zielprozess

### 2.1 NU sendet ACCEPTED → GU bestätigt → Takt CONFIRMED

```
TaktRequest status = ACCEPTED
GU entscheidet: CONFIRM_ACCEPTED
→ TaktRequest bleibt ACCEPTED
→ takte.lifecycle_status = CONFIRMED
→ GU-Entscheidung wird als takt_response_decisions gespeichert
```

### 2.2 NU sendet ALTERNATIVES_PROPOSED → GU wählt Alternative

```
TaktRequest status = ALTERNATIVES_PROPOSED
GU entscheidet: ACCEPT_ALTERNATIVE (acceptedAlternativeId = "ALT-01")
→ TaktRequest: ALTERNATIVES_PROPOSED → ACCEPTED
→ Takt erhält neue Version (sourceType = ACCEPTED_ALTERNATIVE)
→ takte.lifecycle_status = CONFIRMED
→ GU-Entscheidung wird gespeichert
```

### 2.3 NU sendet ALTERNATIVES_PROPOSED → keine Alternative passt → GU fordert Überarbeitung

```
TaktRequest status = ALTERNATIVES_PROPOSED
GU entscheidet: REQUEST_REVISION
→ TaktRequest: ALTERNATIVES_PROPOSED → REVISION_REQUIRED
→ GU erstellt neuen TaktRequest (neue Version, neuer Snapshot)
→ alter TaktRequest: REVISION_REQUIRED → SUPERSEDED (durch supersedesRequestId verknüpft)
→ takte.version wird inkrementiert
→ neue takt_versions-Eintrag (sourceType = REVISION)
```

### 2.4 NU sendet REJECTED → GU überarbeitet → neue Version

```
TaktRequest status = REJECTED
GU entscheidet: REQUEST_REVISION
→ TaktRequest: REJECTED → REVISION_REQUIRED
→ GU erstellt neuen TaktRequest
→ alter TaktRequest: REVISION_REQUIRED → SUPERSEDED
→ neue takt_versions-Eintrag
```

### 2.5 NU sendet REJECTED → GU beendet Abstimmung

```
TaktRequest status = REJECTED (oder ALTERNATIVES_PROPOSED)
GU entscheidet: CLOSE_WITHOUT_AGREEMENT
→ TaktRequest: → CANCELLED
→ Takt wird NICHT automatisch gelöscht oder CANCELLED gesetzt
→ falls keine weitere offene Abstimmung: takte.lifecycle_status kann auf PLANNED zurückgesetzt werden
```

---

## 3. Architekturregeln (verbindlich)

| Nr. | Regel |
|-----|-------|
| 1 | Eine TaktResponse ist nach dem Versand **unveränderlich**. Kein UPDATE auf `takt_responses`. |
| 2 | Eine GU-Entscheidung wird als eigenes fachliches Objekt in `takt_response_decisions` gespeichert. |
| 3 | Eine vorhandene TaktResponse wird nicht überschrieben. Neue Runde → neuer TaktRequest. |
| 4 | Pro TaktResponse darf **nur eine** abschließende GU-Entscheidung existieren. (`UNIQUE` auf `response_id` in `takt_response_decisions`.) |
| 5 | Eine akzeptierte Alternative muss zur referenzierten Response gehören. Keine Cross-Response-Referenz. |
| 6 | Eine akzeptierte Alternative darf keine internen NU-Daten enthalten. Nur Zeitfenster, Rang, `crewSize`, `conditions`. |
| 7 | Eine Änderung von Taktinhalt oder Zeitraum erzeugt eine neue `takt_versions`-Eintrag mit inkrementierter Versionsnummer. |
| 8 | Eine reine Statusbestätigung (`CONFIRM_ACCEPTED` ohne Inhalt der Takt) muss nicht zwingend eine neue Inhaltsversion erzeugen. |
| 9 | Eine neue Abstimmungsrunde erzeugt einen neuen `takt_requests`-Eintrag. |
| 10 | Die alte TaktRequest wird beim Erstellen der neuen Runde auf `SUPERSEDED` gesetzt (`supersedesRequestId` gesetzt). |
| 11 | Alle bisherigen Requests, Responses, Alternativen und Entscheidungen bleiben historisch erhalten. Keine physischen Löschungen in Produktion. |
| 12 | GU-Entscheidungen werden über den simulierten Datenraum an den NU zurückgemeldet (Task 6.6, implementiert via `TAKT_RESPONSE_ACCEPTED`, `TAKT_RESPONSE_REVISION_REQUESTED`, `TAKT_REQUEST_CANCELLED`). |
| 13 | Der Hub erhält keine zusätzlichen vollständigen Fachdaten — nur Entscheidungstyp und Referenz-IDs. |

---

## 4. Geplante GU-Entscheidungstypen

### `CONFIRM_ACCEPTED`

Der NU hat den ursprünglichen Takt bestätigt (`takt_responses.decision = ACCEPTED`). Der GU übernimmt diese Bestätigung ohne eigene Inhaltsänderung.

**Zulässig bei Response-Entscheidung:** `ACCEPTED`  
**Nicht zulässig bei:** `REJECTED` (kein Zeitfenster zum Bestätigen)

**Effekt:** `takt_requests.status` bleibt `ACCEPTED`. `takte.lifecycle_status` → `CONFIRMED`.

### `ACCEPT_ALTERNATIVE`

Der GU wählt genau eine vom NU vorgeschlagene Alternative (`acceptedAlternativeId` muss gesetzt sein und zur Response gehören).

**Zulässig bei Response-Entscheidung:** `ALTERNATIVES_PROPOSED`  
**Nicht zulässig bei:** `ACCEPTED`, `REJECTED`

**Effekt:** `takt_requests.status`: `ALTERNATIVES_PROPOSED` → `ACCEPTED`. Takt erhält neue Version mit `sourceType = ACCEPTED_ALTERNATIVE`.

### `REQUEST_REVISION`

Keine Antwortvariante passt. Der Takt soll überarbeitet und erneut koordiniert werden.

**Zulässig bei Response-Entscheidung:** `ALTERNATIVES_PROPOSED`, `REJECTED`  
**Auch zulässig bei:** `ACCEPTED` (GU kann trotz Bestätigung inhaltliche Überarbeitung wünschen)

**Effekt:** `takt_requests.status` → `REVISION_REQUIRED`. Folgeaktion: neue Version + neuer Request (Aufgabe 6.4).

### `CLOSE_WITHOUT_AGREEMENT`

Die konkrete Abstimmungsrunde wird ohne Vereinbarung beendet. Der Takt wird dadurch **nicht** automatisch gelöscht.

**Zulässig bei:** Alle offenen Antwortstatus (`ACCEPTED`, `ALTERNATIVES_PROPOSED`, `REJECTED`)

**Effekt:** `takt_requests.status` → `CANCELLED`. `takte.lifecycle_status` bleibt erhalten (nur manuell auf `CANCELLED` setzbar, nicht automatisch).

---

## 5. Taktversionierung

### 5.1 Aktuelle Version

`takte.version` ist ein Integer (default 1), der bei inhaltlichen Änderungen inkrementiert wird. Er dient der Kollisionserkennung: Ein `takt_requests.takt_version` der nicht mehr dem aktuellen `takte.version` entspricht, signalisiert einen veralteten Request.

### 5.2 Unveränderliche Versionshistorie (Zielzustand)

Tabelle `takt_versions` (ab Aufgabe 6.2):

```
takt_versions
  id
  takt_id          → takte.id (RESTRICT)
  version          → Integer ≥ 1, UNIQUE per takt_id
  source_type      → INITIAL | MANUAL_EDIT | ACCEPTED_ALTERNATIVE | REVISION
  source_request_id   → nullable FK takt_requests
  source_response_id  → nullable FK takt_responses
  source_decision_id  → nullable FK takt_response_decisions
  snapshot_payload → JSONB (vollständiger fachlicher Taktstand)
  content_hash     → deterministischer Hash für Inhaltsvergleich
  created_by_user_id  → FK users
  created_at
```

Frühere Versionen werden **niemals** überschrieben.

### 5.3 Ursprungsarten

| Typ | Wann |
|-----|------|
| `INITIAL` | Ersteintrag für jeden bestehenden und neuen Takt |
| `MANUAL_EDIT` | GU ändert Taktinhalt ohne Koordinationskontext |
| `ACCEPTED_ALTERNATIVE` | GU akzeptiert eine NU-Alternative (`ACCEPT_ALTERNATIVE`) |
| `REVISION` | Neue Abstimmungsrunde nach `REQUEST_REVISION` |

### 5.4 Zusammenhang mit Request, Response und GU-Entscheidung

```
takt_versions.source_request_id  → der TaktRequest, der diese Version ausgelöst hat
takt_versions.source_response_id → die NU-Response, aus der die Alternative stammt
takt_versions.source_decision_id → die GU-Entscheidung, die die Version erzeugt hat
```

Bei `CONFIRM_ACCEPTED`: keine neue Version notwendig (keine Inhaltsänderung).  
Bei `ACCEPT_ALTERNATIVE`: neue Version mit allen drei Referenzen gesetzt.  
Bei `REQUEST_REVISION`: neue Version mit `sourceType = REVISION`, `source_decision_id` gesetzt.

### 5.5 Inhaltsänderung vs. Statusänderung

| Art | Neue Version? | `takte.version` inkrementiert? |
|-----|---|---|
| `CONFIRM_ACCEPTED` | Nein | Nein |
| `ACCEPT_ALTERNATIVE` (Zeitraum übernehmen) | Ja | Ja |
| `REQUEST_REVISION` (Inhalt überarbeiten) | Ja | Ja |
| `CLOSE_WITHOUT_AGREEMENT` | Nein | Nein |
| Manuelle Taktbearbeitung durch GU | Ja | Ja |

---

## 6. Statusregeln

### 6.1 Bestätigung des ursprünglichen Zeitfensters (`CONFIRM_ACCEPTED`)

```
TaktRequest bleibt ACCEPTED (kein weiterer Übergang)
takte.lifecycle_status → CONFIRMED
Keine neue takt_versions
```

### 6.2 Annahme einer Alternative (`ACCEPT_ALTERNATIVE`)

```
TaktRequest: ALTERNATIVES_PROPOSED → ACCEPTED
takte.version++
Neue takt_versions (sourceType = ACCEPTED_ALTERNATIVE)
takte.lifecycle_status → CONFIRMED
```

### 6.3 Überarbeitung anfordern (`REQUEST_REVISION`)

```
TaktRequest: ALTERNATIVES_PROPOSED → REVISION_REQUIRED
           oder: REJECTED → REVISION_REQUIRED
           oder: ACCEPTED → REVISION_REQUIRED

Folgeschritt POST /revisions (Aufgabe 6.5, implementiert):
  takte.version++
  Neue takt_versions (sourceType = REVISION)
  Neuer TaktRequest erstellen (DRAFT)
  Alter TaktRequest: REVISION_REQUIRED → SUPERSEDED
  takte.lifecycle_status → IN_COORDINATION
```

### 6.4 Abschluss ohne Vereinbarung (`CLOSE_WITHOUT_AGREEMENT`)

```
TaktRequest → CANCELLED
takte darf NICHT automatisch auf CANCELLED gesetzt werden
Falls keine weitere offene Abstimmung: takte.lifecycle_status kann auf PLANNED zurück
```

**Regel:** Ein Takt wird nur dann `CANCELLED`, wenn der GU ausdrücklich den Takt selbst storniert — nicht als Nebeneffekt einer geschlossenen Abstimmungsrunde.

---

## 7. Bewertung der bestehenden Implementierung

### 7.1 Wiederverwendbare Funktionen

| Funktion | Datei | Verwendung |
|---|---|---|
| `createTaktResponse()` | `takt-response-repository.ts` | Bleibt unverändert — NU-seitig |
| `markTaktRequestSuperseded()` | `takt-request-repository.ts` | Wird für neue Runden verwendet |
| `updateTaktRequestStatus()` | `takt-request-repository.ts` | Für alle Statusübergänge |
| `assertValidTaktRequestTransition()` | `takt-request-transitions.ts` | Für Validierung in GU-Entscheidungsservice |
| `getTaktRequestDetailForGu()` | `takt-request-repository.ts` | GU-Ansicht, bleibt kompatibel |
| JWT-Middleware + `requireGuOrg()` | `auth.ts` / `routes` | Berechtigungsprüfung für GU-Endpoint |

### 7.2 Problematische Vermischung von Takt- und Requeststatus

**Status-Dualismus:** `takte` hat zwei Statusspalten:
- `status` (Legacy): `GEPLANT`, `VERGEBEN`, `ALTERNATIV`, `BESTAETIGT`, `ABGELEHNT`, `STORNIERT`
- `lifecycle_status` (neu): `DRAFT`, `PLANNED`, `IN_COORDINATION`, `CONFIRMED`, `CANCELLED`

Die Legacy-`status`-Werte werden in der neuen Koordinationslogik **nicht** aktualisiert. Das erzeugt Inkonsistenzen: Ein Takt kann `lifecycle_status = CONFIRMED` haben, aber `status = GEPLANT`.

**Keine Trennung von Entscheidungslogik und Transportlogik:** Die Response-Verarbeitung (`POST /responses`) aktualisiert gleichzeitig den Requeststatus — diese beiden Aspekte sind verschränkt, aber noch handhabbar.

### 7.3 Alternative-Übernahme in den Takt (implementiert, Task 6.4)

`applyAcceptAlternative()` in `takt-version-service.ts`:
- Übernimmt `proposedStart/End` als neue `takte.planned_start/end`
- Erstellt neuen `takt_versions`-Eintrag (sourceType = `ACCEPTED_ALTERNATIVE`)
- Whitelist: nur `timeWindow.start/end`, `crewSize`, `conditions` — keine internen NU-Daten
- Optimistic Lock auf `takte.version`

### 7.4 Historische Änderungen

Historische Anfragen, Antworten und Snapshots bleiben erhalten (RESTRICT / write-once Constraints). Verluste entstehen nur wenn in Entwicklungsumgebungen physisch gelöscht wird (CASCADE an takt_request_snapshots bei Request-Löschung — aber nur erreichbar bei explizitem DELETE, nicht durch normale Flows).

**Behoben:** `takt_versions`-Tabelle (Task 6.2 angelegt, 6.4/6.5 aktiv befüllt) archiviert alle inhaltlichen Versionsstände des Takts unveränderlich mit `sourceType`, `snapshotPayload` und `contentHash`. Frühere Versionen können nie überschrieben werden.

**FK-Abhängigkeit:** `takt_versions.source_decision_id` → `takt_response_decisions.id` (RESTRICT). Beim Cleanup immer zuerst `takt_versions`, dann `takt_response_decisions` löschen.

### 7.5 Endpunkt-Kompatibilität

Folgende bestehenden Endpunkte müssen nach der Umstellung erhalten bleiben:

| Endpunkt | Kompatibilitätsanforderung |
|---|---|
| `POST /takt-requests` | Unverändert — erzeugt neue Anfragen |
| `POST /takt-requests/:id/send` | Unverändert — sendet Anfrage |
| `POST /takt-requests/:id/responses` | Unverändert — NU-seitig |
| `GET /takt-requests/:id` | Unverändert — neues Feld `decision` später ergänzbar |
| `GET /takt-requests` | Unverändert |
| `GET /takt-details/:requestId` | Unverändert — NU-seitig |

### 7.6 Migrationsrisiken

| Risiko | Beschreibung | Mitigierung |
|---|---|---|
| Status-Dualismus | `takte.status` und `takte.lifecycle_status` divergieren | Schriftlich festhalten welche Spalte maßgeblich ist; Legacy-Spalte schrittweise ablösen |
| `ALTERNATIVES_PROPOSED` → `ACCEPTED` direkt | Übergang existiert in Transition-Tabelle, aber ohne GU-Entscheidungsobjekt — darf nicht mehr direkt verwendet werden | Neuer Endpoint erzwingt Entscheidungsobjekt; direkter Übergang via `updateTaktRequestStatus` weiterhin möglich aber nur im Service |
| Fehlende Inhaltsversion | Bestehende Takte haben keine `takt_versions` — muss nachträglich befüllt werden | Initialisierungsmigration (Aufgabe 6.2) erzeugt je einen `INITIAL`-Eintrag |
| Kaskadenlöschung von Alternativen | `takt_response_alternatives` wird bei Response-Löschung kaskadiert — historisch relevante Alternativen könnten verloren gehen | In Produktion nie Responses löschen; nur in Entwicklungsumgebungen |
| Idempotency-Key-Kollision | Gleicher Key, anderer Inhalt muss abgelehnt werden | Constraint + explizite Prüfung im Service (Aufgabe 6.3) |
| Doppelte Entscheidungen | Ohne UNIQUE-Constraint könnte eine zweite Entscheidung eine Response überschreiben | UNIQUE auf `response_id` in `takt_response_decisions` (Aufgabe 6.2) |
