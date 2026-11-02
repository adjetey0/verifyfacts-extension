# VerifyFacts — Browser Extension

An AI-assisted browser extension that helps assess claims in news articles, social media posts, and documents. Results can be incomplete or wrong; always review the cited sources yourself.

## Installation

1. Download and unzip this folder
2. Go to `chrome://extensions` (or `edge://` / `brave://`)
3. Enable **Developer mode** → click **"Load unpacked"** → select this folder
4. Pin the VerifyFacts icon in your toolbar

## Usage

- Click the icon → **"This page"** to assess the visible page text
- Click the icon → **"Selection"** to verify highlighted text
- Right-click selected text, a page, image, or link → **"Verify with VerifyFacts"**
- After a result → **Claims tab** → **"Highlight on page"** to flag claims inline
- Click the 🌙/☀️ icon to switch between dark and light mode

## How it works

```
User clicks → Extension extracts page content
           → Sends to VerifyFacts backend server
           → Backend retrieves URL-only article text when possible
           → AI searches the web and assesses the provided claims
           → Returns an AI assessment, search citations, and limitations
```

- **No API key needed by extension users** — the hosted backend handles requests
- **Verdict types:** TRUE, LIKELY TRUE, UNVERIFIED, MISLEADING, FALSE
- **Score:** 0-100 model assessment, not a probability or calibrated confidence
- **Claims:** AI assessments of individual claims
- **Sources:** URLs supplied as search citations; not independently endorsed
- **Flags:** red flags like emotional language or missing attribution

## Features

- 🔍 Full page analysis
- ✂️ Selected text verification
- 🖼️ Image URL/context assessment (not visual analysis)
- 🔗 URL verification
- 🌙☀️ Dark / Light theme
- ⚑ Inline claim highlighting on page
- 📊 Credibility score ring

## Privacy and limitations

- The extension does not read every site in the background. It injects its page-reading script only after you request an analysis, using the temporary `activeTab` permission.
- A requested analysis may send the selected text or page text, page URL, title, image URL, and content-type hint to the VerifyFacts backend. URL-only checks ask the backend to retrieve the public page. The backend forwards analysis text to OpenRouter with web search enabled; translation text is sent to MyMemory.
- These third-party services may process or retain requests under their own terms and privacy policies. Do not submit sensitive or confidential material.
- OpenRouter web search may incur additional usage charges for the backend operator; configure provider billing and rate limits before publishing.
- URL retrieval is limited to public HTTP(S) pages, redirects are revalidated, and private/reserved network addresses are blocked.
- Search citations can be incomplete, irrelevant, or misleading. A listed citation is not proof of a claim, and no image is visually inspected just because its URL was supplied.
- Translate & Verify currently accepts up to 500 characters per request, matching the translation provider's per-request limit.
- The hosted backend URL is currently configured in the extension and backend; operators should publish a privacy policy and review provider retention settings before wider distribution.

## Tech Stack

- **Frontend:** Chrome Extension (Manifest V3), HTML, CSS, JavaScript
- **Backend:** Node.js + Express hosted on Render
- **AI/search:** OpenRouter with web search (model configured by `OPENROUTER_MODEL`, default `openrouter/auto`)

## Backend configuration

Set `OPENROUTER_API_KEY` as a secret in the backend host environment; never add it to the extension. `OPENROUTER_MODEL` is optional. Install server dependencies with `npm install`, then start with `npm start`.

## License

© 2025 VerifyFacts. All rights reserved.
