# Schema Versioning

> **Stand: TaktKoord PoC — Schema Version 1.0**

---

## 1  Überblick

Alle Nachrichten und Snapshots, die zwischen GU (AG), NU (AN) und Hub ausgetauscht werden, tragen ein `schemaVersion`-Feld im Format `<major>.<minor>`.

```
schemaVersion = "1.0"
```

Das Feld befindet sich im `MessageEnvelope` — der äußeren Hülle jeder Nachricht. Alle aktuellen PoC-Verträge verwenden Version **1.0**.

---

## 2  Aktuell unterstützte Versionen

| Major | Minor | Status |
|-------|-------|--------|
| 1 | beliebig (1.0, 1.1, …) | ✅ Unterstützt |
| 2+ | beliebig | ❌ Abgelehnt |

Die Implementierung unterstützt genau **Major-Version 1**. Minor-Versionen sind rückwärtskompatibel und werden automatisch akzeptiert.

---

## 3  Nachrichten und Snapshots mit `schemaVersion`

Die `schemaVersion` ist im `MessageEnvelope` enthalten und gilt damit für alle folgenden Nachrichtentypen:

| Nachrichtentyp | MessageType | Beschreibung |
|----------------|-------------|-------------|
| `MessageEnvelope` | — | Äußere Hülle aller Nachrichten |
| Taktanfrage-Benachrichtigung | `TAKT_REQUEST_NOTIFICATION` | GU → NU |
| Taktantwort | `TAKT_RESPONSE_SUBMITTED` | NU → GU |
| GU-Bestätigung | `TAKT_RESPONSE_ACCEPTED` | GU → NU |
| Revisionsanforderung | `TAKT_RESPONSE_REVISION_REQUESTED` | GU → NU |
| Revisionsbenachrichtigung | `TAKT_REQUEST_REVISED` | GU → NU |
| Stornierung | `TAKT_REQUEST_CANCELLED` | GU → NU |
| Details abgerufen | `TAKT_DETAILS_RETRIEVED` | NU → GU |
| Erinnerung | `TAKT_REQUEST_REMINDER` | System → NU/GU |
| Ablauf | `TAKT_REQUEST_EXPIRED` | System → GU |
| TaktRequestSnapshot | — | Unveränderlicher Snapshot |
| Reporting-JSON-Export | — | Auswertungsexport |

---

## 4  Versionierungsregeln

### 4.1  Minor-Version (rückwärtskompatibel)

Format: `1.x → 1.(x+1)`

Erlaubt bei:

- Neues **optionales** Feld im Payload
- Neuer **optionaler** Enum-Wert (sofern Clients unbekannte Werte ignorieren können)
- Zusätzliche Response-Metadaten
- Neue optionale Nachrichtentypen

**Verhalten:** Ältere Clients, die das neue Feld nicht kennen, ignorieren es. Der Vertrag bleibt gültig.

### 4.2  Major-Version (brechende Änderung)

Format: `1.x → 2.0`

Notwendig bei:

- Pflichtfeld entfernt
- Pflichtfeld umbenannt
- Datentyp eines Feldes geändert
- Enum-Wert in seiner Bedeutung verändert
- Feld mit neuer fachlicher Bedeutung wiederverwendet
- Interne Daten in bisher öffentliche Payloads aufgenommen

**Verhalten:** Ein Empfänger, der Major-Version 2 nicht unterstützt, muss die Nachricht mit einem klaren Fehler ablehnen — er darf sie nicht stillschweigend ignorieren oder mit falschen Annahmen verarbeiten.

**Im aktuellen PoC:** Nur Major-Version 1 wird produktiv unterstützt. Major-Version 2 ist für die Zukunft reserviert.

---

## 5  Vorgehen bei unbekannter Version

### Bekannte Major-Version, unbekannte Minor-Version

Beispiel: Service unterstützt `1.0`, empfängt `1.3`.

→ **Akzeptieren.** Unbekannte optionale Felder ignorieren. Nachricht verarbeiten.

### Unbekannte Major-Version

Beispiel: Service unterstützt Major 1, empfängt `2.0`.

→ **Ablehnen** mit HTTP 422 Unprocessable Entity und klarer Fehlermeldung:

```json
{
  "error": "UnsupportedSchemaVersionError",
  "message": "Unsupported schema version \"2.0\". Supported major versions: 1. Received major: 2.",
  "schemaVersion": "2.0",
  "supportedMajorVersions": [1]
}
```

### Fehlendes `schemaVersion`-Feld

→ **Ablehnen.** Das Feld ist in `MessageEnvelope` als Pflichtfeld definiert. Nachrichten ohne `schemaVersion` sind formal ungültig.

### Ungültiges Format (z.B. `"v1"`, `"latest"`, `"10"`)

→ **Ablehnen.** Format muss `<Ganzzahl>.<Ganzzahl>` sein (Regex: `^\d+\.\d+$`).

---

## 6  Implementierung

### Zentrales Utility

```typescript
// artifacts/api-server/src/lib/schema-version.ts
import { isSupportedMajorVersion, assertSupportedSchemaVersion } from "./schema-version";

isSupportedMajorVersion("1.0")  // → true
isSupportedMajorVersion("1.7")  // → true
isSupportedMajorVersion("2.0")  // → false
assertSupportedSchemaVersion("2.0")  // → throws UnsupportedSchemaVersionError
```

### Zod-Validierung

Alle Zod-Schemas für `MessageEnvelope` und typisierte Nachrichtensubtypen verwenden:

```typescript
schemaVersion: z.string()
  .regex(/^\d+\.\d+$/, "Format muss <major>.<minor> sein")
  .refine(isSupportedMajorVersion, {
    message: `Nur Major-Version ${SUPPORTED_MAJOR_VERSIONS.join(", ")} wird unterstützt`,
  }),
```

### Aktuell erzeugte Versionen

Alle Nachrichten, die dieser Service sendet, tragen:

```typescript
schemaVersion: CURRENT_SCHEMA_VERSION  // = "1.0"
```

---

## 7  Noch nicht implementiert (PoC-Scope)

| Funktion | Begründung |
|---------|-----------|
| Schema Registry | Nicht erforderlich für PoC |
| Registry-Datenbank | Nicht erforderlich für PoC |
| Automatische Schema-Veröffentlichung | Nicht erforderlich für PoC |
| Dynamische Schema-Auflösung | Nicht erforderlich für PoC |
| Automatische Payload-Migration | Nicht erforderlich für PoC |
| EDC / Dataspace Protocol | Nicht implementiert |
| Gleichzeitiger Betrieb von Major 1 und 2 | Nicht erforderlich für PoC |

---

## 8  AG/AN-Terminologiemapping

Die technischen Bezeichner `AG` und `AN` bleiben im Code erhalten:

| Code-Begriff | Fachlicher Begriff |
|-------------|-------------------|
| `AG` | Generalunternehmer (GU) |
| `AN` | Nachunternehmer (NU) |
| `agOrgId` | GU-Organisations-ID |
| `anOrgId` | NU-Organisations-ID |
| `senderOrgId` | Sendende Organisation (Nachrichten) |
| `recipientOrgId` | Empfangende Organisation (Nachrichten) |

---

## 9  Weiterführende Dokumentation

- `docs/json-contracts.md` — kanonische JSON-Beispiele aller Nachrichtentypen
- `docs/message-flow.md` — Nachrichtenfluss und Transportarchitektur
- `docs/data-ownership.md` — Datensouveränitätsregeln
- `lib/api-spec/openapi.yaml` — normative Schema-Definitionen
