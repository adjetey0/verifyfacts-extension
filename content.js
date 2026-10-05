// Injected on demand after the user requests an analysis.
(() => {
  if (globalThis.__verifyFactsContentLoaded) return;
  globalThis.__verifyFactsContentLoaded = true;

  const MAX_PAGE_TEXT_LENGTH = 8000;
  const HIGHLIGHT_CLASS = "verifyai-highlight";

  function extractPageData() {
    const selection = window.getSelection()?.toString().trim() || "";
    const hostname = location.hostname;
    let contentType = "news";
    if (/twitter\.com|x\.com|facebook\.com|instagram\.com|threads\.net/.test(hostname)) {
      contentType = "social";
    } else if (/\.pdf(?:$|[?#])/.test(location.href) ||
      document.querySelector("embed[type='application/pdf']")) {
      contentType = "document";
    }

    return {
      url: location.href,
      title: document.title.slice(0, 300),
      selectedText: selection.slice(0, MAX_PAGE_TEXT_LENGTH),
      pageText: extractMainText().slice(0, MAX_PAGE_TEXT_LENGTH),
      imageUrl: findMainImage(),
      contentType
    };
  }

  function extractMainText() {
    const selectors = ["article", "main", "[role='main']", ".post-content", ".article-body", ".story-body"];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element?.innerText?.trim()) return element.innerText.trim();
    }
    return document.body?.innerText?.trim() || "";
  }

  function findMainImage() {
    const ogImage = document.querySelector("meta[property='og:image']");
    if (ogImage?.content) return ogImage.content;
    return document.querySelector("article img, main img")?.src || "";
  }

  function highlightClaims(claims) {
    clearHighlights();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        const parent = node.parentElement;
        if (!node.textContent.trim() || parent?.closest("script,style,textarea,input,select,mark")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    for (const claim of claims) {
      const text = claim.claim?.slice(0, 60);
      if (!text || text.length < 15) continue;
      for (const textNode of nodes) {
        const index = textNode.textContent.indexOf(text);
        if (index < 0 || !textNode.isConnected) continue;
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + text.length);
        const mark = document.createElement("mark");
        const status = ["verified", "unverified", "false"].includes(claim.status)
          ? claim.status
          : "unverified";
        mark.className = `${HIGHLIGHT_CLASS} verifyai-${status}`;
        mark.title = String(claim.note || status).slice(0, 300);
        try {
          range.surroundContents(mark);
          break;
        } catch {
          // Skip text ranges that cross complex inline markup.
        }
      }
    }
  }

  function clearHighlights() {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(element => {
      element.replaceWith(...element.childNodes);
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "getPageData") {
      sendResponse(extractPageData());
      return;
    }
    if (message.action === "highlightClaims" && Array.isArray(message.claims)) {
      highlightClaims(message.claims);
      sendResponse({ ok: true });
      return;
    }
    if (message.action === "clearHighlights") {
      clearHighlights();
      sendResponse({ ok: true });
    }
  });
})();
