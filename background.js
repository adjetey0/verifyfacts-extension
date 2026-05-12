// background.js — VerifyFacts Extension
// Calls your own backend server — no API key needed by users

const BACKEND_URL = "https://verifyfacts-extension.onrender.com";

// ── Context menu ──────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "verifySelection",
    title: "🔍 Verify with VerifyFacts",
    contexts: ["selection", "page", "image", "link"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const payload = {
    type: "VERIFY_CONTEXT",
    selectedText: info.selectionText || "",
    pageUrl: info.pageUrl,
    linkUrl: info.linkUrl || "",
    srcUrl: info.srcUrl || ""
  };
  chrome.tabs.sendMessage(tab.id, { action: "openPopupData", data: payload });
});

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyzeContent") {
    handleAnalysis(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ── Core analysis — calls your backend ───────────────────────────────────────
async function handleAnalysis(payload) {
  const res = await fetch(`${BACKEND_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(data.error || `Server error ${res.status}`);
  }

  return data.data;
}
