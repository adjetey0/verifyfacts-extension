// server.js — VerifyFacts Backend
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));
app.use(cors({ origin: "*" })); // Allow all Chrome extensions

// Rate limit: 30 requests per user per hour
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: "Too many requests. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/analyze", limiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "VerifyFacts API is running ✓" });
});

// ── Main analyze endpoint ─────────────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  try {
    if (!GEMINI_KEY) {
      return res.status(500).json({ error: "Server not configured. Contact the developer." });
    }

    const { url, title, selectedText, pageText, imageUrl, contentType } = req.body;

    // Build prompt
    const parts = [];
    if (url)          parts.push(`Page URL: ${url}`);
    if (title)        parts.push(`Page title: ${title}`);
    if (selectedText) parts.push(`Selected text:\n"${selectedText}"`);
    if (pageText)     parts.push(`Page content (first 3000 chars):\n${String(pageText).slice(0, 3000)}`);
    if (imageUrl)     parts.push(`Image URL to verify: ${imageUrl}`);
    if (contentType)  parts.push(`Content type hint: ${contentType}`);

    const prompt = parts.join("\n\n") || "Analyze the current page for authenticity and credibility.";

    // Call Gemini
    const geminiRes = await fetch(`${GEMINI_API}?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
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
      })
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.json().catch(() => ({}));
      const msg = err.error?.message || `Gemini error ${geminiRes.status}`;
      if (geminiRes.status === 429) {
        return res.status(429).json({ error: "Service is busy. Please try again in a moment." });
      }
      return res.status(500).json({ error: msg });
    }

    const data = await geminiRes.json();

    // Extract text
    const text = data.candidates?.[0]?.content?.parts
      ?.filter(p => p.text)
      ?.map(p => p.text)
      ?.join("") || "";

    // Parse JSON from response
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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`VerifyFacts backend running on port ${PORT}`);
});
