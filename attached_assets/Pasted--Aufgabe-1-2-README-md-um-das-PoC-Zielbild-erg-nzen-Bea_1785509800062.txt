# Aufgabe 1.2 – `README.md` um das PoC-Zielbild ergänzen

Bearbeite ausschließlich die vorhandene Datei `README.md`.

Entferne keine wichtigen Installations-, Start- oder Architekturinformationen.

## Ergänze folgende Abschnitte

### 1. Kurzbeschreibung

Beschreibe in maximal drei Absätzen:

* Der Generalunternehmer beziehungsweise Generalplaner verwaltet den vollständigen Taktplan.
* Nachunternehmer prüfen einzelne Taktanfragen gegen ihre lokale Ressourcenplanung.
* Der Informationsaustausch erfolgt zunächst über REST und JSON.
* Die spätere Migration zu Tractus-X und EDC wird vorbereitet.

### 2. Anwendungen und Komponenten

Beschreibe anhand der tatsächlich vorhandenen Repository-Struktur:

* GU- beziehungsweise bisherige Auftraggeber-Anwendung
* NU- beziehungsweise bisherige Auftragnehmer-Anwendung
* Hub-Anwendung
* API-Server
* Datenbank
* OpenAPI-Spezifikation
* generierte API-Clients
* generierte Validierungsschemas

Verwende die tatsächlichen Paket- und Verzeichnisnamen.

### 3. Grenzen des Proof of Concept

Dokumentiere sinngemäß:

Dieses Projekt verwendet aktuell keinen Eclipse Dataspace Connector und kein Dataspace Protocol. Der Datenraumaustausch wird durch REST-Schnittstellen, standardisierte JSON-Nachrichten und einen lokalen Hub simuliert.

Zusätzlich dokumentieren:

* keine Wallets
* keine Verifiable Credentials
* keine EDC-Policies
* keine echte Vertragsverhandlung
* keine gemeinsame zentrale Ressourcenplanung

### 4. Datenhoheit

Dokumentiere:

* Der GU hält den vollständigen Taktplan.
* Der NU hält seine vollständige lokale Ressourcenplanung.
* Der Hub hält nur Nachrichten- und Transportinformationen.
* Der GU erhält keine vollständigen NU-Ressourcendaten.
* Der NU erhält keinen vollständigen GU-Taktplan.
* Andere Projekte und Auftraggeber des NU bleiben verborgen.

### 5. Spätere Migration

Beschreibe kurz:

* Der lokale Transport kann später durch EDC ersetzt werden.
* Die fachlichen Prozesse sollen dabei erhalten bleiben.
* Die JSON-Verträge sollen weiterverwendet werden.
* Digitale Identitäten, Policies und Vertragsverhandlungen werden später ergänzt.
* Fachlogik und Transportlogik müssen deshalb getrennt bleiben.

## Einschränkungen

* Nur `README.md` ändern.
* Keine Codeänderungen.
* Keine OpenAPI-Änderungen.
* Keine Datenbankänderungen.
* Keine Verzeichnisse umbenennen.
* Keine vorhandenen Funktionen entfernen.

## Abschlussbericht

Berichte:

* welche README-Abschnitte ergänzt wurden
* welche vorhandenen Informationen erhalten blieben
* welche tatsächlichen Anwendungen und Pakete dokumentiert wurden
