// content.js — injected into every page
// Extracts page data and highlights claims

let lastPayload = null;

// ── Page data extraction ──────────────────────────────────────────────────────
function extractPageData() {
  const selection = window.getSelection()?.toString().trim();
  const title = document.title;
  const url = location.href;

  // Try to detect content type
  let contentType = "unknown";
  const hostname = location.hostname;
  if (/twitter\.com|x\.com|facebook\.com|instagram\.com|threads\.net/.test(hostname)) {
    contentType = "social";
  } else if (/pdf/.test(url) || document.querySelector("embed[type='application/pdf']")) {
    contentType = "document";
  } else {
    contentType = "news";
  }

  // Extract main text (strip nav/footer noise)
  const bodyText = extractMainText();

  // Find main image
  const imageUrl = findMainImage();

  return {
    url,
    title,
    selectedText: selection || "",
    pageText: bodyText,
    imageUrl,
    contentType
  };
}

function extractMainText() {
  const selectors = ["article", "main", "[role='main']", ".post-content", ".article-body", ".story-body"];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el.innerText.trim();
  }
  return document.body.innerText.trim();
}

function findMainImage() {
  const og = document.querySelector("meta[property='og:image']");
  if (og) return og.content;
  const img = document.querySelector("article img, main img");
  if (img) return img.src;
  return "";
}

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "getPageData") {
    sendResponse(extractPageData());
  }
  if (msg.action === "highlightClaims" && msg.claims) {
    highlightClaims(msg.claims);
    sendResponse({ ok: true });
  }
  if (msg.action === "clearHighlights") {
    clearHighlights();
    sendResponse({ ok: true });
  }
});

// ── Claim highlighter ─────────────────────────────────────────────────────────
const HIGHLIGHT_CLASS = "verifyai-highlight";

function highlightClaims(claims) {
  clearHighlights();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  for (const claim of claims) {
    const text = claim.claim?.slice(0, 60);
    if (!text || text.length < 15) continue;
    for (const tn of nodes) {
      const idx = tn.textContent.indexOf(text);
      if (idx === -1) continue;
      try {
        const range = document.createRange();
        range.setStart(tn, idx);
        range.setEnd(tn, idx + text.length);
        const mark = document.createElement("mark");
        mark.className = `${HIGHLIGHT_CLASS} verifyai-${claim.status}`;
        mark.title = claim.note || claim.status;
        range.surroundContents(mark);
        break;
      } catch { /* skip complex ranges */ }
    }
  }
}

function clearHighlights() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
    el.replaceWith(...el.childNodes);
  });
}
