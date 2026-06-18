"use strict";

/* ===========================================================================
 * PokéScan — scan a Pokémon card, identify it, show real Cardmarket value.
 *
 * Data: pokemontcg.io (free, no key) — embeds Cardmarket (EUR) prices per card.
 * OCR:  Tesseract.js, fully on-device (the photo never leaves the phone).
 * =========================================================================== */

const API = "https://api.pokemontcg.io/v2/cards";

const el = (id) => document.getElementById(id);
const els = {
  camera: el("camera"),
  cameraStatus: el("camera-status"),
  captureBtn: el("capture-btn"),
  canvas: el("capture-canvas"),
  fileInput: el("file-input"),
  searchForm: el("search-form"),
  searchInput: el("search-input"),
  ocrPreview: el("ocr-preview"),
  ocrThumb: el("ocr-thumb"),
  ocrStatus: el("ocr-status"),
  scanView: el("scan-view"),
  resultsView: el("results-view"),
  resultsGrid: el("results-grid"),
  resultsStatus: el("results-status"),
  detailView: el("detail-view"),
  detail: el("detail"),
};

/* ---------------------------------------------------------------------------
 * View switching
 * ------------------------------------------------------------------------- */
function showView(name) {
  for (const v of [els.scanView, els.resultsView, els.detailView]) v.hidden = true;
  ({ scan: els.scanView, results: els.resultsView, detail: els.detailView })[name].hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-back]").forEach((b) =>
  b.addEventListener("click", () => showView("scan"))
);
document.querySelectorAll("[data-back-results]").forEach((b) =>
  b.addEventListener("click", () => showView("results"))
);

/* ---------------------------------------------------------------------------
 * Camera
 * ------------------------------------------------------------------------- */
let stream = null;

async function initCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    els.cameraStatus.textContent = "Live camera unavailable here — use “Upload / take photo”.";
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    els.camera.srcObject = stream;
    els.captureBtn.disabled = false;
    els.cameraStatus.textContent = "";
  } catch (err) {
    // Permission denied, no camera, or insecure context (http on phone).
    els.cameraStatus.textContent =
      "Camera blocked or needs HTTPS. Use “Upload / take photo” instead.";
  }
}

els.captureBtn.addEventListener("click", () => {
  const v = els.camera;
  if (!v.videoWidth) return;
  const c = els.canvas;
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  c.toBlob((blob) => blob && handleImageBlob(blob), "image/jpeg", 0.92);
});

els.fileInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) handleImageBlob(file);
});

/* ---------------------------------------------------------------------------
 * OCR pipeline
 * ------------------------------------------------------------------------- */
async function handleImageBlob(blob) {
  const url = URL.createObjectURL(blob);
  els.ocrThumb.src = url;
  els.ocrPreview.hidden = false;
  setOcrStatus(true, "Reading the card…");

  try {
    // Downscale first — full-res phone photos are slow and can crash mobile OCR.
    const canvas = await loadScaled(blob, 1100);
    const { data } = await Tesseract.recognize(canvas, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text")
          setOcrStatus(true, `Reading the card… ${Math.round(m.progress * 100)}%`);
      },
    });
    const guess = parseCardText(data.text || "");
    if (!guess.tokens.length && !guess.number) {
      setOcrStatus(false, "Couldn’t read it. Type the name in the box and search.");
      return;
    }
    setOcrStatus(false, `Read: ${guess.tokens.slice(0, 5).join(", ") || "—"}`);
    els.searchInput.value = [guess.tokens[0], guess.numberRaw].filter(Boolean).join(" ").trim();
    await runSearch(guess);
  } catch (err) {
    setOcrStatus(false, "OCR failed. Type the name in the box and search.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setOcrStatus(busy, msg) {
  els.ocrStatus.innerHTML = (busy ? '<span class="spinner"></span>' : "") + msg;
}

/** Load an image blob into a downscaled canvas (longest side <= maxDim). */
function loadScaled(blob, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const u = URL.createObjectURL(blob);
    img.onload = () => {
      const s = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      resolve(c);
    };
    img.onerror = (e) => { URL.revokeObjectURL(u); reject(e); };
    img.src = u;
  });
}

// Words that are never the card name — game text, energy types, common English.
const STOP = new Set(
  ("hp stage basic evolves from energy weakness resistance retreat trainer illus " +
   "attack power damage put when may each all the and this your put discard draw " +
   "fire water grass lightning psychic fighting darkness metal fairy dragon colorless " +
   "pokemon length weight none turn during card cards into onto with for you").split(" ")
);

/**
 * Extract candidate name tokens + collector number from raw OCR text.
 * Returns several tokens (the name is usually among the first); the search
 * tries each until one yields matches, so a single misread word isn't fatal.
 */
function parseCardText(text) {
  let number = "", total = "", numberRaw = "";
  const m = text.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  if (m) {
    number = String(parseInt(m[1], 10));
    total = String(parseInt(m[2], 10));
    numberRaw = `${m[1]}/${m[2]}`;
  }

  const tokens = [];
  const seen = new Set();
  for (const w of text.replace(/[^A-Za-z'\-\s]/g, " ").split(/\s+/)) {
    const word = w.replace(/^[-']+|[-']+$/g, "");
    const lw = word.toLowerCase();
    if (word.length < 3 || word.length > 15) continue;
    if (!/^[A-Za-z]/.test(word) || STOP.has(lw) || seen.has(lw)) continue;
    seen.add(lw);
    tokens.push(word);
  }

  return { tokens, name: "", number, total, numberRaw, source: "ocr" };
}

/* ---------------------------------------------------------------------------
 * Search / identify
 * ------------------------------------------------------------------------- */
function handleTypedSearch(e) {
  e.preventDefault();
  const raw = (e.target.querySelector("input").value || "").trim();
  if (!raw) return;
  els.ocrPreview.hidden = true;
  runSearch(parseTypedQuery(raw));
}
els.searchForm.addEventListener("submit", handleTypedSearch);
document.getElementById("results-search-form").addEventListener("submit", handleTypedSearch);

/** Parse a free-text query like `Charizard 4/102` into the same shape as OCR. */
function parseTypedQuery(raw) {
  let number = "", total = "", numberRaw = "";
  const m = raw.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  if (m) {
    number = String(parseInt(m[1], 10));
    total = String(parseInt(m[2], 10));
    numberRaw = `${m[1]}/${m[2]}`;
  }
  const name = raw.replace(/(\d{1,3})\s*\/\s*(\d{1,3})/, "").replace(/#/g, "").trim();
  const tokens = name.split(/\s+/).filter(Boolean);
  return { tokens, name, number, total, numberRaw, source: "typed" };
}

/**
 * Build an ordered list of queries to try. The number is only used as an
 * optional precise first attempt — never as a hard filter that could zero out
 * results when OCR misreads it. First query that returns cards wins.
 */
function buildAttempts({ tokens, name, number, source }) {
  const attempts = [];
  const add = (q) => { if (q && !attempts.includes(q)) attempts.push(q); };
  const primary = tokens.slice(0, 6);
  const orClause = primary.length ? `(${primary.map((t) => `name:${t}*`).join(" OR ")})` : "";

  // Precise first: any token AND the collector number (tightly constrained).
  if (number && orClause) add(`${orClause} number:${number}`);
  // Typed multi-word names: trust the exact phrase.
  if (source === "typed" && tokens.length > 1) add(`name:"${name}"`);
  // Broad fallbacks: each token alone, in reading order — first hit wins.
  for (const t of primary) add(`name:${t}*`);
  return attempts;
}

async function fetchCards(q) {
  const url = `${API}?q=${encodeURIComponent(q)}&pageSize=30&orderBy=-set.releaseDate`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

async function runSearch(guess) {
  showView("results");
  els.resultsGrid.innerHTML = "";
  els.resultsStatus.innerHTML = '<span class="spinner"></span>Searching the card database…';
  document.getElementById("results-search-input").value =
    [guess.tokens[0], guess.numberRaw].filter(Boolean).join(" ").trim();

  const attempts = buildAttempts(guess);
  if (!attempts.length) {
    els.resultsStatus.textContent = "Nothing to search for — type a card name above.";
    return;
  }

  try {
    // Merge two streams so neither hides the other:
    //  - precise (name + number) surfaces exact/old cards the broad query misses
    //  - broad (token alone) guarantees the species list always shows
    const precise = attempts.filter((q) => q.includes("number:"));
    const broad = attempts.filter((q) => !q.includes("number:"));

    const cards = [];
    const seen = new Set();
    const collect = (arr) => {
      for (const c of arr) if (!seen.has(c.id)) { seen.add(c.id); cards.push(c); }
    };
    const firstHit = async (queries) => {
      for (const q of queries) {
        const d = await fetchCards(q);
        if (d.length) return d;
      }
      return [];
    };

    collect(await firstHit(precise));
    collect(await firstHit(broad));

    if (!cards.length) {
      const read = guess.tokens.slice(0, 6).join(", ") || "(nothing readable)";
      els.resultsStatus.innerHTML =
        `No matches. I read: <em>${escapeHtml(read)}</em>. Fix the name in the box above and tap Go.`;
      return;
    }

    // Rank by collector number / set total so the likeliest card floats to top.
    const num = guess.number ? parseInt(guess.number, 10) : null;
    const tot = guess.total ? parseInt(guess.total, 10) : null;
    cards.sort((a, b) => matchScore(b, num, tot) - matchScore(a, num, tot));

    renderResults(cards, guess);
  } catch (err) {
    els.resultsStatus.textContent = "Search failed — check your connection and try again.";
  }
}

function matchScore(card, num, tot) {
  const s = card.set || {};
  let score = 0;
  if (tot && (s.printedTotal === tot || s.total === tot)) score += 2;
  if (num && String(card.number) === String(num)) score += 1;
  return score;
}

function renderResults(cards, guess) {
  const read = guess.tokens.slice(0, 5).join(", ");
  els.resultsStatus.innerHTML =
    `${cards.length} possible match${cards.length > 1 ? "es" : ""}` +
    (read ? ` (read: <em>${escapeHtml(read)}</em>)` : "") + ". Tap the right one.";

  const num = guess.number ? parseInt(guess.number, 10) : null;
  const tot = guess.total ? parseInt(guess.total, 10) : null;
  els.resultsGrid.innerHTML = "";

  for (const card of cards) {
    const cm = card.cardmarket && card.cardmarket.prices;
    const price = cm ? cm.trendPrice || cm.averageSellPrice : null;
    const isMatch = matchScore(card, num, tot) >= 2;

    const div = document.createElement("div");
    div.className = "result-card";
    div.innerHTML = `
      <img src="${card.images.small}" alt="${escapeHtml(card.name)}" loading="lazy" />
      <div class="rc-name">${escapeHtml(card.name)}</div>
      <div class="rc-set">${escapeHtml(card.set.name)} · #${card.number}/${card.set.printedTotal}</div>
      ${price ? `<div class="rc-price">~€${price.toFixed(2)}</div>` : `<div class="rc-set">no Cardmarket price</div>`}
      ${isMatch ? `<span class="badge-match">set match</span>` : ""}
    `;
    div.addEventListener("click", () => showDetail(card));
    els.resultsGrid.appendChild(div);
  }
}

/* ---------------------------------------------------------------------------
 * Detail + pricing
 * ------------------------------------------------------------------------- */

/**
 * Condition tiers mapped to the *real* Cardmarket anchor each one fits.
 * We never invent multipliers — each tier points at a genuine published figure.
 */
function conditionTiers(p) {
  const tiers = [];
  if (p.trendPrice) tiers.push({ key: "nm", label: "Near Mint / Mint", value: p.trendPrice, basis: "Current market trend price (well-kept copies)." });
  if (p.lowPriceExPlus) tiers.push({ key: "explus", label: "Excellent / Good (EX+)", value: p.lowPriceExPlus, basis: "Cardmarket’s lowest price for Excellent-or-better copies." });
  if (p.averageSellPrice) tiers.push({ key: "avg", label: "Mixed / typical sale", value: p.averageSellPrice, basis: "Average of all recent sales, conditions blended." });
  if (p.lowPrice) tiers.push({ key: "low", label: "Played / Damaged (floor)", value: p.lowPrice, basis: "Absolute lowest listing — usually heavily played copies." });
  return tiers;
}

function showDetail(card) {
  showView("detail");
  const cm = card.cardmarket && card.cardmarket.prices;
  const setLine = `${card.set.name} · ${card.set.series} · ${card.set.releaseDate}`;
  const cmUrl = `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}`;

  if (!cm || !Object.values(cm).some((v) => v > 0)) {
    els.detail.innerHTML = `
      ${heroHtml(card, setLine)}
      <div class="price-block">
        <p class="status muted">No Cardmarket price data is available for this card yet.</p>
        <a class="cm-link" href="${cmUrl}" target="_blank" rel="noopener">Check it on Cardmarket →</a>
      </div>`;
    return;
  }

  const tiers = conditionTiers(cm);
  const headline = tiers[0];

  const options = tiers
    .map((t, i) => `<option value="${i}">${t.label} — €${t.value.toFixed(2)}</option>`)
    .join("");

  const rows = [
    ["Trend price", cm.trendPrice, "market trend, good copies"],
    ["Low (EX+)", cm.lowPriceExPlus, "cheapest Excellent+ copy"],
    ["Average sell", cm.averageSellPrice, "all conditions blended"],
    ["Absolute low", cm.lowPrice, "cheapest of any condition"],
    ["7-day avg", cm.avg7, "last week"],
    ["30-day avg", cm.avg30, "last month"],
  ]
    .filter(([, v]) => v > 0)
    .map(
      ([label, v, hint]) =>
        `<tr><td>${label}<span class="hint">${hint}</span></td><td class="num">€${v.toFixed(2)}</td></tr>`
    )
    .join("");

  els.detail.innerHTML = `
    ${heroHtml(card, setLine)}
    <div class="price-block">
      <div class="price-headline">
        <div class="label" id="hl-label">${headline.label}</div>
        <div class="value" id="hl-value">€${headline.value.toFixed(2)}</div>
      </div>

      <div class="condition-picker">
        <label for="cond-select">What condition is YOUR card?</label>
        <select id="cond-select">${options}</select>
        <p class="condition-note" id="cond-note">${headline.basis}</p>
      </div>

      <table class="price-table">
        <thead><tr><th>Cardmarket figure</th><th class="num">EUR</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <a class="cm-link" href="${cmUrl}" target="_blank" rel="noopener">Open live listings on Cardmarket →</a>
    </div>
    <p class="disclaimer">
      Values are real Cardmarket figures (EUR) via pokemontcg.io, updated ${card.cardmarket.updatedAt}.
      This is an estimate to guide you — it is <strong>not</strong> a professional grade (PSA/BGS/CGC).
      Condition shown is the tier <em>you</em> select.
    </p>`;

  const select = el("cond-select");
  select.addEventListener("change", () => {
    const t = tiers[parseInt(select.value, 10)];
    el("hl-label").textContent = t.label;
    el("hl-value").textContent = `€${t.value.toFixed(2)}`;
    el("cond-note").textContent = t.basis;
  });
}

function heroHtml(card, setLine) {
  return `
    <div class="detail-hero">
      <img src="${card.images.large || card.images.small}" alt="${escapeHtml(card.name)}" />
      <div class="detail-meta">
        <h2>${escapeHtml(card.name)}</h2>
        <p class="sub">${escapeHtml(setLine)}</p>
        <p class="sub">#${card.number}/${card.set.printedTotal}</p>
        ${card.rarity ? `<span class="rarity-tag">${escapeHtml(card.rarity)}</span>` : ""}
      </div>
    </div>`;
}

/* ---------------------------------------------------------------------------
 * Utils + boot
 * ------------------------------------------------------------------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

initCamera();
