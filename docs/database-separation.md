# Datenbanktrennung

Für eine produktive Installation ist die bevorzugte Konfiguration:

| Rolle | Variable | Inhalt |
| --- | --- | --- |
| AG/GU | `AG_DATABASE_URL` | Projekte, vollständiger Taktplan und AG-Koordination |
| AN/NU | `AN_DATABASE_URL` | Ressourcen, lokale Projekte, Kapazität und interne Buchungen |
| Hub | `HUB_DATABASE_URL` | Identität, Nachrichten- und Dataspace-Transport-Metadaten |

Für die lokale Replit-Entwicklung kann ausdrücklich eine vorhandene einzelne
Datenbank über `DATABASE_URL` verwendet werden, wenn zusätzlich
`TAKTKOORD_SHARED_DATABASE_POC=true` gesetzt ist. In diesem Modus werden AG, AN
und Hub logisch über getrennte Rollen-Zugriffspfade (`agDb`, `anDb`, `hubDb`)
und die Route-/Organisationstrennung isoliert. Das ist keine physische
PostgreSQL-Datenbank- oder Benutzertrennung und darf nicht als solche
ausgegeben werden.

Dieser Modus wird ausschließlich außerhalb von `production` akzeptiert und
erfordert genau `DATABASE_URL` ohne role-spezifische URLs. Eine produktive
Instanz muss alle drei role-spezifischen URLs setzen; beim Start prüft die API
über PostgreSQL sowohl die Datenbank- als auch die Verbindungsbenutzer-
Identität. Bei einer Kollision oder einem Verbindungsfehler startet sie nicht.

## Migration und lokale Entwicklung

Getrennte Datenbanken werden unabhängig synchronisiert:

```bash
DB_ROLE=ag pnpm --filter @workspace/db run push-force
DB_ROLE=an pnpm --filter @workspace/db run push-force
DB_ROLE=hub pnpm --filter @workspace/db run push-force
```

`drizzle.config.ts` lädt abhängig von `DB_ROLE` nur das jeweilige Schema.
`scripts/post-merge.sh` prüft die drei URLs auf Gleichheit und führt diese
drei getrennten Schema-Synchronisationen aus. In produktiven Umgebungen sollen
die drei URLs von getrennten PostgreSQL-Rollen mit minimalen Rechten stammen.

Bei Verwendung von `DATABASE_URL` und
`TAKTKOORD_SHARED_DATABASE_POC=true` führt das Nachsetup die gemeinsamen
Entwicklungsmigrationen einmal aus. Die Anwendung bleibt bei jedem Request an
einen logischen Datenbankrollenpfad gebunden.

AG↔AN-Daten sollen nicht per fachlichem SQL-Join übertragen werden. Die
bevorzugte Übergabe ist ein validierter Dataspace-Connector-
Nachrichtenaustausch. Im gemeinsamen Entwicklungsmodus schützen zusätzlich
serverseitige Rollen-, Organisations- und Projektprüfungen vor Querzugriffen.