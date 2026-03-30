#!/usr/bin/env node
// render-report.js — Render HTML summary report from analysis output
//
// Usage: node render-report.js <sessionPath>
//   sessionPath: local directory or s3://bucket/sessions/<sessionId>
//
// Reads: summary.json, follow-up.json, timeline.json (from output/ subdir)
// Template: render-report.html ({{placeholder}} syntax)
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
const TEMPLATE_PATH = path.join(__dirname, 'render-report.html');

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
      if (e.type === 'click') {
        return `<div class="tl-event">
              <div class="tl-dot tl-click"></div>
              <div class="tl-time">${escapeHtml(e.timestamp || '')}</div>
              <div class="tl-text"><span class="tl-click-label">CLICK</span>${escapeHtml(e.element_text || e.description || '')} &mdash; ${escapeHtml(e.page_title || '')}</div>
            </div>`;
      }
      // speech / transcript
      return `<div class="tl-event">
              <div class="tl-dot tl-speech"></div>
              <div class="tl-time">${escapeHtml(e.timestamp || '')}</div>
              <div class="tl-text"><span class="tl-speaker">${escapeHtml(e.speaker || '')}</span>${escapeHtml(e.text || '')}</div>
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
    `<div class="followup-card">
              <div class="followup-num">${idx + 1}</div>
              <div>
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
    score_summary:        scoreSummary(score),
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

function confidenceColor(confidence) {
  switch ((confidence || '').toLowerCase()) {
    case 'high':   return '#4ade80'; // green
    case 'medium': return '#facc15'; // yellow
    case 'low':    return '#94a3b8'; // slate
    default:       return '#94a3b8';
  }
}

function priorityBadge(priority) {
  const colors = {
    high:   { bg: '#dc2626', text: '#fff' },
    medium: { bg: '#d97706', text: '#fff' },
    low:    { bg: '#475569', text: '#fff' },
  };
  const c = colors[(priority || 'medium').toLowerCase()] || colors.medium;
  return `<span style="background:${c.bg};color:${c.text};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">${escapeHtml(priority || 'medium')}</span>`;
}

function renderHtml(summary, followUp) {
  const {
    visitor_name = 'Unknown Visitor',
    demo_duration_minutes = 0,
    session_score = 0,
    executive_summary = '',
    products_shown = [],
    visitor_interests = [],
    recommended_follow_up = [],
    key_moments = [],
    v1_tenant_link = '',
    generated_at = '',
  } = summary;

  const {
    visitor_email = '',
    priority = 'medium',
    sdr_notes = '',
    tags = [],
  } = followUp;

  const productsHtml = products_shown.length
    ? products_shown.map(p =>
        `<span style="display:inline-block;background:#1e40af;color:#bfdbfe;padding:4px 12px;border-radius:16px;font-size:13px;font-weight:500;margin:3px 4px 3px 0">${escapeHtml(p)}</span>`
      ).join('')
    : '<span style="color:#64748b;font-style:italic">None recorded</span>';

  const interestsHtml = visitor_interests.length
    ? visitor_interests.map(i => `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #1e293b;font-weight:500">${escapeHtml(i.topic)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #1e293b;text-align:center">
            <span style="color:${confidenceColor(i.confidence)};font-weight:700;text-transform:uppercase;font-size:12px;letter-spacing:0.05em">${escapeHtml(i.confidence)}</span>
          </td>
          <td style="padding:10px 14px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px">${escapeHtml(i.evidence)}</td>
        </tr>`).join('')
    : '<tr><td colspan="3" style="padding:14px;color:#64748b;font-style:italic">No interests recorded</td></tr>';

  const momentsHtml = key_moments.length
    ? key_moments.map((m, idx) => `
        <div style="display:flex;gap:16px;margin-bottom:20px">
          <div style="display:flex;flex-direction:column;align-items:center">
            <div style="width:36px;height:36px;border-radius:50%;background:#1e40af;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#93c5fd;flex-shrink:0">${idx + 1}</div>
            ${idx < key_moments.length - 1 ? '<div style="width:2px;flex:1;background:#1e293b;margin-top:6px"></div>' : ''}
          </div>
          <div style="padding-top:6px;padding-bottom:8px">
            <div style="font-size:12px;color:#475569;margin-bottom:4px;font-family:monospace">${escapeHtml(m.timestamp)}</div>
            <div style="color:#e2e8f0">${escapeHtml(m.description)}</div>
            ${m.impact ? `<div style="color:#94a3b8;font-size:13px;margin-top:4px;font-style:italic">${escapeHtml(m.impact)}</div>` : ''}
          </div>
        </div>`).join('')
    : '<p style="color:#64748b;font-style:italic">No key moments recorded</p>';

  const followUpActionsHtml = recommended_follow_up.length
    ? recommended_follow_up.map(a => `
        <li style="padding:10px 0;border-bottom:1px solid #1e293b;color:#cbd5e1;display:flex;gap:10px;align-items:flex-start">
          <span style="color:#3b82f6;font-size:18px;line-height:1;flex-shrink:0">›</span>
          <span>${escapeHtml(a)}</span>
        </li>`).join('')
    : '<li style="color:#64748b;font-style:italic">No follow-up actions recorded</li>';

  const tenantLinkHtml = v1_tenant_link
    ? `<a href="${escapeHtml(v1_tenant_link)}" style="color:#60a5fa;text-decoration:none">${escapeHtml(v1_tenant_link)}</a>`
    : '<span style="color:#64748b">—</span>';

  const generatedDate = generated_at
    ? new Date(generated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demo Summary — ${escapeHtml(visitor_name)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      line-height: 1.6;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-bottom: 1px solid #1e293b;
      padding: 32px 0;
    }
    .container { max-width: 900px; margin: 0 auto; padding: 0 24px; }
    .header-meta { color: #64748b; font-size: 13px; margin-top: 6px; }
    h1 { font-size: 26px; font-weight: 700; color: #f1f5f9; }
    .badge-row { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
    .stat-chip {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 4px 12px;
      font-size: 13px;
      color: #94a3b8;
    }
    .stat-chip strong { color: #e2e8f0; }
    .main { padding: 32px 0; }
    .section {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      margin-bottom: 24px;
      overflow: hidden;
    }
    .section-title {
      padding: 16px 20px;
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #94a3b8;
      border-bottom: 1px solid #334155;
      background: #162032;
    }
    .section-body { padding: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      border-bottom: 2px solid #334155;
    }
    ul { list-style: none; }
    .footer {
      border-top: 1px solid #1e293b;
      padding: 20px 0;
      color: #475569;
      font-size: 12px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="container">
      <h1>${escapeHtml(visitor_name)}</h1>
      ${visitor_email ? `<div class="header-meta">${escapeHtml(visitor_email)}</div>` : ''}
      <div class="badge-row">
        ${priorityBadge(priority)}
        ${session_score ? `<div class="stat-chip"><strong>${escapeHtml(String(session_score))}</strong>/10 session score</div>` : ''}
        ${demo_duration_minutes ? `<div class="stat-chip"><strong>${escapeHtml(String(demo_duration_minutes))}</strong> min demo</div>` : ''}
        ${tags.map(t => `<div class="stat-chip">${escapeHtml(t)}</div>`).join('')}
      </div>
      ${v1_tenant_link ? `<div class="header-meta" style="margin-top:10px">Tenant: ${tenantLinkHtml}</div>` : ''}
    </div>
  </div>

  <div class="main">
    <div class="container">

      <!-- Executive Summary -->
      ${executive_summary ? `
      <div class="section">
        <div class="section-title">Executive Summary</div>
        <div class="section-body">
          <div style="font-size:15px;line-height:1.7;color:#e2e8f0">${escapeHtml(executive_summary)}</div>
        </div>
      </div>` : ''}

      <!-- Products Demonstrated -->
      <div class="section">
        <div class="section-title">Products Demonstrated</div>
        <div class="section-body">${productsHtml}</div>
      </div>

      <!-- Visitor Interests -->
      <div class="section">
        <div class="section-title">Visitor Interests</div>
        <table>
          <thead>
            <tr>
              <th>Topic</th>
              <th style="text-align:center">Confidence</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>${interestsHtml}</tbody>
        </table>
      </div>

      <!-- Key Moments -->
      <div class="section">
        <div class="section-title">Key Moments</div>
        <div class="section-body">${momentsHtml}</div>
      </div>

      <!-- Follow-Up Actions -->
      <div class="section">
        <div class="section-title">Follow-Up Actions</div>
        <div class="section-body">
          <ul>${followUpActionsHtml}</ul>
        </div>
      </div>

      <!-- Follow-Up Details -->
      <div class="section">
        <div class="section-title">Follow-Up Details</div>
        <div class="section-body">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <span style="font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Priority</span>
            ${priorityBadge(priority)}
          </div>
          ${sdr_notes
            ? `<div>
                <div style="font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">SDR Notes</div>
                <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:14px 16px;color:#cbd5e1;font-size:14px;line-height:1.7">${escapeHtml(sdr_notes)}</div>
              </div>`
            : '<p style="color:#64748b;font-style:italic">No SDR notes recorded</p>'}
        </div>
      </div>

    </div>
  </div>

  <div class="footer">
    <div class="container">
      Generated ${generatedDate} · Trend Micro Vision One Booth App
    </div>
  </div>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────

async function run() {
  console.log(`[render-report] Reading from ${sessionPath}`);

  // Load template
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  console.log(`[render-report] Template loaded: ${TEMPLATE_PATH}`);

  let summary, followUp, timeline;

  try {
    summary = await readJson('output/summary.json');
  } catch (err) {
    console.error(`[render-report] Failed to read output/summary.json: ${err.message}`);
    process.exit(1);
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
