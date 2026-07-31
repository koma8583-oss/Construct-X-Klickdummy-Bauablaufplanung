# Abschlussbericht – Task 4.7: Availability-Check API

## Aufgabe
Zwei neue REST-Endpunkte für den NU-seitigen Verfügbarkeitscheck, der in Task 4.5/4.6 implementierten Service-Schicht.

## Implementierte Endpunkte

### `POST /api/takt-requests/:id/availability-checks`
- **Berechtigung**: Nur die adressierte NU-Org (AN-Typ); GU, Hub-Admin → 403.
- **Ablauf**:
  1. Prüft NU-Berechtigung und liest den TaktRequest.
  2. Ruft `runAvailabilityCheck()` aus der Service-Schicht auf.
  3. Speichert das Ergebnis in `availability_checks`.
  4. Überführt den TaktRequest von `DETAILS_RETRIEVED` → `UNDER_REVIEW` (idempotent bei `UNDER_REVIEW`).
  5. Gibt das vollständige Check-Ergebnis zurück (inkl. `internalResult` + `publicResult`).
- **Status**: `201 Created`.

### `GET /api/takt-requests/:id/availability-checks/latest`
- **Berechtigung**: Wie oben (nur adressierte NU).
- **Ablauf**: Gibt den jüngsten abgeschlossenen Check zurück (`COMPLETED` bevorzugt, Fallback auf neuesten beliebigen Status).
- **Status**: `200 OK` oder `404 Not Found` (noch kein Check).

## Hilfsfunktionen (route-intern)
- `formatCheckResponse(check)` – serialisiert den DB-Row sicher.
- Kein internes Ergebnis (`internalResultPayload`) wird an GU weitergeleitet.

## Tests
- `availability-checks-api.test.ts` – 12 neue Integrationstests:
  - NU-Berechtigung (foreign NU, GU, Hub-Admin → 403)
  - Erfolgreicher Check (FEASIBLE_WITH_ALTERNATIVES)
  - Zustandsübergang DETAILS_RETRIEVED → UNDER_REVIEW
  - Ergebnis enthält Alternativen (`publicResult`) und interne Konflikte (`internalResult`)
  - Latest-Endpunkt (COMPLETED bevorzugt)

## OpenAPI / Codegen
- Pfade `/takt-requests/{requestId}/availability-checks` und `.../latest` ergänzt.
- Schemata: `AvailabilityCheckResult`, `AvailabilityCheckAlternative`, `AvailabilityCheckPublicResult`, `AvailabilityCheckResponse`.
- Orval-Codegen erfolgreich ausgeführt.

## Status
**Abgeschlossen** – 404/404 Tests grün, Typecheck sauber.
