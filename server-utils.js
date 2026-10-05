const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const MAX_PAGE_BYTES = 1024 * 1024;
const VERDICTS = new Set(["TRUE", "LIKELY TRUE", "UNVERIFIED", "MISLEADING", "FALSE"]);
const CONTENT_TYPES = new Set(["news", "social", "document", "image", "unknown"]);
const CLAIM_STATUSES = new Set(["verified", "unverified", "false"]);
const VERDICT_SCORE_RANGES = {
  TRUE: [80, 100],
  "LIKELY TRUE": [60, 79],
  UNVERIFIED: [40, 59],
  MISLEADING: [20, 39],
  FALSE: [0, 19]
};

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets;
    return !(
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice(7);
      return net.isIP(mapped) === 4 && isPublicAddress(mapped);
    }
    const groups = normalized.split(":");
    const first = parseInt(groups[0] || "0", 16);
    const second = parseInt(groups[1] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && second === 0x0db8);
  }
  return false;
}

async function resolvePublicAddress(url) {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || /\.(localhost|local|internal|test|invalid|onion)$/.test(hostname)) {
    throw makeError("INVALID_URL");
  }

  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw makeError("INVALID_URL");
    return hostname;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw makeError("FETCH_FAILED");
  }
  if (!records.length || records.some(record => !isPublicAddress(record.address))) {
    throw makeError("INVALID_URL");
  }
  return records[0].address;
}

function makeError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

async function validatePublicUrl(value) {
  if (typeof value !== "string" || value.length > 2048) throw makeError("INVALID_URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw makeError("INVALID_URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw makeError("INVALID_URL");
  }
  const address = await resolvePublicAddress(url);
  return { url, address };
}

function requestPage(url, address) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.get(url, {
      headers: {
        "User-Agent": "VerifyFacts/1.0 (+https://verifyfacts-extension.onrender.com)",
        "Accept": "text/html,text/plain;q=0.9",
        "Accept-Encoding": "identity"
      },
      lookup: (hostname, options, callback) => {
        if (typeof options === "function") {
          callback = options;
          options = {};
        }
        const family = net.isIP(address);
        if (options?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      }
    }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        resolve({ redirect: new URL(response.headers.location, url).toString() });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(makeError("FETCH_FAILED"));
        return;
      }
      const contentType = response.headers["content-type"] || "";
      if (!/^(text\/html|text\/plain)(;|$)/i.test(contentType)) {
        response.resume();
        reject(makeError("FETCH_FAILED"));
        return;
      }

      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > MAX_PAGE_BYTES) {
          request.destroy(makeError("FETCH_FAILED"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        contentType
      }));
    });

    request.setTimeout(8000, () => request.destroy(makeError("FETCH_FAILED")));
    request.on("error", () => reject(makeError("FETCH_FAILED")));
  });
}

async function fetchPublicArticle(inputUrl) {
  let target = inputUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const { url, address } = await validatePublicUrl(target);
    const response = await requestPage(url, address);
    if (response.redirect) {
      if (redirects === 3) throw makeError("FETCH_FAILED");
      target = response.redirect;
      continue;
    }
    return extractArticleText(response.body);
  }
  throw makeError("FETCH_FAILED");
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, decimal) => decodeCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => decodeCodePoint(parseInt(hex, 16)));
}

function decodeCodePoint(codePoint) {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return " ";
  }
  return String.fromCodePoint(codePoint);
}

function extractArticleText(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const withoutNoise = html
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(article|main|p|div|section|h[1-6]|li|br|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeHtmlEntities(withoutNoise).replace(/\s+/g, " ").trim().slice(0, 10000);
  return {
    title: titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, "")).trim().slice(0, 300) : "",
    text
  };
}

function citationUrl(item) {
  const annotation = item?.url_citation || item;
  if (typeof annotation?.url !== "string") return null;
  try {
    const url = new URL(annotation.url);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return {
      title: String(annotation.title || url.hostname).slice(0, 300),
      url: url.toString()
    };
  } catch {
    return null;
  }
}

function normalizeAnalysis(result, citationMetadata) {
  if (!result || typeof result !== "object" || !VERDICTS.has(result.verdict) ||
      !Number.isInteger(result.score) || result.score < 0 || result.score > 100 ||
      typeof result.summary !== "string" || !Array.isArray(result.claims) ||
      !Array.isArray(result.flags)) {
    throw makeError("INVALID_RESULT");
  }

  const metadata = Array.isArray(citationMetadata) ? citationMetadata : [];
  const sources = [];
  const seen = new Set();
  for (const item of metadata) {
    const source = citationUrl(item);
    if (source && !seen.has(source.url) && sources.length < 10) {
      seen.add(source.url);
      sources.push({ ...source, credibility: "unverified" });
    }
  }

  let flags = result.flags
    .filter(flag => typeof flag === "string")
    .slice(0, 10)
    .map(flag => flag.slice(0, 300));
  let verdict = result.verdict;
  let score = result.score;
  const sourceUrls = new Set(sources.map(source => source.url));

  const claims = result.claims
    .filter(claim => claim && typeof claim.claim === "string")
    .slice(0, 10)
    .map(claim => {
      const citedSources = Array.isArray(claim.sourceUrls)
        ? [...new Set(claim.sourceUrls.filter(url => typeof url === "string" && sourceUrls.has(url)))]
        : [];
      const hasCitedEvidence = citedSources.length > 0;
      const note = typeof claim.note === "string" ? claim.note.slice(0, 500) : "";
      return {
        claim: claim.claim.slice(0, 500),
        status: hasCitedEvidence && CLAIM_STATUSES.has(claim.status) ? claim.status : "unverified",
        note: hasCitedEvidence
          ? note
          : `${note}${note ? " " : ""}No matching search citation was attached.`.slice(0, 500),
        sourceUrls: citedSources
      };
    });

  const hasClaimEvidence = claims.some(claim =>
    claim.sourceUrls.length > 0 && ["verified", "false"].includes(claim.status)
  );
  const [minimumScore, maximumScore] = VERDICT_SCORE_RANGES[verdict];
  const scoreMatchesVerdict = score >= minimumScore && score <= maximumScore;
  if (!hasClaimEvidence || !scoreMatchesVerdict) {
    verdict = "UNVERIFIED";
    score = 50;
    const reason = !hasClaimEvidence
      ? sources.length
        ? "No claim could be linked to a web-search citation; treat this result as unverified."
        : "No web-search citations were returned; treat this result as unverified."
      : "The returned verdict and score conflicted; this result was reset to unverified.";
    flags = [...flags.slice(0, 9), reason];
  }

  return {
    verdict,
    score,
    summary: (!hasClaimEvidence
      ? `${result.summary} No claim was linked to a web-search citation, so this is unverified.`
      : !scoreMatchesVerdict
        ? `${result.summary} The verdict and score conflicted, so the result is unverified.`
        : result.summary).slice(0, 1500),
    claims,
    sources,
    flags: flags.slice(0, 10),
    contentType: CONTENT_TYPES.has(result.contentType) ? result.contentType : "unknown"
  };
}

module.exports = {
  extractArticleText,
  fetchPublicArticle,
  isPublicAddress,
  normalizeAnalysis,
  validatePublicUrl
};
