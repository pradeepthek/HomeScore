# HomeScore – Datenquellen

## Steuerfüsse (`steuerfuesse.json`)

| Feld | Wert |
|---|---|
| Quelle | Eidgenössische Steuerverwaltung ESTV – Steuerrechner, Grunddaten |
| URL | https://swisstaxcalculator.estv.admin.ch |
| Steuerjahr | 2026 |
| Steuerart | Einkommenssteuer natürliche Personen, Steuerfuss in % |
| Originaldatei | `raw/estv_steuerfuesse_2026.xlsx` (unverändert) |
| Heruntergeladen | 2026-10-20 |
| Anzahl Gemeinden | 2110 (alle 26 Kantone) |
| Nächste Aktualisierung | Anfang 2027, sobald die ESTV die Steuerfüsse 2027 publiziert |

### Struktur
Schlüssel = BfS-Gemeindenummer (gleiche Nummer wie in der Adresssuche von geo.admin.ch).

```json
"131": { "gemeinde": "Adliswil", "kanton": "ZH", "sf_kanton": 95, "sf_gemeinde": 104 }
```

### Übernommene Spalten
- Kanton, BfS-Id, Gemeinde
- Einkommen → Kanton (`sf_kanton`)
- Einkommen → Gemeinde (`sf_gemeinde`)

Nicht übernommen: Kirchensteuer, Vermögenssteuer (später als optionale Felder), Gewinn- und Kapitalsteuer (nur juristische Personen).

### Hinweis
Steuerfüsse sind nur innerhalb desselben Kantons vergleichbar, da jeder Kanton einen eigenen Steuertarif anwendet.

`steuerfuesse.js` enthält dieselben Daten wie `steuerfuesse.json`, damit die Seite auch ohne Webserver (Doppelklick auf index.html) funktioniert. Bei einer Aktualisierung beide Dateien neu erzeugen.

## Live-Abfragen (keine Dateien)

| Daten | Dienst | URL |
|---|---|---|
| Adresssuche, Gemeinde | geo.admin.ch (swisstopo) | https://api3.geo.admin.ch |
| Bahnhof, Lebensmittelgeschäft, Autobahnanschluss, Schule, Kindergarten | OpenStreetMap über Overpass API | https://overpass-api.de |
| Fuss- und Autorouten | FOSSGIS OSRM | https://routing.openstreetmap.de |
| Reisezeiten Zug | transport.opendata.ch | https://transport.opendata.ch |

Pflicht zur Quellenangabe: «© OpenStreetMap-Mitwirkende» (steht im Seitenfuss).
