# Bautagesbericht LANSING (chayns)

Neubau des Bautagesberichts (Vorlage: statische iPad-Web-App V46) für die chayns-Site von
Lansing Metallbau (`99820-05034`). Eingabe als chayns-Formular, PDF im Layout der V46, Speicherung
im Container, Admin-Bereich mit Zeitraumfilter.

## Aufbau

```
frontend/   React + @chayns-components v5 + chayns-api v3
            form/   Formular (Seite "/")         - Gruppe Team
            admin/  Admin-Bereich (Seite "/admin/") - Admin-Gruppe
            common/ Anmeldung, API-Client, Rahmen (PageProvider/Site-Design), Dialoge
server/     Node 22, ein Prozess: JSON-API /api, statische Frontends, SQLite + Dateien in /data
bridge/     chayns.codes-Funktion: bestätigt Person + UAC-Gruppen (HMAC) und ruft chayns.ai.prompt auf
shared/     API-Vertrag (von allen Teilen importiert)
tests/      node:test (Server, Upload, Rechte, Bridge)
```

Warum Container statt reinem chayns.codes: Test vom 11.11.2026 – Anfragen an chayns.codes
sind auf 1 MB begrenzt und `chayns.space.writeFile` war aus chayns.codes nicht nutzbar. PDFs mit Fotos
sind mehrere MB groß.

## Funktionen

**Formular** (Aufklapper je Abschnitt, Entwurf wird laufend im Gerät gesichert, Fotos in IndexedDB):
Projektnummer/Nr./Bauvorhaben/leitender Monteur · Datum, Beginn/Ende (Viertelstunden) · Wetter
automatisch über Open-Meteo (Ort/PLZ je Projekt gemerkt) · bis 8 Mitarbeiter (Auswahl aus der
Mitarbeiterliste oder frei) · Ausgeführte Arbeiten (Bauteil/Geschoss/Ansicht), Zusätzliche Arbeiten
(Bauleitung, Stunden gesamt), Besondere Vorkommnisse – jeweils mit **Diktat + KI** · Fotos mit
Stift-Zeichnung und Beschreibung · Unterschriften Auftraggeber und LANSING · Speichern erzeugt das
PDF im Browser und lädt es mit den Fotos hoch · optional **E-Mail-Kopie des PDFs an den Auftraggeber** · „Nächster Bericht“ übernimmt Projekt, Team und Zeiten
· „Meine Berichte“ mit PDF-Abruf.

Lange Beschreibungen brechen im PDF in die Folgezeile um; das Formular zeigt „PDF-Zeilen x von 8/6“
und lässt erst speichern, wenn alles auf das A4-Blatt passt.

**Admin-Bereich:** Kalender (Zeitraum, Standard aktuelle KW, Vor-/Folgewoche), Liste der Berichte
nach Berichtsdatum mit chayns-Ersteller (Name + personId) und Zeitpunkt, Suche, Details, Fotos,
PDF öffnen/herunterladen, Versandstatus der E-Mail mit „Erneut senden“ (Adresse korrigierbar), Löschen;
Pflege der Mitarbeiterliste.

## Anmeldung und Rechte

1. Seite lädt `/api/bootstrap`, holt eine Nonce (`/api/auth/challenge`).
2. Browser ruft die **Bridge** (chayns.codes, Lansing-Site) mit dem chayns-Token auf; sie liefert
   personId, Name, UAC-Gruppen, HMAC-signiert mit `BRIDGE_SECRET`.
3. Container prüft Signatur, Alter (120 s) und Nonce (einmalig) und vergibt die Rolle:
   `UAC_GROUP_ADMIN` (223675, „Bautagebuch Admin“) und immer chayns-Manager (1) → admin, `UAC_GROUP_TEAM` (79077) → employee, sonst kein Zugang.
4. Sitzung (12 h) als Bearer-Token im localStorage.

Mitarbeiter sehen nur eigene Berichte, Admins alle. Die KI in der Bridge prüft die Gruppen selbst.

## Daten

| Was | Wo |
|---|---|
| Berichtsdaten, Sitzungen, Mitarbeiterliste | SQLite `/data/bautagesbericht.db` |
| PDF und Fotos | `/data/files/<berichtId>/bericht.pdf`, `foto-01.jpg` … |
| Entwurf (bis zum Speichern) | Gerät: localStorage + IndexedDB |

Uploads laufen in 512-KB-Stücken (passt ohne Proxy-Anpassung durch nginx-proxy); ein abgebrochener
Upload wird beim erneuten Speichern fortgesetzt. Unvollständige Uploads werden nach 48 h gelöscht.
**Das Volume `/data` muss in die Sicherung.**

## E-Mail-Kopie

Ist im Formular eine Adresse des Auftraggebers eingetragen, verschickt der Server nach dem Speichern
das PDF per SMTP (nodemailer, Port 587 mit STARTTLS). Der Versand läuft im Hintergrund; Fehler werden
bis zu 3-mal im Abstand von 15 Minuten wiederholt, danach steht der Bericht im Admin-Bereich auf
„fehlgeschlagen“ und kann mit korrigierter Adresse erneut gesendet werden. PDFs über `MAIL_MAX_MB`
(20 MB) werden nicht verschickt. Ohne `SMTP_HOST` ist der Versand aus; Berichte warten dann und
werden verschickt, sobald SMTP eingerichtet ist.

## Entwickeln und testen

```powershell
npm install
npm run typecheck
npm test
npm run build
# lokaler Server mit Test-Anmeldung (nie in Produktion):
$env:DATA_DIR="./data"; $env:STATIC_DIR="dist/frontend"; $env:DEV_LOGIN="true"; $env:PORT="8091"
node --disable-warning=ExperimentalWarning dist/server/index.js
```

Ohne chayns: `http://localhost:8091/?mock=1` (Formular) und
`http://localhost:8091/admin/?mock=1&role=admin`. Farben und Schrift kommen dabei von der echten
Lansing-Site; die KI ist im Mock-Modus durch eine einfache Satzaufteilung ersetzt.

## Inbetriebnahme

1. **Secret erzeugen:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. **Image bauen und pushen:** `docker build -t registry.qonect.de/lansing-bautagesbericht:latest .`
   und `docker push …`
3. **Stack auf web02** aus `deploy/web02/stack.yml` (Portainer), Variablen `BRIDGE_SECRET`,
   `BRIDGE_URL` (nach Schritt 4), `UAC_GROUP_ADMIN`, optional `FRONTEND_HOST`.
4. **Bridge anlegen:** `npm run build:bridge`, dann mit gesetztem `BRIDGE_SECRET`
   `npm run bridge:bundle` → `dist/bridge/bridge.chayns.js` (enthält das Secret, nicht weitergeben).
   In der Lansing-Site unter Developer → Codes eine Funktion mit HTTPS-Trigger anlegen, Inhalt
   einfügen, **Timeout 60 s**, URL als `BRIDGE_URL` im Stack setzen.
5. **Seiten in chayns:** zwei Seiten als „Externe Website“ mit **API v5**:
   `https://<host>/` (sichtbar für Gruppe Team) und `https://<host>/admin/` (nur Admins).
6. Im Admin-Bereich die Mitarbeiterliste pflegen.

## Umgebungsvariablen

| Variable | Bedeutung | Standard |
|---|---|---|
| `BRIDGE_URL` | URL der chayns.codes-Bridge | – |
| `BRIDGE_SECRET` | HMAC-Secret, identisch in der Bridge | – |
| `UAC_GROUP_TEAM` | Gruppe(n) für das Formular | `79077` |
| `UAC_GROUP_ADMIN` | Gruppe(n) für den Admin-Bereich; Manager (1) haben immer Zugang | `223675` (Bautagebuch Admin) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Mailserver für die E-Mail-Kopie | Port `587` |
| `MAIL_FROM`, `MAIL_FROM_NAME` | Absender | `SMTP_USER`, „LANSING Metallbau – Bautagesbericht“ |
| `MAIL_REPLY_TO`, `MAIL_BCC` | Antwortadresse, Blindkopie | – |
| `MAIL_MAX_MB` | größtes PDF für den Mailversand | `20` |
| `DATA_DIR` | Daten-Volume | `/data` |
| `TRUST_PROXY` | hinter nginx-proxy `true` | `false` |
| `DEV_LOGIN` | Test-Anmeldung, wirkt nur mit `NODE_ENV≠production` | `false` |

## Stand und offene Punkte (12.11.2026)

In Betrieb auf web02, eingebunden in die Lansing-Site (Formular für Gruppe Team, Admin-Bereich für
„Bautagebuch Admin“ und Manager). Anmeldung über die Bridge und E-Mail-Kopie an den Auftraggeber sind
im Live-Betrieb bestätigt.

Automatisch geprüft: Typprüfung, 23 Tests (Anmeldung/Signatur/Nonce, Rollen, Upload mit Fortsetzung
und Formatprüfung, Ersetzen geänderter Berichte, Zugriffsschutz, Admin-Zeitraum, Mailversand mit
Attrappe inkl. Wiederholung, Konfiguration, Bridge). Lokal im Browser: Ende-zu-Ende (Entwurf → PDF →
Upload → Admin-Liste → PDF/Foto), Enter-Navigation zwischen Feldern.

Offen:
- **iPad in der chayns-App:** Kamera über Dateiauswahl, Stift-Eingabe, Tastatur-Diktat, KI mit den
  neuen Prompts, PDF teilen/herunterladen im iFrame.
- KI-Rückfragen der V46 (Worker-Funktion `questions`) sind nicht nachgebaut, da der Worker fehlt.
- Mailversand vorerst über eine Absenderadresse von NIEWOEHNER IT; eigene Lansing-Adresse optional.
- Kein Offline-Versand: Entwurf bleibt im Gerät, gespeichert wird bei Netz.
- Aufbewahrung/Löschfristen der Berichte und Datenschutz (Fotos, Unterschriften) mit Lansing klären.
- Ideen für die nächste Ausbaustufe (Projekte/Bauvorhaben pflegen oder anbinden, fortlaufende
  Berichtsnummer, Mitarbeiter aus UAC-Gruppe, Montageplan-Anbindung, Auswertung Zusatzarbeiten).
