// background.js — VerifyFacts extension service worker

const BACKEND_URL = "https://verifyfacts-extension.onrender.com";
const CONTEXT_ANALYSIS_KEY = "contextAnalysis";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "verifySelection",
      title: "Verify with VerifyFacts",
      contexts: ["selection", "page", "image", "link"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const payload = {
    url: (info.linkUrl || info.pageUrl || tab.url || "").slice(0, 2048),
    title: (tab.title || "").slice(0, 300),
    selectedText: (info.selectionText || "").slice(0, 8000),
    imageUrl: (info.srcUrl || "").slice(0, 2048),
    contentType: info.srcUrl ? "image" : "unknown"
  };
  const requestId = crypto.randomUUID();
  if (chrome.action.openPopup) {
    try {
      const opening = chrome.action.openPopup();
      opening?.catch(err => {
        console.debug("Could not open VerifyFacts automatically:", err.message);
      });
    } catch (err) {
      console.debug("Could not open VerifyFacts automatically:", err.message);
    }
  }
  chrome.storage.session.set({
    [CONTEXT_ANALYSIS_KEY]: { requestId, status: "pending", payload }
  }).catch(err => console.error("Could not save context-menu request:", err));
});

async function saveContextResult(requestId, update) {
  const stored = (await chrome.storage.session.get(CONTEXT_ANALYSIS_KEY))[CONTEXT_ANALYSIS_KEY];
  if (stored?.requestId === requestId) {
    await chrome.storage.session.set({
      [CONTEXT_ANALYSIS_KEY]: { requestId, ...update }
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyzeContext") {
    handleAnalysis(message.payload)
      .then(async data => {
        try {
          await saveContextResult(message.requestId, {
            status: "complete",
            result: data,
            payload: message.payload
          });
        } catch (err) {
          console.error("Could not save context-menu result:", err);
        }
        sendResponse({ success: true, data });
      })
      .catch(async err => {
        try {
          await saveContextResult(message.requestId, {
            status: "error",
            error: err.message,
            payload: message.payload
          });
        } catch (saveError) {
          console.error("Could not save context-menu error:", saveError);
        }
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.action === "analyzeContent") {
    handleAnalysis(message.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "translateContent") {
    handleTranslation(message.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function postToBackend(path, payload) {
  let response;
  try {
    response = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(50000)
    });
  } catch {
    throw new Error("Could not reach the VerifyFacts service. Please try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The VerifyFacts service returned an invalid response.");
  }
  if (!response.ok || !data.success) {
    throw new Error(data.error || `Server error ${response.status}`);
  }
  return data;
}

async function handleAnalysis(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("No content was provided to analyze.");
  }
  const response = await postToBackend("/analyze", payload);
  return response.data;
}

async function handleTranslation(payload) {
  if (!payload || typeof payload.text !== "string" || !payload.text.trim()) {
    throw new Error("No text provided for translation.");
  }
  const response = await postToBackend("/translate", payload);
  return response;
}
