#!/usr/bin/env node
/**
 * Session Export -- generates a single self-contained HTML file from S3 session data.
 *
 * Reads session JSON and screenshots from S3, embeds everything (including images
 * as base64 data URIs) into one offline-viewable, printable HTML file.
 *
 * Usage:
 *   node analysis/export.js <session-id>
 *   node analysis/export.js <session-id> --bucket my-bucket --prefix sessions/
 *   node analysis/export.js --sample
 *
 * Output: output/export.html
 */

import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");
const OUTPUT_FILE = join(OUTPUT_DIR, "export.html");

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

function createS3Client(region) {
  return new S3Client({ region: region || process.env.AWS_REGION || "us-east-1" });
}

async function getJSON(s3, bucket, key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await resp.Body.transformToString("utf-8");
  return JSON.parse(body);
}

async function getImageAsBase64(s3, bucket, key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await resp.Body.transformToByteArray();
  const ext = key.split(".").pop().toLowerCase();
  const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
                 gif: "image/gif", webp: "image/webp" }[ext] || "image/png";
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function listKeys(s3, bucket, prefix) {
  const keys = [];
  let token;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, ContinuationToken: token,
    }));
    for (const obj of resp.Contents || []) keys.push(obj.Key);
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// ---------------------------------------------------------------------------
// Load session from S3
// ---------------------------------------------------------------------------

async function loadSession(sessionId, bucket, prefix) {
  const s3 = createS3Client();
  const base = `${prefix}${sessionId}`;

  const session = await getJSON(s3, bucket, `${base}/session.json`);

  const allKeys = await listKeys(s3, bucket, `${base}/`);
  const imageKeys = allKeys.filter(k => /\.(png|jpe?g|gif|webp)$/i.test(k));
  const screenshots = [];
  for (const key of imageKeys) {
    const dataUri = await getImageAsBase64(s3, bucket, key);
    screenshots.push({ filename: key.split("/").pop(), dataUri });
  }

  return { session, screenshots };
}

// ---------------------------------------------------------------------------
// Sample data (matches project schema: visitor, products_demonstrated, etc.)
// ---------------------------------------------------------------------------

const SAMPLE_DATA = {
  session: {
    report_id: "RPT-2026-0331-DEMO",
    generated_at: "2026-03-31 14:22",
    session_id: "demo-001",
    event_name: "RSA Conference 2026",
    booth_number: "4201",
    engagement_score: 8.2,
    summary: "High-engagement visit from a VP of InfoSec actively evaluating XDR platforms. Strong interest in cloud workload protection and SOC automation. Currently comparing three vendors with budget allocated for Q3 2026.",
    visitor: {
      name: "Sarah Chen",
      title: "VP of Information Security",
      company: "Acme Financial Corp",
      email: "schen@acmefin.example.com",
      industry: "Financial Services",
      company_size: "5,000 - 10,000 employees",
      visit_duration: "28 minutes",
    },
    products_demonstrated: [
      { name: "Vision One XDR", timestamp: "14:02", note: "Asked about SOC integration and SIEM correlation" },
      { name: "Cloud Security - Container Protection", timestamp: "14:10", note: "Running K8s in AWS EKS, interested in runtime protection" },
      { name: "Zero Trust Secure Access", timestamp: "14:18", note: "Currently evaluating ZTNA solutions for remote workforce" },
      { name: "Email Security", timestamp: "14:24", note: "Recent BEC incidents, wants AI-powered detection" },
    ],
    interests: [
      { topic: "XDR / SOC Modernization", confidence: "high", detail: "Primary driver -- consolidating point products" },
      { topic: "Cloud Workload Security", confidence: "high", detail: "Active K8s deployment, evaluating runtime protection" },
      { topic: "Zero Trust Network Access", confidence: "medium", detail: "In evaluation phase, comparing 3 vendors" },
      { topic: "Email Threat Protection", confidence: "medium", detail: "Reactive interest after recent BEC incident" },
    ],
    recommendations: [
      { action: "Schedule technical deep-dive on Vision One XDR with SOC team", priority: "high" },
      { action: "Send Cloud Security container protection datasheet and pricing", priority: "high" },
      { action: "Connect with ZTNA SE for proof-of-concept discussion", priority: "medium" },
      { action: "Share BEC case study and Email Security ROI calculator", priority: "medium" },
      { action: "Follow up in 2 weeks with consolidated proposal", priority: "high" },
      { action: "Add to Vision One webinar invite list for April", priority: "low" },
    ],
  },
  screenshots: [
    { filename: "xdr-dashboard.png", dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==" },
    { filename: "endpoint-inventory.png", dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
  ],
};

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                     .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const BRAND = {
  red: "#D71920", dark: "#1A1A2E", darker: "#12121F", accent: "#E63946",
  green: "#2D936C", yellow: "#E9C46A", red_badge: "#E63946",
  light_bg: "#F8F9FA", card_bg: "#FFFFFF", text: "#2D3436",
  text_muted: "#636E72", border: "#DFE6E9",
};

const CONFIDENCE = {
  high:   { bg: BRAND.green,     fg: "#FFFFFF", label: "HIGH" },
  medium: { bg: BRAND.yellow,    fg: "#1A1A2E", label: "MEDIUM" },
  low:    { bg: BRAND.red_badge, fg: "#FFFFFF", label: "LOW" },
};

function badge(level) {
  const c = CONFIDENCE[(level || "medium").toLowerCase()] || CONFIDENCE.medium;
  return `<span class="badge" style="background:${c.bg};color:${c.fg};">${c.label}</span>`;
}

function gaugeColor(score) {
  if (score >= 7) return BRAND.green;
  if (score >= 4) return BRAND.yellow;
  return BRAND.red;
}

function buildHtml({ session: s, screenshots }) {
  const score = parseFloat(s.engagement_score) || 0;
  const pct = Math.round((score / 10) * 100);
  const arcLen = 172.8;
  const dashOffset = arcLen - (arcLen * pct / 100);
  const gColor = gaugeColor(score);
  const v = s.visitor || {};
  const now = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  // -- visitor info rows
  const kvFields = [
    ["Name", v.name], ["Title", v.title], ["Company", v.company],
    ["Email", v.email], ["Industry", v.industry],
    ["Company Size", v.company_size], ["Duration", v.visit_duration],
  ];
  const kvRows = kvFields
    .filter(([, val]) => val)
    .map(([label, val]) => `<div class="label">${esc(label)}</div><div class="value">${esc(val)}</div>`)
    .join("\n            ");

  // -- products timeline
  const productItems = (s.products_demonstrated || []).map(p => `
          <div class="timeline-item">
            <div class="time">${esc(p.timestamp)}</div>
            <div class="product">${esc(p.name)}</div>
            ${p.note ? `<div class="note">${esc(p.note)}</div>` : ""}
          </div>`).join("");

  // -- interests
  const interestItems = (s.interests || []).map(i => `
          <div class="interest-item">
            <span class="name">${esc(i.topic)}</span>
            ${badge(i.confidence)}
            <span class="detail">${esc(i.detail)}</span>
          </div>`).join("");

  // -- recommendations
  const recItems = (s.recommendations || []).map(r => {
    const text = typeof r === "string" ? r : r.action;
    const pri = typeof r === "string" ? "medium" : (r.priority || "medium");
    return `
          <div class="action-item">
            <input type="checkbox" />
            <span class="action-text">${esc(text)}</span>
            <span class="action-priority">${badge(pri)}</span>
          </div>`;
  }).join("");

  // -- screenshots gallery
  const screenshotHtml = screenshots.length > 0 ? `
      <div class="section-title">Screenshots</div>
      <div class="card">
        <div class="screenshots-grid">
          ${screenshots.map(sc => `
          <div class="screenshot-card">
            <img src="${sc.dataUri}" alt="${esc(sc.filename)}" class="screenshot-img">
            <div class="screenshot-label">${esc(sc.filename)}</div>
          </div>`).join("")}
        </div>
      </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session Export - ${esc(v.name || s.session_id || "Unknown")}</title>
<style>
/* ---------- reset & base ---------- */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
  background: ${BRAND.light_bg}; color: ${BRAND.text}; line-height: 1.6;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
/* ---------- header ---------- */
.report-header {
  background: linear-gradient(135deg, ${BRAND.dark} 0%, ${BRAND.darker} 100%);
  color: #FFFFFF; padding: 32px 48px; display: flex; align-items: center; justify-content: space-between;
}
.report-header .brand { display: flex; align-items: center; gap: 16px; }
.report-header .brand .logo {
  width: 48px; height: 48px; background: ${BRAND.red}; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 22px; color: #FFF;
}
.report-header .brand h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.3px; }
.report-header .brand h1 span { color: ${BRAND.red}; }
.report-header .meta { text-align: right; font-size: 13px; opacity: 0.85; }
.report-header .meta .report-id { font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; opacity: 0.7; }
.export-badge { display: inline-block; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3);
  border-radius: 4px; padding: 2px 10px; font-size: 11px; margin-left: 8px; }
/* ---------- container ---------- */
.container { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
/* ---------- section title ---------- */
.section-title {
  font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px;
  color: ${BRAND.text_muted}; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 2px solid ${BRAND.border};
}
/* ---------- card ---------- */
.card {
  background: ${BRAND.card_bg}; border: 1px solid ${BRAND.border}; border-radius: 10px;
  padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.card h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: ${BRAND.dark}; }
/* ---------- kv grid ---------- */
.kv-grid { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; }
.kv-grid .label { font-size: 13px; font-weight: 600; color: ${BRAND.text_muted}; text-transform: uppercase; letter-spacing: 0.5px; }
.kv-grid .value { font-size: 15px; }
/* ---------- badge ---------- */
.badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px;
  font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; vertical-align: middle; }
/* ---------- engagement gauge ---------- */
.gauge-wrapper { text-align: center; }
.gauge { position: relative; width: 140px; height: 80px; overflow: hidden; margin: 0 auto; }
.gauge svg { width: 140px; height: 140px; }
.gauge-bg { fill: none; stroke: #E5E7EB; stroke-width: 14; }
.gauge-fill { fill: none; stroke-width: 14; stroke-linecap: round; }
.gauge-score { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%);
  font-size: 28px; font-weight: 800; line-height: 1; }
.gauge-label { font-size: 12px; color: ${BRAND.text_muted}; margin-top: 2px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.5px; }
/* ---------- interest list ---------- */
.interest-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid ${BRAND.border}; }
.interest-item:last-child { border-bottom: none; }
.interest-item .name { font-weight: 600; min-width: 180px; }
.interest-item .detail { color: ${BRAND.text_muted}; font-size: 14px; flex: 1; }
/* ---------- timeline ---------- */
.timeline { position: relative; padding-left: 32px; }
.timeline::before { content: ''; position: absolute; left: 11px; top: 4px; bottom: 4px; width: 2px; background: ${BRAND.border}; }
.timeline-item { position: relative; padding: 12px 0; }
.timeline-item::before { content: ''; position: absolute; left: -25px; top: 18px; width: 12px; height: 12px;
  border-radius: 50%; background: ${BRAND.red}; border: 2px solid #FFFFFF; box-shadow: 0 0 0 2px ${BRAND.border}; }
.timeline-item .time { font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; color: ${BRAND.text_muted}; }
.timeline-item .product { font-weight: 600; font-size: 15px; margin-top: 2px; }
.timeline-item .note { font-size: 13px; color: ${BRAND.text_muted}; margin-top: 2px; }
/* ---------- actions ---------- */
.action-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid ${BRAND.border}; }
.action-item:last-child { border-bottom: none; }
.action-item input[type="checkbox"] { margin-top: 4px; width: 16px; height: 16px; accent-color: ${BRAND.red}; }
.action-item .action-text { font-size: 15px; }
.action-item .action-priority { margin-left: auto; flex-shrink: 0; }
/* ---------- summary ---------- */
.summary-text { font-size: 15px; line-height: 1.7; color: ${BRAND.text}; }
/* ---------- screenshots ---------- */
.screenshots-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.screenshot-card { border: 1px solid ${BRAND.border}; border-radius: 6px; overflow: hidden; background: ${BRAND.light_bg}; }
.screenshot-img { width: 100%; height: auto; display: block; }
.screenshot-label { padding: 8px 12px; font-size: 12px; color: ${BRAND.text_muted}; text-align: center; font-family: monospace; }
/* ---------- export button ---------- */
.export-btn {
  display: inline-flex; align-items: center; padding: 10px 28px; border: 2px solid ${BRAND.dark};
  border-radius: 6px; background: #FFF; color: ${BRAND.dark}; font-size: 14px; font-weight: 600; cursor: pointer;
}
.export-btn:hover { background: ${BRAND.dark}; color: #FFF; }
/* ---------- footer ---------- */
.report-footer { text-align: center; padding: 24px; font-size: 12px; color: ${BRAND.text_muted};
  border-top: 1px solid ${BRAND.border}; margin-top: 40px; }
/* ---------- print ---------- */
@media print {
  body { background: #FFF; }
  .container { max-width: 100%; padding: 0 16px; }
  .report-header { padding: 20px 24px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .card { box-shadow: none; break-inside: avoid; }
  .section-title { break-after: avoid; }
  .screenshots-grid { grid-template-columns: repeat(2, 1fr); }
  .screenshot-card { break-inside: avoid; }
  .export-btn { display: none; }
  .action-item input[type="checkbox"] {
    -webkit-appearance: none; appearance: none; width: 14px; height: 14px;
    border: 1.5px solid ${BRAND.text}; border-radius: 2px; display: inline-block;
  }
  .report-footer { position: fixed; bottom: 0; width: 100%; }
}
</style>
</head>
<body>

<div class="report-header">
  <div class="brand">
    <div class="logo">V1</div>
    <div>
      <h1>Trend Micro <span>Vision One</span></h1>
      <div style="font-size:14px;opacity:0.8;">Session Export <span class="export-badge">Offline</span></div>
    </div>
  </div>
  <div class="meta">
    ${s.event_name ? `<div>${esc(s.event_name)}</div>` : ""}
    ${s.booth_number ? `<div>Booth #${esc(s.booth_number)}</div>` : ""}
    <div style="font-size:16px;font-weight:600;">${esc(v.name || "")}</div>
    <div>${esc(s.generated_at || "")}</div>
    <div class="report-id">${esc(s.report_id || s.session_id || "")}</div>
  </div>
</div>

<div class="container">

  <!-- Engagement Score -->
  ${score > 0 ? `
  <div style="text-align:center;margin:24px 0;">
    <div class="gauge-wrapper">
      <div class="gauge">
        <svg viewBox="0 0 140 140">
          <defs>
            <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="${BRAND.red}"/>
              <stop offset="50%" stop-color="${BRAND.yellow}"/>
              <stop offset="100%" stop-color="${BRAND.green}"/>
            </linearGradient>
          </defs>
          <path class="gauge-bg" d="M 15 70 A 55 55 0 0 1 125 70" stroke-linecap="round"/>
          <path class="gauge-fill" d="M 15 70 A 55 55 0 0 1 125 70"
                stroke="url(#gaugeGrad)" stroke-linecap="round"
                stroke-dasharray="${arcLen}" stroke-dashoffset="${dashOffset}"/>
        </svg>
        <div class="gauge-score" style="color:${gColor};">${score}</div>
      </div>
      <div class="gauge-label">Engagement Score</div>
    </div>
  </div>` : ""}

  <!-- Summary -->
  ${s.summary ? `
  <div class="section-title">Summary</div>
  <div class="card">
    <div class="summary-text">${esc(s.summary)}</div>
  </div>` : ""}

  <!-- Visitor Information -->
  ${kvRows ? `
  <div class="section-title">Visitor Information</div>
  <div class="card">
    <div class="kv-grid">
      ${kvRows}
    </div>
  </div>` : ""}

  <!-- Products Demonstrated -->
  ${productItems ? `
  <div class="section-title">Products Demonstrated</div>
  <div class="card">
    <div class="timeline">${productItems}
    </div>
  </div>` : ""}

  <!-- Visitor Interests -->
  ${interestItems ? `
  <div class="section-title">Visitor Interests</div>
  <div class="card">${interestItems}
  </div>` : ""}

  <!-- Screenshots -->
  ${screenshotHtml}

  <!-- Follow-Up Actions -->
  ${recItems ? `
  <div class="section-title">Recommended Follow-Up Actions</div>
  <div class="card">${recItems}
  </div>` : ""}

  <!-- Export Button -->
  <div style="text-align:center;margin:32px 0 0;">
    <button class="export-btn" onclick="window.print()" title="Print or save as PDF">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-2px;margin-right:6px;">
        <path d="M4 0v4H0v8h4v4h8v-4h4V4h-4V0H4zm1 1h6v3H5V1zM1 5h14v6h-3V8H4v3H1V5zm4 4h6v6H5V9z"/>
      </svg>
      Print / Export
    </button>
  </div>

  <div class="report-footer">
    Trend Micro Vision One &mdash; Session Export &mdash;
    Exported ${esc(now)} &mdash; ${esc(s.report_id || s.session_id || "")}
  </div>

</div>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node analysis/export.js <session-id> [--bucket NAME] [--prefix PATH] [--sample]");
    process.exit(0);
  }

  let data;

  if (args.includes("--sample")) {
    data = SAMPLE_DATA;
    console.error("Using sample data...");
  } else {
    const sessionId = args.find(a => !a.startsWith("--"));
    if (!sessionId) {
      console.error("Error: session ID required. Use --sample for demo or --help for usage.");
      process.exit(1);
    }

    const bucket = args.includes("--bucket")
      ? args[args.indexOf("--bucket") + 1]
      : (process.env.BOOTH_S3_BUCKET || "boothapp-sessions");
    const prefix = args.includes("--prefix")
      ? args[args.indexOf("--prefix") + 1]
      : (process.env.BOOTH_S3_PREFIX || "sessions/");

    console.error(`Loading session ${sessionId} from s3://${bucket}/${prefix}${sessionId}/...`);
    data = await loadSession(sessionId, bucket, prefix);
  }

  const html = buildHtml(data);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, html, "utf-8");

  const sizeKb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.error(`Export written to ${OUTPUT_FILE} (${sizeKb} KB)`);
  console.error(`Screenshots embedded: ${data.screenshots.length}`);
}

main().catch(err => {
  console.error("Export failed:", err.message);
  process.exit(1);
});
