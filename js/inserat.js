/* HomeScore – Angaben aus einem Immobilieninserat lesen
 * Eingabe: der Text, den der Käufer von der Inseratsseite kopiert (Ctrl+A, Ctrl+C).
 * Die Seite selbst wird nicht abgerufen (Browser-Sperre CORS, Bot-Schutz, Nutzungsbedingungen der Portale).
 * Erkennt Bezeichnungen auf Deutsch, Französisch, Italienisch und Englisch.
 */
(function () {
  "use strict";

  const SEP = "[’'`´. \\u00a0\\u202f]";
  const MONEY_RE = new RegExp("\\d{1,3}(?:" + SEP + "\\d{3})+|\\d{4,9}");
  const NO_PRICE = /auf anfrage|sur demande|su richiesta|on request|price on application|preis nach vereinbarung/i;
  // Zeilen mit diesen Wörtern sind keine Kaufpreise
  const NOT_PRICE_LINE = /nebenkosten|monat|mois|mese|month|miete|loyer|affitto|rent\b|einstellplatz|parkplatz|garage|carport|place de parc|posto auto|parking|pro m|par m|al m|per m|\/\s*m|hypothek|hypoth|eigenkapital|anzahlung|tragbarkeit|einkommen|fonds propres|reservation|reservierung/i;

  const LABELS = {
    preis: "kaufpreis|verkaufspreis|richtpreis|preis|prix de vente|prix|prezzo di vendita|prezzo|purchase price|selling price|sale price|price",
    zimmer: "anzahl zimmer|zimmer|zimmerzahl|nombre de pièces|pièces|nombre de pieces|pieces|locali|numero di locali|vani|number of rooms|rooms",
    flaeche: "wohnfläche(?: ca\\.?)?|nettowohnfläche|surface habitable|surface habitable nette|superficie abitabile|superficie utile abitabile|living space|living area|floor space",
    nutz: "nutzfläche|surface utile|superficie utile|usable area|usable space",
    grund: "grundstücksfläche|grundstück|parzellenfläche|landfläche|surface du terrain|surface terrain|superficie del terreno|superficie fondo|land area|plot area|plot size",
    baujahr: "baujahr|erbaut|année de construction|annee de construction|anno di costruzione|year built|year of construction",
    renoviert: "renovierungsjahr|letzte renovation|letzte renovierung|renoviert|année de rénovation|annee de renovation|dernière rénovation|anno di ristrutturazione|ultima ristrutturazione|year renovated|last renovation",
    geschoss: "geschoss|stockwerk|etage|étage|piano|floor",
    objektart: "objektart|objekttyp|immobilientyp|art des objekts|type d'objet|type de bien|type de propriété|tipo di oggetto|tipo d'immobile|tipologia|property type|object type|type",
    nebenkosten: "nebenkosten|charges|spese accessorie|spese condominiali|additional costs|service charges",
  };

  // Bezeichnung mit Grossbuchstaben, direkt gefolgt von ":" – davor wird getrennt. Gross-/Kleinschreibung zählt,
  // damit "Kaufpreis:" nicht in "Kauf" + "preis:" zerfällt.
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const GLUED_LABELS = Object.values(LABELS).join("|").split("|")
    .concat(["verfügbarkeit", "anzahl etagen", "anzahl wohnungen", "kubatur", "bezugstermin", "disponibilité", "disponibilità"])
    .flatMap((x) => [cap(x), x.split(" ").map(cap).join(" ")])
    .filter((x, i, arr) => arr.indexOf(x) === i).sort((a, b) => b.length - a.length).join("|");
  const GLUED = new RegExp("(\\S)(?=(?:" + GLUED_LABELS + ")\\s*[:：])", "g");

  const PORTALS = [
    [/homegate\./i, "Homegate"], [/immoscout24\./i, "ImmoScout24"], [/comparis\./i, "Comparis"],
    [/newhome\./i, "Newhome"], [/immobilier\.ch/i, "immobilier.ch"], [/flatfox\./i, "Flatfox"],
    [/anibis\./i, "anibis"], [/tutti\./i, "tutti.ch"], [/remax\./i, "RE/MAX"], [/engelvoelkers\./i, "Engel & Völkers"],
  ];

  function portalOf(url) {
    for (const [re, name] of PORTALS) if (re.test(url || "")) return name;
    try { return url ? new URL(url).hostname.replace(/^www\./, "") : null; } catch (e) { return null; }
  }

  function moneyFrom(s) {
    if (!s) return null;
    const t = String(s).replace(/[.,][-–—]+/g, "").replace(/(\d)[.,]\d{2}(?!\d)/g, "$1");
    const m = t.match(MONEY_RE);
    if (!m) return null;
    const n = Number(m[0].replace(/\D/g, ""));
    return n >= 50000 && n <= 100000000 ? n : null;
  }
  function roomsFrom(s) {
    const m = String(s || "").match(/(\d{1,2})(?:\s*½|[.,](\d))?/);
    if (!m) return null;
    const n = Number(m[1]) + (/½/.test(m[0]) ? 0.5 : m[2] ? Number(m[2]) / 10 : 0);
    return n >= 1 && n <= 30 ? n : null;
  }
  function areaFrom(s) {
    const m = String(s || "").match(/(\d{1,3}(?:['’]\d{3})?|\d{2,5})(?:[.,](\d+))?\s*(?:m²|m2|qm|m\^2)/i);
    if (!m) return null;
    const n = Number(m[1].replace(/\D/g, "") + (m[2] ? "." + m[2] : ""));
    return n >= 10 && n <= 100000 ? Math.round(n) : null;
  }
  function yearFrom(s) {
    const m = String(s || "").match(/\b(1[5-9]\d\d|20\d\d)\b/);
    return m ? Number(m[1]) : null;
  }
  function shortText(s) {
    const t = String(s || "").trim();
    return t && t.length <= 40 && !/^\d+$/.test(t) ? t : null;
  }

  function parseListing(text, url) {
    const raw = String(text || "").replace(/\r/g, "");
    let lines = raw.split("\n").map((l) => l.replace(/[  \t]+/g, " ").replace(/\s{2,}/g, " ").trim()).filter(Boolean);
    // Zusammengeklebte Angaben trennen, z.B. "VereinbarungObjekttyp:Einfamilienhaus…Wohnfläche:132 m2Grundstücksfläche:…"
    lines = lines.flatMap((l) => l.replace(GLUED, "$1\n").split("\n")).map((l) => l.trim()).filter(Boolean);
    // Zahl und Einheit auf zwei Zeilen ("132" / "m2") wieder zusammenfügen
    for (let i = lines.length - 2; i >= 0; i--) {
      if (/^\d[\d'’.,]*$/.test(lines[i]) && /^(m2|m²|qm|m\s?2)$/i.test(lines[i + 1])) lines.splice(i, 2, lines[i] + " m²");
    }
    const out = { portal: portalOf(url), address: null, kaufpreis: null, zimmer: null, flaeche: null, extras: {}, zusatz: [], preisAufAnfrage: false, onlyUrl: false };

    if (/^https?:\/\/\S+$/i.test(raw.trim())) { out.onlyUrl = true; out.portal = out.portal || portalOf(raw.trim()); return out; }
    if (!lines.length) return out;

    // Wert nach einer Bezeichnung: gleiche Zeile ("Zimmer: 4.5" / "Zimmer 4.5") oder die nächste(n) Zeile(n)
    function after(key, read, maxAhead = 2) {
      const re = new RegExp("^(?:" + LABELS[key] + ")\\b\\s*[:：]?\\s*(.*)$", "i");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(re);
        if (!m) continue;
        const cands = [m[1]];
        for (let k = 1; k <= maxAhead; k++) if (lines[i + k]) cands.push(lines[i + k]);
        for (const c of cands) {
          if (!c) continue;
          const v = read(c, i);
          if (v != null) return v;
        }
      }
      return null;
    }

    // Kaufpreis
    out.kaufpreis = after("preis", (c) => {
      if (NO_PRICE.test(c)) { out.preisAufAnfrage = true; return null; }
      if (NOT_PRICE_LINE.test(c)) return null;
      return moneyFrom(c);
    });
    if (out.kaufpreis == null) {
      for (const l of lines) {
        if (!/CHF|Fr\.|SFr/i.test(l) || NOT_PRICE_LINE.test(l)) continue;
        const n = moneyFrom(l);
        if (n != null) { out.kaufpreis = n; break; }
      }
    }
    if (out.kaufpreis != null) out.preisAufAnfrage = false;

    // Zimmer
    out.zimmer = after("zimmer", (c) => (/^\s*\d/.test(c) && !/m²|m2|chf/i.test(c) ? roomsFrom(c) : null), 1);
    if (out.zimmer == null) {
      const m = raw.match(/(\d{1,2}(?:[.,]\d)?|\d{1,2}\s*½)\s*-?\s*(?:zimmer|zi\.|pièces|pieces|pcs\.?|locali|loc\.|rooms?)\b/i);
      if (m) out.zimmer = roomsFrom(m[1]);
    }

    // Wohnfläche
    out.flaeche = after("flaeche", (c) => areaFrom(c));
    if (out.flaeche == null) {
      const m = raw.match(/(\d{2,4})\s*(?:m²|m2)\s*(?:wohnfläche|surface habitable|superficie abitabile|living)/i);
      if (m) out.flaeche = Number(m[1]);
    }
    if (out.flaeche == null) {
      // Titelzeile wie "4.5 Zimmer, 97 m², 2. Stock"
      const l = lines.find((x) => /(zimmer|pièces|pieces|locali|rooms)/i.test(x) && /m²|m2/i.test(x) && x.length < 120);
      if (l) { const n = areaFrom(l); if (n && n < 2000) { out.flaeche = n; out.flaecheAusTitel = true; } }
    }

    // Weitere Angaben (nur zur Information)
    const ex = out.extras;
    ex.objektart = after("objektart", (c) => shortText(c), 1);
    ex.baujahr = after("baujahr", (c) => yearFrom(c), 1);
    ex.renoviert = after("renoviert", (c) => yearFrom(c), 1);
    ex.geschoss = after("geschoss", (c) => (shortText(c) && /\d|erdgeschoss|parterre|eg\b|ug\b|dach|attika|rez|pian|ground/i.test(c) ? shortText(c) : null), 1);
    ex.nutzflaeche = after("nutz", (c) => areaFrom(c), 1);
    ex.grundstueck = after("grund", (c) => areaFrom(c), 1);
    ex.nebenkosten = after("nebenkosten", (c) => { const m = c.match(/\d[\d’'. ]*/); const n = m ? Number(m[0].replace(/\D/g, "")) : null; return n && n < 10000 ? n : null; }, 1);
    Object.keys(ex).forEach((k) => ex[k] == null && delete ex[k]);

    // Zusatzkosten im Text (z.B. Einstellplatz separat)
    const PARK = "autoeinstellplatz|einstellplatz|tiefgaragenplatz|tiefgarage|garagenplatz|doppelgarage|garage|aussenparkplatz|parkplatz|carport|place de parc|place de stationnement|posto auto|autorimessa|parking space|parking";
    const reA = new RegExp("(" + PARK + ")[^\\n]{0,80}?(?:CHF|Fr\\.|SFr\\.?)\\s*(\\d[\\d’'`´.]*\\d)", "ig");
    const reB = new RegExp("(?:CHF|Fr\\.|SFr\\.?)\\s*(\\d[\\d’'`´.]*\\d)[^\\n]{0,40}?(" + PARK + ")", "ig");
    const seen = new Set();
    const addZ = (what, num) => {
      const n = Number(String(num).replace(/[.,]-+$/, "").replace(/\D/g, ""));
      if (!n || n < 1000 || n > 500000) return; // Monatsmieten für Parkplätze und Kaufpreise ausschliessen
      const k = what.toLowerCase() + n;
      if (seen.has(k) || out.zusatz.length >= 3) return;
      seen.add(k);
      out.zusatz.push({ was: what.charAt(0).toUpperCase() + what.slice(1).toLowerCase(), chf: n });
    };
    let m;
    while ((m = reA.exec(raw))) addZ(m[1], m[2]);
    while ((m = reB.exec(raw))) addZ(m[2], m[1]);

    out.address = findAddress(lines, raw);
    return out;
  }

  // Adresse: "Strasse Nr" + "PLZ Ort", in einer Zeile oder in zwei Zeilen nebeneinander.
  // Adressen von Makler, Anbieter oder Kontakt werden übergangen.
  const L = "A-Za-zÀ-ÖØ-öø-ÿ";
  const PLZ_LINE = new RegExp("^(?:CH-)?([1-9]\\d{3})\\s+([" + L + "][" + L + " .'’\\-/()]{1,40}?)(?:\\s*,\\s*[A-Z]{2})?$");
  const STREET = new RegExp("^([" + L + "][" + L + "0-9 .'’\\-]{1,50}?\\s\\d{1,4}(?:\\s?[a-zA-Z])?(?:\\s?[-/]\\s?\\d{1,4}[a-zA-Z]?)?)$");
  const INLINE = new RegExp("([" + L + "][" + L + " .'’\\-]{1,50}?\\s\\d{1,4}(?:\\s?[a-zA-Z])?(?:[-/]\\d{1,4}[a-zA-Z]?)?)\\s*,\\s*(?:CH-)?([1-9]\\d{3})\\s+([" + L + "][" + L + " .'’\\-]{1,40}?)(?=\\s*(?:,|$|\\n|\\s{2}|\\())", "m");
  const AGENCY = /kontakt|anbieter|inserent|makler|verwaltung|immobilien ag|immobilien gmbh|agence|contact|annonceur|agenzia|contatto|inserzionista|telefon|tel\.|phone|e-mail|www\.|@/i;
  const NOT_STREET = /^(balkon|zimmer|geschoss|stock|etage|online|lift|baujahr|badezimmer|bad|wc|keller|garage|parkplatz|einstellplatz|seite|page|foto|bild|terrasse)\b/i;

  function nearAgency(lines, i) {
    for (let k = Math.max(0, i - 3); k <= Math.min(lines.length - 1, i + 3); k++) if (AGENCY.test(lines[k])) return true;
    return false;
  }

  function findAddress(lines, raw) {
    const cands = [];
    lines.forEach((l, i) => {
      const im = l.match(INLINE);
      if (im && !NOT_STREET.test(im[1])) { cands.push({ i, street: im[1].trim(), plz: im[2], ort: im[3].trim() }); return; }
      const pm = l.match(PLZ_LINE);
      if (!pm) return;
      const plz = pm[1], ort = pm[2].trim();
      let street = null;
      for (const j of [i - 1, i + 1]) {
        const s = lines[j];
        if (s && STREET.test(s) && !NOT_STREET.test(s) && !/chf|m²|m2|zimmer/i.test(s)) { street = s; break; }
      }
      cands.push({ i, street, plz, ort });
    });
    if (!cands.length) return null;
    const clean = cands.filter((c) => !nearAgency(lines, c.i));
    const pickFrom = clean.length ? clean : cands;
    const best = pickFrom.find((c) => c.street) || pickFrom[0];
    return {
      street: best.street, plz: best.plz, ort: best.ort,
      text: (best.street ? best.street + ", " : "") + best.plz + " " + best.ort,
      unsicher: !clean.length,
    };
  }

  window.HS_parseListing = parseListing;
  window.HS_portalOf = portalOf;
})();
