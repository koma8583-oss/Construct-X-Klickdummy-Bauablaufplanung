# Abschlussbericht: Task 5.2 – GU Taktanfragen-Übersichtsseite

**Datum:** 31. Juli 2026  
**Status:** ✅ Abgeschlossen

---

## Zusammenfassung

Task 5.2 hat die GU-seitige Übersichtsseite für Taktanfragen vollständig implementiert: Backend-Anreicherung (Join über Takt, Projekt, NU-Organisation und Outbox), OpenAPI-Spezifikation, Orval-Codegen, Frontend-Seite mit Filtern und Statusbadges sowie API-Integrationstests.

---

## Implementierte Komponenten

### 1. Backend — angereicherter GU-List-Endpoint

**`artifacts/api-server/src/lib/takt-request-repository.ts`**  
- Neue Funktion `listTaktRequestsForGuEnriched()` mit folgenden Joins:
  - `takt_requests → takte` (Taktbezeichnung, projectId)
  - `takte → projects` (Projektname)
  - `takt_requests → organizations` (NU-Organisationsname)
  - `LEFT JOIN message_outbox ON messageId = 'taktrequest-notification-' || id` (Transportstatus)
- Neuer Interface-Typ `TaktRequestListItem` exportiert.

**`artifacts/api-server/src/routes/takt-requests.ts`**  
- `GET /api/takt-requests` (GU-Pfad) ruft jetzt `listTaktRequestsForGuEnriched()` auf.
- Neuer optionaler Query-Parameter `nuOrgId` für Filterung nach NU-Organisation.

### 2. OpenAPI-Spezifikation

**`lib/api-spec/openapi.yaml`**  
- Neuer `GET /takt-requests` Pfad mit Query-Parametern `status`, `taktId`, `nuOrgId`.
- Neue Schemas:
  - `MessageOutboxStatus` (PENDING | SENT | DELIVERED | READ | FAILED)
  - `TaktRequestListItem` (15 Felder inkl. `outboxStatus` nullable)

### 3. Orval Codegen

- `useListTaktRequests()` Hook generiert in `lib/api-client-react/src/generated/api.ts`
- `getListTaktRequestsQueryKey()` und `getListTaktRequestsQueryOptions()` erzeugt

### 4. Frontend-Seite

**`artifacts/ag-app/src/pages/takt-requests.tsx`**  
- Vollständige Übersichtstabelle mit 11 Spalten
- Zwei getrennte Statusbadges:
  - **Fachlicher Anfragestatus** (amber/green/red/gray-Skala) — zeigt den Koordinationsstand
  - **Technischer Nachrichtenstatus** (blau/indigo/violet-Skala) — zeigt die Transport-Zustellung
  - ⚠️ `DELIVERED` im Fachlichen Status ist niemals grün/Checkmark — bewusst amber/blau gehalten
- Filterelemente: Offen/Abgeschlossen-Tab, Anfragestatus-Dropdown, Projekt-Dropdown (>1), Nachunternehmer-Dropdown (>1)
- Sortierung: Offene Anfragen zuerst, dann neueste zuerst (clientseitig)
- Aktionsschaltflächen je Status: Entwurf bearbeiten, Senden, Erneut zustellen (FAILED-Outbox), Stornieren, Antwort anzeigen
- Polling: `refetchInterval: 8000` ms nur wenn mind. eine offene Anfrage vorhanden
- Loading-State: Skeleton-Zeilen
- Empty-State: Inbox-Icon + Hinweistext
- Error-State: Alert + Retry-Schaltfläche

### 5. Routing & Navigation

**`artifacts/ag-app/src/App.tsx`**  
- Route `/takt-requests` → `TaktRequestsPage` eingetragen

**`artifacts/ag-app/src/components/layout.tsx`**  
- Navigation-Eintrag „Taktanfragen" mit `Send`-Icon zwischen Projekte und Vorschläge

### 6. Internationalisierung

**`de.json` / `en.json`**  
- Neuer Abschnitt `taktRequests.*` mit Titeln, Spaltenüberschriften, Filterbezeichnungen, Statusnamen (beide Statustypen), Aktionsbezeichnungen, Empty-State-Texten
- `nav.taktRequests` in beiden Sprachen

---

## Tests

**`artifacts/api-server/src/__tests__/takt-requests-gu-list.test.ts`** (12 Tests)

| Test | Prüft |
|---|---|
| 401 ohne Token | Authentifizierungspflicht |
| GU erhält angereicherte Liste | Alle Pflichtfelder + Join-Felder vorhanden |
| outboxStatus = null ohne Zustellung | Korrekte LEFT JOIN Logik |
| Fachlicher und technischer Status getrennt | Beide Felder eigenständig; `status` ∈ TaktRequestStatus |
| Filter `status=DRAFT` | Nur DRAFT-Zeilen in Antwort |
| Filter `nuOrgId` | Nur Anfragen an diese NU |
| Fremde GU sieht keine Anfragen | Daten-Isolation korrekt |
| NU als GU → leere Liste | NU hat keine GU-Anfragen |
| Hub-Admin → leer oder kein Fehler | orgId=null → 0 Treffer |
| Nicht-vorhandener taktId-Filter | Leere Liste, kein Fehler |
| Response Shape vollständig | Alle required-Felder present |
| Bestehende Delegation-Routen | GET /api/delegations unverändert |

**Gesamtergebnis:** 416/416 Tests bestanden ✅

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

## Design-Entscheidungen

| Entscheidung | Begründung |
|---|---|
| Fachlicher ≠ Technischer Status-Badge | `DELIVERED` als fachlicher Status bedeutet „Anfrage zugestellt (noch keine Antwort)", nicht „abgeschlossen" — darf nie grün sein. Technischer Outbox-Status nutzt bewusst andere Farbpalette (blau/indigo/violet). |
| LEFT JOIN statt subquery für Outbox | Einfacher und performanter für die erwarteten Datenmengen; Drizzle SQL-Template-Literal für den berechneten MessageId-Join |
| Polling nur bei offenen Anfragen | Spart Bandbreite; kein sinnloser Refresh wenn alle Anfragen terminal |
| Client-seitige Sortierung | Wenige hundert Zeilen pro GU; kein DB-Overhead nötig; flexibel für spätere Anpassungen |
| nuOrgId-Filter serverseitig | Ermöglicht spätere Paginierung ohne Frontend-Anpassung |

---

## Abgrenzung (nicht in Scope)

- Öffnen / Detail-Seite einer einzelnen Anfrage (eigene Task)
- Tatsächliche Send/Cancel/Resend-Aktionen (Schaltflächen vorhanden, aber nicht verdrahtet)
- Paginierung (erst relevant bei sehr großen Datenmengen)
