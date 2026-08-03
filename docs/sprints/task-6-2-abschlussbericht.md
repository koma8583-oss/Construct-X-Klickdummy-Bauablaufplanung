# Abschlussbericht: Task 6.2 – Datenmodelle für GU-Entscheidungen und Taktversionen

**Datum:** August 2026  
**Status:** ✅ Abgeschlossen

---

## Neue Tabellen

### `takt_response_decisions`

Speichert unveränderliche GU-Entscheidungen über eine TaktResponse.

| Spalte | Typ | Constraint |
|---|---|---|
| `id` | TEXT PK | UUID |
| `takt_request_id` | TEXT | NOT NULL, FK → takt_requests (RESTRICT) |
| `response_id` | TEXT | NOT NULL, **UNIQUE**, FK → takt_responses (RESTRICT) |
| `gu_org_id` | TEXT | NOT NULL, FK → organizations |
| `decision_type` | enum | NOT NULL |
| `accepted_alternative_id` | TEXT | nullable, FK → takt_response_alternatives (RESTRICT) |
| `comment` | TEXT | nullable |
| `idempotency_key` | TEXT | nullable |
| `decided_by_user_id` | TEXT | NOT NULL, FK → users |
| `decided_at` | TIMESTAMPTZ | NOT NULL, default NOW() |
| `created_at` | TIMESTAMPTZ | NOT NULL, default NOW() |

**Keine `updated_at`** — write-once by design.

### `takt_versions`

Archiviert unveränderliche Inhaltsstände eines Takts.

| Spalte | Typ | Constraint |
|---|---|---|
| `id` | TEXT PK | UUID |
| `takt_id` | TEXT | NOT NULL, FK → takte (RESTRICT) |
| `version` | INTEGER | NOT NULL, **UNIQUE** per takt_id |
| `source_type` | enum | NOT NULL |
| `source_request_id` | TEXT | nullable, FK → takt_requests (SET NULL) |
| `source_response_id` | TEXT | nullable, FK → takt_responses (RESTRICT) |
| `source_decision_id` | TEXT | nullable, FK → takt_response_decisions (RESTRICT) |
| `snapshot_payload` | JSONB | NOT NULL |
| `content_hash` | TEXT | nullable |
| `created_by_user_id` | TEXT | nullable, FK → users (SET NULL) |
| `created_at` | TIMESTAMPTZ | NOT NULL, default NOW() |

---

## Neue Enums

| Enum | Werte |
|---|---|
| `takt_coordination_decision_type` | CONFIRM_ACCEPTED, ACCEPT_ALTERNATIVE, REQUEST_REVISION, CLOSE_WITHOUT_AGREEMENT |
| `takt_version_source_type` | INITIAL, MANUAL_EDIT, ACCEPTED_ALTERNATIVE, REVISION |

---

## Unique Constraints

| Constraint | Tabelle | Spalten |
|---|---|---|
| UNIQUE response_id | takt_response_decisions | response_id |
| Partial UNIQUE idempotency | takt_response_decisions | (gu_org_id, idempotency_key) WHERE idempotency_key IS NOT NULL |
| uq_takt_version | takt_versions | (takt_id, version) |

---

## Foreign Keys

**takt_response_decisions:**
- `takt_request_id` → takt_requests (RESTRICT)
- `response_id` → takt_responses (RESTRICT)
- `accepted_alternative_id` → takt_response_alternatives (RESTRICT)
- `decided_by_user_id` → users

**takt_versions:**
- `takt_id` → takte (RESTRICT)
- `source_request_id` → takt_requests (SET NULL)
- `source_response_id` → takt_responses (RESTRICT)
- `source_decision_id` → takt_response_decisions (RESTRICT)
- `created_by_user_id` → users (SET NULL)

---

## Initialisierung bestehender Takte

3 bestehende Takte (aus seed-takt-data) erhielten je einen `INITIAL`-Eintrag in `takt_versions`:
- `version` = aktueller `takt.version` (default 1)
- `snapshot_payload` = vollständiger fachlicher Inhalt (taktBezeichnung, zone, gewerk, plannedStart/End, etc.)
- `content_hash` = MD5 des kanonischen JSONB

Keine bestehenden Takte oder IDs verändert.

---

## Löschverhalten

| Objekt | Verhalten |
|---|---|
| Takt mit Versionen | RESTRICT — Takt kann nicht gelöscht werden |
| Response mit Entscheidung | RESTRICT — Response kann nicht gelöscht werden |
| Ausgewählte Alternative | RESTRICT — Alternative kann nicht gelöscht werden |
| TaktRequest bei Taktversion | SET NULL — Versionshistorie bleibt |
| Benutzer bei Taktversion | SET NULL — Versionshistorie bleibt |

---

## Testergebnisse

**`takt-response-decisions-schema.test.ts`** (8 Tests):

| Test | Ergebnis |
|---|---|
| GU-Entscheidung kann gespeichert werden | ✅ |
| Zweite Entscheidung für dieselbe Response wird abgelehnt | ✅ |
| Idempotency-Key ist je GU eindeutig | ✅ |
| NULL Idempotency-Keys sind von Uniqueness ausgenommen | ✅ |
| Taktversion kann gespeichert werden | ✅ |
| Doppelte Versionsnummer wird abgelehnt | ✅ |
| Frühere Version bleibt unverändert | ✅ |
| Bestehende Takte haben INITIAL-Versionen | ✅ |

**Gesamt: 436/436 Tests bestanden ✅**

---

## Migration, Typecheck, Build

```
Schema push: psql — CREATE TABLE (2), CREATE INDEX (7), DO (3) — erfolgreich
Initialisierung: INSERT 0 3 (3 Takte initialisiert)
Typecheck: alle Artefakte Done ✅
Tests: 436/436 ✅
```
