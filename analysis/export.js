"use strict";

/**
 * Session Export -- packages all session data into a self-contained HTML file
 * suitable for email sharing.
 *
 * Embeds: visitor info, timeline with base64 screenshots, full transcript,
 * analysis summary with products and scores, follow-up recommendations.
 * All CSS is inline -- zero external dependencies.
 *
 * CLI:  node analysis/export.js <session-id>
 *       -> writes to output/report-standalone.html
 *
 * API:  const { exportSession } = require("./analysis/export");
 *       const html = exportSession(sessionData);
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Brand palette (matches report_template.py)
// ---------------------------------------------------------------------------
var BRAND = {
  red: "#D71920",
  dark: "#1A1A2E",
  darker: "#12121F",
  accent: "#E63946",
  green: "#2D936C",
  yellow: "#E9C46A",
  redBadge: "#E63946",
  lightBg: "#F8F9FA",
  cardBg: "#FFFFFF",
  text: "#2D3436",
  textMuted: "#636E72",
  border: "#DFE6E9",
};

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------
function esc(val) {
  if (val == null) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Confidence badge colors
// ---------------------------------------------------------------------------
var CONFIDENCE = {
  high:   { bg: BRAND.green,    fg: "#FFFFFF", label: "HIGH" },
  medium: { bg: BRAND.yellow,   fg: "#1A1A2E", label: "MEDIUM" },
  low:    { bg: BRAND.redBadge, fg: "#FFFFFF", label: "LOW" },
};

function badge(level) {
  var key = (level || "medium").toLowerCase().trim();
  var c = CONFIDENCE[key] || { bg: "#B2BEC3", fg: "#2D3436", label: key.toUpperCase() };
  return '<span style="display:inline-block;padding:2px 10px;border-radius:12px;' +
    "font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;" +
    "background:" + c.bg + ";color:" + c.fg + ';">' + esc(c.label) + "</span>";
}

// ---------------------------------------------------------------------------
// Screenshot encoding
// ---------------------------------------------------------------------------
function encodeScreenshot(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  var ext = path.extname(filePath).toLowerCase().replace(".", "");
  var mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
  var buf = fs.readFileSync(filePath);
  return "data:" + mime + ";base64," + buf.toString("base64");
}

// ---------------------------------------------------------------------------
// Format milliseconds as mm:ss
// ---------------------------------------------------------------------------
function formatTime(ms) {
  if (ms == null) return "";
  var totalSec = Math.floor(ms / 1000);
  var min = Math.floor(totalSec / 60);
  var sec = totalSec % 60;
  return String(min).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Inline CSS
// ---------------------------------------------------------------------------
var CSS = [
  "*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }",
  "body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;",
  "  background: " + BRAND.lightBg + "; color: " + BRAND.text + "; line-height: 1.6; }",
  ".header { background: linear-gradient(135deg, " + BRAND.dark + " 0%, " + BRAND.darker + " 100%);",
  "  color: #FFF; padding: 32px 48px; display: flex; align-items: center; justify-content: space-between; }",
  ".header .logo { width: 48px; height: 48px; background: " + BRAND.red + "; border-radius: 8px;",
  "  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 22px; color: #FFF; }",
  ".header .brand { display: flex; align-items: center; gap: 16px; }",
  ".header h1 { font-size: 22px; font-weight: 600; }",
  ".header h1 .accent { color: " + BRAND.red + "; }",
  ".header .meta { text-align: right; font-size: 13px; opacity: 0.85; }",
  ".header .rid { font-family: Consolas, 'Courier New', monospace; font-size: 12px; opacity: 0.7; }",
  ".wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }",
  ".stitle { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px;",
  "  color: " + BRAND.textMuted + "; margin: 32px 0 16px; padding-bottom: 8px;",
  "  border-bottom: 2px solid " + BRAND.border + "; }",
  ".card { background: " + BRAND.cardBg + "; border: 1px solid " + BRAND.border + ";",
  "  border-radius: 10px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }",
  ".kv { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; }",
  ".kv .k { font-size: 13px; font-weight: 600; color: " + BRAND.textMuted + "; text-transform: uppercase; letter-spacing: 0.5px; }",
  ".kv .v { font-size: 15px; }",
  ".tl { position: relative; padding-left: 32px; }",
  ".tl::before { content: ''; position: absolute; left: 11px; top: 4px; bottom: 4px; width: 2px;",
  "  background: " + BRAND.border + "; }",
  ".tl-item { position: relative; padding: 12px 0; }",
  ".tl-item::before { content: ''; position: absolute; left: -25px; top: 18px; width: 12px; height: 12px;",
  "  border-radius: 50%; background: " + BRAND.red + "; border: 2px solid #FFF;",
  "  box-shadow: 0 0 0 2px " + BRAND.border + "; }",
  ".tl-item .time { font-family: Consolas, 'Courier New', monospace; font-size: 12px; color: " + BRAND.textMuted + "; }",
  ".tl-item .prod { font-weight: 600; font-size: 15px; margin-top: 2px; }",
  ".tl-item .note { font-size: 13px; color: " + BRAND.textMuted + "; margin-top: 2px; }",
  ".tl-item .shot { max-width: 100%; border-radius: 6px; margin-top: 8px; border: 1px solid " + BRAND.border + "; }",
  ".int-item { display: flex; align-items: center; gap: 12px; padding: 12px 0;",
  "  border-bottom: 1px solid " + BRAND.border + "; }",
  ".int-item:last-child { border-bottom: none; }",
  ".int-item .name { font-weight: 600; min-width: 180px; }",
  ".int-item .detail { color: " + BRAND.textMuted + "; font-size: 14px; flex: 1; }",
  ".tr-seg { padding: 10px 0; border-bottom: 1px solid " + BRAND.border + "; }",
  ".tr-seg:last-child { border-bottom: none; }",
  ".tr-seg .ts { font-family: Consolas, 'Courier New', monospace; font-size: 12px; color: " + BRAND.textMuted + ";",
  "  margin-right: 12px; }",
  ".tr-seg .txt { font-size: 15px; }",
  ".act-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0;",
  "  border-bottom: 1px solid " + BRAND.border + "; }",
  ".act-item:last-child { border-bottom: none; }",
  ".act-item input[type=checkbox] { margin-top: 4px; width: 16px; height: 16px; accent-color: " + BRAND.red + "; }",
  ".act-item .atxt { font-size: 15px; }",
  ".act-item .apri { margin-left: auto; flex-shrink: 0; }",
  ".footer { text-align: center; padding: 24px; font-size: 12px; color: " + BRAND.textMuted + ";",
  "  border-top: 1px solid " + BRAND.border + "; margin-top: 40px; }",
  "@media print { body { background: #FFF; } .wrap { max-width: 100%; padding: 0 16px; }",
  "  .header { padding: 20px 24px; } .card { box-shadow: none; break-inside: avoid; }",
  "  .stitle { break-after: avoid; } .no-print { display: none; } }",
].join("\n");

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderHeader(data) {
  var v = data.visitor || {};
  var name = v.name || "Visitor";
  var rid = data.report_id || data.session_id || "";
  var gen = data.generated_at || new Date().toISOString().replace("T", " ").slice(0, 16);
  return '<div class="header">' +
    '<div class="brand">' +
    '<div class="logo">V1</div>' +
    "<div>" +
    '<h1>Trend Micro <span class="accent">Vision One</span></h1>' +
    '<div style="font-size:14px;opacity:0.8;">Session Export Report</div>' +
    "</div></div>" +
    '<div class="meta">' +
    '<div style="font-size:16px;font-weight:600;">' + esc(name) + "</div>" +
    "<div>" + esc(gen) + "</div>" +
    '<div class="rid">' + esc(rid) + "</div>" +
    "</div></div>";
}

function renderVisitor(data) {
  var v = data.visitor || {};
  var fields = [
    ["Name", v.name], ["Title", v.title], ["Company", v.company],
    ["Email", v.email], ["Industry", v.industry],
    ["Company Size", v.company_size], ["Visit Duration", v.visit_duration],
  ];
  var rows = "";
  for (var i = 0; i < fields.length; i++) {
    if (fields[i][1]) {
      rows += '<div class="k">' + esc(fields[i][0]) + '</div><div class="v">' + esc(fields[i][1]) + "</div>";
    }
  }
  if (!rows) return "";
  return '<div class="stitle">Visitor Information</div>' +
    '<div class="card"><div class="kv">' + rows + "</div></div>";
}

function renderTimeline(data, screenshotDir) {
  var timeline = data.timeline || [];
  if (timeline.length === 0) return "";
  var items = "";
  for (var i = 0; i < timeline.length; i++) {
    var e = timeline[i];
    var ts = e.timestamp != null ? formatTime(e.timestamp) : esc(e.time || "");
    var shotHtml = "";
    if (e.screenshot) {
      var shotPath = screenshotDir ? path.join(screenshotDir, e.screenshot) : e.screenshot;
      var dataUri = e.screenshot_base64 || encodeScreenshot(shotPath);
      if (dataUri) {
        shotHtml = '<img class="shot" src="' + dataUri + '" alt="Screenshot" />';
      }
    }
    if (e.type === "click") {
      items += '<div class="tl-item">' +
        '<div class="time">' + esc(ts) + "</div>" +
        '<div class="prod">' + esc(e.url || e.element || "Click") + "</div>" +
        (e.element ? '<div class="note">' + esc(e.element) + "</div>" : "") +
        shotHtml + "</div>";
    } else if (e.type === "speech") {
      items += '<div class="tl-item">' +
        '<div class="time">' + esc(ts) + "</div>" +
        '<div class="note">' + esc(e.text || "") + "</div>" +
        shotHtml + "</div>";
    } else {
      // Product demo entry
      items += '<div class="tl-item">' +
        '<div class="time">' + esc(ts || e.timestamp_label || "") + "</div>" +
        '<div class="prod">' + esc(e.name || e.product || "") + "</div>" +
        (e.note ? '<div class="note">' + esc(e.note) + "</div>" : "") +
        shotHtml + "</div>";
    }
  }
  return '<div class="stitle">Timeline</div>' +
    '<div class="card"><div class="tl">' + items + "</div></div>";
}

function renderTranscript(data) {
  var segments = data.transcript || [];
  if (segments.length === 0) return "";
  var items = "";
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    var ts = seg.start != null ? formatTime(seg.start) : "";
    items += '<div class="tr-seg">' +
      '<span class="ts">' + esc(ts) + "</span>" +
      '<span class="txt">' + esc(seg.text || "") + "</span>" +
      "</div>";
  }
  return '<div class="stitle">Full Transcript</div>' +
    '<div class="card">' + items + "</div>";
}

function renderAnalysis(data) {
  var products = data.products_demonstrated || [];
  var interests = data.interests || [];
  if (products.length === 0 && interests.length === 0) return "";
  var html = '<div class="stitle">Analysis Summary</div>';

  if (products.length > 0) {
    html += '<div class="card"><h3 style="font-size:16px;font-weight:600;margin-bottom:16px;color:' +
      BRAND.dark + ';">Products Demonstrated</h3><div class="tl">';
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      html += '<div class="tl-item">' +
        '<div class="time">' + esc(p.timestamp || "") + "</div>" +
        '<div class="prod">' + esc(p.name || "") + "</div>" +
        (p.note ? '<div class="note">' + esc(p.note) + "</div>" : "") +
        "</div>";
    }
    html += "</div></div>";
  }

  if (interests.length > 0) {
    html += '<div class="card"><h3 style="font-size:16px;font-weight:600;margin-bottom:16px;color:' +
      BRAND.dark + ';">Interest Scores</h3>';
    for (var j = 0; j < interests.length; j++) {
      var it = interests[j];
      html += '<div class="int-item">' +
        '<span class="name">' + esc(it.topic || "") + "</span>" +
        badge(it.confidence) +
        '<span class="detail">' + esc(it.detail || "") + "</span>" +
        "</div>";
    }
    html += "</div>";
  }

  return html;
}

function renderRecommendations(data) {
  var recs = data.recommendations || [];
  if (recs.length === 0) return "";
  var items = "";
  for (var i = 0; i < recs.length; i++) {
    var r = recs[i];
    var text = typeof r === "string" ? r : (r.action || "");
    var pri = typeof r === "string" ? "medium" : (r.priority || "medium");
    items += '<div class="act-item">' +
      '<input type="checkbox" />' +
      '<span class="atxt">' + esc(text) + "</span>" +
      '<span class="apri">' + badge(pri) + "</span>" +
      "</div>";
  }
  return '<div class="stitle">Follow-Up Recommendations</div>' +
    '<div class="card">' + items + "</div>";
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * Generate a self-contained HTML report from session data.
 *
 * @param {Object} data - Session data object containing:
 *   - session_id (string)
 *   - report_id (string, optional)
 *   - generated_at (string, optional)
 *   - visitor (object): name, title, company, email, industry, company_size, visit_duration
 *   - timeline (array): correlator output entries with type, timestamp, screenshot, etc.
 *   - transcript (array): segments with start, end, text
 *   - products_demonstrated (array): each with name, timestamp, note
 *   - interests (array): each with topic, confidence, detail
 *   - recommendations (array): each with action, priority (or plain strings)
 * @param {Object} [opts]
 *   - screenshotDir (string): directory containing screenshot files for base64 encoding
 * @returns {string} Complete self-contained HTML document
 */
function exportSession(data, opts) {
  opts = opts || {};
  var screenshotDir = opts.screenshotDir || null;
  var gen = data.generated_at || new Date().toISOString().replace("T", " ").slice(0, 16);
  var visitorName = (data.visitor || {}).name || "Session";

  var sections = [
    renderHeader(data),
    '<div class="wrap">',
    renderVisitor(data),
    renderTimeline(data, screenshotDir),
    renderTranscript(data),
    renderAnalysis(data),
    renderRecommendations(data),
    '<div class="footer">' +
      "Trend Micro Vision One &mdash; Session Export &mdash; Generated " + esc(gen) +
      "</div>",
    "</div>",
  ];

  return "<!DOCTYPE html>\n" +
    '<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8"/>\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>\n' +
    "<title>Session Report &mdash; " + esc(visitorName) + "</title>\n" +
    "<style>" + CSS + "</style>\n" +
    "</head>\n<body>\n" +
    sections.join("\n") +
    "\n</body>\n</html>";
}

// ---------------------------------------------------------------------------
// Load session from disk (JSON file)
// ---------------------------------------------------------------------------

/**
 * Load a session JSON file and export to HTML.
 *
 * @param {string} sessionPath - Path to the session JSON file or directory
 *   If a directory, looks for session.json inside it.
 * @param {Object} [opts] - Options passed to exportSession
 * @returns {string} HTML string
 */
function exportSessionFromFile(sessionPath, opts) {
  var jsonPath = sessionPath;
  if (fs.existsSync(sessionPath) && fs.statSync(sessionPath).isDirectory()) {
    jsonPath = path.join(sessionPath, "session.json");
  }
  if (!fs.existsSync(jsonPath)) {
    throw new Error("Session file not found: " + jsonPath);
  }
  var data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

  // Auto-detect screenshot directory
  if (!opts) opts = {};
  if (!opts.screenshotDir) {
    var dir = path.dirname(jsonPath);
    var shotDir = path.join(dir, "screenshots");
    if (fs.existsSync(shotDir)) {
      opts.screenshotDir = shotDir;
    }
  }

  return exportSession(data, opts);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  var sessionId = process.argv[2];
  if (!sessionId) {
    console.error("Usage: node analysis/export.js <session-id-or-path>");
    console.error("  <session-id-or-path> can be:");
    console.error("    - Path to a session JSON file");
    console.error("    - Path to a session directory (containing session.json)");
    process.exit(1);
  }

  var html;
  if (fs.existsSync(sessionId)) {
    html = exportSessionFromFile(sessionId);
  } else {
    // Try common session locations
    var candidates = [
      path.join("sessions", sessionId, "session.json"),
      path.join("sessions", sessionId + ".json"),
      sessionId + ".json",
    ];
    var found = null;
    for (var i = 0; i < candidates.length; i++) {
      if (fs.existsSync(candidates[i])) {
        found = candidates[i];
        break;
      }
    }
    if (!found) {
      console.error("Session not found: " + sessionId);
      console.error("Searched: " + candidates.join(", "));
      process.exit(1);
    }
    html = exportSessionFromFile(found);
  }

  var outDir = path.join(process.cwd(), "output");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  var outPath = path.join(outDir, "report-standalone.html");
  fs.writeFileSync(outPath, html, "utf-8");
  console.log("Report written to " + outPath + " (" + html.length.toLocaleString() + " bytes)");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

module.exports = { exportSession, exportSessionFromFile, esc, badge, formatTime, encodeScreenshot };
