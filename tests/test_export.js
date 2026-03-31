#!/usr/bin/env node
/**
 * Tests for analysis/export.js -- validates sample HTML output.
 *
 * Run: node tests/test_export.js
 */

import { execSync } from "child_process";
import { readFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUTPUT = join(ROOT, "output", "export.html");

let html = "";
let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}`);
  }
}

function assertContains(haystack, needle, name) {
  assert(haystack.includes(needle), `${name} -- expected to contain "${needle}"`);
}

function assertNotContains(haystack, needle, name) {
  assert(!haystack.includes(needle), `${name} -- expected NOT to contain "${needle}"`);
}

// -- Generate sample output ------------------------------------------------

console.log("Generating sample export...");
try {
  execSync("node analysis/export.js --sample", { cwd: ROOT, stdio: "pipe" });
  html = readFileSync(OUTPUT, "utf-8");
} catch (err) {
  console.error("Failed to generate sample export:", err.message);
  process.exit(1);
}

// -- Structural checks -----------------------------------------------------

console.log("Running tests...");

assertContains(html, "<!DOCTYPE html>", "valid HTML doctype");
assertContains(html, "<html", "html tag");
assertContains(html, "</html>", "closing html tag");
assertContains(html, "<head>", "head tag");
assertContains(html, "<body>", "body tag");
assertContains(html, "<style>", "embedded style block");

// -- No external dependencies ----------------------------------------------

const httpRefs = (html.match(/https?:\/\//g) || [])
  .filter(m => !html.includes("xmlns")); // SVG xmlns is OK
// Only xmlns refs should exist
assert(
  !html.match(/https?:\/\/(?!www\.w3\.org)/),
  "no external HTTP dependencies"
);

// -- Branding --------------------------------------------------------------

assertContains(html, "Trend Micro", "brand name present");
assertContains(html, "Vision One", "product name present");
assertContains(html, "#1A1A2E", "dark brand color");
assertContains(html, "linear-gradient", "header gradient");

// -- Visitor info ----------------------------------------------------------

assertContains(html, "Sarah Chen", "visitor name");
assertContains(html, "VP of Information Security", "visitor title");
assertContains(html, "Acme Financial Corp", "visitor company");
assertContains(html, "Financial Services", "visitor industry");
assertContains(html, "28 minutes", "visit duration");

// -- Engagement score ------------------------------------------------------

assertContains(html, "8.2", "engagement score value");
assertContains(html, "Engagement Score", "engagement label");
assertContains(html, "gauge", "gauge element");
assertContains(html, "gaugeGrad", "gauge gradient");

// -- Summary ---------------------------------------------------------------

assertContains(html, "Summary", "summary section title");
assertContains(html, "High-engagement visit", "summary text");

// -- Products timeline -----------------------------------------------------

assertContains(html, "Products Demonstrated", "products section");
assertContains(html, "Vision One XDR", "product name");
assertContains(html, "14:02", "product timestamp");
assertContains(html, "SOC integration", "product note");

// -- Interests -------------------------------------------------------------

assertContains(html, "Visitor Interests", "interests section");
assertContains(html, "XDR / SOC Modernization", "interest topic");
assertContains(html, "HIGH", "high confidence badge");
assertContains(html, "MEDIUM", "medium confidence badge");

// -- Screenshots -----------------------------------------------------------

assertContains(html, "Screenshots", "screenshots section");
assertContains(html, "data:image/png;base64,", "base64 data URI");
assertContains(html, "xdr-dashboard.png", "screenshot filename");
assert((html.match(/data:image/g) || []).length >= 2, "at least 2 embedded images");

// -- Follow-up actions -----------------------------------------------------

assertContains(html, "Follow-Up Actions", "actions section");
assertContains(html, 'type="checkbox"', "action checkboxes");
assertContains(html, "Schedule technical deep-dive", "action text");

// -- Export button ---------------------------------------------------------

assertContains(html, "Print / Export", "export button text");
assertContains(html, "window.print()", "print onclick handler");

// -- Print styles ----------------------------------------------------------

assertContains(html, "@media print", "print media query");
assertContains(html, "break-inside: avoid", "print break-inside");
assertContains(html, "display: none", "export button hidden in print");

// -- Footer ----------------------------------------------------------------

assertContains(html, "report-footer", "footer class");
assertContains(html, "Session Export", "footer export label");

// -- XSS safety (spot check) ----------------------------------------------

assertNotContains(html, "<script>", "no script tags in output");

// -- Session Export badge --------------------------------------------------

assertContains(html, "Offline", "offline badge");
assertContains(html, "export-badge", "export badge class");

// -- Results ---------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
