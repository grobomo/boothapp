"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { exportSession, esc, badge, formatTime, encodeScreenshot } = require("../../analysis/export");

const fixturesDir = path.join(__dirname, "..", "fixtures");
const sessionData = require(path.join(fixturesDir, "session.json"));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  PASS  " + name);
  } catch (err) {
    failed++;
    console.log("  FAIL  " + name);
    console.log("        " + err.message);
  }
}

// ===========================================================================
// 1. HTML escaping
// ===========================================================================
console.log("\n--- HTML escaping ---");

test("esc handles angle brackets", () => {
  assert.strictEqual(esc("<script>alert('xss')</script>"), "&lt;script&gt;alert('xss')&lt;/script&gt;");
});

test("esc handles ampersand", () => {
  assert.strictEqual(esc("A & B"), "A &amp; B");
});

test("esc handles quotes", () => {
  assert.strictEqual(esc('"hello"'), "&quot;hello&quot;");
});

test("esc handles null", () => {
  assert.strictEqual(esc(null), "");
});

test("esc handles undefined", () => {
  assert.strictEqual(esc(undefined), "");
});

test("esc handles numbers", () => {
  assert.strictEqual(esc(42), "42");
});

// ===========================================================================
// 2. Badge rendering
// ===========================================================================
console.log("\n--- Badge rendering ---");

test("badge high renders green", () => {
  var html = badge("high");
  assert.ok(html.includes("#2D936C"));
  assert.ok(html.includes("HIGH"));
});

test("badge medium renders yellow", () => {
  var html = badge("medium");
  assert.ok(html.includes("#E9C46A"));
  assert.ok(html.includes("MEDIUM"));
});

test("badge low renders red", () => {
  var html = badge("low");
  assert.ok(html.includes("#E63946"));
  assert.ok(html.includes("LOW"));
});

test("badge is case-insensitive", () => {
  var html = badge("HIGH");
  assert.ok(html.includes("HIGH"));
  assert.ok(html.includes("#2D936C"));
});

test("badge handles unknown level", () => {
  var html = badge("unknown");
  assert.ok(html.includes("UNKNOWN"));
});

test("badge handles null", () => {
  var html = badge(null);
  assert.ok(html.includes("MEDIUM")); // default
});

// ===========================================================================
// 3. Time formatting
// ===========================================================================
console.log("\n--- Time formatting ---");

test("formatTime 0 ms = 00:00", () => {
  assert.strictEqual(formatTime(0), "00:00");
});

test("formatTime 1000 ms = 00:01", () => {
  assert.strictEqual(formatTime(1000), "00:01");
});

test("formatTime 65000 ms = 01:05", () => {
  assert.strictEqual(formatTime(65000), "01:05");
});

test("formatTime null = empty string", () => {
  assert.strictEqual(formatTime(null), "");
});

test("formatTime 800 ms = 00:00", () => {
  assert.strictEqual(formatTime(800), "00:00");
});

// ===========================================================================
// 4. Screenshot encoding
// ===========================================================================
console.log("\n--- Screenshot encoding ---");

test("encodeScreenshot returns null for missing file", () => {
  assert.strictEqual(encodeScreenshot("/nonexistent/file.jpg"), null);
});

test("encodeScreenshot returns null for null path", () => {
  assert.strictEqual(encodeScreenshot(null), null);
});

test("encodeScreenshot returns null for empty string", () => {
  assert.strictEqual(encodeScreenshot(""), null);
});

// ===========================================================================
// 5. Full export -- structure
// ===========================================================================
console.log("\n--- Full export structure ---");

test("exportSession returns valid HTML document", () => {
  var html = exportSession(sessionData);
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("</html>"));
});

test("exportSession embeds inline CSS", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("<style>"));
  assert.ok(html.includes("box-sizing: border-box"));
  // No external stylesheet references
  assert.ok(!html.includes('<link rel="stylesheet"'));
});

test("exportSession contains no external dependencies", () => {
  var html = exportSession(sessionData);
  assert.ok(!html.includes('<link rel="stylesheet"'));
  assert.ok(!html.includes('<script src='));
});

// ===========================================================================
// 6. Full export -- visitor info
// ===========================================================================
console.log("\n--- Visitor info ---");

test("export contains visitor name", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("Sarah Chen"));
});

test("export contains visitor title", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("VP of Information Security"));
});

test("export contains visitor company", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("Acme Financial Corp"));
});

test("export contains visitor email", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("schen@acmefin.example.com"));
});

test("export contains industry", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("Financial Services"));
});

// ===========================================================================
// 7. Full export -- timeline
// ===========================================================================
console.log("\n--- Timeline ---");

test("export contains timeline section", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("Timeline"));
});

test("export contains click URLs in timeline", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("portal.example.com/dashboard"));
});

test("export contains speech text in timeline", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("XDR platform"));
});

// ===========================================================================
// 8. Full export -- transcript
// ===========================================================================
console.log("\n--- Transcript ---");

test("export contains transcript section", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("Full Transcript"));
});

test("export contains all transcript segments", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("consolidates alerts"));
  assert.ok(html.includes("unified incident view"));
  assert.ok(html.includes("correlated from three different sources"));
  assert.ok(html.includes("BEC detection engine"));
});

// ===========================================================================
// 9. Full export -- analysis summary
// ===========================================================================
console.log("\n--- Analysis summary ---");

test("export contains products section", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("Products Demonstrated"));
});

test("export contains all product names", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("Vision One XDR"));
  assert.ok(html.includes("Container Protection"));
  assert.ok(html.includes("Zero Trust Secure Access"));
  assert.ok(html.includes("Email Security"));
});

test("export contains interest scores", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("Interest Scores"));
  assert.ok(html.includes("XDR / SOC Modernization"));
  assert.ok(html.includes("HIGH"));
  assert.ok(html.includes("MEDIUM"));
  assert.ok(html.includes("LOW"));
});

// ===========================================================================
// 10. Full export -- recommendations
// ===========================================================================
console.log("\n--- Recommendations ---");

test("export contains recommendations section", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("Follow-Up Recommendations"));
});

test("export contains all recommendation actions", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("Schedule technical deep-dive"));
  assert.ok(html.includes("container protection datasheet"));
  assert.ok(html.includes("proof-of-concept"));
  assert.ok(html.includes("BEC case study"));
  assert.ok(html.includes("consolidated proposal"));
  assert.ok(html.includes("webinar invite"));
});

test("export contains checkboxes for recommendations", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes('type="checkbox"'));
});

// ===========================================================================
// 11. Edge cases
// ===========================================================================
console.log("\n--- Edge cases ---");

test("export with empty data produces valid HTML", () => {
  var html = exportSession({});
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("</html>"));
});

test("export with minimal visitor", () => {
  var html = exportSession({ visitor: { name: "Test" } });
  assert.ok(html.includes("Test"));
});

test("export with string recommendations", () => {
  var html = exportSession({ recommendations: ["Do thing A", "Do thing B"] });
  assert.ok(html.includes("Do thing A"));
  assert.ok(html.includes("Do thing B"));
});

test("export with empty arrays", () => {
  var html = exportSession({
    timeline: [],
    transcript: [],
    products_demonstrated: [],
    interests: [],
    recommendations: [],
  });
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  // Empty sections should be omitted
  assert.ok(!html.includes("Full Transcript"));
  assert.ok(!html.includes("Follow-Up Recommendations"));
});

test("export title uses visitor name", () => {
  var html = exportSession({ visitor: { name: "Jane Doe" } });
  assert.ok(html.includes("<title>Session Report &mdash; Jane Doe</title>"));
});

test("export XSS protection in visitor name", () => {
  var html = exportSession({ visitor: { name: '<script>alert("xss")</script>' } });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
});

// ===========================================================================
// 12. Print support
// ===========================================================================
console.log("\n--- Print support ---");

test("export includes print media query", () => {
  var html = exportSession(sessionData);
  assert.ok(html.includes("@media print"));
});

// ===========================================================================
// Summary
// ===========================================================================
console.log("\n========================================");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("========================================\n");

process.exit(failed > 0 ? 1 : 0);
