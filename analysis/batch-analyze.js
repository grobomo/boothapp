#!/usr/bin/env node
// batch-analyze.js — Multi-session batch analysis
//
// Usage:
//   node batch-analyze.js <sessionDir1> <sessionDir2> ...
//   node batch-analyze.js --bucket <bucket> <sessionId1> <sessionId2> ...
//
// Reads summary.json, metadata.json, clicks.json, transcript.json from each session.
// Generates a cross-session HTML report: presenter/batch-report.html
//
// Patterns identified:
//   - V1 module popularity (clicks + transcript mentions)
//   - Common visitor questions (transcript analysis)
//   - Engagement by company size (duration, clicks, questions)
//   - Demo script optimization recommendations

'use strict';

const fs = require('fs');
const path = require('path');

const PRESENTER_DIR = path.join(__dirname, '..', 'presenter');
const OUTPUT_PATH = path.join(PRESENTER_DIR, 'batch-report.html');

// Single source of truth for product topics and normalizers — shared with correlator
const { PRODUCT_TOPICS, normalizeClicks, normalizeTranscript } = require('./lib/correlator');

// Company size buckets based on endpoint count or keywords in transcript
const SIZE_BUCKETS = [
  { label: 'Small (< 500)', max: 500 },
  { label: 'Mid-Market (500-5K)', max: 5000 },
  { label: 'Enterprise (5K-50K)', max: 50000 },
  { label: 'Large Enterprise (50K+)', max: Infinity },
];

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function tryReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadSessionLocal(dir) {
  const metadata = tryReadJson(path.join(dir, 'metadata.json'));
  const clicks = tryReadJson(path.join(dir, 'clicks', 'clicks.json'));
  const transcript = tryReadJson(path.join(dir, 'transcript', 'transcript.json'));
  const summary = tryReadJson(path.join(dir, 'output', 'summary.json'));
  const feedback = tryReadJson(path.join(dir, 'feedback.json'));
  if (!metadata) return null;
  return { dir, metadata, clicks, transcript, summary, feedback };
}

// ---------------------------------------------------------------------------
// Analysis functions
// ---------------------------------------------------------------------------

function detectModulesFromClicks(clicks) {
  const counts = {};
  const clicksArray = normalizeClicks(clicks);
  if (clicksArray.length === 0) return counts;
  for (const evt of clicksArray) {
    const text = [
      evt.page_title || '',
      evt.page_url || '',
      (evt.element && evt.element.text) || '',
      evt.dom_path || '',
    ].join(' ').toLowerCase();
    for (const prod of PRODUCT_TOPICS) {
      for (const kw of prod.keywords) {
        if (text.includes(kw)) {
          counts[prod.topic] = (counts[prod.topic] || 0) + 1;
          break;
        }
      }
    }
  }
  return counts;
}

function detectModulesFromTranscript(transcript) {
  const counts = {};
  const entries = normalizeTranscript(transcript).entries;
  if (entries.length === 0) return counts;
  for (const entry of entries) {
    const text = entry.text.toLowerCase();
    for (const prod of PRODUCT_TOPICS) {
      for (const kw of prod.keywords) {
        if (text.includes(kw)) {
          counts[prod.topic] = (counts[prod.topic] || 0) + 1;
          break;
        }
      }
    }
  }
  return counts;
}

function extractVisitorQuestions(transcript) {
  const entries = normalizeTranscript(transcript).entries;
  if (entries.length === 0) return [];
  return entries
    .filter(e => e.speaker === 'Visitor' && e.text.includes('?'))
    .map(e => e.text.trim());
}

function estimateCompanySize(transcript) {
  const entries = normalizeTranscript(transcript).entries;
  if (entries.length === 0) return null;
  const fullText = entries.map(e => e.text).join(' ');
  // Look for endpoint count mentions
  const match = fullText.match(/(\d[\d,]*)\s*endpoint/i);
  if (match) {
    const count = parseInt(match[1].replace(/,/g, ''), 10);
    for (const bucket of SIZE_BUCKETS) {
      if (count <= bucket.max) return { count, label: bucket.label };
    }
  }
  // Heuristic: look for size keywords
  const lower = fullText.toLowerCase();
  if (lower.includes('enterprise') || lower.includes('fortune') || lower.includes('global'))
    return { count: null, label: 'Enterprise (5K-50K)' };
  if (lower.includes('mid-size') || lower.includes('midsize') || lower.includes('mid-market'))
    return { count: null, label: 'Mid-Market (500-5K)' };
  if (lower.includes('small') || lower.includes('startup') || lower.includes('smb'))
    return { count: null, label: 'Small (< 500)' };
  return { count: null, label: 'Unknown' };
}

function computeSessionDuration(metadata) {
  if (!metadata.started_at || !metadata.ended_at) return 0;
  return (new Date(metadata.ended_at) - new Date(metadata.started_at)) / 1000;
}

// Group similar questions using simple keyword overlap
function clusterQuestions(questions) {
  const clusters = [];
  for (const q of questions) {
    const words = new Set(q.toLowerCase().replace(/[?.,!]/g, '').split(/\s+/).filter(w => w.length > 3));
    let matched = false;
    for (const cluster of clusters) {
      const overlap = [...cluster.words].filter(w => words.has(w)).length;
      if (overlap >= 2 || (words.size <= 3 && overlap >= 1)) {
        cluster.examples.push(q);
        cluster.count++;
        for (const w of words) cluster.words.add(w);
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ examples: [q], count: 1, words });
    }
  }
  return clusters
    .sort((a, b) => b.count - a.count)
    .map(c => ({ theme: c.examples[0], count: c.count, examples: c.examples.slice(0, 3) }));
}

// ---------------------------------------------------------------------------
// Aggregate across sessions
// ---------------------------------------------------------------------------

function analyzeAll(sessions) {
  const moduleClickCounts = {};
  const moduleTranscriptCounts = {};
  const allQuestions = [];
  const engagementBySize = {};
  const sessionSummaries = [];

  for (const s of sessions) {
    const duration = computeSessionDuration(s.metadata);
    const clickModules = detectModulesFromClicks(s.clicks);
    const transcriptModules = detectModulesFromTranscript(s.transcript);
    const questions = extractVisitorQuestions(s.transcript);
    const size = estimateCompanySize(s.transcript);
    const clickCount = normalizeClicks(s.clicks).length;

    // Accumulate module counts
    for (const [mod, cnt] of Object.entries(clickModules)) {
      moduleClickCounts[mod] = (moduleClickCounts[mod] || 0) + cnt;
    }
    for (const [mod, cnt] of Object.entries(transcriptModules)) {
      moduleTranscriptCounts[mod] = (moduleTranscriptCounts[mod] || 0) + cnt;
    }

    allQuestions.push(...questions);

    // Engagement by company size
    const sizeLabel = size ? size.label : 'Unknown';
    if (!engagementBySize[sizeLabel]) {
      engagementBySize[sizeLabel] = { sessions: 0, totalDuration: 0, totalClicks: 0, totalQuestions: 0 };
    }
    engagementBySize[sizeLabel].sessions++;
    engagementBySize[sizeLabel].totalDuration += duration;
    engagementBySize[sizeLabel].totalClicks += clickCount;
    engagementBySize[sizeLabel].totalQuestions += questions.length;

    sessionSummaries.push({
      id: s.metadata.session_id,
      visitor: s.metadata.visitor_name || 'Unknown',
      se: s.metadata.se_name || 'Unknown',
      duration,
      clickCount,
      questionCount: questions.length,
      topModules: Object.entries(clickModules).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]),
      score: s.summary ? s.summary.session_score : null,
      sizeLabel,
      rating: s.feedback ? s.feedback.rating : null,
    });
  }

  // Compute averages for engagement
  const engagementAvg = {};
  for (const [label, data] of Object.entries(engagementBySize)) {
    engagementAvg[label] = {
      sessions: data.sessions,
      avgDuration: Math.round(data.totalDuration / data.sessions),
      avgClicks: Math.round(data.totalClicks / data.sessions),
      avgQuestions: (data.totalQuestions / data.sessions).toFixed(1),
    };
  }

  // Top modules combined score
  const allModules = new Set([...Object.keys(moduleClickCounts), ...Object.keys(moduleTranscriptCounts)]);
  const moduleRanking = [...allModules].map(mod => ({
    module: mod,
    clicks: moduleClickCounts[mod] || 0,
    mentions: moduleTranscriptCounts[mod] || 0,
    combined: (moduleClickCounts[mod] || 0) + (moduleTranscriptCounts[mod] || 0),
  })).sort((a, b) => b.combined - a.combined);

  const questionClusters = clusterQuestions(allQuestions);

  // Generate optimization recommendations
  const recommendations = generateRecommendations(moduleRanking, questionClusters, engagementAvg, sessionSummaries);

  return {
    sessionCount: sessions.length,
    moduleRanking,
    questionClusters,
    engagementAvg,
    sessionSummaries,
    recommendations,
  };
}

function generateRecommendations(moduleRanking, questionClusters, engagementAvg, sessions) {
  const recs = [];
  // Top module recommendation
  if (moduleRanking.length > 0) {
    const top = moduleRanking[0];
    recs.push({
      category: 'Demo Flow',
      text: `Lead with ${top.module} -- it has the highest engagement across sessions (${top.combined} interactions).`,
    });
  }
  // Second module bridge
  if (moduleRanking.length > 1) {
    recs.push({
      category: 'Demo Flow',
      text: `Bridge from ${moduleRanking[0].module} to ${moduleRanking[1].module} early in the demo to cover the two most popular topics.`,
    });
  }
  // Low-engagement modules to drop
  const lowModules = moduleRanking.filter(m => m.combined <= 2);
  if (lowModules.length > 0) {
    recs.push({
      category: 'Efficiency',
      text: `Consider dropping ${lowModules.map(m => m.module).join(', ')} from the standard demo flow -- low engagement suggests visitors rarely ask about these.`,
    });
  }
  // Frequent questions -> prep answers
  if (questionClusters.length > 0) {
    const topQ = questionClusters[0];
    recs.push({
      category: 'Preparation',
      text: `Prepare a crisp answer for: "${topQ.theme}" -- asked ${topQ.count} time(s) across sessions.`,
    });
  }
  // Engagement by size insight
  const sizeEntries = Object.entries(engagementAvg).filter(([l]) => l !== 'Unknown');
  if (sizeEntries.length > 1) {
    const sorted = sizeEntries.sort((a, b) => b[1].avgDuration - a[1].avgDuration);
    recs.push({
      category: 'Audience',
      text: `${sorted[0][0]} visitors stay longest (avg ${Math.round(sorted[0][1].avgDuration / 60)} min). Prioritize depth for this segment.`,
    });
  }
  // Duration outlier
  const durations = sessions.map(s => s.duration).filter(d => d > 0);
  if (durations.length >= 3) {
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const short = sessions.filter(s => s.duration > 0 && s.duration < avg * 0.5);
    if (short.length > 0) {
      recs.push({
        category: 'Attention',
        text: `${short.length} session(s) ended in under half the average time. Review these for drop-off causes.`,
      });
    }
  }
  return recs;
}

// ---------------------------------------------------------------------------
// HTML report generation (CSS-only charts)
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function renderBarChart(items, maxVal, colorFn) {
  if (!items.length) return '<p class="empty">No data</p>';
  const rows = items.map((item, i) => {
    const pct = maxVal > 0 ? Math.round((item.value / maxVal) * 100) : 0;
    const color = colorFn ? colorFn(i) : '#58a6ff';
    return `<div class="bar-row">
      <span class="bar-label">${escapeHtml(item.label)}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="bar-value">${item.value}</span>
    </div>`;
  });
  return rows.join('\n');
}

function renderReport(data) {
  const moduleMax = data.moduleRanking.length > 0 ? data.moduleRanking[0].combined : 1;
  const moduleColors = ['#58a6ff', '#3fb950', '#d29922', '#f0883e', '#f85149', '#a371f7', '#79c0ff', '#56d364', '#e3b341', '#db6d28', '#ff7b72', '#bc8cff'];

  const moduleChartItems = data.moduleRanking.map(m => ({ label: m.module, value: m.combined }));
  const moduleClickItems = data.moduleRanking.map(m => ({ label: m.module, value: m.clicks }));
  const moduleMentionItems = data.moduleRanking.map(m => ({ label: m.module, value: m.mentions }));

  // Engagement comparison chart data
  const engagementLabels = Object.keys(data.engagementAvg);
  const engagementDurationMax = Math.max(...Object.values(data.engagementAvg).map(e => e.avgDuration), 1);
  const engagementClickMax = Math.max(...Object.values(data.engagementAvg).map(e => e.avgClicks), 1);

  const questionHtml = data.questionClusters.slice(0, 10).map((q, i) => `
    <div class="question-card">
      <div class="question-count">${q.count}x</div>
      <div class="question-text">${escapeHtml(q.theme)}</div>
      ${q.examples.length > 1 ? `<div class="question-variants">${q.examples.slice(1).map(e => `<div class="variant">${escapeHtml(e)}</div>`).join('')}</div>` : ''}
    </div>`).join('\n');

  const sessionRows = data.sessionSummaries.map(s => `
    <tr>
      <td class="mono">${escapeHtml(s.id)}</td>
      <td>${escapeHtml(s.visitor)}</td>
      <td>${escapeHtml(s.se)}</td>
      <td>${formatDuration(s.duration)}</td>
      <td>${s.clickCount}</td>
      <td>${s.questionCount}</td>
      <td>${s.score != null ? s.score + '/10' : '--'}</td>
      <td>${s.rating != null ? s.rating + '/5' : '--'}</td>
      <td>${s.topModules.map(m => `<span class="module-tag">${escapeHtml(m)}</span>`).join(' ')}</td>
      <td>${escapeHtml(s.sizeLabel)}</td>
    </tr>`).join('\n');

  const recHtml = data.recommendations.map(r => `
    <div class="rec-card">
      <span class="rec-category">${escapeHtml(r.category)}</span>
      <span class="rec-text">${escapeHtml(r.text)}</span>
    </div>`).join('\n');

  const engagementRows = engagementLabels.map(label => {
    const e = data.engagementAvg[label];
    return `<tr>
      <td>${escapeHtml(label)}</td>
      <td>${e.sessions}</td>
      <td>${formatDuration(e.avgDuration)}</td>
      <td>${e.avgClicks}</td>
      <td>${e.avgQuestions}</td>
    </tr>`;
  }).join('\n');

  // Stacked comparison: duration bars per size
  const durationBarItems = engagementLabels.map(l => ({
    label: l,
    value: data.engagementAvg[l].avgDuration,
  }));
  const clickBarItems = engagementLabels.map(l => ({
    label: l,
    value: data.engagementAvg[l].avgClicks,
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BoothApp — Batch Session Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0d1117;
    color: #e6edf3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    min-height: 100vh;
    padding: 2rem;
  }
  .container { max-width: 1200px; margin: 0 auto; }

  /* -- Header -- */
  header {
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem;
  }
  h1 { font-size: 1.8rem; font-weight: 600; color: #58a6ff; }
  .meta { color: #8b949e; font-size: 0.85rem; }

  /* -- KPI cards -- */
  .kpi-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem; margin-bottom: 2rem;
  }
  .kpi {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 1.2rem; text-align: center;
  }
  .kpi-value { font-size: 2rem; font-weight: 700; color: #58a6ff; }
  .kpi-label { font-size: 0.8rem; color: #8b949e; margin-top: 0.3rem; text-transform: uppercase; letter-spacing: 0.05em; }

  /* -- Sections -- */
  .section { margin-bottom: 2.5rem; }
  .section h2 {
    font-size: 1.3rem; font-weight: 600; color: #e6edf3;
    border-bottom: 1px solid #30363d; padding-bottom: 0.5rem; margin-bottom: 1rem;
  }

  /* -- Bar chart (CSS only) -- */
  .bar-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
  .bar-label { width: 200px; text-align: right; font-size: 0.85rem; color: #c9d1d9; flex-shrink: 0; }
  .bar-track { flex: 1; height: 24px; background: #21262d; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; min-width: 2px; }
  .bar-value { width: 40px; font-size: 0.85rem; color: #8b949e; text-align: right; flex-shrink: 0; }

  /* -- Chart grid -- */
  .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
  .chart-panel {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.2rem;
  }
  .chart-panel h3 { font-size: 1rem; color: #8b949e; margin-bottom: 0.75rem; }

  /* -- Donut chart (CSS only) -- */
  .donut-container { display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; }
  .donut {
    width: 160px; height: 160px; border-radius: 50%; position: relative; flex-shrink: 0;
  }
  .donut-center {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 80px; height: 80px; background: #161b22; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.4rem; font-weight: 700; color: #58a6ff;
  }
  .donut-legend { font-size: 0.8rem; }
  .donut-legend-item { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
  .legend-swatch { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }

  /* -- Questions -- */
  .question-card {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 1rem; margin-bottom: 0.75rem; display: flex; align-items: flex-start; gap: 1rem;
  }
  .question-count {
    background: #58a6ff22; color: #58a6ff; font-weight: 700; padding: 0.25rem 0.6rem;
    border-radius: 4px; font-size: 0.85rem; flex-shrink: 0;
  }
  .question-text { color: #c9d1d9; font-size: 0.95rem; }
  .question-variants { margin-top: 0.5rem; padding-left: 1rem; border-left: 2px solid #30363d; }
  .variant { color: #8b949e; font-size: 0.85rem; margin-bottom: 0.25rem; }

  /* -- Recommendations -- */
  .rec-card {
    background: #161b22; border-left: 3px solid #3fb950; border-radius: 0 8px 8px 0;
    padding: 1rem 1.2rem; margin-bottom: 0.75rem; display: flex; align-items: flex-start; gap: 1rem;
  }
  .rec-category {
    background: #3fb95022; color: #3fb950; font-size: 0.75rem; font-weight: 600;
    padding: 0.2rem 0.6rem; border-radius: 4px; text-transform: uppercase; flex-shrink: 0;
  }
  .rec-text { color: #c9d1d9; font-size: 0.9rem; }

  /* -- Table -- */
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .data-table th {
    text-align: left; padding: 0.6rem 0.75rem; border-bottom: 2px solid #30363d;
    color: #8b949e; font-weight: 600; text-transform: uppercase; font-size: 0.75rem;
    letter-spacing: 0.05em; position: sticky; top: 0; background: #0d1117;
  }
  .data-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid #21262d; }
  .data-table tr:hover td { background: #161b22; }
  .mono { font-family: monospace; }
  .module-tag {
    display: inline-block; background: #58a6ff15; color: #58a6ff; font-size: 0.75rem;
    padding: 0.15rem 0.5rem; border-radius: 4px; margin: 0.1rem;
  }
  .table-scroll { overflow-x: auto; }

  .empty { color: #484f58; font-style: italic; }

  /* -- Responsive -- */
  @media (max-width: 768px) {
    body { padding: 0.75rem; }
    h1 { font-size: 1.3rem; }
    .chart-grid { grid-template-columns: 1fr; }
    .bar-label { width: 120px; font-size: 0.75rem; }
    .kpi-row { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Batch Session Analysis</h1>
    <div class="meta">${data.sessionCount} sessions | Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
  </header>

  <!-- KPIs -->
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-value">${data.sessionCount}</div>
      <div class="kpi-label">Sessions</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${data.moduleRanking.length}</div>
      <div class="kpi-label">Modules Seen</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${data.questionClusters.reduce((s, q) => s + q.count, 0)}</div>
      <div class="kpi-label">Visitor Questions</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${data.sessionSummaries.length > 0 ? formatDuration(data.sessionSummaries.reduce((s, x) => s + x.duration, 0) / data.sessionSummaries.length) : '--'}</div>
      <div class="kpi-label">Avg Duration</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${data.sessionSummaries.length > 0 ? Math.round(data.sessionSummaries.reduce((s, x) => s + x.clickCount, 0) / data.sessionSummaries.length) : '--'}</div>
      <div class="kpi-label">Avg Clicks/Session</div>
    </div>
  </div>

  <!-- V1 Module Popularity -->
  <div class="section">
    <h2>V1 Module Popularity</h2>
    <div class="chart-grid">
      <div class="chart-panel">
        <h3>Combined Score (Clicks + Mentions)</h3>
        ${renderBarChart(moduleChartItems, moduleMax, i => moduleColors[i % moduleColors.length])}
      </div>
      <div class="chart-panel">
        <h3>Module Popularity Donut</h3>
        <div class="donut-container">
          ${renderDonut(moduleChartItems.slice(0, 8), moduleColors)}
        </div>
      </div>
      <div class="chart-panel">
        <h3>Click Interactions</h3>
        ${renderBarChart(moduleClickItems, Math.max(...moduleClickItems.map(m => m.value), 1), i => moduleColors[i % moduleColors.length])}
      </div>
      <div class="chart-panel">
        <h3>Transcript Mentions</h3>
        ${renderBarChart(moduleMentionItems, Math.max(...moduleMentionItems.map(m => m.value), 1), i => moduleColors[i % moduleColors.length])}
      </div>
    </div>
  </div>

  <!-- Engagement by Company Size -->
  <div class="section">
    <h2>Engagement by Company Size</h2>
    <div class="chart-grid">
      <div class="chart-panel">
        <h3>Avg Duration (seconds)</h3>
        ${renderBarChart(durationBarItems, engagementDurationMax, () => '#d29922')}
      </div>
      <div class="chart-panel">
        <h3>Avg Clicks per Session</h3>
        ${renderBarChart(clickBarItems, engagementClickMax, () => '#a371f7')}
      </div>
    </div>
    <div class="chart-panel" style="margin-top:1rem">
      <h3>Breakdown Table</h3>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Company Size</th><th>Sessions</th><th>Avg Duration</th><th>Avg Clicks</th><th>Avg Questions</th></tr></thead>
          <tbody>${engagementRows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Common Visitor Questions -->
  <div class="section">
    <h2>Common Visitor Questions</h2>
    ${questionHtml || '<p class="empty">No visitor questions found</p>'}
  </div>

  <!-- Demo Script Recommendations -->
  <div class="section">
    <h2>Demo Script Optimization</h2>
    ${recHtml || '<p class="empty">Not enough data for recommendations</p>'}
  </div>

  <!-- Session Comparison Table -->
  <div class="section">
    <h2>Session Comparison</h2>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Session</th><th>Visitor</th><th>SE</th><th>Duration</th>
            <th>Clicks</th><th>Questions</th><th>Score</th><th>Rating</th>
            <th>Top Modules</th><th>Company Size</th>
          </tr>
        </thead>
        <tbody>${sessionRows}</tbody>
      </table>
    </div>
  </div>
</div>
</body>
</html>`;
}

function renderDonut(items, colors) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return '<p class="empty">No data</p>';

  // Build conic-gradient stops
  let cumPct = 0;
  const stops = [];
  for (let i = 0; i < items.length; i++) {
    const pct = (items[i].value / total) * 100;
    stops.push(`${colors[i % colors.length]} ${cumPct}% ${cumPct + pct}%`);
    cumPct += pct;
  }

  const legendItems = items.map((item, i) => {
    const pct = Math.round((item.value / total) * 100);
    return `<div class="donut-legend-item">
      <span class="legend-swatch" style="background:${colors[i % colors.length]}"></span>
      ${escapeHtml(item.label)} (${pct}%)
    </div>`;
  }).join('');

  return `<div class="donut" style="background:conic-gradient(${stops.join(', ')})">
    <div class="donut-center">${total}</div>
  </div>
  <div class="donut-legend">${legendItems}</div>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node batch-analyze.js <sessionDir1> [sessionDir2] ...');
    console.error('       node batch-analyze.js --sample   (run with built-in sample data)');
    process.exit(1);
  }

  let sessions;

  if (args[0] === '--sample') {
    // Use sample data directory (duplicated to simulate multiple sessions)
    const sampleDir = path.join(__dirname, 'sample_data');
    const sample = loadSampleSession(sampleDir);
    if (!sample) {
      console.error('[batch-analyze] Could not load sample data from', sampleDir);
      process.exit(1);
    }
    sessions = generateSampleBatch(sample);
    console.log(`[batch-analyze] Using ${sessions.length} synthetic sessions from sample data`);
  } else {
    sessions = [];
    for (const dir of args) {
      const resolved = path.resolve(dir);
      const session = loadSessionLocal(resolved);
      if (session) {
        sessions.push(session);
        console.log(`[batch-analyze] Loaded session ${session.metadata.session_id} from ${resolved}`);
      } else {
        console.warn(`[batch-analyze] Skipping ${resolved} — no metadata.json found`);
      }
    }
  }

  if (sessions.length === 0) {
    console.error('[batch-analyze] No valid sessions found');
    process.exit(1);
  }

  const report = analyzeAll(sessions);
  const html = renderReport(report);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, html, 'utf8');
  console.log(`[batch-analyze] Report written to ${OUTPUT_PATH}`);
  console.log(`[batch-analyze] ${report.sessionCount} sessions, ${report.moduleRanking.length} modules, ${report.recommendations.length} recommendations`);
}

// Load sample_data which has flat files (not nested in session dirs)
function loadSampleSession(sampleDir) {
  const metadata = tryReadJson(path.join(sampleDir, 'sample_metadata.json'));
  const clicks = tryReadJson(path.join(sampleDir, 'sample_clicks.json'));
  const transcript = tryReadJson(path.join(sampleDir, 'sample_transcript.json'));
  if (!metadata) return null;
  return { dir: sampleDir, metadata, clicks, transcript, summary: null, feedback: null };
}

// Generate synthetic variations for demo/testing
function generateSampleBatch(base) {
  const visitors = [
    { name: 'Priya Sharma', company: 'mid-size financial firm, about 3,500 endpoints', se: 'Casey Mondoux' },
    { name: 'Marcus Chen', company: 'enterprise manufacturing, 22,000 endpoints globally', se: 'Tom Gamull' },
    { name: 'Sarah O\'Brien', company: 'small SaaS startup, maybe 200 endpoints', se: 'Casey Mondoux' },
    { name: 'Kenji Tanaka', company: 'Fortune 500 retailer, 85,000 endpoints across stores', se: 'Kush Mangat' },
    { name: 'Anna Mueller', company: 'mid-market healthcare org with 4,000 endpoints', se: 'Tom Gamull' },
  ];

  return visitors.map((v, i) => {
    const meta = { ...base.metadata };
    meta.session_id = `BATCH${String(i + 1).padStart(3, '0')}`;
    meta.visitor_name = v.name;
    meta.se_name = v.se;
    // Vary duration
    const durationMin = 10 + Math.floor(i * 5);
    const start = new Date('2026-08-06T10:00:00Z');
    start.setMinutes(start.getMinutes() + i * 30);
    meta.started_at = start.toISOString();
    const end = new Date(start.getTime() + durationMin * 60 * 1000);
    meta.ended_at = end.toISOString();

    // Vary transcript — swap company description
    const transcript = base.transcript ? JSON.parse(JSON.stringify(base.transcript)) : null;
    if (transcript && transcript.entries && transcript.entries.length > 1) {
      transcript.entries[1].text = `Thanks. We're a ${v.company}. Our biggest concern is endpoint security.`;
    }

    // Vary clicks — take subset
    const clicks = base.clicks ? JSON.parse(JSON.stringify(base.clicks)) : null;
    if (clicks && clicks.events) {
      const take = Math.max(3, clicks.events.length - i);
      clicks.events = clicks.events.slice(0, take);
    }

    const rating = [4, 5, 3, 5, 4][i];
    const feedback = { session_id: meta.session_id, rating, rating_label: ['', '', '', 'Good', 'Very Good', 'Excellent'][rating] };

    return { dir: base.dir, metadata: meta, clicks, transcript, summary: null, feedback };
  });
}

main();
