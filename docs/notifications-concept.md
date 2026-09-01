# TaktKoord Notifications-Konzept

## Ziel

TaktKoord verwendet für fachliche Ereignisse die Industry-Core-Struktur von
Tractus-X: eine Nachricht besteht aus `header` und `content`. Das Konzept
standardisiert die technische Zustellung, ohne fachliche Ergebnisse mit
Zustellstatus zu vermischen.

In diesem Schritt wird kein Datenraum, kein Connector-Asset und kein neuer
Service provisioniert. Die lokale Outbox-/Inbox-Zustellung bleibt der laufende
Transport und kann später hinter derselben Schnittstelle durch einen
Connector-Adapter ersetzt werden.

## Nachrichtenstruktur

Der standardisierte Header enthält:

- `messageId`: UUID beziehungsweise `urn:uuid:`-UUID; bei einem technischen
  Retry bleibt sie gleich.
- `context`: versionierter Use-Case-Kontext, zum Beispiel
  `TaktKoord-ServiceCoordination-TaktRequest:1.0.0`.
- `sentDateTime`: Zeitpunkt des Versands.
- `senderBpn` und `receiverBpn`: explizite BPNL-Werte. Lokale Organisations-IDs
  werden nicht als BPN missbraucht.
- `expectedResponseBy`: optionaler fachlicher Antwortzeitpunkt.
- `relatedMessageId`: optionale Beziehung zu einer vorherigen Nachricht.
- `version`: Version des gemeinsamen MessageHeaderAspect (`3.0.0`).

`content` bleibt use-case-spezifisch. Es enthält nur den bereits freigegebenen
öffentlichen Koordinationsausschnitt; vollständige Taktpläne, interne
Ressourcen- oder Kostendaten gehören nicht in generische Benachrichtigungen.

## Abbildung auf TaktKoord

Die bestehende `MessageEnvelope`-Schicht bleibt die interne Persistenz- und
Idempotenzgrenze. Eine explizite, zentrale Zuordnung verbindet die vorhandenen
Nachrichtentypen mit stabilen Notification-Kontexten. Die Umwandlung in das
Tractus-X-Format erfolgt erst an der Connector-Grenze, sobald für beide
Teilnehmer echte BPNLs konfiguriert sind.

Damit gelten weiterhin:

1. Erst Outbox persistieren, dann zustellen.
2. Eine Kollision derselben `messageId` mit verändertem Inhalt ablehnen.
3. Technische Zustellung (`PENDING`, `SENT`, `DELIVERED`, `FAILED`) getrennt
   von fachlichen Zuständen behandeln.
4. Retries mit der ursprünglichen `messageId` aus dem gespeicherten Outbox-
   Payload senden.
5. Inbox-Abfragen strikt auf den adressierten Empfänger begrenzen.

## Benutzeroberfläche

AN-Nutzer sehen eingehende Nachrichten in einer eigenen Nachrichtenbox. Dort
werden nur minimale Payload-Felder dargestellt, Nachrichten können als gelesen
markiert werden und bekannte Koordinationsnachrichten verlinken in den
zugehörigen Vorgang. Die bestehende Leistungsanfragen- und Datenraum-Ansicht
bleibt unverändert.

## Noch bewusst nicht enthalten

- Provisionierung eines Datenraums oder Connector-Assets.
- Erfinden oder Ableiten von BPNLs aus internen Organisations-IDs.
- Vollständige Payload-Schemata für jeden einzelnen Use Case.
- Automatisches fachliches Antworten beim Eingang einer Notification.