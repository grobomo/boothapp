#!/usr/bin/env node
// render-report.js — Render HTML summary report from analysis output
//
// Usage: node render-report.js <sessionPath>
//   sessionPath: local directory or s3://bucket/sessions/<sessionId>
//
// Reads: metadata.json, summary.json, follow-up.json, timeline.json (from output/ subdir)
// Template: templates/report.html ({{placeholder}} syntax)
// Writes: output/summary.html (locally or to S3)

'use strict';

const fs = require('fs');
const path = require('path');

const [, , sessionPath] = process.argv;

if (!sessionPath) {
  console.error('Usage: render-report.js <sessionPath>');
  process.exit(1);
}

const IS_S3 = sessionPath.startsWith('s3://');
const REGION = process.env.AWS_REGION || 'us-east-1';

// Lazy-load AWS SDK only when needed (keeps local/test usage dependency-free)
let _s3;
function getS3() {
  if (!_s3) {
    const sdk = require('@aws-sdk/client-s3');
    _s3 = { S3Client: sdk.S3Client, GetObjectCommand: sdk.GetObjectCommand, PutObjectCommand: sdk.PutObjectCommand };
  }
  return _s3;
}
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'report.html');

function parseS3Path(s3Uri) {
  const without = s3Uri.replace('s3://', '');
  const slashIdx = without.indexOf('/');
  if (slashIdx === -1) return { bucket: without, prefix: '' };
  return {
    bucket: without.slice(0, slashIdx),
    prefix: without.slice(slashIdx + 1),
  };
}

async function readJson(location) {
  if (IS_S3) {
    const { bucket, prefix } = parseS3Path(sessionPath);
    const key = prefix ? `${prefix}/${location}` : location;
    const { S3Client, GetObjectCommand } = getS3();
    const client = new S3Client({ region: REGION });
    const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks = [];
    for await (const chunk of resp.Body) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  return JSON.parse(fs.readFileSync(path.join(sessionPath, location), 'utf8'));
}

async function writeFile(location, content) {
  if (IS_S3) {
    const { bucket, prefix } = parseS3Path(sessionPath);
    const key = prefix ? `${prefix}/${location}` : location;
    const { S3Client, PutObjectCommand } = getS3();
    const client = new S3Client({ region: REGION });
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: 'text/html',
    }));
    console.log(`[render-report] Written to s3://${bucket}/${key}`);
  } else {
    const outPath = path.join(sessionPath, location);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf8');
    console.log(`[render-report] Written to ${outPath}`);
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── HTML fragment builders ──────────────────────────────────────

function buildProductBadges(products) {
  if (!products || !products.length) {
    return '<span class="empty">No products recorded</span>';
  }
  return products.map(p => {
    const initial = (p[0] || '?').toUpperCase();
    return `<div class="product-badge"><span class="p-icon">${escapeHtml(initial)}</span>${escapeHtml(p)}</div>`;
  }).join('\n            ');
}

function buildInterestsRows(interests) {
  if (!interests || !interests.length) {
    return '<tr><td colspan="3" class="empty">No interests recorded</td></tr>';
  }
  return interests.map(i => {
    const cls = 'conf-' + (i.confidence || 'low').toLowerCase();
    return `<tr>
              <td style="font-weight:500">${escapeHtml(i.topic)}</td>
              <td style="text-align:center"><span class="${cls}">${escapeHtml(i.confidence)}</span></td>
              <td style="font-size:13px;color:#94a3b8">${escapeHtml(i.evidence)}</td>
            </tr>`;
  }).join('\n            ');
}

function buildPainPointRows(interests) {
  // Extract pain points from interests with "pain" or "challenge" evidence,
  // or from high-confidence items that suggest problems
  const painPoints = (interests || []).filter(i =>
    (i.evidence || '').toLowerCase().match(/pain|challenge|problem|struggle|concern|issue|frustrat/)
  );
  if (!painPoints.length) {
    return '<tr><td colspan="2" class="empty">No explicit pain points detected</td></tr>';
  }
  return painPoints.map(i =>
    `<tr>
              <td style="font-weight:500">${escapeHtml(i.topic)}</td>
              <td style="font-size:13px;color:#94a3b8">${escapeHtml(i.evidence)}</td>
            </tr>`
  ).join('\n            ');
}

function buildTimelineEvents(timeline, keyMoments) {
  // Merge click events and transcript from timeline.json
  const events = (timeline && timeline.events) || [];
  if (!events.length && (!keyMoments || !keyMoments.length)) {
    return '<p class="empty">No timeline events recorded</p>';
  }

  // If we have a full timeline, render it
  if (events.length) {
    return events.map(e => {
      const screenshotHtml = e.screenshot_url
        ? `\n              <div class="tl-screenshot"><img src="${escapeHtml(e.screenshot_url)}" alt="Screenshot"></div>`
        : '';
      if (e.type === 'click') {
        return `<div class="tl-event">
              <div class="tl-dot tl-click"></div>
              <div class="tl-time">${escapeHtml(e.timestamp || '')}</div>
              <div class="tl-text"><span class="tl-click-label">CLICK</span>${escapeHtml(e.element_text || e.description || '')} &mdash; ${escapeHtml(e.page_title || '')}</div>${screenshotHtml}
            </div>`;
      }
      // speech / transcript
      return `<div class="tl-event">
              <div class="tl-dot tl-speech"></div>
              <div class="tl-time">${escapeHtml(e.timestamp || '')}</div>
              <div class="tl-text"><span class="tl-speaker">${escapeHtml(e.speaker || '')}</span>${escapeHtml(e.text || '')}</div>${screenshotHtml}
            </div>`;
    }).join('\n            ');
  }

  // Fallback: render key_moments from summary.json
  return keyMoments.map((m, idx) =>
    `<div class="tl-event">
              <div class="tl-dot tl-speech"></div>
              <div class="tl-time">${escapeHtml(m.timestamp || '')}</div>
              <div class="tl-text">${escapeHtml(m.description || '')}</div>
            </div>`
  ).join('\n            ');
}

function buildFollowUpCards(actions, priority) {
  if (!actions || !actions.length) {
    return '<p class="empty">No follow-up actions recorded</p>';
  }
  const priClass = 'priority-' + (priority || 'medium').toLowerCase();
  return actions.map((a, idx) =>
    `<div class="action-card">
              <div class="followup-num">${idx + 1}</div>
              <div class="followup-content">
                <div class="followup-text">${escapeHtml(a)}</div>
                ${idx === 0 ? `<span class="followup-priority ${priClass}">${escapeHtml(priority || 'medium')}</span>` : ''}
              </div>
            </div>`
  ).join('\n            ');
}

function computeScore(summary, followUp) {
  // Score 0-100 based on session richness
  let score = 50; // baseline
  const interests = summary.visitor_interests || [];
  const products = summary.products_shown || [];
  const moments = summary.key_moments || [];
  const actions = summary.recommended_follow_up || [];

  // High-confidence interests boost score
  score += interests.filter(i => i.confidence === 'high').length * 10;
  score += interests.filter(i => i.confidence === 'medium').length * 5;

  // Products shown
  score += Math.min(products.length * 5, 15);

  // Key moments
  score += Math.min(moments.length * 3, 15);

  // Follow-up priority
  if ((followUp.priority || '').toLowerCase() === 'high') score += 10;

  // Duration bonus (longer demos = more engaged)
  if (summary.demo_duration_minutes > 15) score += 5;
  if (summary.demo_duration_minutes > 25) score += 5;

  return Math.min(Math.max(score, 0), 100);
}

function scoreColor(score) {
  if (score >= 80) return '#4ade80'; // green
  if (score >= 60) return '#facc15'; // yellow
  if (score >= 40) return '#fb923c'; // orange
  return '#f87171'; // red
}

function scoreColorLight(score) {
  if (score >= 80) return '#86efac';
  if (score >= 60) return '#fde68a';
  if (score >= 40) return '#fdba74';
  return '#fca5a5';
}

function scoreDasharray(score) {
  // SVG circle r=30 => circumference = 2 * PI * 30 ~= 188.50
  const circumference = 2 * Math.PI * 30;
  const filled = (score / 100) * circumference;
  return `${filled.toFixed(1)} ${circumference.toFixed(1)}`;
}

function buildVisitorPhoto(summary) {
  // If badge_photo_url exists, render an <img>; otherwise render SVG placeholder
  if (summary.badge_photo_url) {
    return `<img src="${escapeHtml(summary.badge_photo_url)}" alt="${escapeHtml(summary.visitor_name || 'Visitor')}">`;
  }
  return '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
}

function buildPriorityChip(priority) {
  const p = (priority || 'medium').toLowerCase();
  return `<span class="chip chip-priority chip-priority-${escapeHtml(p)}">${escapeHtml(priority || 'medium')}</span>`;
}

function buildTagChips(tags) {
  if (!tags || !tags.length) return '';
  return tags.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('\n            ');
}

function scoreSummary(score) {
  if (score >= 80) return 'Strong engagement — high-priority follow-up recommended';
  if (score >= 60) return 'Good engagement — visitor showed clear interest';
  if (score >= 40) return 'Moderate engagement — some interest signals detected';
  return 'Light engagement — brief interaction or limited data';
}

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return isoString;
  }
}

// ── Template rendering ──────────────────────────────────────────

function renderTemplate(template, summary, followUp, timeline) {
  const score = computeScore(summary, followUp);

  const replacements = {
    visitor_name:         escapeHtml(summary.visitor_name || 'Unknown Visitor'),
    visitor_company:      escapeHtml(followUp.visitor_company || summary.visitor_company || '—'),
    visitor_email:        escapeHtml(followUp.visitor_email || ''),
    se_name:              escapeHtml(summary.se_name || '—'),
    demo_duration_minutes: escapeHtml(String(summary.demo_duration_minutes || 0)),
    session_date:         formatDate(summary.generated_at),
    generated_at:         formatDate(summary.generated_at),
    session_score:        String(score),
    score_color:          scoreColor(score),
    score_color_light:    scoreColorLight(score),
    score_dasharray:      scoreDasharray(score),
    score_summary:        scoreSummary(score),
    visitor_photo:        buildVisitorPhoto(summary),
    priority_chip:        buildPriorityChip(followUp.priority),
    tag_chips:            buildTagChips(followUp.tags),
    executive_summary:    escapeHtml(followUp.sdr_notes || 'No executive summary available.'),
    sdr_notes:            escapeHtml(followUp.sdr_notes || 'No SDR notes recorded.'),
    products_shown:       buildProductBadges(summary.products_shown),
    visitor_interests:    buildInterestsRows(summary.visitor_interests),
    pain_points:          buildPainPointRows(summary.visitor_interests),
    timeline_events:      buildTimelineEvents(timeline, summary.key_moments),
    follow_up_cards:      buildFollowUpCards(summary.recommended_follow_up, followUp.priority),
  };

  let html = template;
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return html;
}

// ── Main ────────────────────────────────────────────────────────

async function run() {
  console.log(`[render-report] Reading from ${sessionPath}`);

  // Load template
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  console.log(`[render-report] Template loaded: ${TEMPLATE_PATH}`);

  let metadata, summary, followUp, timeline;

  try {
    metadata = await readJson('metadata.json');
  } catch (err) {
    console.warn(`[render-report] metadata.json not found, using defaults: ${err.message}`);
    metadata = {};
  }

  try {
    summary = await readJson('output/summary.json');
  } catch (err) {
    console.error(`[render-report] Failed to read output/summary.json: ${err.message}`);
    process.exit(1);
  }

  // Merge metadata fields into summary as fallbacks (metadata.json has se_name,
  // visitor_name, etc. that the Claude analysis may not include in summary.json)
  for (const key of ['se_name', 'visitor_name', 'demo_pc']) {
    if (!summary[key] && metadata[key]) summary[key] = metadata[key];
  }
  // Compute demo_duration_minutes from metadata timestamps if not in summary
  if (!summary.demo_duration_minutes && metadata.started_at && metadata.ended_at) {
    const ms = new Date(metadata.ended_at) - new Date(metadata.started_at);
    if (ms > 0) summary.demo_duration_minutes = Math.round(ms / 60000);
  }

  try {
    followUp = await readJson('output/follow-up.json');
  } catch (err) {
    console.warn(`[render-report] follow-up.json not found, using defaults: ${err.message}`);
    followUp = {};
  }

  try {
    timeline = await readJson('output/timeline.json');
  } catch (err) {
    console.warn(`[render-report] timeline.json not found, using key_moments fallback: ${err.message}`);
    timeline = {};
  }

  const html = renderTemplate(template, summary, followUp, timeline);
  await writeFile('output/summary.html', html);
  console.log('[render-report] Done');
}

run().catch((err) => {
  console.error(`[render-report] FATAL: ${err.message}`);
  process.exit(1);
});
