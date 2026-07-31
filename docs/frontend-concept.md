# Frontend-Konzept – TaktKoord

Stand: Sprint 4 (Analyse-Basis für Sprint 5)

---

## 1. Analysierte Anwendungen und Seiten

### 1.1 GU-Anwendung (`artifacts/ag-app`)

**Router:** Wouter mit Basis `import.meta.env.BASE_URL`  
**Auth-Kontext:** `src/contexts/auth-context.tsx` — `{ orgId, orgType: 'AG'|'AN', hubAdmin, user }`  
**Auth-Guard:** `src/components/auth-guard.tsx` — Weiterleitung zu `/login` ohne aktive Sitzung  

| Route | Komponente | Datei |
|---|---|---|
| `/` | Dashboard | `src/pages/dashboard.tsx` |
| `/projects` | Projektliste | `src/pages/projects.tsx` |
| `/projects/:projectId` | Projektdetail (Gantt + Netzplan) | `src/pages/project-detail.tsx` |
| `/projects/:projectId/proposals` | Projektbezogene Gegenangebote | `src/pages/project-proposals.tsx` |
| `/proposals` | Alle ausstehenden Delegationen | `src/pages/proposals.tsx` |
| `/contractors` | Nachunternehmerverwaltung | `src/pages/contractors.tsx` |
| `/settings` | Profil, Mitglieder, Webhooks | `src/pages/settings.tsx` |
| `/login`, `/register` | Authentifizierung | öffentlich |

**Sidebar-Navigation** (`src/components/layout.tsx`):
- Dashboard (`/`)
- Projekte (`/projects`)
- Angebote (`/proposals`)
- Nachunternehmer (`/contractors`)
- Einstellungen (`/settings`)

**Seitendetails:**

- **Dashboard:** Projektkennzahlen (gesamt / ausstehend / kritisch / bestätigt), nächste 7 Tage Takte, Aktivitätsprotokoll.
- **Projektdetail:** Haupt-Planungsansicht mit Tab-Umschalter Gantt ↔ Netzplan. Takt-CRUD via Sheet-Panel, Abhängigkeiten, Delegation starten.
  - Gantt: `gantt-task-react`, eigene Tooltips mit Vorgängern.
  - Netzplan: `src/components/NetzplanView.tsx` — SVG-Eigenimplementierung mit Schichtlayoutalgorithmus (`computeLayout`), kritischer Pfad (`computeCriticalPath`), Zoom, interaktive Knoten.
- **Proposals/ProjectProposals:** Delegationen mit Status `ALTERNATIVE_PROPOSED`. Polling alle 30 Sekunden (`refetchInterval: 30_000`).

**Verwendete API-Hooks** (aus `@workspace/api-client-react`):

| Bereich | Hooks |
|---|---|
| Projekte | `useGetProject`, `useListProjects`, `useCreateProject` |
| Takte | `useListTakte`, `useCreateTakt`, `useUpdateTakt`, `useDeleteTakt` |
| Abhängigkeiten | `useListTaktDependencies`, `useCreateTaktDependency`, `useDeleteTaktDependency` |
| Delegation (alt) | `useCreateDelegation`, `useUpdateDelegation`, `useListDelegations`, `useListDelegationResponses`, `useUpdateDelegationResponse` |
| TaktRequest (neu) | `useCreateTaktRequestWithSnapshot`, `useSendTaktRequest`, `useGetTaktRequestDetails` |
| Org/Auth | `useGetMyProfile`, `useListOrganizationMembers`, `useListOrganizations`, `useGetAgDashboard` |
| Webhooks | `useListWebhooks`, `useCreateWebhook`, `useDeleteWebhook` |

---

### 1.2 NU-Anwendung (`artifacts/an-app`)

**Router:** Wouter mit Basis `import.meta.env.BASE_URL`  
**Auth-Kontext:** `src/contexts/auth.tsx` — prüft `orgType === 'AN'`; AN-fremde Sitzungen werden aktiv abgewiesen  

| Route | Komponente | Datei |
|---|---|---|
| `/` | Dashboard | `src/pages/dashboard.tsx` |
| `/requests` | Delegationsliste (Eingang) | `src/pages/requests.tsx` |
| `/requests/:delegationId` | Delegationsdetail | `src/pages/request-detail.tsx` |
| `/gantt` | Gantt-Ressourcenansicht | `src/pages/gantt.tsx` |
| `/resources` | Ressourcenverwaltung | `src/pages/resources.tsx` |
| `/settings` | Profil, Mitglieder, Webhooks | `src/pages/settings.tsx` |
| `/login`, `/register` | Authentifizierung | öffentlich |

**Sidebar-Navigation** (`src/components/layout.tsx`):
- Dashboard (`/`)
- Requests (`/requests`)
- Gantt (`/gantt`)
- Resources (`/resources`)
- Einstellungen (`/settings`)

**Seitendetails:**

- **Dashboard:** Bevorstehende Fristen, ausstehende Anfragen, Ressourcenauslastung. Polling: 30 s.
- **Requests:** Filterbare Delegationsliste (Status-Dropdown). Polling: 5 s, kein Hintergrundpolling. Tabelle mit Projekt, Gewerk/Zone, AG, Zeitraum, Puffer, Status.
- **RequestDetail:** Delegationsdetails, Antworten (annehmen/ablehnen/Gegenvorschlag). Polling: 5 s.
- **Gantt:** Ressourcenzuordnungen visuell, `gantt-task-react`.
- **Resources:** CRUD für Ressourcentypen EMPLOYEE / EQUIPMENT / VEHICLE / TOOL. Inline-Bearbeitung ohne Dialog.

**Verwendete API-Hooks:**

| Bereich | Hooks |
|---|---|
| Dashboard | `useGetAnDashboard` |
| Delegation (alt) | `useListDelegations`, `useGetDelegation`, `useListDelegationResponses`, `useCreateDelegationResponse` |
| TaktRequest (neu) | `useRunAvailabilityCheck`, `useGetLatestAvailabilityCheck`, `useSubmitNuResponse`, `useGetTaktRequestDetails` |
| Ressourcen | `useListResources`, `useCreateResource`, `useUpdateResource`, `useDeleteResource` |
| Ressourcenplanung | `useListResourceAssignments` |
| Org/Auth | `useGetMyProfile`, `useUpdateMyProfile`, `useListOrganizationMembers`, `useAddOrganizationMember` |
| Webhooks | `useListWebhooks`, `useCreateWebhook` |

---

### 1.3 Hub-Anwendung (`artifacts/hub-app`)

**Router:** Wouter mit Basis `import.meta.env.BASE_URL`  
**Auth-Kontext:** `src/contexts/auth.tsx` — prüft `user.hubRole === 'ADMIN'` für Admin-Bereiche  
**API-Base:** `/api/hub` (direkter REST-Client, keine Orval-Hooks)  

| Route | Komponente | Datei |
|---|---|---|
| `/` | Dashboard | `src/pages/dashboard.tsx` |
| `/messages` | Nachrichtenliste | `src/pages/messages.tsx` |
| `/messages/:delegationId` | Nachrichtendetail + Timeline | `src/pages/message-detail.tsx` |
| `/admin/users` | Benutzerverwaltung (Admin) | `src/pages/admin-users.tsx` |
| `/login`, `/register` | Authentifizierung | öffentlich |

**Sidebar-Navigation** (`src/components/layout.tsx`):
- Dashboard (`/`)
- Nachrichten (`/messages`)
- Alle Nutzer (`/admin/users`) — nur bei `hubRole === 'ADMIN'`

**Seitendetails:**

- **Dashboard:** Statistiken (ausstehend / bestätigt / abgelehnt), letzte 50 Nachrichten als Tabelle mit Badge-Typen.
- **MessagesPage:** Filterbare Nachrichtenliste (nach Typ, Status), Admin kann löschen (AlertDialog).
- **MessageDetailPage:** Takt-/Projektzusammenfassung + vertikale Event-Timeline (`DELEGATION_CREATED`, `DELEGATION_CONFIRMED`, …) mit JSON-Payload-Anzeige.

**Inline-Query-Muster** (kein Orval, direkte `useQuery`/`useMutation`):

| Key | Endpunkt |
|---|---|
| `['hub-messages', 'dashboard']` | Top 50 Nachrichten |
| `['hub-messages', filterType]` | Gefilterte Nachrichtenliste |
| `['hub-timeline', delegationId]` | Delegations-Ereignishistorie |
| `['admin-users']` | Alle Nutzer (Hub-Admin) |

---

## 2. Wiederverwendbare Komponenten

Die folgenden Komponenten und Muster können für Sprint-5-Seiten direkt übernommen werden:

| Komponente / Muster | Fundort | Verwendung |
|---|---|---|
| shadcn/ui (`Table`, `Badge`, `Dialog`, `Sheet`, `Select`, `Card`, `Skeleton`) | `*/src/components/ui/` | Alle drei Apps, einheitlich |
| `TaktStatusBadge` | `an-app/src/components/takt-status-badge.tsx` | Status-Darstellung in Tabellen |
| Gantt-Chart (`gantt-task-react`) | AG + AN | Zeitplan-Visualisierung |
| Netzplan-View (SVG, eigener Algorithmus) | `ag-app/src/components/NetzplanView.tsx` | Strukturplan |
| `Loader2` (Lucide, zentriert) | AG + AN + Hub | Ladeindikator |
| `Skeleton`-Blöcke | alle | Ladezustands-Platzhalter |
| `Empty`-Komponente | `an-app/src/components/ui/empty.tsx` | Leere-Listen-Darstellung |
| `useToast` | AG + Hub | Toast-Benachrichtigungen |
| `AlertDialog` für destruktive Aktionen | Hub | Löschbestätigung |
| i18n via `react-i18next` / `useTranslation` | AG + AN | Mehrsprachigkeit |
| `customFetch` mit Bearer-Token-Injektion | `lib/api-client-react` | Alle API-Aufrufe |
| Polling via `refetchInterval` | alle | Echtzeit-Updates |
| Wouter `Link` + Basename | alle | Interne Navigation |

---

## 3. Neue Seiten und Routen (empfohlen ab Sprint 5)

### 3.1 GU-Anwendung – neue Seiten

| Route | Seite | Beschreibung |
|---|---|---|
| `/takt-requests` | TaktAnfragen-Übersicht | Liste aller TaktRequests der GU-Org (Sprint 5.2) |
| `/takt-requests/:requestId` | TaktAnfragen-Detail | Anfragestatus, Snapshot-Vorschau, Antwortvergleich (Sprint 5.x) |

Einstiegspunkte für Erstell-Dialog (Sprint 5.3):
- Schaltfläche in `/takt-requests` (Übersicht)
- Kontextaktion in `/projects/:projectId` (Takt-Sheet)

### 3.2 NU-Anwendung – neue Seiten

| Route | Seite | Beschreibung |
|---|---|---|
| `/takt-requests` | TaktAnfragen-Eingang | Sprint-4-API-Anfragen (ersetzt `/requests` schrittweise) |
| `/takt-requests/:requestId` | TaktAnfragen-Detail | Snapshot abrufen, Machbarkeitsprüfung starten, Antwort senden |
| `/local-projects` | Lokale Projekte | NU-interne Projektplanung |
| `/resource-bookings` | Ressourcenbuchungen | Buchungsübersicht |
| `/feasibility` | Machbarkeitsprüfungen | Übersicht laufender und abgeschlossener Checks |

### 3.3 Hub-Anwendung – neue Seiten

| Route | Seite | Beschreibung |
|---|---|---|
| `/process-chains` | Prozessketten | Korrelation TaktRequest ↔ TaktResponse |
| `/failed-deliveries` | Fehlgeschlagene Zustellungen | FAILED-Status-Nachrichten, Retry-Aktion |
| `/system-status` | Systemstatus | Transport-Health, Outbox-Queue-Übersicht |

---

## 4. Navigationsänderungen (empfohlen)

### 4.1 GU-Sidebar

Aktuell:
```
Dashboard | Projekte | Angebote | Nachunternehmer | Einstellungen
```

Ziel:
```
Dashboard
Projekte
  └─ [Projektdetail mit Gantt / Netzplan]
Taktanfragen          ← NEU (Sprint 5.2)
Antworten             ← bestehend (Proposals, bleibt erhalten)
Nachunternehmer
Einstellungen
```

Bestehende `/proposals`- und `/projects/:id/proposals`-Seiten bleiben unverändert erreichbar.

### 4.2 NU-Sidebar

Aktuell:
```
Dashboard | Requests | Gantt | Resources | Einstellungen
```

Ziel:
```
Dashboard
Taktanfragen          ← NEU (ersetzt/ergänzt Requests)
Lokale Projekte       ← NEU
Ressourcen
Ressourcenplanung     ← NEU (Buchungsübersicht)
Machbarkeitsprüfungen ← NEU
Einstellungen
```

Bestehende `/requests`-Seite bleibt als Delegation-Inbox erhalten.

### 4.3 Hub-Sidebar

Aktuell:
```
Dashboard | Nachrichten | Alle Nutzer (Admin)
```

Ziel:
```
Nachrichten
Prozessketten         ← NEU
Fehlgeschlagene Zustellungen ← NEU
Systemstatus          ← NEU
Alle Nutzer (Admin)
```

---

## 5. Zielnavigation und Hauptprozesse

### 5.1 GU – Hauptprozess

```
Takt auswählen (Projektdetail / Taktplan)
  → Taktanfrage vorbereiten (Dialog: Takt + NU + Konfiguration)
  → freigegebene Daten prüfen (Notification-Vorschau + Snapshot-Vorschau)
  → Als Entwurf speichern  →  POST /takt-requests (DRAFT)
  → Anfrage senden          →  POST /takt-requests/:id/send (DELIVERED)
  → Status verfolgen        →  Taktanfragen-Übersicht mit Polling
  → Antwort erhalten        →  GU-Inbox (TAKT_RESPONSE_SUBMITTED)
  → Alternativen vergleichen →  Detailseite mit Antwortvergleich
  → Entscheidung treffen
```

**GU-Zielnavigation:**
```
Dashboard
Projekte
Taktplan (Gantt / Netzplan in Projektdetail)
Taktanfragen
Antworten
Nachunternehmer
```

### 5.2 NU – Hauptprozess

```
Notification empfangen   →  TAKT_REQUEST_NOTIFICATION in NU-Inbox
  → Taktdetails abrufen  →  GET /takt-requests/:id/details (Snapshot)
  → Anfrage im lokalen Planungskontext prüfen
  → Machbarkeitsprüfung starten  →  POST /takt-requests/:id/availability-checks
  → Ergebnis bewerten (FEASIBLE / FEASIBLE_WITH_ALTERNATIVES / NOT_FEASIBLE)
  → Antwort bearbeiten   →  Entscheidung + optionale Alternativen
  → Antwort senden       →  POST /takt-requests/:id/responses
```

**NU-Zielnavigation:**
```
Dashboard
Taktanfragen
Lokale Projekte
Ressourcen
Ressourcenplanung
Machbarkeitsprüfungen
```

### 5.3 Hub – Hauptprozess

```
Nachricht sehen         →  Nachrichtenliste (Inbox-Tabelle)
  → technische Zustellung prüfen   →  Outbox-Status (PENDING/SENT/DELIVERED/FAILED)
  → Request und Response korrelieren →  Prozessketten-Ansicht
  → Fehler erkennen     →  FAILED-Markierung, Fehlermeldung
  → Zustellung erneut auslösen     →  Retry-Aktion (geplant)
```

**Hub-Zielnavigation:**
```
Nachrichten
Prozessketten
Fehlgeschlagene Zustellungen
Systemstatus
```

---

## 6. UI-Grundsätze

1. **Fachliche Trennung:** GU und NU sehen grundlegend unterschiedliche Daten. Die GU-App zeigt ausschließlich eigene Projekts- und Anfragedaten. Die NU-App zeigt ausschließlich eingehende Anfragen und interne Ressourcendaten.

2. **Hub zeigt keine Sachdaten:** Der Hub zeigt keine vollständigen Takt- oder Ressourcendaten, nur Transport-Metadaten (messageId, messageType, Status, Timestamps).

3. **Notification ≠ Snapshot:** Notification und Takt-Snapshot werden immer getrennt dargestellt. Die Notification enthält nur Referenzen; der Snapshot enthält die freigegebenen Taktdaten.

4. **Technischer Status ≠ Fachlicher Status:** Beide werden separat visualisiert (z. B. separate Badge-Spalten in Tabellen). Verwechslung ist durch unterschiedliche Farbcodierung zu verhindern.

5. **Interne NU-Konflikte bleiben intern:** `internalResultPayload`, `resourceId`, `localProjectId` und ähnliche Felder dürfen nur in der NU-App sichtbar sein. GU sieht ausschließlich `publicResult`.

6. **GU sieht nur freigegebene Antwort:** `TAKT_RESPONSE_SUBMITTED`-Payload enthält ausschließlich öffentliche Felder (Entscheidung, generische Reason-Codes, Zeitfenster-Alternativen).

7. **Wiederverwendung:** Bestehende shadcn/ui-Komponenten, Tabellenmuster, Skeleton-Zustände und Query-Strukturen werden bevorzugt. Keine vollständige Neugestaltung ohne nachgewiesene Notwendigkeit.

8. **Alte Seiten bleiben:** Delegation-Seiten (`/proposals`, `/requests`, `/requests/:id`) bleiben vollständig erreichbar und funktional. Neue TaktRequest-Seiten werden parallel ergänzt.

---

## 7. Statusdarstellung

### 7.1 Technische Nachrichtenstatus

Darstellung: kompaktes Badge, eigene Farbgruppe (blau-/grautöne), immer mit Präfix-Label „Nachrichtenstatus" in Spaltenkopf.

| Status | Bedeutung | Empfohlene Badge-Variante |
|---|---|---|
| `PENDING` | Noch nicht versendet | grau / outline |
| `SENT` | Versendet, Zustellung ausstehend | blau / outline |
| `DELIVERED` | Technisch zugestellt | blau / filled |
| `READ` | Empfänger hat gelesen | grün / filled |
| `FAILED` | Zustellung fehlgeschlagen | rot / destructive |

### 7.2 Fachliche Requeststatus

Darstellung: kompaktes Badge, eigene Farbgruppe (amber/grün/rot), immer mit Präfix-Label „Anfragestatus" in Spaltenkopf.

| Status | Anzeigename (DE) | Farbe |
|---|---|---|
| `DRAFT` | Entwurf | grau |
| `SENT` | Versendet | blau |
| `DELIVERED` | Zugestellt (technisch) | blau |
| `DETAILS_RETRIEVED` | Details abgerufen | amber |
| `UNDER_REVIEW` | In Prüfung | amber |
| `ACCEPTED` | Bestätigt | grün |
| `ALTERNATIVES_PROPOSED` | Alternativen vorgeschlagen | orange |
| `REJECTED` | Abgelehnt | rot |
| `REVISION_REQUIRED` | Überarbeitung erforderlich | orange |
| `CANCELLED` | Storniert | grau / durchgestrichen |
| `EXPIRED` | Abgelaufen | grau |
| `SUPERSEDED` | Ersetzt | grau |

> **Wichtig:** `DELIVERED` (fachlich) bedeutet ausschließlich technische Zustellung. Es darf nicht als inhaltliche Zustimmung oder Bestätigung dargestellt werden — insbesondere keine grüne Farbe oder Häkchen-Icon für diesen Status.

---

## 8. Polling-Verhalten

| Seite | Intervall | Hintergrund |
|---|---|---|
| AN Requests-Liste | 5 s | nein |
| AN Request-Detail | 5 s | nein |
| AN Dashboard | 30 s | ja |
| GU Proposals / ProjectProposals | 30 s | ja |
| GU Taktanfragen (neu, Sprint 5.2) | 5–10 s (nur offene) | nein |
| Hub Dashboard | einmalig | — |

Abgeschlossene Anfragen (ACCEPTED, REJECTED, CANCELLED, EXPIRED, SUPERSEDED) erfordern kein Polling.

---

## 9. Responsive-Anforderungen

- **Desktop als primärer Anwendungsfall.** Die Planungs- und Koordinierungsansichten (Gantt, Netzplan, Taktanfragen) sind auf Desktop-Bildschirme ausgerichtet.
- **Tabellen auf kleineren Ansichten nutzbar:** Horizontales Scrollen via `overflow-x-auto` (bereits in AN-App umgesetzt). Keine kritischen Spalten ausblenden.
- **Komplexe Vergleichsansichten** (Alternativen-Vergleich, Snapshot-Vorschau) dürfen horizontal scrollbar sein.
- **Dialoge** dürfen auf kleinen Bildschirmen (`< md`) als Vollbild erscheinen (shadcn `DialogContent` mit `sm:max-w-full`).
- **Keine Hover-only-Aktionen:** Alle Aktionsschaltflächen (Senden, Stornieren, Antwort anzeigen) müssen ohne Hover erreichbar sein — keine rein Hover-basierte Aktionsspalten.

---

## 10. Lade-, Leer- und Fehlerzustände

**Ladeindikator:**
- `Skeleton`-Blöcke für Tabellen und Karten (alle drei Apps einheitlich)
- `Loader2` (Lucide, `animate-spin`) für inline-Lade­anzeigen und Button-Zustände

**Leere Liste:**
- AG: Zentriertes Icon + Überschrift + Erläuterungstext (Proposals-Muster)
- AN: `Empty`-Komponente (`src/components/ui/empty.tsx`) mit Header/Media/Title/Description

**Fehleranzeige:**
- `isError` aus React Query → Alert-Banner mit Fehlermeldung und „Erneut laden"-Schaltfläche
- Keine technischen Stacktraces im UI
- Mutations-Fehler über `useToast` als Toast-Nachricht

---

## 11. Rollen- und Organisationsprüfung im Frontend

| App | Prüfmechanismus | Effekt bei Verletzung |
|---|---|---|
| AG-App | `AuthGuard` → `orgType: 'AG'` fix bei Registrierung | Weiterleitung zu `/login` |
| AN-App | `auth.tsx` prüft `orgType !== 'AN'` explizit | Logout + Weiterleitung |
| Hub-App | `user.hubRole === 'ADMIN'` für Admin-Routes | Null-Render / Redirect |
| API-Server | JWT + `requireJwt` + `requireOrg`/`requireNuOrg` | 401 / 403 HTTP-Fehler |

Frontend-Prüfungen sind eine UX-Maßnahme; die verbindliche Absicherung erfolgt serverseitig.

---

## 12. Abschlussbericht

### Analysierte Anwendungen und Seiten

- **GU-App:** 7 Routen (Dashboard, Projekte, Projektdetail mit Gantt+Netzplan, Projekt-Proposals, globale Proposals, Contractors, Settings)
- **AN-App:** 6 Routen (Dashboard, Requests, RequestDetail, Gantt, Resources, Settings)
- **Hub-App:** 5 Routen (Dashboard, Messages, MessageDetail, AdminUsers, Login/Register)

### Wiederverwendbare Komponenten

Vollständig wiederverwendbar ohne Anpassung:
- shadcn/ui Basisbibliothek (Table, Badge, Dialog, Sheet, Select, Card, Skeleton, AlertDialog)
- Lucide-Icons (Loader2, AlertTriangle, AlertCircle, ChevronRight, Clock, …)
- `TaktStatusBadge` (AN-App)
- `useToast`, `useQueryClient`, React Query Polling-Muster
- `customFetch` mit automatischem Bearer-Token
- Wouter-Navigation mit Basename
- `format` (date-fns) für Datumsformatierung
- i18n-Struktur (`useTranslation`, `t(...)`)

Wiederverwendbar mit geringer Anpassung:
- Tabellenmuster (Spaltenstruktur der AN Requests-Seite als Vorlage für GU TaktAnfragen)
- Leer-/Fehlerzustandsmuster (leichter Copy der Proposals-Seite)
- Filter-/Select-Muster (bereits in AG und AN vorhanden)
- `refetchInterval`-Polling-Pattern

### Neue Seiten (Bedarf)

**GU-App:**
- `TaktAnfragenPage` (`/takt-requests`) — Sprint 5.2
- `TaktAnfrageDetailPage` (`/takt-requests/:id`) — Sprint 5.x
- Erstell-Dialog `CreateTaktRequestDialog` — Sprint 5.3

**AN-App:**
- `TaktAnfragenPage` (`/takt-requests`) auf Basis der Sprint-4-API
- `TaktAnfrageDetailPage` mit Machbarkeitsprüfung + Antwort-Formular
- `LocalProjectsPage`, `ResourceBookingsPage`, `FeasibilityPage`

**Hub-App:**
- `ProcessChainsPage` — Korrelation Request ↔ Response
- `FailedDeliveriesPage` — FAILED-Nachrichten + Retry
- `SystemStatusPage` — Transport-Health

### Navigationsänderungen

| App | Änderung | Priorität |
|---|---|---|
| GU | „Taktanfragen" zwischen Projekte und Angebote einfügen | Sprint 5.2 |
| AN | „Taktanfragen" neben / anstatt „Requests" ergänzen | Sprint 5.x |
| AN | „Lokale Projekte", „Ressourcenplanung", „Machbarkeitsprüfungen" ergänzen | Sprint 5.x |
| Hub | „Prozessketten", „Fehlgeschlagene Zustellungen", „Systemstatus" ergänzen | Sprint 5.x |

Bestehende Einträge bleiben in allen drei Apps erhalten.

### UX-Risiken

| Risiko | Beschreibung | Empfehlung |
|---|---|---|
| Status-Verwechslung | `DELIVERED` (technisch) könnte als inhaltliche Bestätigung missverstanden werden | Immer zwei separate Badge-Spalten; `DELIVERED` nie grün/Häkchen |
| Datenschutz im Frontend | NU-interne Felder (`resourceId`, `internalResultPayload`) könnten versehentlich in GU-sichtbaren Komponenten gerendert werden | Strikte Typen aus `NuResponseCreate`/`NuResponseResult`; kein `any`-Spreading |
| Polling auf abgeschlossenen Anfragen | Unnötiger Netzwerkverkehr wenn alle Anfragen terminal-Status haben | `refetchInterval` konditional nur für offene Status aktivieren |
| Hintergrundpolling im AN | `refetchIntervalInBackground: false` bereits korrekt gesetzt; bei Hub-App noch nicht geprüft | Prüfen und ggf. nachziehen |
| Fehlende Leer-/Fehlerzustände in neuen Seiten | Neue TaktRequest-Seiten müssen von Anfang an Lade-, Leer- und Fehlerzustände implementieren | Skeletons + Empty-Komponente als Pflichtbestandteil jeder neuen Seite |
| Keine Orval-Hooks im Hub | Hub-App verwendet direkten REST-Client; neue Sprint-4-Endpunkte sind nicht automatisch verfügbar | Entweder Hub an `@workspace/api-client-react` anschließen oder eigene typed-Wrapper ergänzen |
| Veraltete Delegationsterminologie | Bestehende Seiten nutzen englische Begriffe (Proposals, Requests, ALTERNATIVE_PROPOSED); neue Seiten sollen deutsche Terminologie verwenden | Konsistente i18n-Schlüssel; keine gemischte Terminologie auf einer Seite |
