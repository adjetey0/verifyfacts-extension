const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractArticleText,
  isPublicAddress,
  normalizeAnalysis,
  validatePublicUrl
} = require("../server-utils");

test("article extraction removes scripts and decodes common HTML entities", () => {
  const article = extractArticleText(
    "<html><title>News &amp; Facts</title><script>ignore()</script><main><p>Tom &amp; Jerry</p></main></html>"
  );
  assert.equal(article.title, "News & Facts");
  assert.match(article.text, /Tom & Jerry/);
  assert.doesNotMatch(article.text, /ignore/);
  assert.doesNotThrow(() => extractArticleText("<p>&#99999999999999999999;</p>"));
});

test("URL validation rejects private, local, non-HTTP, and credentialed URLs", async () => {
  for (const value of [
    "http://127.0.0.1/",
    "http://192.168.1.2/",
    "http://172.31.0.1/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[2001:db8::1]/",
    "http://localhost/",
    "file:///etc/passwd",
    "https://user:pass@example.com/"
  ]) {
    await assert.rejects(validatePublicUrl(value), { code: "INVALID_URL" });
  }
});

test("public-address check rejects reserved addresses", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicAddress("10.0.0.1"), false);
  assert.equal(isPublicAddress("172.31.255.255"), false);
  assert.equal(isPublicAddress("169.254.10.20"), false);
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
});

test("analysis only exposes HTTPS citations returned in search metadata", () => {
  const normalized = normalizeAnalysis({
    verdict: "TRUE",
    score: 88,
    summary: "Evidence supports the claim.",
    claims: [{
      claim: "A claim",
      status: "verified",
      note: "Supported.",
      sourceUrls: ["https://news.example/story", "https://invented.example/"]
    }],
    sources: [{ title: "Invented", url: "https://invented.example" }],
    flags: [],
    contentType: "news"
  }, [
    { url_citation: { title: "Search result", url: "https://news.example/story" } },
    { url_citation: { title: "Unsafe", url: "http://news.example/story" } },
    { url_citation: { title: "Duplicate", url: "https://news.example/story" } }
  ]);

  assert.equal(normalized.sources.length, 1);
  assert.equal(normalized.sources[0].title, "Search result");
  assert.equal(normalized.sources[0].credibility, "unverified");
  assert.equal(normalized.claims[0].status, "verified");
  assert.deepEqual(normalized.claims[0].sourceUrls, ["https://news.example/story"]);
});

test("analysis without citations is conservatively marked unverified", () => {
  const normalized = normalizeAnalysis({
    verdict: "FALSE",
    score: 2,
    summary: "No sources were available.",
    claims: [{ claim: "A claim", status: "false", note: "Claim is false.", sourceUrls: [] }],
    flags: [],
    contentType: "news"
  }, []);

  assert.equal(normalized.verdict, "UNVERIFIED");
  assert.equal(normalized.score, 50);
  assert.match(normalized.flags.join(" "), /No web-search citations/);
  assert.equal(normalized.claims[0].status, "unverified");
});

test("unmapped search citations cannot support a confident overall verdict", () => {
  const normalized = normalizeAnalysis({
    verdict: "TRUE",
    score: 95,
    summary: "The claim appears true.",
    claims: [{ claim: "A claim", status: "verified", sourceUrls: [] }],
    flags: [],
    contentType: "news"
  }, [{ url_citation: { title: "A result", url: "https://news.example/story" } }]);

  assert.equal(normalized.verdict, "UNVERIFIED");
  assert.equal(normalized.score, 50);
  assert.equal(normalized.claims[0].status, "unverified");
  assert.match(normalized.flags.join(" "), /No claim could be linked/);
});

test("invalid analysis results are rejected", () => {
  assert.throws(() => normalizeAnalysis({
    verdict: "TRUE",
    score: "100",
    summary: "Bad score.",
    claims: [],
    flags: []
  }, []), { code: "INVALID_RESULT" });
});

test("claims with missing or invalid status remain visible as unverified", () => {
  const normalized = normalizeAnalysis({
    verdict: "UNVERIFIED",
    score: 45,
    summary: "Insufficient evidence.",
    claims: [{ claim: "A claim", status: "pending", sourceUrls: [] }],
    flags: [],
    contentType: "unknown"
  }, []);

  assert.equal(normalized.claims.length, 1);
  assert.equal(normalized.claims[0].status, "unverified");
});

test("conflicting model verdict and score are downgraded", () => {
  const normalized = normalizeAnalysis({
    verdict: "TRUE",
    score: 25,
    summary: "The verdict and score disagree.",
    claims: [{
      claim: "A claim",
      status: "verified",
      sourceUrls: ["https://news.example/story"]
    }],
    flags: [],
    contentType: "news"
  }, [{ url_citation: { title: "A result", url: "https://news.example/story" } }]);

  assert.equal(normalized.verdict, "UNVERIFIED");
  assert.equal(normalized.score, 50);
  assert.match(normalized.flags.join(" "), /verdict and score conflicted/);
});
