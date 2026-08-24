# Physische Datenbanktrennung

TaktKoord verwendet drei PostgreSQL-Datenbanken:

| Rolle | Variable | Inhalt |
| --- | --- | --- |
| AG/GU | `AG_DATABASE_URL` | Projekte, vollständiger Taktplan und AG-Koordination |
| AN/NU | `AN_DATABASE_URL` | Ressourcen, lokale Projekte, Kapazität und interne Buchungen |
| Hub | `HUB_DATABASE_URL` | Identität, Nachrichten- und Dataspace-Transport-Metadaten |

`DATABASE_URL` ist absichtlich nicht mehr gültig. Die API startet nicht, wenn
eine Variable fehlt oder zwei Variablen auf dieselbe Datenbank zeigen. Die
Verbindungen werden lazy als `agDb`, `anDb` und `hubDb` erzeugt. Bestehende
Repository-Aufrufe über `db` sind request-scoped und werden durch die
Route-Grenze (`/api`, `/api/an`, `/api/hub`) auf genau eine Rolle gebunden.

## Migration und lokale Entwicklung

Jede Datenbank wird unabhängig synchronisiert:

```bash
DB_ROLE=ag pnpm --filter @workspace/db run push-force
DB_ROLE=an pnpm --filter @workspace/db run push-force
DB_ROLE=hub pnpm --filter @workspace/db run push-force
```

`drizzle.config.ts` lädt abhängig von `DB_ROLE` nur das jeweilige Schema.
`scripts/post-merge.sh` prüft die drei URLs auf Gleichheit und führt diese
drei getrennten Schema-Synchronisationen aus. In produktiven Umgebungen sollen
die drei URLs von getrennten PostgreSQL-Rollen mit minimalen Rechten stammen.

AG↔AN-Daten werden nicht per SQL-Join, Fremdschlüssel oder gemeinsamem ORM-
Bestand übertragen. Die einzige erlaubte Übergabe ist ein validierter
Dataspace-Connector-Nachrichtenaustausch; der Hub speichert dabei nur
Transportmetadaten und keine vollständigen Projekt- oder Ressourcenpläne.