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
| Lebensmittelgeschäft, Autobahnanschluss, Schule, Kindergarten (Bahnhof nur als Ersatz) | OpenStreetMap über Overpass API: overpass-api.de (FOSSGIS, DE), Ersatz overpass.private.coffee. overpass.osm.ch (Schweiz) vorbereitet, aber ausgeschaltet bis zur Zustimmung des Betreibers | https://overpass-api.de |
| Fuss- und Autorouten | FOSSGIS OSRM | https://routing.openstreetmap.de |
| Reisezeiten Zug | transport.opendata.ch | https://transport.opendata.ch |

Pflicht zur Quellenangabe: «© OpenStreetMap-Mitwirkende» (steht im Seitenfuss).

## Einkaufszentren (`einkaufszentren.json`, `einkaufszentren.js`)

| Feld | Wert |
|---|---|
| Liste | Wikipedia: Liste der Einkaufszentren mit den grössten Verkaufsflächen der Schweiz (25 Einträge) |
| URL | https://de.wikipedia.org/wiki/Liste_der_Einkaufszentren_mit_den_gr%C3%B6ssten_Verkaufsfl%C3%A4chen_der_Schweiz |
| Koordinaten | OpenStreetMap, Objekte mit shop=mall (Typ und ID im Feld «osm»), abgefragt über overpass.osm.ch, Rohdaten: `raw/osm_shop_mall_ch_2026-10-23.csv`. 24 von 25 eindeutig zugeordnet; Shoppi Tivoli besteht aus zwei Gebäuden («Shoppi», «Tivoli»), Koordinate = Mittelpunkt. Ausnahme Gäupark (Egerkingen): in OpenStreetMap nicht als shop=mall erfasst, Koordinaten aus dem amtlichen Gebäudeadressverzeichnis (geo.admin.ch, Hausimollstrasse 1, 4622 Egerkingen). |
| Stand | 2026-10-23 |
| Aktualisierung | bei Bedarf; die Wikipedia-Liste ändert sich selten |

## Haltestelle öV
Live über transport.opendata.ch: nächste Haltestelle jeder Art (Bus, Tram, Zug, Schiff), Fussweg bzw. Autoroute über FOSSGIS OSRM.
