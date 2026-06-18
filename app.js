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
    const { data } = await Tesseract.recognize(blob, "eng");
    const guess = parseCardText(data.text || "");
    if (!guess.name && !guess.number) {
      setOcrStatus(false, "Couldn’t read it clearly. Type the name below and search.");
      return;
    }
    const human = [guess.name, guess.number && `#${guess.number}`].filter(Boolean).join(" ");
    setOcrStatus(false, `Read: “${human}” — searching…`);
    els.searchInput.value = [guess.name, guess.numberRaw].filter(Boolean).join(" ").trim();
    await runSearch(guess);
  } catch (err) {
    setOcrStatus(false, "OCR failed. Type the name below and search.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setOcrStatus(busy, msg) {
  els.ocrStatus.innerHTML = (busy ? '<span class="spinner"></span>' : "") + msg;
}

/**
 * Pull a likely card name and collector number out of raw OCR text.
 * Pokémon names sit at the top in large type; the collector number ("4/102")
 * sits small at the bottom. We grab both heuristically.
 */
function parseCardText(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Collector number like 4/102, 058/165, sometimes with surrounding noise.
  let number = "", total = "", numberRaw = "";
  for (const line of lines) {
    const m = line.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
    if (m) {
      number = String(parseInt(m[1], 10));
      total = String(parseInt(m[2], 10));
      numberRaw = `${m[1]}/${m[2]}`;
      break;
    }
  }

  // Name: first line that is mostly letters, 3–20 chars, not obvious game text.
  const STOP = /(HP|Stage|Basic|Evolves|Energy|Weakness|Resistance|Retreat|Trainer|Illus|Attack|Pokémon Power|©|Damage)/i;
  let name = "";
  for (const line of lines) {
    const cleaned = line.replace(/[^A-Za-z'.\- ]/g, "").trim();
    const letters = cleaned.replace(/[^A-Za-z]/g, "");
    if (
      cleaned.length >= 3 &&
      cleaned.length <= 20 &&
      letters.length >= 3 &&
      !STOP.test(line) &&
      letters.length / cleaned.length > 0.6
    ) {
      name = cleaned;
      break;
    }
  }

  return { name, number, total, numberRaw };
}

/* ---------------------------------------------------------------------------
 * Search / identify
 * ------------------------------------------------------------------------- */
els.searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = els.searchInput.value.trim();
  if (!raw) return;
  els.ocrPreview.hidden = true;
  runSearch(parseTypedQuery(raw));
});

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
  return { name, number, total, numberRaw };
}

function buildQuery({ name, number }) {
  const parts = [];
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length === 1) parts.push(`name:${words[0]}*`);
    else parts.push(`name:"${name}"`);
  }
  if (number) parts.push(`number:${number}`);
  return parts.join(" ");
}

async function runSearch(guess) {
  showView("results");
  els.resultsGrid.innerHTML = "";
  els.resultsStatus.innerHTML = '<span class="spinner"></span>Searching the card database…';

  const q = buildQuery(guess);
  if (!q) {
    els.resultsStatus.textContent = "Nothing to search for — try a card name.";
    return;
  }

  try {
    const url = `${API}?q=${encodeURIComponent(q)}&pageSize=20&orderBy=-set.releaseDate`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    let cards = json.data || [];

    // If a collector total ("/102") was read, surface exact-set matches first.
    if (guess.total) {
      const t = parseInt(guess.total, 10);
      cards.sort((a, b) => setMatches(b, t) - setMatches(a, t));
    }

    renderResults(cards, guess);
  } catch (err) {
    els.resultsStatus.textContent = "Search failed — check your connection and try again.";
  }
}

function setMatches(card, total) {
  const s = card.set || {};
  return s.printedTotal === total || s.total === total ? 1 : 0;
}

function renderResults(cards, guess) {
  if (!cards.length) {
    els.resultsStatus.innerHTML =
      "No matches. Try just the Pokémon’s name, or check the spelling.";
    return;
  }
  els.resultsStatus.textContent = `${cards.length} possible match${cards.length > 1 ? "es" : ""}.`;

  const totalNum = guess.total ? parseInt(guess.total, 10) : null;
  els.resultsGrid.innerHTML = "";

  for (const card of cards) {
    const cm = card.cardmarket && card.cardmarket.prices;
    const price = cm ? cm.trendPrice || cm.averageSellPrice : null;
    const isMatch = totalNum && setMatches(card, totalNum);

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
