# HomeScore – Prototyp

Bewertet eine Wohnlage in der Schweiz nach den Prioritäten des Käufers.

## Starten
`index.html` im Browser öffnen (Doppelklick). Es braucht keinen Server und keine Installation, nur eine Internetverbindung für die Datenabfragen.

## Ordnerstruktur
```
HomeScore/
├── index.html              Seite
├── css/style.css           Gestaltung
├── js/app.js               Logik: Abfragen, Bewertung, Anzeige
└── data/
    ├── raw/estv_steuerfuesse_2026.xlsx   ESTV-Original, unverändert
    ├── steuerfuesse.json                 bereinigte Daten
    ├── steuerfuesse.js                   gleiche Daten, von der Seite geladen
    └── SOURCES.md                        Quellen und Aktualisierung
```

## Kriterien und Bewertung (0–10 Punkte)
| Kriterium | 10 Punkte | 5 Punkte | 0 Punkte | Quelle |
|---|---|---|---|---|
| Steuerfuss Gemeinde | tiefster im Kanton | Mitte | höchster im Kanton | ESTV |
| Bahnhof | ≤ 0.5 km | 2 km | ≥ 5 km | transport.opendata.ch (Ersatz: OpenStreetMap) |
| Lebensmittelgeschäft | ≤ 0.3 km | 1.5 km | ≥ 4 km | OpenStreetMap |
| Autobahnanschluss | ≤ 2 km | 6 km | ≥ 15 km | OpenStreetMap |
| Schule | ≤ 0.5 km | 1.5 km | ≥ 3 km | OpenStreetMap |
| Kindergarten | ≤ 0.5 km | 1.5 km | ≥ 3 km | OpenStreetMap |
| Kaufpreis (Abweichung vom Wunschpreis) | ≤ −20 % | +6.7 % (Wunschpreis selbst = 7.5) | ≥ +20 % | Eingabe Käufer |
| Arbeitsweg (je Person, bis 3) | ≤ 15 min | 45 min | ≥ 90 min | Zug: transport.opendata.ch · Auto: FOSSGIS OSRM |
| Reisezeit zu Ziel (je Ziel) | ≤ 15 min | 45 min | ≥ 90 min | Zug: transport.opendata.ch · Auto: FOSSGIS OSRM |

- Orte aus OpenStreetMap: eine kleine Abfrage pro Kategorie, in einem Rechteck um das Objekt, das schrittweise wächst (z.B. 1.5 → 4 → 10 km).
- Distanzen: Fussweg, wenn dieser höchstens 1 km lang ist, sonst Autoroute (FOSSGIS OSRM). Fällt der Routendienst aus, wird die Luftlinie angezeigt.
- Reisezeit: pro Ziel Zug und Auto. Zug = schnellste Verbindung ab dem nächsten Bahnhof, Dienstag 07:30, mit Anzahl Umstiege. Auto = Route ohne Verkehr, mit km. Pro Ziel wählt der Käufer, was zählt: Zug, Auto oder der schnellere Wert.
- Arbeitsort: bis zu drei Personen mit Name und Adresse. Zug = Bahnhof beim Objekt bis Bahnhof beim Arbeitsort (ohne Fusswege), Auto = Haustür bis Arbeitsort. Pro Person wählbar: Zug, Auto oder schneller. Neue oder geänderte Arbeitsorte werden für alle Objekte neu berechnet.
- Kaufpreis: Der Käufer gibt einen Wunschpreis ein. Punkte: günstiger als Wunschpreis 7.5 + 0.125 pro % (max. 10), teurer 7.5 − 0.375 pro % (min. 0): −20 % = 10, −10 % = 8.75, 0 % = 7.5, +10 % = 3.75, +20 % = 0. Günstigere Objekte stehen also höher. Muss-Kriterium = max. % über dem Wunschpreis.
- Score-Farbe in der Kopfzeile: grün = alle gewichteten Kriterien haben einen Wert, rot = Werte fehlen (Anzahl darunter, Liste beim Darüberfahren). Dann aufklappen und «Fehlende Orte erneut suchen» oder Wert von Hand eintragen.
- Rangliste: pro Objekt nur die Kopfzeile (Adresse, Kaufpreis, Zimmer, Wohnfläche, Score). Details über den Pfeil oder Klick auf die Kopfzeile aufklappen.
- Gesamtscore 0–100 = Σ (Punkte × Gewicht) ÷ Σ Gewichte × 10 (Gewichtung 0–5, 0 = ignoriert). In den Details zeigt die Spalte «Beitrag», wie viele der 100 Punkte jedes Kriterium beiträgt; die Rechnung steht unter der Tabelle.
- Muss-Kriterien: Höchstwert je Kriterium. Objekte darüber werden markiert und ans Ende der Rangliste gesetzt.
- Alle abgerufenen Werte sind in der Rangliste editierbar. Von Hand eingetragene Werte sind blau markiert (Feld und Hinweis «angepasst»).
- Auswahl: Objekte ankreuzen; sobald etwas ausgewählt ist, erscheint ein roter Knopf «… ausgewählte Objekte entfernen». Nach dem Entfernen 8 Sekunden lang «Rückgängig».
- Vergleichen: genau 2 Objekte ankreuzen, dann «Vergleichen». Eigene Ansicht mit beiden Scores, Kriterium für Kriterium; das bessere Objekt pro Kriterium ist grün markiert. Zurück über den Knopf oder die Zurück-Taste des Browsers.
- Einstellungen und Objekte bleiben im Browser des Käufers gespeichert.

## Bekannte Grenzen
- Steuerfüsse sind nur innerhalb eines Kantons vergleichbar. Die Seite warnt bei Objekten in mehreren Kantonen.
- «Schule» umfasst alle Schulen in OpenStreetMap; Primarschulen sind dort nicht immer als solche gekennzeichnet.
- Die öffentlichen Dienste haben Nutzungslimiten. Für eine öffentliche Website mit vielen Besuchern braucht es später Caching oder eigene Server.
