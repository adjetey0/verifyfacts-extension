// popup.js — VerifyFacts popup controller

// ── State ─────────────────────────────────────────────────────────────────────
let currentPayload = null;
let lastResult = null;
let highlightsActive = false;
let sections = {};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.classList.toggle("light", theme === "light");
  const moon = $("themeIconMoon");
  const sun  = $("themeIconSun");
  if (moon) moon.classList.toggle("hidden", theme === "light");
  if (sun)  sun.classList.toggle("hidden",  theme !== "light");
  const darkBtn  = $("darkBtn");
  const lightBtn = $("lightBtn");
  if (darkBtn)  darkBtn.classList.toggle("active",  theme !== "light");
  if (lightBtn) lightBtn.classList.toggle("active", theme === "light");
}

async function loadTheme() {
  const { theme } = await chrome.storage.local.get(["theme"]);
  applyTheme(theme || "dark");
}

function saveTheme(theme) {
  chrome.storage.local.set({ theme });
  applyTheme(theme);
  showToast(theme === "light" ? "Light mode ☀️" : "Dark mode 🌙");
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Build sections AFTER DOM is ready
  sections = {
    settings: $("settingsPanel"),
    noKey:    $("noKeyNotice"),
    idle:     $("idleState"),
    loading:  $("loadingState"),
    result:   $("resultState"),
    error:    $("errorState")
  };

  await loadTheme();

  const apiKey = await getApiKey();
  if (!apiKey) {
    show("noKey");
  } else {
    show("idle");
    loadStoredApiKey();
  }

  bindEvents();
});

// ── Event bindings ────────────────────────────────────────────────────────────
function bindEvents() {
  // Theme toggle button in header
  const themeToggle = $("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const isLight = document.body.classList.contains("light");
      saveTheme(isLight ? "dark" : "light");
    });
  }

  // Theme pill buttons inside settings
  const darkBtn  = $("darkBtn");
  const lightBtn = $("lightBtn");
  if (darkBtn)  darkBtn.addEventListener("click",  () => saveTheme("dark"));
  if (lightBtn) lightBtn.addEventListener("click", () => saveTheme("light"));

  // Settings toggle
  $("settingsToggle").addEventListener("click", () => {
    sections.settings.classList.toggle("hidden");
    loadStoredApiKey();
  });

  // Save API key
  $("saveKey").addEventListener("click", async () => {
    const key = $("apiKeyInput").value.trim();
    if (!key) return;
    await chrome.runtime.sendMessage({ action: "saveApiKey", key });
    sections.settings.classList.add("hidden");
    sections.noKey.classList.add("hidden");
    show("idle");
    showToast("API key saved ✓");
  });

  // Go to settings from no-key notice
  $("goToSettings").addEventListener("click", () => {
    sections.noKey.classList.add("hidden");
    sections.settings.classList.remove("hidden");
    loadStoredApiKey();
  });

  // Mode buttons
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => handleMode(btn.dataset.mode));
  });

  // URL verify
  $("verifyUrl").addEventListener("click", () => {
    const url = $("urlInput").value.trim();
    if (!url) return;
    analyze({ url, contentType: "news" });
  });

  $("urlInput").addEventListener("keydown", e => {
    if (e.key === "Enter") $("verifyUrl").click();
  });

  // Tab switching
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Highlight toggle
  $("highlightBtn").addEventListener("click", toggleHighlights);

  // Reset
  $("resetBtn").addEventListener("click", reset);

  // Retry
  $("retryBtn").addEventListener("click", () => {
    if (currentPayload) analyze(currentPayload);
    else show("idle");
  });
}

// ── Mode handler ──────────────────────────────────────────────────────────────
async function handleMode(mode) {
  document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(`[data-mode="${mode}"]`).classList.add("active");

  if (mode === "url") {
    $("urlRow").classList.remove("hidden");
    $("urlInput").focus();
    return;
  }

  $("urlRow").classList.add("hidden");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  let pageData = {};
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { action: "getPageData" });
    pageData = resp || {};
  } catch {
    pageData = { url: tab.url, title: tab.title, pageText: "", contentType: "news" };
  }

  if (mode === "selection" && !pageData.selectedText) {
    showError("No text selected. Highlight some text on the page first.");
    return;
  }

  const payload = {
    url: pageData.url,
    title: pageData.title,
    pageText: mode === "selection" ? "" : pageData.pageText,
    selectedText: mode === "selection" ? pageData.selectedText : "",
    imageUrl: mode === "image" ? pageData.imageUrl : "",
    contentType: pageData.contentType
  };

  analyze(payload);
}

// ── Analyze ───────────────────────────────────────────────────────────────────
async function analyze(payload) {
  currentPayload = payload;
  show("loading");
  animateSteps();

  const result = await chrome.runtime.sendMessage({
    action: "analyzeContent",
    payload
  });

  if (!result.success) {
    if (result.error === "NO_API_KEY") {
      show("noKey");
    } else {
      showError(result.error || "Analysis failed. Please try again.");
    }
    return;
  }

  lastResult = result.data;
  renderResult(result.data);
}

// ── Render result ─────────────────────────────────────────────────────────────
function renderResult(data) {
  const badge = $("verdictBadge");
  badge.textContent = data.verdict || "UNVERIFIED";
  badge.className = "verdict-badge " + (data.verdict || "UNVERIFIED").replace(/\s+/g, "-");

  const score = Math.min(100, Math.max(0, data.score || 50));
  const circumference = 138.2;
  const offset = circumference - (score / 100) * circumference;
  const ring = $("ringFill");
  ring.style.strokeDashoffset = offset;
  ring.style.stroke = scoreColor(score);
  $("scoreNum").textContent = score;

  $("summary").textContent = data.summary || "";

  const cl = $("claimsList");
  cl.innerHTML = "";
  (data.claims || []).forEach(c => {
    const li = document.createElement("li");
    li.className = `claim-item ${c.status}`;
    li.innerHTML = `
      <span class="claim-status ${c.status}">${c.status}</span>
      <div class="claim-text">${escHtml(c.claim)}</div>
      ${c.note ? `<div class="claim-note">${escHtml(c.note)}</div>` : ""}
    `;
    cl.appendChild(li);
  });

  if (data.claims?.length > 0) {
    $("highlightBtn").classList.remove("hidden");
  }

  const sl = $("sourcesList");
  sl.innerHTML = "";
  (data.sources || []).forEach(s => {
    const li = document.createElement("li");
    li.className = "source-item";
    li.innerHTML = `
      <a class="source-title" href="${escHtml(s.url)}" target="_blank">${escHtml(s.title)}</a>
      <span class="source-url">${escHtml(s.url)}</span>
      <span class="source-cred ${s.credibility}">${s.credibility} credibility</span>
    `;
    sl.appendChild(li);
  });

  const fl = $("flagsList");
  fl.innerHTML = "";
  if (!data.flags?.length) {
    fl.innerHTML = `<li class="no-flags">✓ No red flags detected</li>`;
  } else {
    data.flags.forEach(f => {
      const li = document.createElement("li");
      li.className = "flag-item";
      li.textContent = f;
      fl.appendChild(li);
    });
  }

  show("result");
  switchTab("claims");
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
  $(`tab-${name}`).classList.remove("hidden");
}

// ── Highlights ────────────────────────────────────────────────────────────────
async function toggleHighlights() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (highlightsActive) {
    await chrome.tabs.sendMessage(tab.id, { action: "clearHighlights" });
    $("highlightBtn").textContent = "Highlight on page";
    highlightsActive = false;
  } else {
    await chrome.tabs.sendMessage(tab.id, {
      action: "highlightClaims",
      claims: lastResult?.claims || []
    });
    $("highlightBtn").textContent = "Clear highlights";
    highlightsActive = true;
  }
}

// ── Loading animation ─────────────────────────────────────────────────────────
function animateSteps() {
  const steps = ["step1", "step2", "step3"];
  const labels = ["Extracting claims…", "Searching sources…", "Generating verdict…"];
  let i = 0;

  steps.forEach(s => { $(s).classList.remove("active", "done"); });
  $(steps[0]).classList.add("active");
  $("loadingLabel").textContent = labels[0];

  const interval = setInterval(() => {
    if (i >= steps.length - 1) { clearInterval(interval); return; }
    $(steps[i]).classList.remove("active");
    $(steps[i]).classList.add("done");
    i++;
    $(steps[i]).classList.add("active");
    $("loadingLabel").textContent = labels[i];
  }, 3500);

  window._stepInterval = interval;
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function show(name) {
  Object.entries(sections).forEach(([key, el]) => {
    if (el) el.classList.toggle("hidden", key !== name);
  });
}

function showError(msg) {
  $("errorMsg").textContent = msg;
  show("error");
}

function reset() {
  lastResult = null;
  currentPayload = null;
  highlightsActive = false;
  document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
  $("urlRow").classList.add("hidden");
  show("idle");
}

function getApiKey() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: "getApiKey" }, r => resolve(r?.apiKey));
  });
}

async function loadStoredApiKey() {
  const key = await getApiKey();
  if (key) $("apiKeyInput").value = key;
}

function scoreColor(score) {
  if (score >= 70) return "#4dff91";
  if (score >= 40) return "#ffb347";
  return "#ff5252";
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg) {
  const existing = document.querySelector(".vf-toast");
  if (existing) existing.remove();
  const t = document.createElement("div");
  t.className = "vf-toast";
  t.style.cssText = `
    position:fixed;bottom:12px;left:50%;transform:translateX(-50%);
    background:var(--accent);color:var(--accent-text);
    font-family:'DM Mono',monospace;font-size:11px;font-weight:500;
    padding:6px 14px;border-radius:100px;opacity:1;
    transition:opacity 0.4s;z-index:99;white-space:nowrap;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 400); }, 1800);
}
