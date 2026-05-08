// background.js — service worker (Gemini free tier edition)
// Uses Google Gemini 2.0 Flash with Google Search grounding — free up to 1,500 req/day

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
  if (message.action === "getApiKey") {
    chrome.storage.local.get(["geminiKey"], r => sendResponse({ apiKey: r.geminiKey || "" }));
    return true;
  }
  if (message.action === "saveApiKey") {
    chrome.storage.local.set({ geminiKey: message.key }, () => sendResponse({ ok: true }));
    return true;
  }
});

// ── Core analysis ─────────────────────────────────────────────────────────────
async function handleAnalysis(payload) {
  const { geminiKey } = await chrome.storage.local.get(["geminiKey"]);
  if (!geminiKey) throw new Error("NO_API_KEY");

  const prompt = buildPrompt(payload);

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1500
    },
    systemInstruction: {
      parts: [{
        text: `You are VerifyFacts, an expert fact-checker and media literacy assistant.
Analyze the provided content using Google Search to find corroborating or contradicting sources.
Return ONLY a valid JSON object — no markdown, no backticks, no preamble — with this exact structure:
{
  "verdict": "TRUE" | "LIKELY TRUE" | "UNVERIFIED" | "MISLEADING" | "FALSE",
  "score": <integer 0-100>,
  "summary": "<2-3 sentence plain-English explanation>",
  "claims": [{"claim": "<text>", "status": "verified"|"unverified"|"false", "note": "<brief note>"}],
  "sources": [{"title": "<source name>", "url": "<url>", "credibility": "high"|"medium"|"low"}],
  "flags": ["<red flags like emotional language, missing attribution, implausible claims>"],
  "contentType": "news" | "social" | "document" | "image" | "unknown"
}
Score guide: 80-100 = well-verified true, 60-79 = likely true, 40-59 = unverified/mixed, 20-39 = misleading, 0-19 = false/debunked.`
      }]
    }
  };

  const res = await fetch(`${GEMINI_API}?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `Gemini API error ${res.status}`;
    if (res.status === 400 && msg.includes("API_KEY")) throw new Error("Invalid API key. Check your Gemini key.");
    if (res.status === 429) throw new Error("Rate limit reached. You have used today's free quota — try again tomorrow.");
    throw new Error(msg);
  }

  const data = await res.json();

  const text = data.candidates?.[0]?.content?.parts
    ?.filter(p => p.text)
    ?.map(p => p.text)
    ?.join("") || "";

  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse AI response. Please try again.");
  }
}

function buildPrompt(payload) {
  const parts = [];
  if (payload.url)          parts.push(`Page URL: ${payload.url}`);
  if (payload.title)        parts.push(`Page title: ${payload.title}`);
  if (payload.selectedText) parts.push(`Selected text:\n"${payload.selectedText}"`);
  if (payload.pageText)     parts.push(`Page content (first 3000 chars):\n${payload.pageText.slice(0, 3000)}`);
  if (payload.imageUrl)     parts.push(`Image URL to verify: ${payload.imageUrl}`);
  if (payload.contentType)  parts.push(`Content type hint: ${payload.contentType}`);
  return parts.join("\n\n") || "Analyze the current page for authenticity and credibility.";
}
