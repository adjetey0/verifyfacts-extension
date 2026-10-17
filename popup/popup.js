// popup.js — VerifyFacts popup controller

const CONTEXT_ANALYSIS_KEY = "contextAnalysis";

let currentPayload = null;
let currentTranslation = null;
let lastResult = null;
let highlightsActive = false;
let sections = {};
let stepInterval = null;
let handledContextRequestId = null;
let displayedContextRequestId = null;

const $ = id => document.getElementById(id);

function applyTheme(theme) {
  document.body.classList.toggle("light", theme === "light");
  $("themeIconMoon")?.classList.toggle("hidden", theme === "light");
  $("themeIconSun")?.classList.toggle("hidden", theme !== "light");
  $("darkBtn")?.classList.toggle("active", theme !== "light");
  $("lightBtn")?.classList.toggle("active", theme === "light");
}

async function loadTheme() {
  const { theme } = await chrome.storage.local.get(["theme"]);
  applyTheme(theme || "dark");
}

function saveTheme(theme) {
  chrome.storage.local.set({ theme }).catch(err => console.error("Could not save theme:", err));
  applyTheme(theme);
  showToast(theme === "light" ? "Light mode" : "Dark mode");
}

document.addEventListener("DOMContentLoaded", async () => {
  sections = {
    settings: $("settingsPanel"),
    idle:     $("idleState"),
    loading:  $("loadingState"),
    result:   $("resultState"),
    error:    $("errorState")
  };

  bindEvents();
  try {
    await loadTheme();
  } catch (err) {
    console.error("Could not load saved theme:", err);
    applyTheme("dark");
  }
  show("idle");
  chrome.storage.onChanged.addListener(handleStorageChange);
  await loadContextAnalysis();
});

function bindEvents() {
  $("themeToggle").addEventListener("click", () => {
    saveTheme(document.body.classList.contains("light") ? "dark" : "light");
  });
  $("darkBtn").addEventListener("click", () => saveTheme("dark"));
  $("lightBtn").addEventListener("click", () => saveTheme("light"));

  // ── FIXED: settings toggle ──────────────────────────────────────────────
  $("settingsToggle").addEventListener("click", () => {
    const panel = $("settingsPanel");
    const isNowOpen = panel.classList.toggle("hidden") === false;
    $("settingsToggle").setAttribute("aria-expanded", String(isNowOpen));
  });

  document.querySelectorAll(".mode-btn").forEach(button => {
    button.addEventListener("click", () => void handleMode(button.dataset.mode));
  });

  $("verifyUrl").addEventListener("click", () => {
    const value = $("urlInput").value.trim();
    let url;
    try {
      url = new URL(value);
    } catch {
      showError("Enter a valid public http or https URL.");
      return;
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      showError("Enter a valid public http or https URL.");
      return;
    }
    void analyze({ url: url.toString(), contentType: "news" });
  });

  $("urlInput").addEventListener("keydown", event => {
    if (event.key === "Enter") $("verifyUrl").click();
  });

  $("translateVerifyBtn").addEventListener("click", () => void handleTranslateVerify());
  $("translateInput").addEventListener("input", updateTranslationCount);
  updateTranslationCount();

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  $("highlightBtn").addEventListener("click", () => void toggleHighlights());
  $("resetBtn").addEventListener("click", reset);
  $("retryBtn").addEventListener("click", () => {
    if (currentPayload) void analyze(currentPayload, currentTranslation);
    else show("idle");
  });
}

async function handleMode(mode) {
  document.querySelectorAll(".mode-btn").forEach(button => button.classList.remove("active"));
  document.querySelector(`[data-mode="${CSS.escape(mode)}"]`)?.classList.add("active");
  $("urlRow").classList.add("hidden");
  $("translatePanel").classList.add("hidden");

  if (mode === "url") {
    $("urlRow").classList.remove("hidden");
    $("urlInput").focus();
    return;
  }
  if (mode === "translate") {
    $("translatePanel").classList.remove("hidden");
    $("translateInput").focus();
    return;
  }

  try {
    const tab = await getActiveTab();

    // ── FIXED: wrap ensureContentScript so it never blocks on restricted pages ──
    let pageData = null;
    try {
      await ensureContentScript(tab.id);
      pageData = await chrome.tabs.sendMessage(tab.id, { action: "getPageData" });
    } catch {
      // Fall back to tab metadata if content script can't run (e.g. restricted pages)
      pageData = {
        url: tab.url || "",
        title: tab.title || "",
        pageText: "",
        selectedText: "",
        imageUrl: "",
        contentType: "news"
      };
    }

    if (mode === "selection" && !pageData.selectedText) {
      showError("No text selected. Highlight some text on the page first.");
      return;
    }
    if (mode === "image" && !pageData.imageUrl) {
      showError("No main image was found on this page.");
      return;
    }

    const payload = {
      url: pageData.url,
      title: pageData.title,
      pageText: mode === "page" ? pageData.pageText : "",
      selectedText: mode === "selection" ? pageData.selectedText : "",
      imageUrl: mode === "image" ? pageData.imageUrl : "",
      contentType: mode === "image" ? "image" : pageData.contentType
    };
    await analyze(payload);
  } catch (err) {
    showError(err.message || "Could not read this page. Try entering the URL instead.");
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Could not identify the current tab.");
  return tab;
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function handleTranslateVerify() {
  const text = $("translateInput").value.trim();
  if (!text) {
    showToast("Please enter some text first");
    return;
  }
  if (text.length > 500) {
    showError("Translation supports up to 500 characters per request.");
    return;
  }

  const sourceLang = $("sourceLang").value;
  if (sourceLang === "en") {
    await analyze({ selectedText: text, contentType: "unknown" });
    return;
  }

  show("loading");
  $("loadingLabel").textContent = "Translating…";
  try {
    const response = await chrome.runtime.sendMessage({
      action: "translateContent",
      payload: { text, sourceLang, targetLang: "en" }
    });
    if (!response?.success) throw new Error(response?.error || "Translation failed.");
    const translatedText = response.data?.translatedText;
    if (typeof translatedText !== "string" || !translatedText.trim()) {
      throw new Error("Translation returned no text.");
    }
    await analyze(
      { selectedText: translatedText, contentType: "unknown" },
      { sourceLang, translatedText }
    );
  } catch (err) {
    showError(err.message || "Translation service unavailable. Please try again.");
  }
}

async function analyze(payload, translation = null) {
  currentPayload = payload;
  currentTranslation = translation;
  show("loading");
  animateSteps();
  try {
    const response = await chrome.runtime.sendMessage({
      action: "analyzeContent",
      payload
    });
    if (!response?.success) throw new Error(response?.error || "Analysis failed. Please try again.");
    if (!isAnalysisResult(response.data)) {
      throw new Error("The analysis service returned an invalid result.");
    }
    lastResult = response.data;
    renderResult(response.data);
  } catch (err) {
    showError(err.message || "Analysis failed. Please try again.");
  }
}

function isAnalysisResult(data) {
  return Boolean(data && typeof data === "object" &&
    typeof data.verdict === "string" && Number.isInteger(data.score) &&
    typeof data.summary === "string" && Array.isArray(data.claims) &&
    Array.isArray(data.sources) && Array.isArray(data.flags));
}

function renderResult(data) {
  stopSteps();
  const allowedVerdicts = new Set(["TRUE", "LIKELY TRUE", "UNVERIFIED", "MISLEADING", "FALSE"]);
  const verdict = allowedVerdicts.has(data.verdict) ? data.verdict : "UNVERIFIED";
  const badge = $("verdictBadge");
  badge.textContent = verdict;
  badge.className = `verdict-badge ${verdict.replace(/\s+/g, "-")}`;

  const score = Number.isInteger(data.score) ? Math.min(100, Math.max(0, data.score)) : 0;
  const circumference = 138.2;
  $("ringFill").style.strokeDashoffset = circumference - (score / 100) * circumference;
  $("ringFill").style.stroke = scoreColor(score);
  $("scoreNum").textContent = String(score);
  $("scoreDisplay").setAttribute("aria-label", `Assessment score ${score} out of 100. Not a probability.`);
  $("summary").textContent = data.summary;

  const scopeNotice = $("scopeNotice");
  if (currentPayload?.imageUrl) {
    scopeNotice.textContent = "Image context only: the image itself was not opened or visually analyzed.";
    scopeNotice.classList.remove("hidden");
  } else {
    scopeNotice.classList.add("hidden");
  }

  const notice = $("translationNotice");
  if (currentTranslation) {
    notice.classList.remove("hidden");
    const translated = currentTranslation.translatedText;
    $("translationNoticeText").textContent =
      `Translated from ${langName(currentTranslation.sourceLang)} · "${translated.slice(0, 60)}${translated.length > 60 ? "…" : ""}"`;
  } else {
    notice.classList.add("hidden");
  }

  const claimsList = $("claimsList");
  claimsList.replaceChildren();
  for (const claim of data.claims) {
    if (!claim || typeof claim.claim !== "string") continue;
    const status = ["verified", "unverified", "false"].includes(claim.status)
      ? claim.status : "unverified";
    const item = document.createElement("li");
    item.className = `claim-item ${status}`;
    const statusLabel = document.createElement("span");
    statusLabel.className = `claim-status ${status}`;
    statusLabel.textContent = status;
    const claimText = document.createElement("div");
    claimText.className = "claim-text";
    claimText.textContent = claim.claim;
    item.append(statusLabel, claimText);
    if (typeof claim.note === "string" && claim.note) {
      const note = document.createElement("div");
      note.className = "claim-note";
      note.textContent = claim.note;
      item.append(note);
    }
    if (Array.isArray(claim.sourceUrls)) {
      for (const sourceUrl of claim.sourceUrls) {
        let url;
        try { url = new URL(sourceUrl); } catch { continue; }
        if (url.protocol !== "https:" || url.username || url.password) continue;
        const sourceLink = document.createElement("a");
        sourceLink.className = "claim-source";
        sourceLink.href = url.toString();
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceLink.textContent = `Evidence: ${url.hostname}`;
        item.append(sourceLink);
      }
    }
    claimsList.append(item);
  }
  $("claimsCount").textContent = String(claimsList.childElementCount);
  if (!claimsList.childElementCount) {
    claimsList.append(createEmptyState(
      "No individual claims returned",
      "Review the assessment summary and citations, or try a shorter passage."
    ));
  }

  const highlightButton = $("highlightBtn");
  highlightButton.classList.toggle("hidden", claimsList.childElementCount === 0 || !currentPayload?.url);
  highlightButton.textContent = "Highlight on page";
  highlightsActive = false;

  const sourcesList = $("sourcesList");
  sourcesList.replaceChildren();
  for (const source of data.sources) {
    if (!source || typeof source.url !== "string") continue;
    let url;
    try { url = new URL(source.url); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password) continue;
    const item = document.createElement("li");
    item.className = "source-item";
    const link = document.createElement("a");
    link.className = "source-title";
    link.href = url.toString();
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = typeof source.title === "string" ? source.title : url.hostname;
    const domain = document.createElement("span");
    domain.className = "source-domain";
    domain.textContent = url.hostname;
    const label = document.createElement("span");
    label.className = "source-cred unverified";
    label.textContent = "Search citation · unverified";
    const note = document.createElement("span");
    note.className = "source-note";
    note.textContent = "Check that this source directly supports the claim.";
    item.append(link, domain, label, note);
    sourcesList.append(item);
  }
  if (!sourcesList.childElementCount) {
    sourcesList.append(createEmptyState(
      "No citations returned",
      "This assessment is marked unverified. Try a more specific claim."
    ));
  }
  $("sourcesCount").textContent = String(
    [...sourcesList.children].filter(item => item.classList.contains("source-item")).length
  );

  const flagsList = $("flagsList");
  flagsList.replaceChildren();
  if (!data.flags.length) {
    flagsList.append(createEmptyState(
      "No additional notes",
      "This does not mean the content is error-free.",
      true
    ));
  } else {
    for (const flag of data.flags) {
      if (typeof flag !== "string") continue;
      const item = document.createElement("li");
      item.className = "flag-item";
      item.textContent = flag;
      flagsList.append(item);
    }
  }
  $("flagsCount").textContent = String(
    [...flagsList.children].filter(item => item.classList.contains("flag-item")).length
  );

  show("result");
  switchTab("claims");
}

function switchTab(name) {
  const panel = $(`tab-${name}`);
  if (!panel) return;
  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach(item => item.classList.add("hidden"));
  panel.classList.remove("hidden");
}

function createEmptyState(title, description, positive = false) {
  const item = document.createElement("li");
  item.className = `empty-state${positive ? " positive" : ""}`;
  const heading = document.createElement("strong");
  heading.textContent = title;
  const copy = document.createElement("span");
  copy.textContent = description;
  item.append(heading, copy);
  return item;
}

function updateTranslationCount() {
  $("translationCount").textContent = `${$("translateInput").value.length} / 500`;
}

async function toggleHighlights() {
  try {
    const tab = await getActiveTab();
    try { await ensureContentScript(tab.id); } catch { /* restricted page */ }
    if (!highlightsActive) {
      try {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
      } catch { /* ok if already injected */ }
      await chrome.tabs.sendMessage(tab.id, {
        action: "highlightClaims",
        claims: lastResult?.claims || []
      });
      $("highlightBtn").textContent = "Clear highlights";
      highlightsActive = true;
    } else {
      await chrome.tabs.sendMessage(tab.id, { action: "clearHighlights" });
      $("highlightBtn").textContent = "Highlight on page";
      highlightsActive = false;
    }
  } catch (err) {
    showToast(err.message || "Could not update page highlights.");
  }
}

function animateSteps() {
  stopSteps();
  const steps = ["step1", "step2", "step3"];
  const labels = ["Preparing assessment…", "Searching sources…", "Reviewing evidence…"];
  let index = 0;
  steps.forEach(step => $(step).classList.remove("active", "done"));
  $(steps[0]).classList.add("active");
  $("loadingLabel").textContent = labels[0];
  stepInterval = setInterval(() => {
    if (index >= steps.length - 1) { stopSteps(); return; }
    $(steps[index]).classList.remove("active");
    $(steps[index]).classList.add("done");
    index += 1;
    $(steps[index]).classList.add("active");
    $("loadingLabel").textContent = labels[index];
  }, 3500);
}

function stopSteps() {
  if (stepInterval !== null) {
    clearInterval(stepInterval);
    stepInterval = null;
  }
}

function show(name) {
  if (name !== "loading") stopSteps();
  Object.entries(sections).forEach(([key, element]) => {
    if (element) element.classList.toggle("hidden", key !== name);
  });
}

function showError(message) {
  stopSteps();
  $("errorMsg").textContent = message;
  show("error");
}

function reset() {
  stopSteps();
  lastResult = null;
  currentPayload = null;
  currentTranslation = null;
  highlightsActive = false;
  document.querySelectorAll(".mode-btn").forEach(button => button.classList.remove("active"));
  $("urlRow").classList.add("hidden");
  $("translatePanel").classList.add("hidden");
  $("translateInput").value = "";
  updateTranslationCount();
  show("idle");
}

async function loadContextAnalysis() {
  try {
    const stored = (await chrome.storage.session.get(CONTEXT_ANALYSIS_KEY))[CONTEXT_ANALYSIS_KEY];
    await displayContextAnalysis(stored);
  } catch (err) {
    console.error("Could not load context-menu analysis:", err);
  }
}

function handleStorageChange(changes, areaName) {
  if (areaName === "session" && changes[CONTEXT_ANALYSIS_KEY]?.newValue) {
    displayContextAnalysis(changes[CONTEXT_ANALYSIS_KEY].newValue)
      .catch(err => console.error("Could not display context-menu analysis:", err));
  }
}

async function displayContextAnalysis(record) {
  if (!record?.requestId || record.requestId === displayedContextRequestId) return;
  if (record.status === "pending") {
    await startContextAnalysis(record);
    return;
  }
  if (record.status === "loading" || record.status === "processing") {
    currentPayload = record.payload || null;
    show("loading");
    $("loadingLabel").textContent = "Verifying selected content…";
    return;
  }
  if (record.status === "complete" && isAnalysisResult(record.result)) {
    displayedContextRequestId = record.requestId;
    currentPayload = record.payload || null;
    currentTranslation = null;
    lastResult = record.result;
    renderResult(record.result);
  } else if (record.status === "error") {
    displayedContextRequestId = record.requestId;
    currentPayload = record.payload || null;
    showError(record.error || "Context-menu analysis failed.");
  } else {
    return;
  }
  await chrome.storage.session.remove(CONTEXT_ANALYSIS_KEY);
}

async function startContextAnalysis(record) {
  if (record.requestId === handledContextRequestId) return;
  handledContextRequestId = record.requestId;
  currentPayload = record.payload;
  currentTranslation = null;
  show("loading");
  animateSteps();
  try {
    await chrome.storage.session.set({
      [CONTEXT_ANALYSIS_KEY]: { ...record, status: "processing" }
    });
    const response = await chrome.runtime.sendMessage({
      action: "analyzeContext",
      requestId: record.requestId,
      payload: record.payload
    });
    if (!response?.success) {
      throw new Error(response?.error || "Context-menu analysis failed.");
    }
    await displayContextAnalysis({
      requestId: record.requestId,
      status: "complete",
      result: response.data,
      payload: record.payload
    });
  } catch (err) {
    showError(err.message || "Context-menu analysis failed.");
  }
}

function langName(code) {
  const names = {
    fr: "French", es: "Spanish", ar: "Arabic", pt: "Portuguese",
    tw: "Twi", ha: "Hausa", yo: "Yoruba", ig: "Igbo",
    sw: "Swahili", zh: "Chinese", de: "German", ru: "Russian",
    auto: "detected language", en: "English"
  };
  return names[code] || code;
}

function scoreColor(score) {
  if (score >= 70) return "#4dff91";
  if (score >= 40) return "#ffb347";
  return "#ff5252";
}

function showToast(message) {
  document.querySelector(".vf-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "vf-toast";
  toast.style.cssText = `
    position:fixed;bottom:12px;left:50%;transform:translateX(-50%);
    background:var(--accent);color:var(--accent-text);
    font-family:'DM Mono',monospace;font-size:11px;font-weight:500;
    padding:6px 14px;border-radius:100px;opacity:1;
    transition:opacity 0.4s;z-index:99;white-space:nowrap;
  `;
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 400);
  }, 1800);
}