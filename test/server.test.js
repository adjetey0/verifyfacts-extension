const test = require("node:test");
const assert = require("node:assert/strict");

process.env.OPENROUTER_API_KEY = "test-key";
const app = require("../server");

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  });
});

test("health endpoint responds without exposing configuration", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "VerifyFacts API is running" });
});

test("analysis endpoint rejects private-network URLs before fetching", async () => {
  const response = await fetch(`${baseUrl}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "http://127.0.0.1:1/" })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Enter a valid public http or https URL."
  });
});

test("translation endpoint rejects oversized text and invalid language codes", async () => {
  const oversized = await fetch(`${baseUrl}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "x".repeat(501), sourceLang: "fr", targetLang: "en" })
  });
  assert.equal(oversized.status, 413);

  const invalidLanguage = await fetch(`${baseUrl}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Bonjour", sourceLang: "fr|en", targetLang: "en" })
  });
  assert.equal(invalidLanguage.status, 400);
});
