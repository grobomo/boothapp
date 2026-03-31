const crypto = require("crypto");
const assert = require("assert");

// Mock https before requiring handler
let lastRequest = null;
const mockHttps = {
  request(options, callback) {
    lastRequest = { options, body: "" };
    const req = lastRequest;
    const mockRes = {
      statusCode: 201,
      on(event, cb) {
        if (event === "data") cb(JSON.stringify({ number: 42, title: "Test", html_url: "https://github.com/altarr/boothapp/issues/42" }));
        if (event === "end") cb();
      },
    };
    return {
      on() {},
      write(data) { req.body = data; },
      end() { callback(mockRes); },
    };
  },
};

// Inject mock
require.cache[require.resolve("https")] = { id: "https", filename: "https", loaded: true, exports: mockHttps };

// Set env before requiring handler
process.env.GITHUB_TOKEN = "ghp_test_token";
process.env.GITHUB_REPO = "altarr/boothapp";
process.env.TEAMS_WEBHOOK_SECRET = "";

// Clear cached handler so it picks up mocked https
delete require.cache[require.resolve("./index")];
const { handler } = require("./index");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err.message}`);
    failed++;
  }
}

(async () => {
  console.log("teams-webhook tests\n");

  await test("rejects non-POST", async () => {
    const res = await handler({ httpMethod: "GET", body: "{}" });
    assert.strictEqual(res.statusCode, 405);
  });

  await test("rejects invalid JSON", async () => {
    const res = await handler({ httpMethod: "POST", body: "not json", headers: {} });
    assert.strictEqual(res.statusCode, 400);
  });

  await test("shows usage when no text", async () => {
    const res = await handler({ httpMethod: "POST", body: JSON.stringify({ text: "" }), headers: {} });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert(body.text.includes("Usage"), "should show usage");
  });

  await test("parses title-only message", async () => {
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ text: "<at>BoothApp</at> Scanner broken", from: { name: "Alice" } }),
      headers: {},
    });
    assert.strictEqual(res.statusCode, 200);
    const reqBody = JSON.parse(lastRequest.body);
    assert.strictEqual(reqBody.title, "Scanner broken");
    assert(reqBody.body.includes("Alice"), "body should include sender name");
  });

  await test("parses title | description message", async () => {
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ text: "<at>BoothApp</at> Scanner broken | Booth 3 times out", from: { name: "Bob" } }),
      headers: {},
    });
    const reqBody = JSON.parse(lastRequest.body);
    assert.strictEqual(reqBody.title, "Scanner broken");
    assert(reqBody.body.includes("Booth 3 times out"), "body should include description");
  });

  await test("adds from-teams label", async () => {
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ text: "Bug report", from: { name: "Carol" } }),
      headers: {},
    });
    const reqBody = JSON.parse(lastRequest.body);
    assert.deepStrictEqual(reqBody.labels, ["from-teams"]);
  });

  await test("returns issue link in response", async () => {
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ text: "Test issue", from: { name: "Dave" } }),
      headers: {},
    });
    const body = JSON.parse(res.body);
    assert(body.text.includes("#42"), "should include issue number");
    assert(body.text.includes("github.com"), "should include github link");
  });

  await test("validates HMAC signature", async () => {
    const secret = "dGVzdHNlY3JldA=="; // base64 "testsecret"
    process.env.TEAMS_WEBHOOK_SECRET = secret;

    const payload = JSON.stringify({ text: "Signed message" });
    const validHmac = crypto.createHmac("sha256", Buffer.from(secret, "base64")).update(payload).digest("base64");

    // Valid signature
    const res1 = await handler({
      httpMethod: "POST",
      body: payload,
      headers: { Authorization: `HMAC ${validHmac}` },
    });
    assert.strictEqual(res1.statusCode, 200);

    // Invalid signature
    const res2 = await handler({
      httpMethod: "POST",
      body: payload,
      headers: { Authorization: "HMAC invalidhmac" },
    });
    assert.strictEqual(res2.statusCode, 401);

    process.env.TEAMS_WEBHOOK_SECRET = "";
  });

  await test("handles missing GITHUB_TOKEN", async () => {
    const savedToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "";
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ text: "Test" }),
      headers: {},
    });
    const body = JSON.parse(res.body);
    assert(body.text.includes("token not configured"), "should report missing token");
    process.env.GITHUB_TOKEN = savedToken;
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
