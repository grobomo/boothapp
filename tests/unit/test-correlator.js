"use strict";

const assert = require("assert");
const path = require("path");
const { correlate, matchScreenshot, DEFAULT_WINDOW_MS } = require("../../analysis/lib/correlator");

// ---------------------------------------------------------------------------
// Load fixtures
// ---------------------------------------------------------------------------
const fixturesDir = path.join(__dirname, "..", "fixtures");
const sampleClicks = require(path.join(fixturesDir, "clicks.json"));
const sampleTranscript = require(path.join(fixturesDir, "transcript.json"));
const sampleScreenshots = require(path.join(fixturesDir, "screenshots.json"));

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
// 1. Empty inputs
// ===========================================================================
console.log("\n--- Empty inputs ---");

test("empty clicks + empty transcript = empty timeline", () => {
  const result = correlate({ clicks: [], transcript: [] });
  assert.deepStrictEqual(result, []);
});

test("no arguments = empty timeline", () => {
  const result = correlate();
  assert.deepStrictEqual(result, []);
});

test("empty object = empty timeline", () => {
  const result = correlate({});
  assert.deepStrictEqual(result, []);
});

test("undefined clicks and transcript = empty timeline", () => {
  const result = correlate({ clicks: undefined, transcript: undefined });
  assert.deepStrictEqual(result, []);
});

// ===========================================================================
// 2. Clicks only
// ===========================================================================
console.log("\n--- Clicks only ---");

test("clicks only produces click events in timeline", () => {
  const result = correlate({ clicks: sampleClicks });
  assert.strictEqual(result.length, sampleClicks.length);
  result.forEach((entry) => assert.strictEqual(entry.type, "click"));
});

test("click events preserve timestamp", () => {
  const result = correlate({ clicks: sampleClicks });
  assert.strictEqual(result[0].timestamp, 1000);
  assert.strictEqual(result[1].timestamp, 5000);
});

test("click events preserve url and element", () => {
  const result = correlate({ clicks: sampleClicks });
  assert.strictEqual(result[0].url, "https://portal.example.com/dashboard");
  assert.strictEqual(result[0].element, "button#start-demo");
});

test("click events preserve coordinates", () => {
  const result = correlate({ clicks: sampleClicks });
  assert.strictEqual(result[0].x, 540);
  assert.strictEqual(result[0].y, 320);
});

test("clicks are sorted by timestamp", () => {
  const unsorted = [
    { timestamp: 5000, x: 0, y: 0 },
    { timestamp: 1000, x: 0, y: 0 },
    { timestamp: 3000, x: 0, y: 0 },
  ];
  const result = correlate({ clicks: unsorted });
  assert.deepStrictEqual(
    result.map((e) => e.timestamp),
    [1000, 3000, 5000]
  );
});

test("single click produces single-element timeline", () => {
  const result = correlate({ clicks: [{ timestamp: 42, x: 10, y: 20 }] });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, "click");
  assert.strictEqual(result[0].timestamp, 42);
});

// ===========================================================================
// 3. Transcript only
// ===========================================================================
console.log("\n--- Transcript only ---");

test("transcript only produces speech events in timeline", () => {
  const result = correlate({ transcript: sampleTranscript });
  assert.strictEqual(result.length, sampleTranscript.length);
  result.forEach((entry) => assert.strictEqual(entry.type, "speech"));
});

test("speech events use start as timestamp", () => {
  const result = correlate({ transcript: sampleTranscript });
  assert.strictEqual(result[0].timestamp, 800);
});

test("speech events preserve end time", () => {
  const result = correlate({ transcript: sampleTranscript });
  assert.strictEqual(result[0].end, 3500);
});

test("speech events preserve text", () => {
  const result = correlate({ transcript: sampleTranscript });
  assert.ok(result[0].text.includes("XDR platform"));
});

test("transcript segments are sorted by start time", () => {
  const unsorted = [
    { start: 5000, end: 6000, text: "second" },
    { start: 1000, end: 2000, text: "first" },
  ];
  const result = correlate({ transcript: unsorted });
  assert.strictEqual(result[0].text, "first");
  assert.strictEqual(result[1].text, "second");
});

test("single transcript segment produces single-element timeline", () => {
  const result = correlate({ transcript: [{ start: 100, end: 200, text: "hi" }] });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, "speech");
});

// ===========================================================================
// 4. Both inputs -- merged sorted timeline
// ===========================================================================
console.log("\n--- Merged timeline ---");

test("both inputs are merged into single timeline", () => {
  const result = correlate({ clicks: sampleClicks, transcript: sampleTranscript });
  assert.strictEqual(result.length, sampleClicks.length + sampleTranscript.length);
});

test("merged timeline is sorted by timestamp", () => {
  const result = correlate({ clicks: sampleClicks, transcript: sampleTranscript });
  for (let i = 1; i < result.length; i++) {
    assert.ok(
      result[i].timestamp >= result[i - 1].timestamp,
      `timestamp at index ${i} (${result[i].timestamp}) should be >= index ${i - 1} (${result[i - 1].timestamp})`
    );
  }
});

test("merged timeline contains both click and speech types", () => {
  const result = correlate({ clicks: sampleClicks, transcript: sampleTranscript });
  const types = new Set(result.map((e) => e.type));
  assert.ok(types.has("click"));
  assert.ok(types.has("speech"));
});

test("speech at 800ms comes before click at 1000ms", () => {
  const result = correlate({ clicks: sampleClicks, transcript: sampleTranscript });
  assert.strictEqual(result[0].type, "speech");
  assert.strictEqual(result[0].timestamp, 800);
  assert.strictEqual(result[1].type, "click");
  assert.strictEqual(result[1].timestamp, 1000);
});

test("interleaved events maintain correct order", () => {
  const clicks = [
    { timestamp: 2000, x: 0, y: 0 },
    { timestamp: 6000, x: 0, y: 0 },
  ];
  const transcript = [
    { start: 1000, end: 3000, text: "first" },
    { start: 4000, end: 5000, text: "second" },
  ];
  const result = correlate({ clicks, transcript });
  assert.deepStrictEqual(
    result.map((e) => e.timestamp),
    [1000, 2000, 4000, 6000]
  );
  assert.deepStrictEqual(
    result.map((e) => e.type),
    ["speech", "click", "speech", "click"]
  );
});

// ===========================================================================
// 5. Overlapping timestamps
// ===========================================================================
console.log("\n--- Overlapping timestamps ---");

test("identical timestamps are both included", () => {
  const clicks = [{ timestamp: 5000, x: 0, y: 0 }];
  const transcript = [{ start: 5000, end: 6000, text: "same time" }];
  const result = correlate({ clicks, transcript });
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].timestamp, 5000);
  assert.strictEqual(result[1].timestamp, 5000);
});

test("multiple clicks at same timestamp preserved", () => {
  const clicks = [
    { timestamp: 1000, x: 10, y: 20 },
    { timestamp: 1000, x: 30, y: 40 },
  ];
  const result = correlate({ clicks });
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].timestamp, 1000);
  assert.strictEqual(result[1].timestamp, 1000);
});

test("overlapping speech segments both appear", () => {
  const transcript = [
    { start: 1000, end: 5000, text: "long segment" },
    { start: 2000, end: 3000, text: "overlapping" },
  ];
  const result = correlate({ transcript });
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].timestamp, 1000);
  assert.strictEqual(result[1].timestamp, 2000);
});

test("click during speech segment appears between speech events", () => {
  const clicks = [{ timestamp: 2500, x: 0, y: 0 }];
  const transcript = [
    { start: 1000, end: 4000, text: "speaking" },
    { start: 5000, end: 6000, text: "later" },
  ];
  const result = correlate({ clicks, transcript });
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].type, "speech");
  assert.strictEqual(result[1].type, "click");
  assert.strictEqual(result[2].type, "speech");
});

test("zero timestamp handled correctly", () => {
  const clicks = [{ timestamp: 0, x: 0, y: 0 }];
  const transcript = [{ start: 0, end: 100, text: "start" }];
  const result = correlate({ clicks, transcript });
  assert.strictEqual(result.length, 2);
  assert.ok(result.every((e) => e.timestamp === 0));
});

// ===========================================================================
// 6. Screenshots referenced in click events
// ===========================================================================
console.log("\n--- Screenshot correlation ---");

test("screenshots are matched to click events within window", () => {
  const result = correlate({
    clicks: sampleClicks,
    screenshots: sampleScreenshots,
  });
  const clickEvents = result.filter((e) => e.type === "click");
  assert.strictEqual(clickEvents[0].screenshot, "click-001.jpg");
  assert.strictEqual(clickEvents[1].screenshot, "click-002.jpg");
  assert.strictEqual(clickEvents[2].screenshot, "click-003.jpg");
  assert.strictEqual(clickEvents[3].screenshot, "click-004.jpg");
});

test("screenshot not attached when outside window", () => {
  const clicks = [{ timestamp: 1000, x: 0, y: 0 }];
  const screenshots = { "far-away.jpg": 9000 };
  const result = correlate({ clicks, screenshots });
  assert.strictEqual(result[0].screenshot, undefined);
});

test("closest screenshot wins when multiple are in window", () => {
  const clicks = [{ timestamp: 5000, x: 0, y: 0 }];
  const screenshots = {
    "far.jpg": 3500,   // 1500ms away
    "close.jpg": 5100, // 100ms away
    "mid.jpg": 4000,   // 1000ms away
  };
  const result = correlate({ clicks, screenshots });
  assert.strictEqual(result[0].screenshot, "close.jpg");
});

test("screenshot at exact click timestamp is matched", () => {
  const clicks = [{ timestamp: 3000, x: 0, y: 0 }];
  const screenshots = { "exact.jpg": 3000 };
  const result = correlate({ clicks, screenshots });
  assert.strictEqual(result[0].screenshot, "exact.jpg");
});

test("speech events do not get screenshots", () => {
  const result = correlate({
    transcript: sampleTranscript,
    screenshots: sampleScreenshots,
  });
  result.forEach((entry) => {
    assert.strictEqual(entry.screenshot, undefined);
  });
});

test("empty screenshots object = no screenshot fields", () => {
  const result = correlate({ clicks: sampleClicks, screenshots: {} });
  result.forEach((entry) => {
    assert.strictEqual(entry.screenshot, undefined);
  });
});

test("null screenshots = no screenshot fields", () => {
  const result = correlate({ clicks: sampleClicks, screenshots: null });
  result.forEach((entry) => {
    assert.strictEqual(entry.screenshot, undefined);
  });
});

test("custom window size respected", () => {
  const clicks = [{ timestamp: 1000, x: 0, y: 0 }];
  const screenshots = { "nearby.jpg": 1400 }; // 400ms away
  // Default 2000ms window -> match
  const r1 = correlate({ clicks, screenshots });
  assert.strictEqual(r1[0].screenshot, "nearby.jpg");
  // Tight 100ms window -> no match
  const r2 = correlate({ clicks, screenshots, windowMs: 100 });
  assert.strictEqual(r2[0].screenshot, undefined);
});

// ===========================================================================
// matchScreenshot unit tests
// ===========================================================================
console.log("\n--- matchScreenshot helper ---");

test("matchScreenshot returns null for empty object", () => {
  assert.strictEqual(matchScreenshot(1000, {}, 2000), null);
});

test("matchScreenshot returns null for null", () => {
  assert.strictEqual(matchScreenshot(1000, null, 2000), null);
});

test("matchScreenshot returns null for undefined", () => {
  assert.strictEqual(matchScreenshot(1000, undefined, 2000), null);
});

test("matchScreenshot picks closest within window", () => {
  const shots = { "a.jpg": 900, "b.jpg": 1050 };
  assert.strictEqual(matchScreenshot(1000, shots, 2000), "b.jpg");
});

test("DEFAULT_WINDOW_MS is 2000", () => {
  assert.strictEqual(DEFAULT_WINDOW_MS, 2000);
});

// ===========================================================================
// Full integration with fixtures
// ===========================================================================
console.log("\n--- Full fixture integration ---");

test("full fixture merge produces correct count", () => {
  const result = correlate({
    clicks: sampleClicks,
    transcript: sampleTranscript,
    screenshots: sampleScreenshots,
  });
  assert.strictEqual(result.length, 8); // 4 clicks + 4 transcript
});

test("full fixture merge is time-sorted", () => {
  const result = correlate({
    clicks: sampleClicks,
    transcript: sampleTranscript,
    screenshots: sampleScreenshots,
  });
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i].timestamp >= result[i - 1].timestamp);
  }
});

test("full fixture merge has all screenshots attached", () => {
  const result = correlate({
    clicks: sampleClicks,
    transcript: sampleTranscript,
    screenshots: sampleScreenshots,
  });
  const withScreenshots = result.filter((e) => e.screenshot);
  assert.strictEqual(withScreenshots.length, 4);
});

// ===========================================================================
// Summary
// ===========================================================================
console.log("\n========================================");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("========================================\n");

process.exit(failed > 0 ? 1 : 0);
