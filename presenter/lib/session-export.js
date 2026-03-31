/**
 * Session Export Module
 * Provides HTML (self-contained offline), PDF (via print), and CSV export
 * for BoothApp session viewer data.
 */
var SessionExport = (function () {
  "use strict";

  function esc(str) {
    if (str == null) return "";
    var d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
  }

  // ── Gather all session data from the DOM + stored data ────────────

  function gatherSessionData() {
    var data = {};

    // Visitor info
    var nameEl = document.getElementById("v-name");
    var subEl = document.getElementById("v-subtitle");
    data.visitorName = nameEl ? nameEl.textContent : "Unknown Visitor";
    data.visitorSubtitle = subEl ? subEl.textContent : "";
    data.sessionId = document.getElementById("topbar-sid")
      ? document.getElementById("topbar-sid").textContent
      : "";

    // Score
    var scoreEl = document.getElementById("score-value");
    data.score = scoreEl ? scoreEl.textContent : "--";

    // Meta chips
    var metaEl = document.getElementById("v-meta");
    data.metaText = metaEl ? metaEl.innerText.replace(/\s+/g, " ").trim() : "";

    // Parse meta chips individually
    data.metaChips = [];
    if (metaEl) {
      var chips = metaEl.querySelectorAll(".chip");
      for (var i = 0; i < chips.length; i++) {
        data.metaChips.push(chips[i].textContent.trim());
      }
    }

    // Analysis sections
    var analysisEl = document.getElementById("analysis");
    data.executiveSummary = "";
    data.products = [];
    data.interests = [];
    data.moments = [];
    data.actions = [];

    if (analysisEl) {
      var summaryDiv = analysisEl.querySelector(".summary-text");
      if (summaryDiv) data.executiveSummary = summaryDiv.textContent;

      var prodChips = analysisEl.querySelectorAll(".products-list .chip");
      for (var p = 0; p < prodChips.length; p++) {
        data.products.push(prodChips[p].textContent.trim());
      }

      var intRows = analysisEl.querySelectorAll(".interests-tbl tbody tr");
      for (var k = 0; k < intRows.length; k++) {
        var cells = intRows[k].querySelectorAll("td");
        if (cells.length >= 3) {
          data.interests.push({
            topic: cells[0].textContent.trim(),
            confidence: cells[1].textContent.trim(),
            evidence: cells[2].textContent.trim()
          });
        }
      }

      var momentItems = analysisEl.querySelectorAll(".moment-item");
      for (var m = 0; m < momentItems.length; m++) {
        var ts = momentItems[m].querySelector(".moment-ts");
        var desc = momentItems[m].querySelector(".moment-desc");
        var impact = momentItems[m].querySelector(".moment-impact");
        data.moments.push({
          timestamp: ts ? ts.textContent.trim() : "",
          description: desc ? desc.textContent.trim() : "",
          impact: impact ? impact.textContent.trim() : ""
        });
      }

      var actionItems = analysisEl.querySelectorAll(".actions-list li");
      for (var a = 0; a < actionItems.length; a++) {
        data.actions.push(actionItems[a].textContent.replace(/^>\s*/, "").trim());
      }
    }

    // Timeline events
    data.timeline = [];
    var tlItems = document.querySelectorAll("#timeline .tl-item");
    for (var t = 0; t < tlItems.length; t++) {
      var timeEl = tlItems[t].querySelector(".tl-time");
      var descEl = tlItems[t].querySelector(".tl-desc");
      var pageEl = tlItems[t].querySelector(".tl-page");
      data.timeline.push({
        time: timeEl ? timeEl.textContent.trim() : "",
        description: descEl ? descEl.textContent.trim() : "",
        page: pageEl ? pageEl.textContent.trim() : ""
      });
    }

    // Transcript
    data.transcript = [];
    var tEntries = document.querySelectorAll("#transcript .t-entry");
    for (var te = 0; te < tEntries.length; te++) {
      var tsEl = tEntries[te].querySelector(".t-ts");
      var spEl = tEntries[te].querySelector(".t-speaker");
      var txEl = tEntries[te].querySelector(".t-text");
      data.transcript.push({
        timestamp: tsEl ? tsEl.textContent.trim() : "",
        speaker: spEl ? spEl.textContent.trim() : "",
        text: txEl ? txEl.textContent.trim() : ""
      });
    }

    // Screenshots as base64
    data.screenshots = [];
    var thumbs = document.querySelectorAll("#timeline .tl-thumb img");
    for (var s = 0; s < thumbs.length; s++) {
      data.screenshots.push({
        src: thumbs[s].src,
        alt: thumbs[s].alt || "Screenshot"
      });
    }

    // Priority/tags from analysis
    data.priority = "";
    data.tags = [];
    if (analysisEl) {
      // Find priority text
      var prioEls = analysisEl.querySelectorAll(".section-label");
      for (var pl = 0; pl < prioEls.length; pl++) {
        if (prioEls[pl].textContent.toLowerCase().indexOf("priority") !== -1) {
          var nextSibling = prioEls[pl].nextElementSibling || prioEls[pl].parentElement;
          var prioSpan = nextSibling.querySelector
            ? nextSibling.querySelector("span[style*='font-weight:700']")
            : null;
          if (prioSpan) data.priority = prioSpan.textContent.trim();
        }
      }
    }

    return data;
  }

  // ── Convert image URL to base64 data URI ────────────────────────

  function imgToBase64(imgEl) {
    try {
      var canvas = document.createElement("canvas");
      canvas.width = imgEl.naturalWidth || imgEl.width;
      canvas.height = imgEl.naturalHeight || imgEl.height;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(imgEl, 0, 0);
      return canvas.toDataURL("image/jpeg", 0.85);
    } catch (e) {
      // Cross-origin or other error
      return null;
    }
  }

  // ── HTML Export (self-contained offline file) ───────────────────

  function exportHTML() {
    var data = gatherSessionData();
    var exportDate = new Date().toLocaleString();

    // Collect screenshot base64 data
    var screenshotData = [];
    var thumbImgs = document.querySelectorAll("#timeline .tl-thumb img");
    for (var i = 0; i < thumbImgs.length; i++) {
      var b64 = imgToBase64(thumbImgs[i]);
      if (b64) {
        screenshotData.push(b64);
      }
    }

    var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>Session Export - ' + esc(data.visitorName) + ' (' + esc(data.sessionId) + ')</title>\n' +
      '<style>\n' +
      '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n' +
      ':root {\n' +
      '  --bg: #0d1117; --surface: #161b22; --surface2: #1c2333;\n' +
      '  --border: #30363d; --text: #e6edf3; --text2: #8b949e; --text3: #484f58;\n' +
      '  --accent: #58a6ff; --green: #3fb950; --yellow: #d29922;\n' +
      '  --red: #f85149; --purple: #bc8cff; --radius: 10px;\n' +
      '}\n' +
      'body {\n' +
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;\n' +
      '  background: var(--bg); color: var(--text); line-height: 1.6; padding: 24px;\n' +
      '}\n' +
      '.export-header {\n' +
      '  max-width: 1200px; margin: 0 auto 24px; padding: 24px;\n' +
      '  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);\n' +
      '}\n' +
      '.export-badge {\n' +
      '  display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px;\n' +
      '  font-weight: 600; background: #1f6feb33; border: 1px solid #1f6feb; color: var(--accent);\n' +
      '  margin-bottom: 16px;\n' +
      '}\n' +
      '.export-title { font-size: 28px; font-weight: 700; margin-bottom: 4px; }\n' +
      '.export-subtitle { font-size: 14px; color: var(--text2); margin-bottom: 8px; }\n' +
      '.export-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--text3); }\n' +
      '.export-meta span { background: var(--surface2); padding: 2px 10px; border-radius: 12px; border: 1px solid var(--border); }\n' +
      '.score-inline {\n' +
      '  display: inline-block; font-size: 36px; font-weight: 700; font-family: monospace;\n' +
      '  float: right; margin-left: 16px;\n' +
      '}\n' +
      '.container { max-width: 1200px; margin: 0 auto; }\n' +
      '.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }\n' +
      '.card {\n' +
      '  background: var(--surface); border: 1px solid var(--border);\n' +
      '  border-radius: var(--radius); overflow: hidden;\n' +
      '}\n' +
      '.card-header {\n' +
      '  padding: 14px 20px; border-bottom: 1px solid var(--border);\n' +
      '  font-size: 13px; font-weight: 700; text-transform: uppercase;\n' +
      '  letter-spacing: 0.06em; color: var(--text2);\n' +
      '}\n' +
      '.card-body { padding: 20px; }\n' +
      '.full-width { grid-column: 1 / -1; }\n' +
      '.chip {\n' +
      '  display: inline-block; padding: 3px 10px; border-radius: 12px;\n' +
      '  font-size: 12px; font-weight: 600; background: var(--surface2);\n' +
      '  border: 1px solid var(--border); color: var(--text2);\n' +
      '}\n' +
      '.chip.purple { background: #bc8cff22; border-color: #8b5cf6; color: var(--purple); }\n' +
      '.tl-item { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid #21262d; }\n' +
      '.tl-item:last-child { border-bottom: none; }\n' +
      '.tl-time { font-family: monospace; font-size: 12px; color: var(--text3); min-width: 50px; flex-shrink: 0; }\n' +
      '.tl-desc { font-size: 14px; color: var(--text); }\n' +
      '.tl-page { font-size: 12px; color: var(--text3); margin-top: 2px; }\n' +
      '.tl-thumb { width: 160px; height: 90px; border-radius: 6px; border: 1px solid var(--border); overflow: hidden; flex-shrink: 0; }\n' +
      '.tl-thumb img { width: 100%; height: 100%; object-fit: cover; }\n' +
      '.t-entry { display: flex; gap: 10px; padding: 6px 0; font-size: 14px; }\n' +
      '.t-ts { font-family: monospace; font-size: 11px; color: var(--text3); min-width: 65px; flex-shrink: 0; }\n' +
      '.t-speaker { font-weight: 700; min-width: 55px; flex-shrink: 0; }\n' +
      '.t-speaker.se { color: var(--accent); }\n' +
      '.t-speaker.visitor { color: var(--green); }\n' +
      'table { width: 100%; border-collapse: collapse; font-size: 13px; }\n' +
      'th { text-align: left; padding: 8px; border-bottom: 2px solid var(--border); font-size: 11px; text-transform: uppercase; color: var(--text3); }\n' +
      'td { padding: 8px; border-bottom: 1px solid #21262d; vertical-align: top; }\n' +
      '.actions-list { list-style: none; }\n' +
      '.actions-list li { padding: 8px 0; border-bottom: 1px solid #21262d; font-size: 14px; }\n' +
      '.actions-list li:last-child { border-bottom: none; }\n' +
      '.moment-item { display: flex; gap: 12px; margin-bottom: 12px; }\n' +
      '.moment-ts { font-family: monospace; font-size: 12px; color: var(--text3); min-width: 60px; }\n' +
      '.moment-desc { font-size: 13px; color: var(--text); }\n' +
      '.moment-impact { font-size: 12px; color: var(--yellow); margin-top: 2px; }\n' +
      '.section-label {\n' +
      '  font-size: 12px; font-weight: 700; text-transform: uppercase;\n' +
      '  letter-spacing: 0.06em; color: var(--text3); margin: 16px 0 8px;\n' +
      '}\n' +
      '.section-label:first-child { margin-top: 0; }\n' +
      '.confidence-high { color: var(--green); }\n' +
      '.confidence-medium { color: var(--yellow); }\n' +
      '.confidence-low { color: var(--text3); }\n' +
      '.screenshots-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }\n' +
      '.screenshots-grid img { width: 100%; border-radius: 6px; border: 1px solid var(--border); }\n' +
      '.export-footer {\n' +
      '  max-width: 1200px; margin: 24px auto 0; padding: 16px;\n' +
      '  text-align: center; font-size: 11px; color: var(--text3);\n' +
      '  border-top: 1px solid var(--border);\n' +
      '}\n' +
      '@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }\n' +
      '@media print {\n' +
      '  body { background: #fff; color: #111; padding: 20px; }\n' +
      '  .export-header, .card { background: #fff; border-color: #ddd; }\n' +
      '  .card-header { color: #555; border-color: #ddd; }\n' +
      '  .chip { background: #f0f0f0; border-color: #ccc; color: #555; }\n' +
      '  .chip.purple { background: #f0e8ff; color: #7c3aed; }\n' +
      '  .tl-time, .t-ts, .moment-ts { color: #888; }\n' +
      '  .t-speaker.se { color: #2563eb; }\n' +
      '  .t-speaker.visitor { color: #16a34a; }\n' +
      '  .section-label, th { color: #666; }\n' +
      '  .confidence-high { color: #16a34a; }\n' +
      '  .confidence-medium { color: #ca8a04; }\n' +
      '  .moment-impact { color: #b45309; }\n' +
      '  .export-badge { background: #e8f0fe; border-color: #2563eb; color: #2563eb; }\n' +
      '  .score-inline { color: #111; }\n' +
      '  td, .tl-item, .actions-list li { border-color: #eee; }\n' +
      '  .export-footer { color: #999; border-color: #ddd; }\n' +
      '}\n' +
      '</style>\n</head>\n<body>\n';

    // Header
    html += '<div class="export-header">\n' +
      '  <div class="export-badge">OFFLINE EXPORT</div>\n' +
      '  <div class="score-inline">' + esc(data.score) + '</div>\n' +
      '  <div class="export-title">' + esc(data.visitorName) + '</div>\n' +
      (data.visitorSubtitle ? '  <div class="export-subtitle">' + esc(data.visitorSubtitle) + '</div>\n' : '') +
      '  <div class="export-meta">\n' +
      '    <span>Session: ' + esc(data.sessionId) + '</span>\n';
    for (var mc = 0; mc < data.metaChips.length; mc++) {
      html += '    <span>' + esc(data.metaChips[mc]) + '</span>\n';
    }
    html += '  </div>\n</div>\n';

    html += '<div class="container">\n<div class="grid">\n';

    // Executive Summary (full width)
    if (data.executiveSummary) {
      html += '<div class="card full-width">\n' +
        '  <div class="card-header">Executive Summary</div>\n' +
        '  <div class="card-body">' + esc(data.executiveSummary) + '</div>\n' +
        '</div>\n';
    }

    // Products
    if (data.products.length) {
      html += '<div class="card full-width">\n' +
        '  <div class="card-header">Products Demonstrated</div>\n' +
        '  <div class="card-body" style="display:flex;gap:6px;flex-wrap:wrap">\n';
      for (var pi = 0; pi < data.products.length; pi++) {
        html += '    <span class="chip purple">' + esc(data.products[pi]) + '</span>\n';
      }
      html += '  </div>\n</div>\n';
    }

    // Key Interests
    if (data.interests.length) {
      html += '<div class="card full-width">\n' +
        '  <div class="card-header">Key Interests</div>\n' +
        '  <div class="card-body">\n' +
        '    <table><thead><tr><th>Topic</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>\n';
      for (var ki = 0; ki < data.interests.length; ki++) {
        var interest = data.interests[ki];
        var confCls = "confidence-" + interest.confidence.toLowerCase();
        html += '      <tr><td style="font-weight:500">' + esc(interest.topic) + '</td>' +
          '<td><span class="' + confCls + '" style="text-transform:uppercase;font-size:12px">' + esc(interest.confidence) + '</span></td>' +
          '<td style="color:var(--text2)">' + esc(interest.evidence) + '</td></tr>\n';
      }
      html += '    </tbody></table>\n  </div>\n</div>\n';
    }

    // Timeline
    if (data.timeline.length) {
      html += '<div class="card">\n' +
        '  <div class="card-header">Click Timeline</div>\n' +
        '  <div class="card-body">\n';
      var ssIdx = 0;
      for (var ti = 0; ti < data.timeline.length; ti++) {
        var tev = data.timeline[ti];
        html += '    <div class="tl-item">\n' +
          '      <div class="tl-time">' + esc(tev.time) + '</div>\n' +
          '      <div>\n' +
          '        <div class="tl-desc">' + esc(tev.description) + '</div>\n' +
          (tev.page ? '        <div class="tl-page">' + esc(tev.page) + '</div>\n' : '') +
          '      </div>\n';
        // Attach screenshot if available
        if (ssIdx < screenshotData.length) {
          // Check if original timeline item had a thumb
          var origThumb = document.querySelectorAll("#timeline .tl-item")[ti];
          if (origThumb && origThumb.querySelector(".tl-thumb img")) {
            html += '      <div class="tl-thumb"><img src="' + screenshotData[ssIdx] + '" alt="Screenshot"></div>\n';
            ssIdx++;
          }
        }
        html += '    </div>\n';
      }
      html += '  </div>\n</div>\n';
    }

    // Transcript
    if (data.transcript.length) {
      html += '<div class="card">\n' +
        '  <div class="card-header">Transcript</div>\n' +
        '  <div class="card-body">\n';
      for (var tr = 0; tr < data.transcript.length; tr++) {
        var entry = data.transcript[tr];
        var spCls = entry.speaker.toLowerCase() === "se" ? "se" : "visitor";
        html += '    <div class="t-entry">\n' +
          '      <span class="t-ts">' + esc(entry.timestamp) + '</span>\n' +
          '      <span class="t-speaker ' + spCls + '">' + esc(entry.speaker) + '</span>\n' +
          '      <span>' + esc(entry.text) + '</span>\n' +
          '    </div>\n';
      }
      html += '  </div>\n</div>\n';
    }

    // Key Moments
    if (data.moments.length) {
      html += '<div class="card">\n' +
        '  <div class="card-header">Key Moments</div>\n' +
        '  <div class="card-body">\n';
      for (var mi = 0; mi < data.moments.length; mi++) {
        var mom = data.moments[mi];
        html += '    <div class="moment-item">\n' +
          '      <span class="moment-ts">' + esc(mom.timestamp) + '</span>\n' +
          '      <div>\n' +
          '        <div class="moment-desc">' + esc(mom.description) + '</div>\n' +
          (mom.impact ? '        <div class="moment-impact">' + esc(mom.impact) + '</div>\n' : '') +
          '      </div>\n' +
          '    </div>\n';
      }
      html += '  </div>\n</div>\n';
    }

    // Follow-up Actions
    if (data.actions.length) {
      html += '<div class="card">\n' +
        '  <div class="card-header">Follow-up Actions</div>\n' +
        '  <div class="card-body">\n' +
        '    <ul class="actions-list">\n';
      for (var ai = 0; ai < data.actions.length; ai++) {
        html += '      <li>> ' + esc(data.actions[ai]) + '</li>\n';
      }
      html += '    </ul>\n  </div>\n</div>\n';
    }

    // Screenshots gallery (full-size base64)
    if (screenshotData.length) {
      html += '<div class="card full-width">\n' +
        '  <div class="card-header">Screenshots</div>\n' +
        '  <div class="card-body">\n' +
        '    <div class="screenshots-grid">\n';
      for (var si = 0; si < screenshotData.length; si++) {
        html += '      <img src="' + screenshotData[si] + '" alt="Screenshot ' + (si + 1) + '">\n';
      }
      html += '    </div>\n  </div>\n</div>\n';
    }

    html += '</div>\n</div>\n';

    // Footer
    html += '<div class="export-footer">\n' +
      '  Exported from BoothApp Session Viewer | ' + esc(exportDate) + '\n' +
      '</div>\n';

    html += '</body>\n</html>';

    // Download as file
    downloadFile(
      "session-" + sanitizeFilename(data.sessionId) + ".html",
      html,
      "text/html"
    );
  }

  // ── PDF Export (via window.print with print-optimized CSS) ──────

  function exportPDF() {
    var data = gatherSessionData();
    var exportDate = new Date().toLocaleString();

    var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<title>Session Report - ' + esc(data.visitorName) + '</title>\n' +
      '<style>\n' +
      '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n' +
      'body {\n' +
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;\n' +
      '  color: #1a1a1a; line-height: 1.6; padding: 40px; max-width: 800px; margin: 0 auto; background: #fff;\n' +
      '}\n' +
      '.header { border-bottom: 3px solid #e53e3e; padding-bottom: 24px; margin-bottom: 32px; }\n' +
      '.header-row { display: flex; align-items: center; justify-content: space-between; }\n' +
      '.title { font-size: 28px; font-weight: 700; color: #111; }\n' +
      '.subtitle { font-size: 14px; color: #666; margin-top: 2px; }\n' +
      '.score { font-size: 36px; font-weight: 800; font-family: monospace; border: 2px solid #ddd; border-radius: 8px; padding: 4px 16px; }\n' +
      '.meta { display: flex; gap: 24px; margin-top: 12px; font-size: 13px; color: #555; }\n' +
      '.meta strong { color: #333; }\n' +
      '.section { margin-bottom: 28px; page-break-inside: avoid; }\n' +
      '.section-title {\n' +
      '  font-size: 16px; font-weight: 700; color: #222;\n' +
      '  border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 14px;\n' +
      '  text-transform: uppercase; letter-spacing: 0.04em;\n' +
      '}\n' +
      '.exec-summary {\n' +
      '  background: #fafafa; border-left: 3px solid #e53e3e;\n' +
      '  padding: 16px 20px; font-size: 14px; line-height: 1.8;\n' +
      '}\n' +
      '.products { font-size: 13px; color: #555; }\n' +
      'table { width: 100%; border-collapse: collapse; font-size: 13px; }\n' +
      'th {\n' +
      '  text-align: left; padding: 8px 10px; border-bottom: 2px solid #ddd;\n' +
      '  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #666; background: #f8f8f8;\n' +
      '}\n' +
      'td { padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }\n' +
      '.actions-list { list-style: none; }\n' +
      '.actions-list li { padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; display: flex; gap: 8px; }\n' +
      '.actions-list li:last-child { border-bottom: none; }\n' +
      '.actions-list input[type="checkbox"] { margin-top: 3px; width: 16px; height: 16px; }\n' +
      '.moment { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px solid #eee; font-size: 13px; }\n' +
      '.moment:last-child { border-bottom: none; }\n' +
      '.moment-ts { font-family: monospace; color: #888; min-width: 60px; flex-shrink: 0; }\n' +
      '.moment-impact { color: #b45309; font-style: italic; }\n' +
      '.t-entry { display: flex; gap: 10px; padding: 4px 0; font-size: 13px; }\n' +
      '.t-ts { font-family: monospace; font-size: 11px; color: #888; min-width: 65px; flex-shrink: 0; }\n' +
      '.t-speaker { font-weight: 700; min-width: 55px; flex-shrink: 0; }\n' +
      '.t-speaker.se { color: #2563eb; }\n' +
      '.t-speaker.visitor { color: #16a34a; }\n' +
      '.tl-row { display: flex; gap: 10px; padding: 4px 0; border-bottom: 1px solid #eee; font-size: 13px; }\n' +
      '.tl-row:last-child { border-bottom: none; }\n' +
      '.tl-time { font-family: monospace; color: #888; min-width: 50px; flex-shrink: 0; }\n' +
      '.tl-page { font-size: 11px; color: #999; }\n' +
      '.footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 11px; color: #999; text-align: center; }\n' +
      '.no-print { margin-bottom: 20px; text-align: right; }\n' +
      '.print-btn {\n' +
      '  padding: 10px 32px; font-size: 14px; cursor: pointer;\n' +
      '  background: #e53e3e; color: #fff; border: none; border-radius: 6px; font-weight: 600;\n' +
      '}\n' +
      '.print-btn:hover { background: #dc2626; }\n' +
      '@media print {\n' +
      '  .no-print { display: none !important; }\n' +
      '  body { padding: 20px; }\n' +
      '  .header { page-break-after: avoid; }\n' +
      '  .section { page-break-inside: avoid; }\n' +
      '}\n' +
      '</style>\n</head>\n<body>\n';

    // Print button
    html += '<div class="no-print">\n' +
      '  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>\n' +
      '</div>\n';

    // Header
    html += '<div class="header">\n' +
      '  <div class="header-row">\n' +
      '    <div>\n' +
      '      <div class="title">' + esc(data.visitorName) + '</div>\n' +
      (data.visitorSubtitle ? '      <div class="subtitle">' + esc(data.visitorSubtitle) + '</div>\n' : '') +
      '    </div>\n' +
      '    <div class="score">' + esc(data.score) + '</div>\n' +
      '  </div>\n' +
      '  <div class="meta">\n' +
      '    <span><strong>Session:</strong> ' + esc(data.sessionId) + '</span>\n' +
      '    <span><strong>Date:</strong> ' + esc(exportDate) + '</span>\n' +
      (data.metaText ? '    <span>' + esc(data.metaText) + '</span>\n' : '') +
      '  </div>\n' +
      '</div>\n';

    // Executive Summary
    if (data.executiveSummary) {
      html += '<div class="section">\n' +
        '  <div class="section-title">Executive Summary</div>\n' +
        '  <div class="exec-summary">' + esc(data.executiveSummary) + '</div>\n' +
        '</div>\n';
    }

    // Products
    if (data.products.length) {
      html += '<div class="section">\n' +
        '  <div class="section-title">Products Demonstrated</div>\n' +
        '  <div class="products">' + data.products.map(function (p) { return esc(p); }).join(", ") + '</div>\n' +
        '</div>\n';
    }

    // Key Interests
    if (data.interests.length) {
      html += '<div class="section">\n' +
        '  <div class="section-title">Key Interests</div>\n' +
        '  <table><thead><tr><th>Topic</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>\n';
      for (var ki = 0; ki < data.interests.length; ki++) {
        html += '    <tr><td>' + esc(data.interests[ki].topic) + '</td>' +
          '<td>' + esc(data.interests[ki].confidence) + '</td>' +
          '<td>' + esc(data.interests[ki].evidence) + '</td></tr>\n';
      }
      html += '  </tbody></table>\n</div>\n';
    }

    // Follow-up Actions
    if (data.actions.length) {
      html += '<div class="section">\n' +
        '  <div class="section-title">Follow-up Actions</div>\n' +
        '  <ul class="actions-list">\n';
      for (var ai = 0; ai < data.actions.length; ai++) {
        html += '    <li><input type="checkbox"> ' + esc(data.actions[ai]) + '</li>\n';
      }
      html += '  </ul>\n</div>\n';
    }

    // Key Moments
    if (data.moments.length) {
      html += '<div class="section">\n' +
        '  <div class="section-title">Key Moments</div>\n';
      for (var mi = 0; mi < data.moments.length; mi++) {
        var mom = data.moments[mi];
        html += '  <div class="moment">\n' +
          '    <span class="moment-ts">' + esc(mom.timestamp) + '</span>\n' +
          '    <span>' + esc(mom.description) +
          (mom.impact ? ' <em class="moment-impact">(' + esc(mom.impact) + ')</em>' : '') +
          '</span>\n  </div>\n';
      }
      html += '</div>\n';
    }

    // Timeline
    if (data.timeline.length) {
      html += '<div class="section">\n' +
        '  <div class="section-title">Click Timeline</div>\n';
      for (var ti = 0; ti < data.timeline.length; ti++) {
        var tev = data.timeline[ti];
        html += '  <div class="tl-row">\n' +
          '    <span class="tl-time">' + esc(tev.time) + '</span>\n' +
          '    <span>' + esc(tev.description) +
          (tev.page ? ' <span class="tl-page">(' + esc(tev.page) + ')</span>' : '') +
          '</span>\n  </div>\n';
      }
      html += '</div>\n';
    }

    // Transcript
    if (data.transcript.length) {
      html += '<div class="section">\n' +
        '  <div class="section-title">Transcript</div>\n';
      for (var tr = 0; tr < data.transcript.length; tr++) {
        var e = data.transcript[tr];
        var spCls = e.speaker.toLowerCase() === "se" ? "se" : "visitor";
        html += '  <div class="t-entry">\n' +
          '    <span class="t-ts">' + esc(e.timestamp) + '</span>\n' +
          '    <span class="t-speaker ' + spCls + '">' + esc(e.speaker) + '</span>\n' +
          '    <span>' + esc(e.text) + '</span>\n' +
          '  </div>\n';
      }
      html += '</div>\n';
    }

    // Footer
    html += '<div class="footer">Generated from BoothApp Session Viewer | ' + esc(exportDate) + '</div>\n';
    html += '</body>\n</html>';

    // Open in new window for printing
    var w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      // Auto-trigger print after content loads
      w.onload = function () { w.print(); };
    }
  }

  // ── CSV Export (structured data) ────────────────────────────────

  function exportCSV() {
    var data = gatherSessionData();
    var lines = [];

    // Session info section
    lines.push("SECTION,Session Info");
    lines.push("Session ID," + csvVal(data.sessionId));
    lines.push("Visitor," + csvVal(data.visitorName));
    lines.push("Title/Company," + csvVal(data.visitorSubtitle));
    lines.push("Score," + csvVal(data.score));
    lines.push("Meta," + csvVal(data.metaText));
    lines.push("");

    // Executive Summary
    if (data.executiveSummary) {
      lines.push("SECTION,Executive Summary");
      lines.push("Summary," + csvVal(data.executiveSummary));
      lines.push("");
    }

    // Products
    if (data.products.length) {
      lines.push("SECTION,Products Demonstrated");
      for (var p = 0; p < data.products.length; p++) {
        lines.push("Product," + csvVal(data.products[p]));
      }
      lines.push("");
    }

    // Key Interests
    if (data.interests.length) {
      lines.push("SECTION,Key Interests");
      lines.push("Topic,Confidence,Evidence");
      for (var k = 0; k < data.interests.length; k++) {
        lines.push(
          csvVal(data.interests[k].topic) + "," +
          csvVal(data.interests[k].confidence) + "," +
          csvVal(data.interests[k].evidence)
        );
      }
      lines.push("");
    }

    // Follow-up Actions
    if (data.actions.length) {
      lines.push("SECTION,Follow-up Actions");
      lines.push("Action,Status");
      for (var a = 0; a < data.actions.length; a++) {
        lines.push(csvVal(data.actions[a]) + ",Pending");
      }
      lines.push("");
    }

    // Key Moments
    if (data.moments.length) {
      lines.push("SECTION,Key Moments");
      lines.push("Timestamp,Description,Impact");
      for (var m = 0; m < data.moments.length; m++) {
        lines.push(
          csvVal(data.moments[m].timestamp) + "," +
          csvVal(data.moments[m].description) + "," +
          csvVal(data.moments[m].impact)
        );
      }
      lines.push("");
    }

    // Click Timeline
    if (data.timeline.length) {
      lines.push("SECTION,Click Timeline");
      lines.push("Time,Action,Page");
      for (var t = 0; t < data.timeline.length; t++) {
        lines.push(
          csvVal(data.timeline[t].time) + "," +
          csvVal(data.timeline[t].description) + "," +
          csvVal(data.timeline[t].page)
        );
      }
      lines.push("");
    }

    // Transcript
    if (data.transcript.length) {
      lines.push("SECTION,Transcript");
      lines.push("Timestamp,Speaker,Text");
      for (var tr = 0; tr < data.transcript.length; tr++) {
        lines.push(
          csvVal(data.transcript[tr].timestamp) + "," +
          csvVal(data.transcript[tr].speaker) + "," +
          csvVal(data.transcript[tr].text)
        );
      }
    }

    var csv = "\uFEFF" + lines.join("\n"); // BOM for Excel UTF-8
    downloadFile(
      "session-" + sanitizeFilename(data.sessionId) + ".csv",
      csv,
      "text/csv;charset=utf-8"
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────

  function csvVal(str) {
    if (str == null) return "";
    str = String(str);
    if (str.indexOf(",") !== -1 || str.indexOf('"') !== -1 || str.indexOf("\n") !== -1) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function sanitizeFilename(str) {
    return (str || "export").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function downloadFile(filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ── Public API ──────────────────────────────────────────────────

  return {
    exportHTML: exportHTML,
    exportPDF: exportPDF,
    exportCSV: exportCSV
  };

})();
