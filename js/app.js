/* HomeScore – Prototyp
 * Ablauf: Adresse/Gemeinde -> Koordinaten + Gemeinde (geo.admin.ch)
 *         -> nächste Orte (OpenStreetMap/Overpass) -> Route (FOSSGIS OSRM)
 *         -> Reisezeiten (transport.opendata.ch) -> Steuerfuss (ESTV-Datei)
 * Alle Werte sind nachträglich editierbar (hybrid).
 */
(function () {
  "use strict";

  // ---------- Sprache ----------
  // Texte sind auf Deutsch im Code; js/i18n.js liefert EN/FR/IT. T("…", {n: 3}) ersetzt {n}.
  const LANGS = ["de", "en", "fr", "it"];
  const LOCALES = { de: "de-CH", en: "en-CH", fr: "fr-CH", it: "it-CH" };
  let LANG = "de";
  try {
    const savedLang = localStorage.getItem("homescore.lang");
    const nav = (navigator.language || "de").slice(0, 2).toLowerCase();
    LANG = LANGS.includes(savedLang) ? savedLang : LANGS.includes(nav) ? nav : "de";
  } catch (e) { /* Standard Deutsch */ }
  function T(de, params) {
    const dict = (window.HS_I18N && window.HS_I18N[LANG]) || {};
    let s = LANG === "de" ? de : (dict[de] ?? de);
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
    return s;
  }
  const plain = (s) => String(s).replace(/\u00AD/g, "");

  // ---------- Konfiguration ----------
  const API = {
    search: "https://api3.geo.admin.ch/rest/services/api/SearchServer",
    identify: "https://api3.geo.admin.ch/rest/services/api/MapServer/identify",
    // Reihenfolge = Reihenfolge der Versuche. Zuerst der Schweizer Server (nur Schweizer Daten,
    // betrieben aus der Schweizer OpenStreetMap-Community), dann die internationalen Ersatzserver.
    overpass: [
      // Schweizer Server: vorübergehend aus, bis der Betreiber (User:Datendelphin) zustimmt.
      // Zum Einschalten die nächste Zeile wieder aktivieren (// entfernen) und in index.html ?v= erhöhen.
      // "https://overpass.osm.ch/api/interpreter",
      "https://overpass-api.de/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ],
    routeFoot: "https://routing.openstreetmap.de/routed-foot/route/v1/driving/",
    routeCar: "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
    transport: "https://transport.opendata.ch/v1/",
  };
  const WALK_LIMIT_KM = 1.0; // bis 1 km Fussweg, darüber Autoroute

  // Distanz-Kriterien: [10 Punkte bis, 5 Punkte bei, 0 Punkte ab] in km
  // Reihenfolge = Reihenfolge in «Prioritäten» und in der Rangliste
  const CRITERIA = [
    // Abweichung vom Wunschpreis in %: −20 % = 10 Punkte, 0 % = 7.5, +20 % = 0
    { id: "kaufpreis", label: "Kaufpreis", unit: "%", note: "Abweichung vom Wunschpreis" },
    { id: "steuer", label: "Steuerfuss Gemeinde", unit: "%", note: "Rang innerhalb des Kantons" },
    { id: "haltestelle", label: "Haltestelle öV", note: "Bus, Tram oder Zug", unit: "km", t: [0.3, 0.6, 1.2], osm: "stop", gsearch: "Haltestelle" },
    { id: "bahnhof", label: "Bahnhof", unit: "km", t: [0.5, 2, 5], osm: "station", gsearch: "Bahnhof" },
    { id: "autobahn", label: "Autobahn\u00ADanschluss", unit: "km", t: [2, 6, 15], osm: "exit", carOnly: true, gsearch: "Autobahn Einfahrt" },
    { id: "kiga", label: "Kindergarten", unit: "km", t: [0.5, 1.5, 3], osm: "kindergarten", gsearch: "Kindergarten" },
    { id: "schule", label: "Primarschule", unit: "km", t: [0.5, 1.5, 3], osm: "school", gsearch: "Primarschule" },
    { id: "spital", label: "Spital", unit: "km", t: [3, 8, 20], osm: "hospital", gsearch: "Spital" },
    { id: "einkauf", label: "Lebensmittel\u00ADgeschäft", unit: "km", t: [0.3, 1.5, 4], osm: "grocery", gsearch: "Supermarkt" },
    { id: "mall", label: "Einkaufszentrum", note: "Eines der 25 grössten der Schweiz", unit: "km", t: [5, 15, 30], osm: "mall", carOnly: true, gsearch: "Einkaufszentrum" },
  ];
  // Ziele: Reisezeit in Minuten [10, 5, 0 Punkte]
  const DEST_T = [15, 45, 90];
  // to = Bahnhof für den Fahrplan, lat/lon = Ziel für die Autoroute
  const DESTS = [
    { id: "zh", label: "Zürich", to: "Zürich HB", lat: 47.3779, lon: 8.5403 },
    { id: "be", label: "Bern", to: "Bern", lat: 46.9490, lon: 7.4391 },
    { id: "bs", label: "Basel", to: "Basel SBB", lat: 47.5476, lon: 7.5897 },
    { id: "ge", label: "Genève", to: "Genève", lat: 46.2102, lon: 6.1424 },
    { id: "la", label: "Lausanne", to: "Lausanne", lat: 46.5167, lon: 6.6291 },
    { id: "lu", label: "Luzern", to: "Luzern", lat: 47.0502, lon: 8.3102 },
    { id: "zrh", label: "Flughafen Zürich", to: "Zürich Flughafen", lat: 47.4504, lon: 8.5624 },
    { id: "gva", label: "Flughafen Genève", to: "Genève-Aéroport", lat: 46.2321, lon: 6.1104 },
  ];
  const MODES = { best: "schneller", zug: "Zug", auto: "Auto" };
  const modeName = (m) => T(MODES[m]);
  // Gewichtung 0–5 als Wort (0 = zählt nicht)
  const WEIGHT_TEXT = ["Egal", "Unwichtig", "Eher unwichtig", "Neutral", "Wichtig", "Sehr wichtig"];
  const weightText = (w) => T(WEIGHT_TEXT[Math.max(0, Math.min(5, Number(w) || 0))]);
  const WORK = ["p1", "p2", "p3"]; // bis zu drei Personen mit Arbeitsort

  // ---------- Steuerdaten ----------
  const TAX = (window.HS_STEUERFUESSE && window.HS_STEUERFUESSE.gemeinden) || {};
  const TAX_YEAR = window.HS_STEUERFUESSE ? window.HS_STEUERFUESSE.steuerjahr : "";
  const cantonRange = {};
  Object.values(TAX).forEach((g) => {
    const r = (cantonRange[g.kanton] = cantonRange[g.kanton] || { min: Infinity, max: -Infinity });
    r.min = Math.min(r.min, g.sf_gemeinde);
    r.max = Math.max(r.max, g.sf_gemeinde);
  });
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s*\([a-z]{2}\)\s*$/, "").trim();
  function findTaxByName(name, kanton) {
    const n = norm(name);
    let hit = null;
    for (const [bfs, g] of Object.entries(TAX)) {
      if (norm(g.gemeinde) === n && (!kanton || g.kanton === kanton)) { hit = { bfs: Number(bfs), ...g }; break; }
    }
    return hit;
  }

  // ---------- Zustand (im Browser gespeichert) ----------
  const STORE_KEY = "homescore.v1";
  const defaultSettings = () => {
    const w = {}, lim = {};
    CRITERIA.forEach((c) => { w[c.id] = 3; lim[c.id] = null; });
    DESTS.forEach((d) => { w["dest_" + d.id] = 3; lim["dest_" + d.id] = null; });
    WORK.forEach((x) => { w["work_" + x] = 3; lim["work_" + x] = null; });
    return { weights: w, limits: lim, dests: [], destMode: {}, work: {}, workMode: {}, wunschpreis: null, mall: "" };
  };
  let state = { settings: defaultSettings(), props: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved && saved.settings && Array.isArray(saved.props)) {
      const d = defaultSettings();
      state = {
        settings: {
          wunschpreis: saved.settings.wunschpreis ?? null,
          mall: saved.settings.mall || "",
          weights: { ...d.weights, ...saved.settings.weights },
          limits: { ...d.limits, ...saved.settings.limits },
          dests: (saved.settings.dests || []).filter((id) => DESTS.some((x) => x.id === id)),
          destMode: saved.settings.destMode || {},
          work: saved.settings.work || {},
          workMode: saved.settings.workMode || {},
        },
        props: saved.props,
      };
      // ältere Objekte: Kaufpreis und Fläche standen nur im Text «CHF 1’250’000 / 125 m²»
      state.props.forEach((p) => {
        if (p.kaufpreis == null && p.meta && p.meta.preis) {
          const m = /CHF\s*([\d’'.,\s]+)\s*\/\s*(\d+)/.exec(p.meta.preis);
          if (m) { p.kaufpreis = Number(m[1].replace(/[^\d]/g, "")); p.flaeche = Number(m[2]); }
        }
        if (p.v) delete p.v.preis;
      });
      // ältere Objekte: «Schule» war jede Schule, neu nur Primarschulen -> Wert neu suchen (von Hand eingetragene bleiben)
      state.props.forEach((p) => {
        if (p.schoolV === 2) return;
        if (!(p.edited && p.edited.schule)) { if (p.v) delete p.v.schule; if (p.meta) delete p.meta.schule; if (p.target) delete p.target.schule; if (p.notFound) delete p.notFound.schule; }
        p.schoolV = 2;
      });
      // ältere Objekte: Reisezeit war nur Zug
      state.props.forEach((p) => DESTS.forEach((d) => {
        const k = "dest_" + d.id;
        if (p.v[k] != null && p.v[k + "_zug"] == null) { p.v[k + "_zug"] = p.v[k]; delete p.v[k]; }
      }));
    }
  } catch (e) { /* ohne Speicher weiter */ }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignorieren */ }
  }

  // ---------- Hilfsfunktionen ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stripTags = (s) => String(s || "").replace(/<[^>]*>/g, "");
  // Zahlen immer mit Schweizer Apostroph, damit die Darstellung in allen Sprachen gleich bleibt
  const chf = (n) => Math.round(n).toLocaleString("de-CH");
  // Betragsfelder (class="money"): Tausendertrennzeichen beim Tippen, Wert = nur Ziffern
  const moneyVal = (el) => { const d = String(el.value).replace(/\D/g, ""); return d ? Number(d) : null; };
  const moneyText = (n) => (n == null || n === "" || isNaN(n) ? "" : chf(n));
  // Zimmer erlaubt Komma oder Punkt (4,5 = 4.5)
  const decimalVal = (el) => { const v = String(el.value).replace(",", ".").replace(/[^\d.]/g, ""); return v === "" || isNaN(Number(v)) ? null : Number(v); };
  // Läuft vor allen anderen input-Ereignissen (capture), damit diese schon den formatierten Wert sehen
  document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (!el.classList || !el.classList.contains("money")) return;
    const caret = el.selectionStart ?? el.value.length;
    const digitsBefore = el.value.slice(0, caret).replace(/\D/g, "").length;
    const digits = el.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    el.value = digits ? chf(Number(digits)) : "";
    let pos = 0, seen = 0;
    while (pos < el.value.length && seen < digitsBefore) { if (/\d/.test(el.value[pos])) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch (e) { /* ignorieren */ }
  }, true);
  const fmt = (n, d = 1) => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d }));
  function haversineKm(a, b) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  async function getJSON(url, opts = {}, timeoutMs = 20000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  // Stückweise linear: <=a 10, a..b 10->5, b..c 5->0, >c 0
  function piecewise(v, [a, b, c]) {
    if (v == null || isNaN(v)) return null;
    if (v <= a) return 10;
    if (v <= b) return 10 - (5 * (v - a)) / (b - a);
    if (v <= c) return 5 - (5 * (v - b)) / (c - b);
    return 0;
  }
  function nextWeekdayMorning() {
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 2); // nächster Dienstag
    return { date: d.toISOString().slice(0, 10), time: "07:30" };
  }

  // ---------- Datenabruf ----------
  async function searchLocations(text) {
    const u = new URL(API.search);
    u.search = new URLSearchParams({ searchText: text, type: "locations", origins: "address,gg25", limit: "8", sr: "4326" });
    const j = await getJSON(u, {}, 10000);
    return (j.results || []).map((r) => ({
      label: stripTags(r.attrs.label),
      origin: r.attrs.origin,
      lat: r.attrs.lat,
      lon: r.attrs.lon,
      detail: r.attrs.detail || "",
    }));
  }

  async function identifyGemeinde(lat, lon) {
    const u = new URL(API.identify);
    u.search = new URLSearchParams({
      geometry: lon + "," + lat, geometryType: "esriGeometryPoint", sr: "4326",
      layers: "all:ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill",
      tolerance: "0", returnGeometry: "false", lang: "de",
    });
    const j = await getJSON(u, {}, 10000);
    const res = j.results || [];
    const cur = res.find((r) => r.attributes && r.attributes.is_current_jahr) || res[0];
    if (!cur) return null;
    const a = cur.attributes || {};
    return { bfs: Number(cur.featureId ?? cur.id ?? a.bfs_nummer ?? a.gde_nr), name: a.gemname || a.label, kanton: a.kanton };
  }

  async function resolveTax(place) {
    // 1. Gemeinde-Treffer: Name + Kanton aus dem Label "Name (KT)"
    if (place.origin === "gg25") {
      const m = place.label.match(/^(.*?)\s*\(([A-Z]{2})\)\s*$/);
      const hit = m ? findTaxByName(m[1], m[2]) : findTaxByName(place.label);
      if (hit) return hit;
    }
    // 2. Gemeindegrenze am Punkt (BfS-Nummer)
    try {
      const g = await identifyGemeinde(place.lat, place.lon);
      if (g && TAX[g.bfs]) return { bfs: g.bfs, ...TAX[g.bfs] };
      if (g && g.name) { const hit = findTaxByName(g.name, g.kanton); if (hit) return hit; }
    } catch (e) { /* weiter mit Fallback */ }
    // 3. Adressdetail: "... <plz> <ort> <bfs> <gemeinde> ch <kt>"
    const m = place.detail.match(/\s(\d{1,4})\s+([^\d]+?)\s+ch\s+([a-z]{2})\s*$/i);
    if (m && TAX[m[1]]) return { bfs: Number(m[1]), ...TAX[m[1]] };
    return null;
  }

  // Eine kleine Overpass-Abfrage; probiert die Server der Reihe nach
  // Bei Überlastung (502/503/504/429, Zeitüberschreitung) folgt nach kurzer Pause ein zweiter Durchgang.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function overpassQuery(q) {
    let reasons = [], allOffline = true;
    for (let round = 0; round < 2; round++) {
      if (round > 0) { if (allOffline) break; await sleep(3000); }
      reasons = []; allOffline = true;
      for (const ep of API.overpass) {
        try {
          return await getJSON(ep, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "data=" + encodeURIComponent(q),
          }, 20000);
        } catch (e) {
          const offline = e.message === "Failed to fetch";
          const why = e.name === "AbortError" ? T("Zeitüberschreitung") : offline ? T("keine Verbindung") : e.message;
          if (!offline) allOffline = false;
          reasons.push(new URL(ep).hostname + ": " + why);
        }
      }
    }
    const err = new Error(reasons.join("; "));
    err.offline = allOffline;
    throw err;
  }
  // Pro Kategorie: Suche in einem Rechteck um das Objekt, das schrittweise wächst
  const OSM_SEARCH = {
    grocery: { filter: 'nwr["shop"="supermarket"]', radii: [1.5, 4, 10] },
    // Nur Primarschulen: Schulstufe (isced:level 1 / school=primary) oder Name mit «Primar…», «école primaire», «scuola elementare»
    school: { filter: 'nwr["amenity"="school"]', radii: [1.5, 4, 10], accept: isPrimarySchool },
    hospital: { filter: 'nwr["amenity"="hospital"]', radii: [5, 12, 30] },
    kindergarten: { filter: 'nwr["amenity"="kindergarten"]', radii: [1.5, 4, 10] },
    exit: { filter: 'node["highway"="motorway_junction"]', radii: [6, 15, 30] },
    station: { filter: '(node["railway"="station"];node["railway"="halt"];)', radii: [3, 8, 15] },
  };
  function isPrimarySchool(el) {
    const t = el.tags || {};
    const name = [t.name, t["name:de"], t["name:fr"], t["name:it"], t.official_name].filter(Boolean).join(" ");
    const isced = String(t["isced:level"] || "");
    if (/(^|[;,\s-])1([;,\s-]|$)/.test(isced)) return true;
    if (/primary/i.test(t.school || "") || /primary/i.test(t["school:type"] || "") || /primar/i.test(t["school:level"] || "")) return true;
    return /primar|primaire|elementare|scuola elementare|scuole elementari|primaria/i.test(name);
  }
  async function osmNearest(kind, from) {
    const cfg = OSM_SEARCH[kind];
    for (const r of cfg.radii) {
      const dLat = r / 111.32, dLon = r / (111.32 * Math.cos((from.lat * Math.PI) / 180));
      const bbox = [from.lat - dLat, from.lon - dLon, from.lat + dLat, from.lon + dLon].map((x) => x.toFixed(5)).join(",");
      const filter = cfg.filter.startsWith("(") ? cfg.filter : cfg.filter + ";";
      const j = await overpassQuery(`[out:json][timeout:20][bbox:${bbox}];${filter}out center tags;`);
      let best = null;
      (j.elements || []).forEach((el) => {
        const pos = el.type === "node" ? { lat: el.lat, lon: el.lon } : el.center;
        if (!pos) return;
        if (cfg.accept && !cfg.accept(el)) return;
        const d = haversineKm(from, pos);
        if (!best || d < best.d) best = { d, pos, name: placeName(el, kind) };
      });
      if (best && best.d <= r) return best;
      if (best && r === cfg.radii[cfg.radii.length - 1]) return best;
    }
    return null;
  }

  function classify(el) {
    const t = el.tags || {};
    if (t.railway === "station" || t.railway === "halt") return "station";
    if (t.shop === "supermarket") return "grocery";
    if (t.highway === "motorway_junction") return "exit";
    if (t.amenity === "school") return "school";
    if (t.amenity === "kindergarten") return "kindergarten";
    return null;
  }
  function placeName(el, kind) {
    const t = el.tags || {};
    if (kind === "exit") return { exit: true, ref: t.ref || "", nm: t.name || "" };
    return t.name || t.brand || t.operator || null;
  }

  async function route(profileUrl, a, b) {
    const j = await getJSON(`${profileUrl}${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`, {}, 15000);
    const r = j.routes && j.routes[0];
    if (!r) throw new Error("keine Route");
    return { km: r.distance / 1000, min: r.duration / 60 };
  }

  // Bis 1 km zu Fuss, sonst Auto. Bei Fehlern Luftlinie.
  async function bestRoute(from, to, carOnly) {
    const air = haversineKm(from, to);
    try {
      if (!carOnly && air <= WALK_LIMIT_KM * 1.2) {
        const w = await route(API.routeFoot, from, to);
        if (w.km <= WALK_LIMIT_KM) return { ...w, mode: "walk" };
      }
      const c = await route(API.routeCar, from, to);
      return { ...c, mode: "car" };
    } catch (e) {
      return { km: air, min: null, mode: "air" };
    }
  }

  function parseDuration(s) {
    const m = /^(\d+)d(\d+):(\d+):(\d+)$/.exec(s || "");
    return m ? Number(m[1]) * 1440 + Number(m[2]) * 60 + Number(m[3]) : null;
  }
  // Nächster Bahnhof (sonst nächste Haltestelle) zu einem Punkt
  async function nearestStation(lat, lon) {
    const loc = await getJSON(`${API.transport}locations?x=${lat}&y=${lon}&type=station`, {}, 15000);
    const st = loc.stations || [];
    const station = st.find((s) => s.icon === "train" && s.id) || st.find((s) => s.id);
    if (!station) throw new Error("keine Haltestelle");
    const c = station.coordinate || {};
    return { id: station.id, name: station.name, lat: c.x, lon: c.y };
  }
  // Nächste Haltestelle jeder Art (Bus, Tram, Zug, Schiff …)
  async function nearestStop(lat, lon) {
    const loc = await getJSON(`${API.transport}locations?x=${lat}&y=${lon}&type=station`, {}, 15000);
    const st = (loc.stations || []).filter((s) => s.id && s.coordinate && s.coordinate.x != null);
    if (!st.length) throw new Error("keine Haltestelle");
    const from = { lat, lon };
    st.sort((a, b) => haversineKm(from, { lat: a.coordinate.x, lon: a.coordinate.y }) - haversineKm(from, { lat: b.coordinate.x, lon: b.coordinate.y }));
    return { name: st[0].name, lat: st[0].coordinate.x, lon: st[0].coordinate.y };
  }
  // Nächstes der grossen Einkaufszentren (Liste in data/einkaufszentren.js, Koordinaten aus OpenStreetMap)
  // Anzeige «Name, Ort (Kanton)»
  const mallLabel = (m) => `${m.name}, ${m.ort} (${m.kanton})`;
  // Gewähltes Einkaufszentrum (Prioritäten) oder sonst das nächste
  function nearestMall(from) {
    const malls = (window.HS_MALLS || []).filter((m) => m.lat != null);
    const chosen = state.settings.mall ? malls.find((m) => String(m.rang) === String(state.settings.mall)) : null;
    const pick = (m) => ({ d: haversineKm(from, m), pos: { lat: m.lat, lon: m.lon }, name: mallLabel(m) });
    if (chosen) return pick(chosen);
    let best = null;
    malls.forEach((m) => { const c = pick(m); if (!best || c.d < best.d) best = c; });
    return best;
  }

  // Schnellste Verbindung Dienstag 07:30
  async function fastestConnection(fromId, to) {
    const { date, time } = nextWeekdayMorning();
    const u = `${API.transport}connections?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(to)}&date=${date}&time=${time}&limit=4`;
    const j = await getJSON(u, {}, 20000);
    const cons = (j.connections || []).map((c) => ({ min: parseDuration(c.duration), transfers: c.transfers })).filter((x) => x.min != null);
    if (cons.length) return cons.reduce((a, b) => (b.min < a.min ? b : a));
    if (j.from && j.to && j.from.id === j.to.id) return { min: 0, transfers: 0 };
    return null;
  }
  const transfersText = (n) => (n === 0 ? T("direkt") : n === 1 ? T("1 Umstieg") : T("{n} Umstiege", { n }));
  // Gespeicherte Details als Daten, Text erst beim Anzeigen (damit die Sprache wechseln kann)
  const MODE_TEXT = { walk: "zu Fuss", car: "mit dem Auto", air: "Luftlinie" };
  function placeText(n) {
    if (n && typeof n === "object" && n.exit) return [T("Ausfahrt") + (n.ref ? " " + n.ref : ""), n.nm].filter(Boolean).join(" ");
    return n || T("ohne Namen");
  }
  function metaText(p, key) {
    const m = p.meta && p.meta[key];
    if (p.notFound && p.notFound[key]) return T("nichts im Umkreis gefunden");
    if (!m) return "";
    if (typeof m === "string") return m; // ältere Objekte
    if (key === "steuer") return T("Kanton {kt}: {sfk} % · Gemeinde {sfg} % (ESTV {year})", m);
    return `${placeText(m.name)} · ${T(MODE_TEXT[m.mode] || m.mode)}${m.min != null ? " · " + Math.round(m.min) + " min" : ""}`;
  }
  function trainInfoText(info) {
    if (!info) return "";
    if (typeof info === "string") return info; // ältere Objekte
    if (info.to) return `${info.from} → ${info.to}, ${transfersText(info.tr)}`;
    return T("ab {st}", { st: info.st }) + ", " + transfersText(info.tr);
  }
  async function travelTimes(stationP) {
    const station = await stationP;
    const out = {};
    await Promise.all(DESTS.map(async (d) => {
      try { const c = await fastestConnection(station.id, d.to); if (c) out[d.id] = c; } catch (e) { /* Ziel bleibt leer */ }
    }));
    return { station: station.name, stationObj: station, times: out };
  }

  // ---------- Orte in der Umgebung (Bahnhof, Einkauf, Autobahn, Schulen) ----------
  // Sucht nacheinander, damit die öffentlichen Server nicht überlastet werden.
  async function lookupPlaces(p, crits, stationP) {
    const from = { lat: p.lat, lon: p.lon };
    const failed = [], errors = [];
    let offline = false; // nur bei Totalausfall weitere Versuche überspringen
    p.target = p.target || {};
    for (const c of crits) {
      const name = plain(T(c.label));
      try {
        let b = null;
        if (c.osm === "station") {
          try {
            const st = await (stationP || nearestStation(p.lat, p.lon));
            if (st.lat != null) b = { pos: { lat: st.lat, lon: st.lon }, name: st.name };
          } catch (e) { /* weiter mit OpenStreetMap */ }
        }
        if (c.osm === "stop") {
          try { const st = await nearestStop(p.lat, p.lon); b = { pos: { lat: st.lat, lon: st.lon }, name: st.name }; }
          catch (e) { /* Fahrplan nicht erreichbar */ }
          if (!b) { failed.push(name); continue; }
        }
        if (c.osm === "mall") {
          b = nearestMall(from);
          if (!b) { failed.push(name); continue; } // Liste ohne Koordinaten: später erneut versuchen
        }
        if (!b && c.osm !== "mall") {
          if (offline) { failed.push(name); continue; }
          b = await osmNearest(c.osm, from);
        }
        if (b) {
          const r = await bestRoute(from, b.pos, c.carOnly);
          p.v[c.id] = Math.round(r.km * 100) / 100;
          p.meta[c.id] = { name: b.name, mode: r.mode, min: r.min };
          p.target[c.id] = { lat: b.pos.lat, lon: b.pos.lon, walk: r.mode === "walk" };
          delete p.edited[c.id];
          if (p.notFound) delete p.notFound[c.id];
        } else { delete p.meta[c.id]; (p.notFound = p.notFound || {})[c.id] = true; failed.push(name); }
      } catch (e) {
        failed.push(name);
        errors.push(e.message);
        if (e.offline) offline = true;
      }
    }
    return { failed, errors };
  }
  // Orts-Kriterien ohne Wert (und nicht von Hand ausgefüllt)
  const missingPlaces = (p) => CRITERIA.filter((c) => c.osm && (p.v[c.id] == null || isNaN(p.v[c.id])) && !(p.notFound && p.notFound[c.id]) && p.meta[c.id] !== "nichts im Umkreis gefunden");

  // ---------- Objekt aufbauen ----------
  async function buildProperty(place, facts, onStep) {
    const p = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      schoolV: 2,
      label: place.label,
      approx: place.origin === "gg25",
      lat: place.lat, lon: place.lon,
      v: {}, meta: {}, edited: {},
    };
    Object.assign(p, facts); // kaufpreis, zimmer, flaeche

    onStep("gemeinde", T("Gemeinde und Steuerfuss bestimmen"));
    const tax = await resolveTax(place);
    if (tax) {
      p.bfs = tax.bfs; p.gemeinde = tax.gemeinde; p.kanton = tax.kanton;
      p.v.steuer = tax.sf_gemeinde;
      p.meta.steuer = { kt: tax.kanton, sfk: tax.sf_kanton, sfg: tax.sf_gemeinde, year: TAX_YEAR };
      onStep("gemeinde", `${tax.gemeinde} (${tax.kanton})`, "done");
    } else onStep("gemeinde", T("Gemeinde nicht gefunden – Steuerfuss bitte von Hand eintragen"), "fail");

    const from = { lat: place.lat, lon: place.lon };
    const jobs = [];

    // Nächster Bahnhof aus dem Fahrplan (wird auch für die Zugzeiten gebraucht)
    const stationP = nearestStation(place.lat, place.lon);
    stationP.catch(() => {});

    onStep("osm", T("Bahnhof, Einkauf, Autobahn und Schulen suchen"));
    p.target = {};
    jobs.push(lookupPlaces(p, CRITERIA.filter((x) => x.osm), stationP).then(({ failed, errors }) => {
      if (!failed.length) onStep("osm", T("Orte in der Umgebung gefunden"), "done");
      else onStep("osm", T("Nicht gefunden: {list}", { list: failed.join(", ") }) + (errors.length ? " (" + errors[0] + ")" : "") + ". " + T("Mit «Fehlende Orte erneut suchen» später nochmals versuchen, oder Kriterium anklicken und in Google Maps nachschauen."), "fail");
    }));

    p.destInfo = {};
    DESTS.forEach((d) => (p.destInfo[d.id] = {}));

    onStep("oev", T("Reisezeiten mit dem Zug berechnen"));
    jobs.push(travelTimes(stationP).then((tt) => {
      p.station = tt.stationObj;
      DESTS.forEach((d) => {
        const c = tt.times[d.id];
        if (c) {
          p.v["dest_" + d.id + "_zug"] = c.min;
          p.destInfo[d.id].zug = { st: tt.station, tr: c.transfers };
        }
      });
      onStep("oev", T("Zug: Reisezeiten ab {st}", { st: tt.station }), "done");
    }).catch(() => onStep("oev", T("Fahrplan nicht erreichbar – Zugzeiten bitte von Hand eintragen"), "fail")));

    onStep("auto", T("Reisezeiten mit dem Auto berechnen"));
    jobs.push(Promise.all(DESTS.map(async (d) => {
      try {
        const r = await route(API.routeCar, from, d);
        p.v["dest_" + d.id + "_auto"] = Math.round(r.min);
        p.v["dest_" + d.id + "_km"] = Math.round(r.km);
        return true;
      } catch (e) { return false; }
    })).then((ok) => {
      if (ok.some(Boolean)) onStep("auto", T("Auto: Reisezeiten ohne Verkehr berechnet"), "done");
      else onStep("auto", T("Routendienst nicht erreichbar – Autozeiten bitte von Hand eintragen"), "fail");
    }));

    await Promise.all(jobs);

    if (activeWork().length) {
      onStep("work", T("Arbeitswege berechnen"));
      await Promise.all(activeWork().map((w) => computeWork(p, w)));
      onStep("work", T("Arbeitswege berechnet"), "done");
    }
    return p;
  }

  // ---------- Arbeitsorte ----------
  function activeWork() {
    return WORK.map((id) => ({ id, ...(state.settings.work[id] || {}) })).filter((w) => w.lat != null);
  }
  const workName = (w) => (w.name && w.name.trim()) || T("Person {n}", { n: w.id.slice(1) });
  // Zug- und Autozeit von einem Objekt zum Arbeitsort; von Hand angepasste Werte bleiben
  async function computeWork(p, w) {
    const k = "work_" + w.id;
    p.workInfo = p.workInfo || {};
    p.workInfo[w.id] = {};
    p.edited = p.edited || {};
    const jobs = [];
    if (!p.edited[k + "_auto"]) {
      jobs.push(route(API.routeCar, { lat: p.lat, lon: p.lon }, w).then((r) => {
        p.v[k + "_auto"] = Math.round(r.min); p.v[k + "_km"] = Math.round(r.km);
      }).catch(() => { delete p.v[k + "_auto"]; delete p.v[k + "_km"]; }));
    }
    if (!p.edited[k + "_zug"]) {
      jobs.push((async () => {
        try {
          if (!p.station) p.station = await nearestStation(p.lat, p.lon);
          const c = w.station ? await fastestConnection(p.station.id, w.station.id) : null;
          if (c) {
            p.v[k + "_zug"] = c.min;
            p.workInfo[w.id].zug = { from: p.station.name, to: w.station.name, tr: c.transfers };
          } else delete p.v[k + "_zug"];
        } catch (e) { delete p.v[k + "_zug"]; }
      })());
    }
    await Promise.all(jobs);
  }
  // Einkaufszentrum geändert: Distanz für alle Objekte neu (von Hand eingetragene Werte werden ersetzt)
  async function recomputeMall() {
    const crit = CRITERIA.filter((c) => c.id === "mall");
    await Promise.all(state.props.map((p) => { delete p.v.mall; delete p.edited.mall; return lookupPlaces(p, crit); }));
    save(); renderResults();
  }
  async function recomputeWorkForAll(w, statusEl) {
    if (!state.props.length) { statusEl.textContent = ""; return; }
    statusEl.textContent = state.props.length > 1 ? T("Arbeitsweg für {n} Objekte wird berechnet …", { n: state.props.length }) : T("Arbeitsweg für 1 Objekt wird berechnet …");
    await Promise.all(state.props.map((p) => computeWork(p, w)));
    statusEl.textContent = T("Arbeitsweg für alle Objekte berechnet.");
    save(); renderResults();
  }

  // ---------- Google Maps ----------
  // Öffnet die Route ab der eingegebenen Adresse. Ohne gefundenes Ziel: Suche in der Umgebung.
  function mapsLink(c, p) {
    const origin = p.label.replace(/\s*\([A-Z]{2}\)\s*$/, "") + ", Schweiz";
    const dir = (dest, mode) => "https://www.google.com/maps/dir/?" + new URLSearchParams({ api: "1", origin, destination: dest, travelmode: mode });
    if (c.dest) {
      const ev = travelValue(c, p);
      return ev.used === "auto" ? dir(c.dest.lat + "," + c.dest.lon, "driving") : dir(c.dest.to + ", Schweiz", "transit");
    }
    if (c.work) {
      const ev = travelValue(c, p);
      return dir(c.work.label + ", Schweiz", ev.used === "auto" ? "driving" : "transit");
    }
    const t = p.target && p.target[c.key];
    if (t) return dir(t.lat + "," + t.lon, t.walk ? "walking" : "driving");
    const def = CRITERIA.find((x) => x.id === c.key);
    if (def && def.gsearch && p.lat != null) {
      return `https://www.google.com/maps/search/${encodeURIComponent(T(def.gsearch))}/@${p.lat},${p.lon},15z`;
    }
    return null;
  }

  // ---------- Bewertung ----------
  const num = (x) => (x == null || x === "" || isNaN(x) ? null : Number(x));
  // Wert, der für ein Ziel zählt: Zug, Auto oder der schnellere von beiden
  function travelValue(c, p) {
    const zug = num(p.v[c.key + "_zug"]), auto = num(p.v[c.key + "_auto"]);
    const mode = (c.dest ? state.settings.destMode[c.dest.id] : state.settings.workMode[c.work.id]) || "best";
    if (mode === "zug") return { v: zug, used: "zug", zug, auto };
    if (mode === "auto") return { v: auto, used: "auto", zug, auto };
    if (zug == null && auto == null) return { v: null, used: null, zug, auto };
    if (auto == null || (zug != null && zug <= auto)) return { v: zug, used: "zug", zug, auto };
    return { v: auto, used: "auto", zug, auto };
  }
  function activeCriteria() {
    const s = state.settings;
    const list = CRITERIA.map((c) => ({ ...c, key: c.id, label: T(c.label), note: c.note ? T(c.note) : "" }));
    activeWork().forEach((w) => {
      const mode = s.workMode[w.id] || "best";
      const name = T("Arbeitsort {name}", { name: workName(w) });
      list.push({ id: "work_" + w.id, key: "work_" + w.id, work: w, travel: true, label: name + " (" + modeName(mode) + ")", name, note: w.label, unit: "min", t: DEST_T });
    });
    s.dests.forEach((id) => {
      const d = DESTS.find((x) => x.id === id);
      const mode = s.destMode[id] || "best";
      list.push({ id: "dest_" + id, key: "dest_" + id, dest: d, travel: true, label: T(d.label) + " (" + modeName(mode) + ")", name: T(d.label), unit: "min", t: DEST_T });
    });
    return list;
  }
  // Abweichung des Kaufpreises vom Wunschpreis in Prozent (negativ = günstiger)
  function priceDeviation(p) {
    const w = num(state.settings.wunschpreis), k = num(p.kaufpreis);
    if (!w || k == null) return null;
    return ((k - w) / w) * 100;
  }
  function valueOf(c, p) {
    if (c.travel) return travelValue(c, p).v;
    if (c.id === "kaufpreis") return priceDeviation(p);
    return num(p.v[c.key]);
  }
  function scoreOf(c, p, all) {
    const v = valueOf(c, p);
    if (v == null || isNaN(v)) return null;
    if (c.id === "steuer") {
      const r = cantonRange[p.kanton];
      if (!r) return null;
      return r.max === r.min ? 10 : (10 * (r.max - v)) / (r.max - r.min);
    }
    // Kaufpreis: günstiger = mehr Punkte. −20 % → 10, 0 % → 7.5, +20 % → 0
    if (c.id === "kaufpreis") return v <= 0 ? Math.min(10, 7.5 - 0.125 * v) : Math.max(0, 7.5 - 0.375 * v);
    return piecewise(v, c.t);
  }
  function evaluate(p, all) {
    const s = state.settings;
    let sum = 0, wsum = 0, fails = [], unknown = [];
    const rows = activeCriteria().map((c) => {
      const w = Number(s.weights[c.key] ?? 3);
      const sc = scoreOf(c, p, all);
      const lim = s.limits[c.key];
      const v = valueOf(c, p);
      let fail = false;
      if (lim != null && lim !== "") {
        if (v == null || isNaN(v)) unknown.push(c.label);
        else if (v > Number(lim)) { fail = true; fails.push(c.label); }
      }
      if (w > 0 && sc != null) { sum += w * sc; wsum += w; }
      return { c, w, sc, v, fail };
    });
    // Beitrag je Kriterium in Score-Punkten (0–100); die Summe ergibt den Gesamtscore
    rows.forEach((r) => { r.contrib = wsum && r.w > 0 && r.sc != null ? (r.w * r.sc * 10) / wsum : null; });
    return { total: wsum ? Math.round((sum / wsum) * 10) : null, exact: wsum ? (sum / wsum) * 10 : null, sum, wsum, rows, fails, unknown };
  }

  // ---------- Darstellung: Prioritäten ----------
  function renderPrio() {
    const s = state.settings;
    const rows = activeCriteria().map((c) => {
      const w = s.weights[c.key] ?? 3;
      const lim = s.limits[c.key];
      const unit = c.unit;
      return `<div class="prio-row${Number(w) === 0 ? " off" : ""}">
        <div class="prio-name"><label for="w-${c.key}">${esc(c.travel ? c.name : c.label)}</label>${c.note ? `<small>${esc(c.note)}</small>` : ""}${c.id === "mall" ? `<select class="mode mall-select" id="m-mall" data-mallsel="1" aria-label="${esc(T("Einkaufszentrum wählen"))}"><option value="">${esc(T("Nächstes Einkaufszentrum (automatisch)"))}</option>${(window.HS_MALLS || []).slice().sort((a, b) => a.name.localeCompare(b.name, "de")).map((m) => `<option value="${m.rang}"${String(s.mall) === String(m.rang) ? " selected" : ""}>${esc(mallLabel(m))}</option>`).join("")}</select>` : ""}${c.travel ? (() => { const id = c.dest ? c.dest.id : c.work.id, cur = (c.dest ? s.destMode[id] : s.workMode[id]) || "best"; return `<select class="mode" id="m-${c.key}" data-mode="${c.key}" aria-label="${esc(T("Verkehrsmittel für {name}", { name: c.name }))}">${Object.keys(MODES).map((k) => `<option value="${k}"${cur === k ? " selected" : ""}>${k === "best" ? T("Schneller") : modeName(k)}</option>`).join("")}</select>`; })() : ""}</div>
        <div class="slider lvl-${w}"><input id="w-${c.key}" data-w="${c.key}" type="range" min="0" max="5" step="1" value="${w}" aria-valuetext="${esc(weightText(w))}"><output for="w-${c.key}">${esc(weightText(w))}</output></div>
        <div class="limit"><input id="l-${c.key}" data-l="${c.key}" type="number" min="0" step="any" placeholder="${esc(T("max."))}" value="${lim ?? ""}" aria-label="${esc(T("Muss-Kriterium {name} maximal", { name: plain(c.label) }))}"><span>${esc(unit)}</span></div>
      </div>`;
    }).join("");
    $("#prio-table").innerHTML = `<div class="prio-head"><span>${T("Kriterium")}</span><span>${T("Gewichtung")}</span><span>${T("Muss max.")}</span></div>${rows}`;

    $("#dest-chips").innerHTML = DESTS.map((d) => `<label class="chip"><input type="checkbox" id="d-${d.id}" data-dest="${d.id}"${s.dests.includes(d.id) ? " checked" : ""}><span>${esc(T(d.label))}</span></label>`).join("");
  }

  // ---------- Darstellung: Resultate ----------
  function factsHtml(p) {
    const parts = [
      p.kaufpreis ? "CHF " + chf(p.kaufpreis) : T("Kaufpreis") + " –",
      p.zimmer ? T("{n} Zimmer", { n: fmt(p.zimmer, p.zimmer % 1 ? 1 : 0) }) : T("Zimmer") + " –",
      p.flaeche ? p.flaeche + " m²" : "m² –",
    ];
    return `<div class="facts">${parts.map((x) => `<span>${esc(x)}</span>`).join("")}</div>`;
  }
  function scoreColor(sc) {
    if (sc == null) return "var(--line)";
    return sc >= 7 ? "var(--good)" : sc >= 4 ? "var(--mid)" : "var(--bad)";
  }
  function renderResults() {
    const props = state.props;
    $("#maps-hint").hidden = props.length === 0;
    renderBulk();
    renderPropList();
    const cantons = [...new Set(props.map((p) => p.kanton).filter(Boolean))];
    const warn = $("#canton-warn");
    warn.hidden = cantons.length < 2;
    warn.textContent = cantons.length > 1
      ? T("Ihre Objekte liegen in {n} Kantonen ({list}). Steuerfüsse sind nur innerhalb eines Kantons vergleichbar: der Steuerfuss-Score zeigt deshalb den Rang in der eigenen Kantonsliste, nicht die tatsächliche Steuerbelastung.", { n: cantons.length, list: cantons.join(", ") })
      : "";

    if (!props.length) {
      $("#results").innerHTML = `<div class="empty"><strong>${T("Noch keine Objekte")}</strong>
        ${T("So funktioniert HomeScore:")}
        <ol>
          <li>${T("Adresse oder Gemeinde eines Inserats eingeben, dazu Kaufpreis, Zimmer und Wohnfläche aus dem Inserat.")}</li>
          <li>${T("HomeScore holt Steuerfuss, Distanzen und Reisezeiten aus öffentlichen Daten.")}</li>
          <li>${T("Prioritäten mit den Reglern setzen. Die Rangliste passt sich sofort an.")}</li>
        </ol>
        <a href="#objekte" class="btn-next">${T("Zu Schritt 1: Objekte hinzufügen")}</a></div>`;
      return;
    }
    const evals = props.map((p) => ({ p, e: evaluate(p, props) }));
    evals.sort((a, b) => {
      const af = a.e.fails.length ? 1 : 0, bf = b.e.fails.length ? 1 : 0;
      if (af !== bf) return af - bf;
      return (b.e.total ?? -1) - (a.e.total ?? -1);
    });
    $("#results").innerHTML = evals.map(({ p, e }, i) => {
      const tags = [];
      if (p.approx) tags.push(`<span class="tag">${T("ungefähr: ab Gemeindezentrum")}</span>`);
      if (e.fails.length) tags.push(`<span class="tag ko">${esc(T("Muss-Kriterium nicht erfüllt: {list}", { list: plain(e.fails.join(", ")) }))}</span>`);
      if (e.unknown.length) tags.push(`<span class="tag">${esc(T("Muss-Kriterium ohne Wert: {list}", { list: plain(e.unknown.join(", ")) }))}</span>`);
      const rows = e.rows.map((r) => {
        const step = r.c.unit === "km" ? "0.01" : "1";
        const val = r.v == null || isNaN(r.v) ? "" : r.v;
        const pct = r.sc == null ? 0 : Math.round(r.sc * 10);
        let detailText = metaText(p, r.c.key);
        const man = (k) => (p.edited[k] ? ` class="manual" title="${esc(T("Von Hand eingetragen"))}"` : "");
        let valueCell = `<input type="number"${man(r.c.key)} step="${step}" min="0" value="${val}" data-prop="${p.id}" data-key="${r.c.key}" aria-label="${esc(T("{crit} für {obj}", { crit: plain(r.c.label), obj: p.label }))}"><span class="unit">${esc(r.c.unit)}</span>`;
        let editedKey = p.edited[r.c.key];
        if (r.c.id === "kaufpreis") {
          const dev = priceDeviation(p), w = num(state.settings.wunschpreis);
          valueCell = `<input type="text" inputmode="numeric" class="wide money" value="${moneyText(p.kaufpreis)}" data-prop="${p.id}" data-key="kaufpreis" aria-label="${esc(T("Kaufpreis in CHF für {obj}", { obj: p.label }))}"><span class="unit">CHF</span>`;
          detailText = !w ? T("Wunschpreis unter «Ihre Prioritäten» eintragen")
            : p.kaufpreis == null ? T("Kaufpreis eintragen")
            : T(dev > 0 ? "{d} % über Wunschpreis CHF {w}" : dev < 0 ? "{d} % unter Wunschpreis CHF {w}" : "{d} % gleich Wunschpreis CHF {w}", { d: (dev > 0 ? "+" : "") + fmt(dev), w: chf(w) });
        }
        if (r.c.travel) {
          const k = r.c.key, ev = travelValue(r.c, p);
          const info = r.c.dest ? (p.destInfo && p.destInfo[r.c.dest.id]) || {} : (p.workInfo && p.workInfo[r.c.work.id]) || {};
          const km = num(p.v[k + "_km"]);
          const inp = (m, v) => `<label class="dual${ev.used === m ? " used" : ""}"><span>${modeName(m)}</span><input type="number"${man(k + "_" + m)} step="1" min="0" value="${v ?? ""}" data-prop="${p.id}" data-key="${k}_${m}" aria-label="${esc(T("{mode} zu {name} in Minuten für {obj}", { mode: modeName(m), name: r.c.name, obj: p.label }))}"><span class="unit">min</span></label>`;
          valueCell = inp("zug", ev.zug) + inp("auto", ev.auto);
          detailText = [info.zug ? modeName("zug") + " " + trainInfoText(info.zug) : "", km != null ? T("Auto {km} km, ohne Verkehr", { km }) : ""].filter(Boolean).join(" · ");
          editedKey = p.edited[k + "_zug"] || p.edited[k + "_auto"];
        }
        const detail = detailText ? `<span class="detail">${esc(detailText)}</span>` : "";
        const edited = editedKey ? ` <span class="edited">${T("angepasst")}</span>` : "";
        return `<tr class="${r.fail ? "fail" : ""}">
          <td>${(() => { const u = mapsLink(r.c, p); return u ? `<a class="maplink" href="${esc(u)}" target="_blank" rel="noopener" title="${esc(T("In Google Maps öffnen"))}">${esc(r.c.label)}<span aria-hidden="true"> ↗</span></a>` : esc(r.c.label); })()}${edited}${detail}</td>
          <td class="val">${valueCell}</td>
          <td><div class="bar" title="${r.sc == null ? T("kein Score") : T("{v} von 10", { v: fmt(r.sc) })}"><i style="--w:${pct}%;--c:${scoreColor(r.sc)}"></i><em>${r.sc == null ? "–" : fmt(r.sc)}</em></div></td>
          <td class="w">${r.w}</td>
          <td class="contrib">${r.contrib != null
            ? `<span class="cnum" title="${esc(T("{p} Punkte × Gewicht {w} = {r}", { p: fmt(r.sc), w: r.w, r: fmt(r.sc * r.w) }))}">+${fmt(r.contrib)}</span>`
            : `<span class="muted">${r.w === 0 ? T("nicht gewichtet") : T("kein Wert")}</span>`}</td>
        </tr>`;
      }).join("");
      const open = openCards.has(p.id);
      return `<article class="card${e.fails.length ? " ko" : ""}${open ? " open" : ""}">
        <div class="card-head" data-head="${p.id}">
          <label class="select" title="${esc(T("Auswählen"))}"><input type="checkbox" id="sel-${p.id}" data-select="${p.id}"${selected.has(p.id) ? " checked" : ""} aria-label="${esc(T("{obj} auswählen", { obj: p.label }))}"><span class="rank">#${i + 1}</span></label>
          <div class="card-title">
            <h3>${esc(p.label)}</h3>
            ${factsHtml(p)}
            <div class="meta">${p.gemeinde ? `<span>${esc(p.gemeinde)} (${esc(p.kanton)})</span>` : ""}${tags.join(" ")}</div>
          </div>
          ${(() => {
            const miss = e.rows.filter((r) => r.w > 0 && (r.v == null || isNaN(r.v))).map((r) => plain(r.c.travel ? r.c.name : r.c.label));
            const ok = miss.length === 0;
            return `<div class="score ${ok ? "complete" : "incomplete"}" title="${esc(ok ? T("Alle Werte vorhanden") : T("Fehlt: {list}", { list: miss.join(", ") }))}"><b>${e.total ?? "–"}</b><small>${ok ? T("von 100 · vollständig") : miss.length === 1 ? T("1 Wert fehlt") : T("{n} Werte fehlen", { n: miss.length })}</small></div>`;
          })()}
          <button type="button" class="toggle" data-toggle="${p.id}" aria-expanded="${open}" aria-controls="body-${p.id}" aria-label="${esc(open ? T("Details schliessen") : T("Details öffnen"))}"><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        <div class="card-body" id="body-${p.id}"${open ? "" : " hidden"}>
        <div class="table-scroll"><table class="breakdown">
          <thead><tr><th>${T("Kriterium")}</th><th>${T("Wert")}</th><th title="${esc(T("Punkte von 0 bis 10"))}">${T("Punkte")}</th><th>${T("Gew.")}</th><th title="${esc(T("Anteil am Gesamtscore"))}">${T("Beitrag")}</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="5" class="calc">${e.wsum
            ? `<strong>${T("Gesamtscore")}</strong> = ${T("Σ (Punkte × Gewicht) ÷ Σ Gewichte × 10")} = ${fmt(e.sum)} ÷ ${e.wsum} × 10 = ${fmt(e.exact)} ≈ <strong>${e.total}</strong>
               <span class="muted">${T("Die Spalte «Beitrag» zeigt denselben Wert aufgeteilt nach Kriterium (Punkte × Gewicht ÷ {w} × 10). Kriterien ohne Wert oder mit Gewicht 0 zählen nicht mit.", { w: e.wsum })}</span>`
            : T("Noch kein Score: Es fehlen Werte oder alle Gewichte sind 0.")}</td></tr></tfoot>
        </table></div>
        <div class="card-foot">${missingPlaces(p).length ? `<button type="button" class="btn-ghost" data-retry="${p.id}">${T("Fehlende Orte erneut suchen")}</button>` : ""}<button type="button" class="btn-ghost" data-remove="${p.id}">${T("Entfernen")}</button></div>
        </div>
      </article>`;
    }).join("");
  }
  function renderAll() { renderPrio(); renderResults(); if (!$("#compare").hidden) renderCompare(); }

  // ---------- Vergleich von 2 Objekten (eigene Ansicht, Adresse #vergleich-<id>-<id>) ----------
  let compareIds = null;
  function showValue(c, p) {
    const v = valueOf(c, p);
    if (c.travel) {
      const ev = travelValue(c, p);
      if (ev.v == null) return "–";
      const other = ev.used === "zug" ? ev.auto : ev.zug;
      return `${ev.v} min ${modeName(ev.used)}` + (other != null && (state.settings[c.dest ? "destMode" : "workMode"][c.dest ? c.dest.id : c.work.id] || "best") === "best" ? ` <span class="muted">(${modeName(ev.used === "zug" ? "auto" : "zug")} ${other} min)</span>` : "");
    }
    if (v == null) return "–";
    if (c.id === "kaufpreis") return `CHF ${chf(p.kaufpreis)} <span class="muted">(${v > 0 ? "+" : ""}${fmt(v)} %)</span>`;
    if (c.id === "steuer") return `${fmt(v, v % 1 ? 1 : 0)} %`;
    return `${fmt(v, 2)} ${esc(c.unit)}`;
  }
  function renderCompare() {
    const [a, b] = (compareIds || []).map((id) => state.props.find((p) => p.id === id));
    const box = $("#compare-body");
    if (!a || !b) { box.innerHTML = `<p class="empty">${T("Die Objekte wurden nicht gefunden. Zurück zur Rangliste und 2 Objekte auswählen.")}</p>`; return; }
    const ea = evaluate(a, state.props), eb = evaluate(b, state.props);
    let winsA = 0, winsB = 0, ties = 0;
    const rows = ea.rows.map((ra, i) => {
      const rb = eb.rows[i];
      let better = null;
      if (ra.sc != null && rb.sc != null && ra.w > 0) {
        if (Math.abs(ra.sc - rb.sc) < 0.05) ties++;
        else if (ra.sc > rb.sc) { better = "a"; winsA++; } else { better = "b"; winsB++; }
      }
      const cell = (r, p, side) => `<td class="cmp-cell${better === side ? " better" : ""}${r.fail ? " fail" : ""}">
          <span class="cmp-val">${showValue(ra.c, p)}</span>
          <span class="cmp-pts">${r.sc == null ? T("kein Score") : T("{p} Punkte", { p: fmt(r.sc) })}${r.contrib != null ? " · " + T("Beitrag") + " +" + fmt(r.contrib) : ""}${r.fail ? " · " + T("Muss-Kriterium nicht erfüllt") : ""}</span>
        </td>`;
      return `<tr class="${ra.w === 0 ? "off" : ""}">
        <th scope="row">${esc(plain(ra.c.label))}<span class="muted">${T("Gewicht {w}", { w: ra.w })}${ra.w === 0 ? " · " + T("zählt nicht") : ""}</span></th>
        ${cell(ra, a, "a")}${cell(rb, b, "b")}
      </tr>`;
    }).join("");
    const lead = ea.exact != null && eb.exact != null ? (ea.exact > eb.exact ? "a" : eb.exact > ea.exact ? "b" : null) : null;
    const head = (p, e, side) => `<div class="cmp-head${lead === side ? " lead" : ""}${e.fails.length ? " ko" : ""}">
        ${lead === side ? `<span class="badge">${T("Höherer Score")}</span>` : ""}
        <h3>${esc(p.label)}</h3>
        ${factsHtml(p)}
        <div class="cmp-score"><b>${e.total ?? "–"}</b><small>${T("von 100")}</small></div>
        ${e.fails.length ? `<span class="tag ko">${esc(T("Muss-Kriterium nicht erfüllt: {list}", { list: plain(e.fails.join(", ")) }))}</span>` : ""}
      </div>`;
    const nameA = esc(a.gemeinde || a.label), nameB = esc(b.gemeinde || b.label);
    const diff = ea.total != null && eb.total != null ? Math.abs(ea.total - eb.total) : null;
    const verdict = lead == null
      ? T("Beide Objekte haben den gleichen Score.")
      : T(diff === 1 ? "{name} liegt 1 Punkt vorne." : "{name} liegt {n} Punkte vorne.", { name: `<strong>${lead === "a" ? nameA : nameB}</strong>`, n: diff });
    box.innerHTML = `
      <div class="cmp-heads">${head(a, ea, "a")}${head(b, eb, "b")}</div>
      <p class="cmp-verdict">${verdict} ${T(winsA === 1 ? "{a} ist in 1 Kriterium besser, {b} in {nb}" : "{a} ist in {na} Kriterien besser, {b} in {nb}", { a: nameA, na: winsA, b: nameB, nb: winsB })}${ties ? ", " + T("{n} gleich", { n: ties }) : ""}.</p>
      <div class="table-scroll"><table class="cmp-table">
        <thead><tr><th>${T("Kriterium")}</th><th>${nameA}</th><th>${nameB}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="hint">${T("Grün = mehr Punkte in diesem Kriterium. Die Gewichte stammen aus «Ihre Prioritäten»; Änderungen dort gelten auch hier.")}</p>`;
  }
  // ---------- Schritte (Tabs): #objekte, #prioritaeten, #ergebnis; Vergleich gehört zu «Ergebnis» ----------
  const TABS = ["objekte", "prioritaeten", "ergebnis"];
  let currentTab = null;
  function showTab(tab) {
    TABS.forEach((t) => {
      $("#tab-" + t).hidden = t !== tab;
      const st = $("#t-" + t);
      st.setAttribute("aria-selected", String(t === tab));
      st.classList.toggle("active", t === tab);
    });
    try { localStorage.setItem("homescore.tab", tab); } catch (e) { /* ignorieren */ }
    if (currentTab !== null && currentTab !== tab) window.scrollTo(0, 0);
    currentTab = tab;
  }
  function route_() {
    const m = /^#vergleich-([a-z0-9]+)-([a-z0-9]+)$/.exec(location.hash);
    const on = !!m;
    compareIds = m ? [m[1], m[2]] : null;
    $("#compare").hidden = !on;
    document.querySelector("main.layout").hidden = on;
    if (on) {
      TABS.forEach((t) => { const st = $("#t-" + t); st.classList.toggle("active", t === "ergebnis"); st.setAttribute("aria-selected", String(t === "ergebnis")); });
      renderCompare(); window.scrollTo(0, 0);
      return;
    }
    const h = location.hash.slice(1);
    let tab = TABS.includes(h) ? h : null;
    if (!tab) {
      try { tab = localStorage.getItem("homescore.tab"); } catch (e) { /* leer */ }
      if (!TABS.includes(tab)) tab = state.props.length ? "ergebnis" : "objekte";
    }
    showTab(tab);
  }
  window.addEventListener("hashchange", route_);

  // ---------- Ereignisse: Prioritäten ----------
  $("#prio-table").addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.dataset.w) {
      state.settings.weights[t.dataset.w] = Number(t.value);
      const wt = weightText(t.value);
      t.nextElementSibling.value = wt;
      t.setAttribute("aria-valuetext", wt);
      t.parentElement.className = "slider lvl-" + t.value;
      t.closest(".prio-row").classList.toggle("off", Number(t.value) === 0);
    } else if (t.dataset.l) {
      state.settings.limits[t.dataset.l] = t.value === "" ? null : Number(t.value);
    } else if (t.dataset.mode) {
      const key = t.dataset.mode;
      if (key.startsWith("dest_")) state.settings.destMode[key.slice(5)] = t.value;
      else state.settings.workMode[key.slice(5)] = t.value;
    } else if (t.dataset.mallsel) {
      if (state.settings.mall === t.value) return;
      state.settings.mall = t.value;
      save();
      recomputeMall();
      return;
    } else return;
    save(); renderResults();
  });
  $("#dest-chips").addEventListener("change", (ev) => {
    const id = ev.target.dataset.dest;
    if (!id) return;
    const set = new Set(state.settings.dests);
    ev.target.checked ? set.add(id) : set.delete(id);
    state.settings.dests = DESTS.map((d) => d.id).filter((x) => set.has(x));
    save(); renderAll();
  });
  const wp = $("#wunschpreis");
  wp.value = moneyText(state.settings.wunschpreis);
  const onWish = () => {
    const v = moneyVal(wp);
    if (v === state.settings.wunschpreis) return; // nichts geändert: nicht neu zeichnen
    state.settings.wunschpreis = v;
    save(); renderResults();
  };
  wp.addEventListener("input", onWish);
  wp.addEventListener("change", onWish);
  // Zurücksetzen behält Arbeitsorte und Wunschpreis
  $("#btn-reset").addEventListener("click", () => { const work = state.settings.work, wunschpreis = state.settings.wunschpreis, mallBefore = state.settings.mall; state.settings = { ...defaultSettings(), work, wunschpreis }; if (mallBefore) recomputeMall(); save(); renderAll(); });

  // ---------- Ereignisse: Resultate ----------
  // ---------- Auswahl: mehrere Objekte auf einmal entfernen ----------
  const selected = new Set();
  let undo = null, undoTimer;
  function renderBulk() {
    const props = state.props;
    [...selected].forEach((id) => { if (!props.some((p) => p.id === id)) selected.delete(id); });
    const bar = $("#bulk");
    bar.hidden = props.length === 0 && !undo;
    const n = selected.size;
    const all = props.length > 0 && n === props.length;
    bar.innerHTML = undo
      ? `<span class="bulk-info">${undo.items.length === 1 ? T("1 Objekt entfernt.") : T("{n} Objekte entfernt.", { n: undo.items.length })}</span><button type="button" class="btn-ghost" data-bulk="undo">${T("Rückgängig")}</button>`
      : `<label class="bulk-all"><input type="checkbox" id="sel-all" data-bulk="all"${all ? " checked" : ""}> ${T("Alle auswählen")}</label>
         <span class="bulk-info">${n ? T("{n} von {total} ausgewählt", { n, total: props.length }) + (n === 2 ? "" : " · " + T("zum Vergleichen genau 2 wählen")) : T("Objekte zum Vergleichen oder Entfernen auswählen")}</span>
         ${n ? `<div class="bulk-actions">
           <button type="button" class="btn-compare" data-bulk="compare"${n === 2 ? "" : " disabled"} title="${esc(n === 2 ? T("Die 2 ausgewählten Objekte vergleichen") : T("Zum Vergleichen genau 2 Objekte auswählen"))}"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7 4v12M13 4v12M3 8h4M13 12h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>${T("Vergleichen")}</button>
           <button type="button" class="btn-danger" data-bulk="remove"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="lbl-long">${n === 1 ? T("Ausgewähltes entfernen") : T("{n} Ausgewählte entfernen", { n })}</span><span class="lbl-short">${T("Entfernen")} (${n})</span></button>
         </div>` : ""}`;
    const allBox = $("#sel-all");
    if (allBox) allBox.indeterminate = n > 0 && !all;
  }
  function doUndo() {
    if (!undo) return;
    undo.items.sort((a, b) => a.idx - b.idx).forEach(({ p, idx }) => state.props.splice(Math.min(idx, state.props.length), 0, p));
    undo = null; clearTimeout(undoTimer);
    save(); renderResults();
  }
  function removeProps(ids) {
    const items = [];
    state.props.forEach((p, idx) => { if (ids.has(p.id)) items.push({ p, idx }); });
    if (!items.length) return;
    state.props = state.props.filter((p) => !ids.has(p.id));
    selected.clear(); // nach dem Entfernen neu auswählen
    undo = { items };
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { undo = null; renderBulk(); renderPropList(); }, 8000);
    save(); renderResults();
  }
  $("#bulk").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-bulk]");
    if (!b || b.disabled) return;
    const act = b.dataset.bulk;
    if (act === "remove") removeProps(new Set(selected));
    else if (act === "compare" && selected.size === 2) location.hash = "vergleich-" + [...selected].join("-");
    else if (act === "undo") doUndo();
  });
  $("#bulk").addEventListener("change", (ev) => {
    if (ev.target.dataset.bulk !== "all") return;
    if (ev.target.checked) state.props.forEach((p) => selected.add(p.id)); else selected.clear();
    renderResults();
  });
  $("#results").addEventListener("change", (ev) => {
    const id = ev.target.dataset && ev.target.dataset.select;
    if (!id) return;
    ev.target.checked ? selected.add(id) : selected.delete(id);
    renderBulk();
  });

  // ---------- Schritt 1: Liste der erfassten Objekte ----------
  function renderPropList() {
    const props = state.props;
    const badge = $("#badge-objekte");
    badge.textContent = props.length ? String(props.length) : "";
    badge.hidden = !props.length;
    const list = $("#prop-list");
    if (list.contains(document.activeElement) && document.activeElement.dataset.edit) return; // nicht neu zeichnen, während getippt wird
    const undoRow = undo ? `<li class="prop-undo"><span>${undo.items.length === 1 ? T("1 Objekt entfernt.") : T("{n} Objekte entfernt.", { n: undo.items.length })}</span><button type="button" class="btn-ghost" data-undo="1">${T("Rückgängig")}</button></li>` : "";
    if (!props.length) { list.innerHTML = undoRow + `<li class="prop-empty">${T("Noch keine Objekte hinzugefügt.")}</li>`; return; }
    list.innerHTML = undoRow + props.map((p) => {
      const e = evaluate(p, props);
      const miss = e.rows.filter((r) => r.w > 0 && (r.v == null || isNaN(r.v))).length;
      const status = miss === 0
        ? `<span class="prop-status ok">✓ ${T("Daten vollständig")}</span>`
        : `<span class="prop-status miss">${miss === 1 ? T("1 Wert fehlt") : T("{n} Werte fehlen", { n: miss })}</span>`;
      return `<li class="prop-item">
        <div class="prop-main"><strong>${esc(p.label)}</strong>
          <div class="prop-edit">
            <label><span>${T("Kaufpreis (CHF)")}</span><input type="text" inputmode="numeric" class="money" id="pk-${p.id}" data-edit="kaufpreis" data-prop="${p.id}" value="${moneyText(p.kaufpreis)}"></label>
            <label><span>${T("Zimmer")}</span><input type="text" inputmode="decimal" id="pz-${p.id}" data-edit="zimmer" data-prop="${p.id}" value="${p.zimmer ?? ""}"></label>
            <label><span>${T("Wohnfläche (m²)")}</span><input type="text" inputmode="numeric" id="pf-${p.id}" data-edit="flaeche" data-prop="${p.id}" value="${p.flaeche ?? ""}"></label>
          </div>${status}</div>
        <button type="button" class="btn-x" data-remove="${p.id}" aria-label="${esc(T("{obj} entfernen", { obj: p.label }))}" title="${esc(T("Entfernen"))}">×</button>
      </li>`;
    }).join("");
  }
  // Angaben eines Objekts ändern (Adresse bleibt fest)
  $("#prop-list").addEventListener("input", (ev) => {
    const t = ev.target, f = t.dataset && t.dataset.edit;
    if (!f) return;
    const p = state.props.find((x) => x.id === t.dataset.prop);
    if (!p) return;
    const n = f === "kaufpreis" ? moneyVal(t) : decimalVal(t);
    p[f] = n != null && n > 0 ? n : null;
    save(); renderResults();
  });
  $("#prop-list").addEventListener("focusout", (ev) => {
    if (ev.target.dataset && ev.target.dataset.edit) setTimeout(() => { if (!$("#prop-list").contains(document.activeElement)) renderPropList(); }, 0);
  });
  $("#prop-list").addEventListener("click", (ev) => {
    if (ev.target.dataset && ev.target.dataset.undo) { doUndo(); return; }
    const id = ev.target.dataset && ev.target.dataset.remove;
    if (id) removeProps(new Set([id]));
  });

  // Aufgeklappte Objekte (pro Browser gemerkt); standardmässig nur die Kopfzeile
  const OPEN_KEY = "homescore.open";
  let openCards = new Set();
  try { openCards = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]")); } catch (e) { /* leer */ }
  function toggleCard(id) {
    openCards.has(id) ? openCards.delete(id) : openCards.add(id);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openCards])); } catch (e) { /* ignorieren */ }
    const card = document.querySelector(`[data-head="${id}"]`).closest(".card");
    const open = openCards.has(id);
    card.classList.toggle("open", open);
    card.querySelector(".card-body").hidden = !open;
    const btn = card.querySelector("[data-toggle]");
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? T("Details schliessen") : T("Details öffnen"));
  }
  let rowTimer;
  // Werte in der Rangliste: Score beim Tippen neu berechnen, Fokus und Cursor bleiben erhalten
  $("#results").addEventListener("input", (ev) => {
    const t = ev.target;
    if (!t.dataset.prop) return;
    const p = state.props.find((x) => x.id === t.dataset.prop);
    if (!p) return;
    const key = t.dataset.key, raw = t.value;
    if (key === "kaufpreis") p.kaufpreis = moneyVal(t);
    else { if (raw === "") delete p.v[key]; else p.v[key] = Number(raw); p.edited[key] = true; }
    save();
    // neu zeichnen, sobald eine kurze Tipppause entsteht; danach Fokus zurück ins Feld
    clearTimeout(rowTimer);
    rowTimer = setTimeout(() => {
      const focused = document.activeElement === t;
      renderResults();
      const again = document.querySelector(`[data-prop="${p.id}"][data-key="${key}"]`);
      if (focused && again) again.focus();
    }, 600);
  });
  // Feld verlassen: sofort neu zeichnen
  $("#results").addEventListener("focusout", (ev) => {
    if (!ev.target.dataset || !ev.target.dataset.prop) return;
    clearTimeout(rowTimer);
    setTimeout(renderResults, 0);
  });
  // (Änderungen werden schon beim Tippen übernommen, siehe "input" oben)
  $("#results").addEventListener("click", async (ev) => {
    const head = ev.target.closest("[data-head]");
    if (head && !ev.target.closest("a, .select")) { toggleCard(head.dataset.head); return; }
    const retry = ev.target.dataset && ev.target.dataset.retry;
    if (retry) {
      const p = state.props.find((x) => x.id === retry);
      if (!p) return;
      const btn = ev.target;
      btn.disabled = true; btn.textContent = T("Suche läuft …");
      const { failed } = await lookupPlaces(p, missingPlaces(p));
      save(); renderResults();
      if (failed.length) {
        const again = document.querySelector(`[data-retry="${retry}"]`);
        if (again) again.insertAdjacentHTML("beforebegin", `<span class="retry-note">${esc(T("Noch nicht gefunden: {list}. Die Server sind ausgelastet, bitte später nochmals versuchen.", { list: failed.join(", ") }))}</span>`);
      }
      return;
    }
    const id = ev.target.dataset && ev.target.dataset.remove;
    if (!id) return;
    removeProps(new Set([id]));
  });
  // ---------- Arbeitsorte: Eingabe ----------
  function renderWork() {
    $("#work-list").innerHTML = WORK.map((id) => {
      const w = state.settings.work[id] || {};
      return `<div class="work-row" data-work="${id}">
        <input type="text" class="work-name" id="wn-${id}" value="${esc(w.name || "")}" placeholder="${esc(T("Person {n}", { n: id.slice(1) }))}" aria-label="${esc(T("Name Person {n}", { n: id.slice(1) }))}">
        <div class="search">
          <input type="text" class="work-addr" id="wa-${id}" value="${esc(w.label || "")}" placeholder="${esc(T("Arbeitsort-Adresse"))}" autocomplete="off" aria-label="${esc(T("Arbeitsort Person {n}", { n: id.slice(1) }))}">
          <ul class="suggest" role="listbox" hidden></ul>
        </div>
        <button type="button" class="btn-x" data-clear="${id}" aria-label="${esc(T("Arbeitsort Person {n} entfernen", { n: id.slice(1) }))}" ${w.lat == null ? "hidden" : ""}>×</button>
        <p class="work-status hint">${w.lat != null && !w.station ? T("Kein Bahnhof gefunden: nur Autozeit.") : ""}</p>
      </div>`;
    }).join("");
  }
  async function setWork(id, place, statusEl) {
    const prev = state.settings.work[id] || {};
    const w = { name: prev.name || "", label: place.label, lat: place.lat, lon: place.lon, station: null };
    statusEl.textContent = T("Bahnhof beim Arbeitsort suchen …");
    try { w.station = await nearestStation(place.lat, place.lon); } catch (e) { w.station = null; }
    state.settings.work[id] = w;
    // alte Werte verwerfen, auch von Hand angepasste, da der Ort neu ist
    state.props.forEach((p) => { ["_zug", "_auto", "_km"].forEach((x) => { delete p.v["work_" + id + x]; delete p.edited["work_" + id + x]; }); });
    save(); renderPrio(); renderResults();
    const row = document.querySelector(`.work-row[data-work="${id}"]`);
    row.querySelector("[data-clear]").hidden = false;
    const st = row.querySelector(".work-status");
    await recomputeWorkForAll({ id, ...w }, st);
    if (!w.station) st.textContent += " " + T("Kein Bahnhof gefunden: nur Autozeit.");
  }
  $("#work-list").addEventListener("input", (ev) => {
    const t = ev.target, row = t.closest(".work-row");
    if (!row) return;
    const id = row.dataset.work;
    if (t.classList.contains("work-name")) {
      state.settings.work[id] = { ...(state.settings.work[id] || {}), name: t.value };
      save(); renderPrio(); renderResults();
      return;
    }
    if (!t.classList.contains("work-addr")) return;
    const list = row.querySelector(".suggest");
    clearTimeout(t._deb);
    const text = t.value.trim();
    if (text.length < 3) { list.hidden = true; return; }
    t._deb = setTimeout(async () => {
      try {
        const res = await searchLocations(text);
        t._res = res;
        list.innerHTML = res.map((s, i) => `<li role="option" data-i="${i}"><span>${esc(s.label)}</span><span class="kind">${s.origin === "gg25" ? T("Gemeinde") : T("Adresse")}</span></li>`).join("");
        list.hidden = !res.length;
      } catch (e) { list.hidden = true; }
    }, 250);
  });
  $("#work-list").addEventListener("mousedown", (ev) => {
    const li = ev.target.closest(".suggest li");
    if (!li) return;
    ev.preventDefault();
    const row = li.closest(".work-row"), input = row.querySelector(".work-addr");
    const place = input._res[Number(li.dataset.i)];
    input.value = place.label;
    li.parentElement.hidden = true;
    setWork(row.dataset.work, place, row.querySelector(".work-status"));
  });
  $("#work-list").addEventListener("keydown", (ev) => {
    const t = ev.target;
    if (!t.classList.contains("work-addr") || ev.key !== "Enter") return;
    ev.preventDefault();
    const row = t.closest(".work-row");
    if (t._res && t._res.length) {
      row.querySelector(".suggest").hidden = true;
      t.value = t._res[0].label;
      setWork(row.dataset.work, t._res[0], row.querySelector(".work-status"));
    }
  });
  $("#work-list").addEventListener("focusout", (ev) => {
    if (ev.target.classList.contains("work-addr")) {
      const list = ev.target.closest(".work-row").querySelector(".suggest");
      setTimeout(() => (list.hidden = true), 150);
    }
  });
  $("#work-list").addEventListener("click", (ev) => {
    const id = ev.target.dataset && ev.target.dataset.clear;
    if (!id) return;
    const name = (state.settings.work[id] || {}).name || "";
    state.settings.work[id] = { name };
    state.props.forEach((p) => { ["_zug", "_auto", "_km"].forEach((x) => { delete p.v["work_" + id + x]; delete p.edited["work_" + id + x]; }); });
    save(); renderWork(); renderPrio(); renderResults();
  });

  // ---------- Ereignisse: Suche ----------
  const q = $("#q"), sug = $("#suggest");
  let suggestions = [], chosen = null, active = -1, debounce;
  function showSuggest(list) {
    suggestions = list; active = -1;
    if (!list.length || document.activeElement !== q) { sug.hidden = true; return; } // nur zeigen, solange im Feld getippt wird
    sug.innerHTML = list.map((s, i) => `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="false"><span>${esc(s.label)}</span><span class="kind">${s.origin === "gg25" ? T("Gemeinde") : T("Adresse")}</span></li>`).join("");
    sug.hidden = false;
  }
  function pick(i) {
    chosen = suggestions[i]; q.value = chosen.label; sug.hidden = true;
  }
  q.addEventListener("input", () => {
    chosen = null;
    clearTimeout(debounce);
    const text = q.value.trim();
    if (text.length < 3) { sug.hidden = true; return; }
    debounce = setTimeout(async () => {
      try { showSuggest(await searchLocations(text)); } catch (e) { sug.hidden = true; }
    }, 250);
  });
  q.addEventListener("keydown", (ev) => {
    if (sug.hidden) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      active = (active + (ev.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
      [...sug.children].forEach((li, i) => li.setAttribute("aria-selected", i === active ? "true" : "false"));
      q.setAttribute("aria-activedescendant", "opt-" + active);
    } else if (ev.key === "Enter" && active >= 0) { ev.preventDefault(); pick(active); }
    else if (ev.key === "Escape") sug.hidden = true;
  });
  sug.addEventListener("mousedown", (ev) => {
    const li = ev.target.closest("li");
    if (li) { ev.preventDefault(); pick(Number(li.dataset.i)); }
  });
  q.addEventListener("blur", () => setTimeout(() => (sug.hidden = true), 150));

  const STEP_IDS = ["gemeinde", "osm", "oev", "auto"];
  function onStep(id, text, status) {
    const ol = $("#progress");
    ol.hidden = false;
    let li = ol.querySelector(`[data-step="${id}"]`);
    if (!li) { li = document.createElement("li"); li.dataset.step = id; ol.appendChild(li); }
    li.textContent = text + (status ? "" : " …");
    li.className = status || "";
  }

  $("#lookup-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = $("#form-error");
    err.hidden = true;
    $("#form-ok").hidden = true;
    clearTimeout(debounce); sug.hidden = true;
    const btn = $("#btn-lookup");
    let place = chosen;
    try {
      if (!place) {
        const text = q.value.trim();
        if (!text) { err.textContent = T("Bitte eine Adresse oder Gemeinde eingeben."); err.hidden = false; return; }
        const list = await searchLocations(text);
        if (!list.length) { err.textContent = T("Keine Adresse oder Gemeinde gefunden. Bitte Schreibweise prüfen, z.B. «Bahnhofstrasse 10, 8400 Winterthur»."); err.hidden = false; return; }
        place = list[0];
      }
    } catch (e) {
      err.textContent = T("Die Adresssuche (geo.admin.ch) ist nicht erreichbar. Bitte Internetverbindung prüfen und erneut versuchen.");
      err.hidden = false; return;
    }
    const pos = (n) => (n != null && n > 0 ? n : null);
    const facts = { kaufpreis: pos(moneyVal($("#kaufpreis"))), zimmer: pos(decimalVal($("#zimmer"))), flaeche: pos(decimalVal($("#flaeche"))) };

    btn.disabled = true; btn.textContent = T("Daten werden abgerufen …");
    $("#progress").innerHTML = "";
    try {
      const p = await buildProperty(place, facts, onStep);
      state.props.push(p);
      save(); renderResults();
      q.value = ""; $("#kaufpreis").value = ""; $("#zimmer").value = ""; $("#flaeche").value = ""; chosen = null;
      const ok = $("#form-ok");
      ok.textContent = T("«{name}» hinzugefügt. Fügen Sie weitere Objekte hinzu oder gehen Sie weiter zu Schritt 2.", { name: p.label });
      ok.hidden = false;
    } catch (e) {
      err.textContent = T("Beim Abrufen ist ein Fehler aufgetreten. Bitte erneut versuchen.");
      err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = T("Daten abrufen und hinzufügen");
    }
  });

  // Für Tests
  window.HomeScore = { piecewise, evaluate, state: () => state, STEP_IDS, T, lang: () => LANG };

  // Statische Texte der Seite (data-i18n) übersetzen und Sprachwahl
  function applyStatic() {
    document.documentElement.lang = LOCALES[LANG];
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = T(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = T(el.dataset.i18nPh); });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", T(el.dataset.i18nAria)); });
    document.querySelectorAll("[data-i18n-content]").forEach((el) => { el.setAttribute("content", T(el.dataset.i18nContent)); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === LANG)));
  }
  document.querySelector(".lang").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-lang]");
    if (!b || b.dataset.lang === LANG) return;
    LANG = b.dataset.lang;
    try { localStorage.setItem("homescore.lang", LANG); } catch (e) { /* ignorieren */ }
    applyStatic(); renderWork(); renderAll();
  });

  applyStatic();
  renderWork();
  renderAll();
  route_();
  $("#compare-back").addEventListener("click", () => {
    location.hash = "ergebnis";
  });
})();
