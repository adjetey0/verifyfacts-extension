# VerifyFacts — Browser Extension

An AI-powered browser extension that instantly verifies the authenticity of news articles, social media posts, documents, and images. No API key required — just install and use.

## Installation

1. Download and unzip this folder
2. Go to `chrome://extensions` (or `edge://` / `brave://`)
3. Enable **Developer mode** → click **"Load unpacked"** → select this folder
4. Pin the VerifyFacts icon in your toolbar

## Usage

- Click the icon → **"This page"** to verify a full article
- Click the icon → **"Selection"** to verify highlighted text
- Right-click any text → **"Verify with VerifyFacts"**
- After a result → **Claims tab** → **"Highlight on page"** to flag claims inline
- Click the 🌙/☀️ icon to switch between dark and light mode

## How it works

```
User clicks → Extension extracts page content
           → Sends to VerifyFacts backend server
           → AI analyzes and fact-checks in real time
           → Returns: verdict, 0-100 score, claims, sources, red flags
```

- **No API key needed** — the backend handles everything
- **Verdict types:** TRUE, LIKELY TRUE, UNVERIFIED, MISLEADING, FALSE
- **Score:** 0-100 credibility rating
- **Claims:** individual fact-check of each claim on the page
- **Sources:** supporting or contradicting sources found online
- **Flags:** red flags like emotional language or missing attribution

## Features

- 🔍 Full page analysis
- ✂️ Selected text verification
- 🖼️ Image verification
- 🔗 URL verification
- 🌙☀️ Dark / Light theme
- ⚑ Inline claim highlighting on page
- 📊 Credibility score ring

## Tech Stack

- **Frontend:** Chrome Extension (Manifest V3), HTML, CSS, JavaScript
- **Backend:** Node.js + Express hosted on Render
- **AI:** OpenRouter (auto-selects best available free model)

## License

© 2025 VerifyFacts. All rights reserved.
