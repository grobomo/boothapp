'use strict';

// ---------------------------------------------------------------------------
// Render Report — generates summary.html from correlator output.
//
// Produces a self-contained HTML report with inline CSS (no external deps).
// Includes visitor badge photo display with circular thumbnail, or a
// CSS-only placeholder avatar when no badge photo exists.
// ---------------------------------------------------------------------------

/**
 * Build the visitor avatar HTML — either a circular badge photo or a
 * CSS placeholder silhouette.
 *
 * @param {string|null} badgePhotoUrl - S3 presigned URL or relative path to badge.jpg
 * @returns {string} HTML string for the avatar element
 */
function buildAvatarHtml(badgePhotoUrl) {
  if (badgePhotoUrl) {
    return `<img class="badge-photo" src="${escapeAttr(badgePhotoUrl)}" alt="Visitor badge photo" />`;
  }

  // CSS-only placeholder: inline SVG silhouette
  return [
    '<div class="badge-placeholder">',
    '  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">',
    '    <circle cx="50" cy="38" r="18" fill="#94a3b8"/>',
    '    <ellipse cx="50" cy="80" rx="30" ry="22" fill="#94a3b8"/>',
    '  </svg>',
    '</div>',
  ].join('\n');
}

/**
 * Build the visitor info header card HTML.
 *
 * @param {Object} visitor
 * @param {string} [visitor.name]
 * @param {string} [visitor.company]
 * @param {string} [visitor.visitDate]
 * @param {string|null} [visitor.badgePhotoUrl]
 * @returns {string} HTML for the header card
 */
function buildVisitorCard(visitor) {
  const v = visitor || {};
  const name = v.name || 'Unknown Visitor';
  const company = v.company || '';
  const visitDate = v.visitDate || '';
  const avatarHtml = buildAvatarHtml(v.badgePhotoUrl || null);

  const lines = [
    '<div class="visitor-card">',
    `  ${avatarHtml}`,
    '  <div class="visitor-details">',
    `    <h2 class="visitor-name">${escapeHtml(name)}</h2>`,
  ];

  if (company) {
    lines.push(`    <p class="visitor-company">${escapeHtml(company)}</p>`);
  }
  if (visitDate) {
    lines.push(`    <p class="visitor-date">${escapeHtml(visitDate)}</p>`);
  }

  lines.push('  </div>');
  lines.push('</div>');
  return lines.join('\n');
}

/**
 * Build engagement summary section.
 *
 * @param {Object} summary - correlator summary object
 * @returns {string} HTML
 */
function buildEngagementSection(summary) {
  const s = summary || {};
  const topics = (s.topics || []).map((t) => `<span class="topic-tag">${escapeHtml(t)}</span>`).join(' ');
  const avg = s.avgEngagement || 'low';
  const total = s.totalSegments || 0;

  return [
    '<div class="section engagement-summary">',
    '  <h3>Engagement Summary</h3>',
    `  <p>Segments: <strong>${total}</strong> | Overall engagement: <span class="engagement-${avg}">${avg}</span></p>`,
    topics ? `  <p>Topics: ${topics}</p>` : '',
    '</div>',
  ].filter(Boolean).join('\n');
}

/**
 * Build timeline section from segments.
 *
 * @param {Array} segments - correlator segments
 * @returns {string} HTML
 */
function buildTimelineSection(segments) {
  if (!segments || !segments.length) return '';

  const rows = segments.map((seg, i) => {
    const score = seg.engagement_score || 'low';
    const topics = (seg.topics || []).join(', ');
    const clicks = (seg.clicks || []).length;
    const text = seg.transcript_text
      ? (seg.transcript_text.length > 120 ? seg.transcript_text.slice(0, 117) + '...' : seg.transcript_text)
      : '-';
    return [
      '  <tr>',
      `    <td>${i + 1}</td>`,
      `    <td><span class="engagement-${score}">${score}</span></td>`,
      `    <td>${clicks}</td>`,
      `    <td>${escapeHtml(topics) || '-'}</td>`,
      `    <td>${escapeHtml(text)}</td>`,
      '  </tr>',
    ].join('\n');
  });

  return [
    '<div class="section timeline">',
    '  <h3>Session Timeline</h3>',
    '  <table>',
    '    <thead><tr><th>#</th><th>Engagement</th><th>Clicks</th><th>Topics</th><th>Transcript</th></tr></thead>',
    '    <tbody>',
    ...rows,
    '    </tbody>',
    '  </table>',
    '</div>',
  ].join('\n');
}

/**
 * Render the full summary HTML report.
 *
 * @param {Object} data
 * @param {Object} data.correlator - output from correlate() { segments, summary }
 * @param {Object} [data.visitor]  - { name, company, visitDate, badgePhotoUrl }
 * @param {string} [data.title]    - page title
 * @returns {string} complete HTML document
 */
function renderSummaryHtml(data) {
  const d = data || {};
  const correlator = d.correlator || {};
  const title = d.title || 'Visitor Session Report';
  const visitor = d.visitor || {};

  const visitorCard = buildVisitorCard(visitor);
  const engagement = buildEngagementSection(correlator.summary);
  const timeline = buildTimelineSection(correlator.segments);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; color: #1e293b; line-height: 1.6; padding: 2rem; }
.report { max-width: 800px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #0f172a; }

.visitor-card {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  background: #fff;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  margin-bottom: 1.5rem;
}
.badge-photo {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  border: 3px solid #e2e8f0;
}
.badge-placeholder {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: #e2e8f0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 3px solid #e2e8f0;
}
.badge-placeholder svg {
  width: 60px;
  height: 60px;
}
.visitor-details { flex: 1; }
.visitor-name { font-size: 1.25rem; font-weight: 600; color: #0f172a; margin-bottom: 0.25rem; }
.visitor-company { color: #475569; font-size: 0.95rem; }
.visitor-date { color: #94a3b8; font-size: 0.85rem; margin-top: 0.25rem; }

.section { background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
.section h3 { font-size: 1.1rem; margin-bottom: 0.75rem; color: #0f172a; }
.topic-tag { display: inline-block; background: #dbeafe; color: #1e40af; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 500; }
.engagement-high { color: #16a34a; font-weight: 600; }
.engagement-medium { color: #ca8a04; font-weight: 600; }
.engagement-low { color: #94a3b8; font-weight: 600; }

table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
th { background: #f8fafc; font-weight: 600; color: #475569; }
</style>
</head>
<body>
<div class="report">
<h1>${escapeHtml(title)}</h1>
${visitorCard}
${engagement}
${timeline}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

module.exports = {
  renderSummaryHtml,
  buildAvatarHtml,
  buildVisitorCard,
  buildEngagementSection,
  buildTimelineSection,
};
