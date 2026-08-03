# Abschlussbericht: Task 6.4 – Bestätigte Planung oder akzeptierte Alternative auf Takt anwenden

**Datum:** August 2026  
**Status:** ✅ Abgeschlossen

---

## Neuer Service

**Service:** `artifacts/api-server/src/services/takt-version-service.ts`

Exportiert:
- `applyConfirmAccepted(tx, params)` — vergleicht bestätigtes Zeitfenster mit Taktdaten
- `applyAcceptAlternative(tx, params)` — übernimmt Alternative in den Takt
- `VersionConflictError` — ausgelöst bei Optimistic-Lock-Konflikt (409)

---

## Verhalten

### `applyConfirmAccepted`

| Bedingung | Aktion |
|---|---|
| `acceptedStart/End` == `takt.plannedStart/End` | Kein neuer `takt_versions`-Eintrag; nur `lifecycle_status → CONFIRMED` |
| `acceptedStart/End` ≠ `takt.plannedStart/End` | Neue `takt_versions` (sourceType = `ACCEPTED_ALTERNATIVE`?); Takt-Daten und Version aktualisiert |

Datumvergleich basiert auf ISO-Datumstring (YYYY-MM-DD), nicht auf Millisekunden.  
Optimistic Lock: `UPDATE takte WHERE id = ? AND version = ?` — schlägt fehl → `VersionConflictError`.

### `applyAcceptAlternative`

Erstellt **immer** einen neuen `takt_versions`-Eintrag mit `sourceType = ACCEPTED_ALTERNATIVE`.

**Whitelist der übernehmbaren Felder aus der Alternative:**
- `timeWindow.start`, `timeWindow.end`
- `crewSize`
- `conditions`

**Blockierte interne NU-Felder (400 wenn vorhanden):**
- `resourceId`, `resourceName`
- `localProjectId`, `customerAlias`
- `internalConflicts`, `internalPriority`, `internalCost`

---

## Integration in `gu-decision-service.ts`

`applyConfirmAccepted` / `applyAcceptAlternative` werden **innerhalb der GU-Entscheidungs-Transaktion** aufgerufen.

Rückgabe des Endpunkts `POST /takt-requests/:id/gu-decisions` enthält nun:
- `newTaktVersion` — neue Versionsnummer (null wenn keine Inhaltsänderung)
- `newTaktVersionId` — UUID des neuen `takt_versions`-Eintrags (null wenn keine neue Version)

`VersionConflictError` → HTTP 409.

---

## Neue Felder in der API-Antwort

```json
{
  "decisionId": "...",
  "decisionType": "CONFIRM_ACCEPTED",
  "newRequestStatus": "ACCEPTED",
  "newTaktVersion": null,
  "newTaktVersionId": null
}
```

Bei `ACCEPT_ALTERNATIVE` mit Inhaltsänderung:
```json
{
  "decisionType": "ACCEPT_ALTERNATIVE",
  "newTaktVersion": 2,
  "newTaktVersionId": "uuid-..."
}
```

---

## Tests

**Datei:** `artifacts/api-server/src/__tests__/takt-version-application.test.ts` (11 Tests, Fixture-Prefix `t64-`)

| Testgruppe | Inhalt |
|---|---|
| CONFIRM_ACCEPTED — same window | Kein `takt_versions`, nur `lifecycle_status = CONFIRMED` |
| CONFIRM_ACCEPTED — different window | Neue `takt_versions`, Taktdaten aktualisiert, FK-Verlinkung |
| ACCEPT_ALTERNATIVE | Immer neue Version, Snapshot, keine internen NU-Felder |
| Cross-Response-Prüfung | Alternative aus fremder Response → 400 |

---

## Architekturregeln (übernommen)

- Vergleich immer auf YYYY-MM-DD (nicht datetime)
- Optimistic Lock bei allen Takt-Updates (`WHERE version = ?`)
- Nur Whitelist-Felder aus Alternative übernehmen — keine internen NU-Daten in Takt
