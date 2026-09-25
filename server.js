// server.js — VerifyFacts Backend (OpenRouter + MyMemory Translation)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 10000;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const MYMEMORY_API = "https://api.mymemory.translated.net/get";

// Middleware
app.use(express.json({ limit: "10kb" }));
app.use(cors({ origin: "*" }));

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: "Too many requests. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/analyze", limiter);
app.use("/translate", limiter);

// Health check
app.get("/", (req, res) => {
  res.json({ status: "VerifyFacts API is running ✓" });
});

//  Translation endpoint (MyMemory — free, no key needed) 
app.post("/translate", async (req, res) => {
  try {
    const { text, sourceLang, targetLang } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided." });

    const langPair = `${sourceLang || "auto"}|${targetLang || "en"}`;
    const url = `${MYMEMORY_API}?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${langPair}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.responseStatus !== 200) {
      return res.status(500).json({ error: "Translation failed. Please try again." });
    }

    res.json({
      success: true,
      translatedText: data.responseData.translatedText,
      detectedLang: sourceLang || "auto"
    });

  } catch (err) {
    console.error("Translation error:", err);
    res.status(500).json({ error: "Translation service unavailable." });
  }
});

// Main analyze endpoint
app.post("/analyze", async (req, res) => {
  try {
    if (!OPENROUTER_KEY) {
      return res.status(500).json({ error: "Server not configured. Contact the developer." });
    }

    const { url, title, selectedText, pageText, imageUrl, contentType } = req.body;

    const parts = [];
    if (url)          parts.push(`Page URL: ${url}`);
    if (title)        parts.push(`Page title: ${title}`);
    if (selectedText) parts.push(`Selected text:\n"${selectedText}"`);
    if (pageText)     parts.push(`Page content (first 3000 chars):\n${String(pageText).slice(0, 3000)}`);
    if (imageUrl)     parts.push(`Image URL to verify: ${imageUrl}`);
    if (contentType)  parts.push(`Content type hint: ${contentType}`);

    const prompt = parts.join("\n\n") || "Analyze the current page for authenticity and credibility.";

    const systemPrompt = `You are VerifyFacts, an expert fact-checker and media literacy assistant.
Analyze the provided content and return ONLY a valid JSON object — no markdown, no backticks, no preamble — with this exact structure:
{
  "verdict": "TRUE" | "LIKELY TRUE" | "UNVERIFIED" | "MISLEADING" | "FALSE",
  "score": <integer 0-100>,
  "summary": "<2-3 sentence plain-English explanation>",
  "claims": [{"claim": "<text>", "status": "verified"|"unverified"|"false", "note": "<brief note>"}],
  "sources": [{"title": "<source name>", "url": "<url>", "credibility": "high"|"medium"|"low"}],
  "flags": ["<red flags like emotional language, missing attribution, implausible claims>"],
  "contentType": "news" | "social" | "document" | "image" | "unknown"
}
Score guide: 80-100 = well-verified true, 60-79 = likely true, 40-59 = unverified/mixed, 20-39 = misleading, 0-19 = false/debunked.`;

    const openRouterRes = await fetch(OPENROUTER_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "HTTP-Referer": "https://verifyfacts-extension.onrender.com",
        "X-Title": "VerifyFacts"
      },
      body: JSON.stringify({
        model: "openrouter/auto",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        max_tokens: 1500,
        temperature: 0.1
      })
    });

    const data = await openRouterRes.json();

    if (!openRouterRes.ok) {
      const msg = data.error?.message || `OpenRouter error ${openRouterRes.status}`;
      console.error("OpenRouter error:", msg);
      return res.status(500).json({ error: "Analysis failed. Please try again." });
    }

    const text = data.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
      else return res.status(500).json({ error: "Could not parse AI response. Please try again." });
    }

    res.json({ success: true, data: result });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// Start
app.listen(PORT, () => {
  console.log(`VerifyFacts backend running on port ${PORT}`);
});