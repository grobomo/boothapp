const express = require('express');

// Casey's feature document tasks submitted to the CCC worker fleet.
// Static definitions with status updated from task files or environment.
const FEATURES = [
  {
    id: 'feature-3',
    feature: 'Feature 3: QR Code Device Pairing',
    description: 'Generate QR codes on demo PCs that the Android app scans to pair devices. Links badge photo session to the correct demo PC automatically.',
    status: 'submitted',
    submitted_at: '2026-03-31',
    assignee: 'CCC Fleet',
    prs: []
  },
  {
    id: 'feature-5',
    feature: 'Feature 5: Demo Capture (Screenshots + Clicks)',
    description: 'Chrome extension captures every click with DOM path, coordinates, and a silent screenshot. Builds a full timeline of the demo for analysis.',
    status: 'completed',
    submitted_at: '2026-03-31',
    assignee: 'CCC Fleet',
    prs: []
  },
  {
    id: 'feature-7',
    feature: 'Feature 7: Session End + Packaging',
    description: 'When SE taps End Session, all data (audio, clicks, screenshots, metadata) is packaged and uploaded to S3 as a complete session bundle.',
    status: 'submitted',
    submitted_at: '2026-03-31',
    assignee: 'CCC Fleet',
    prs: []
  },
  {
    id: 'feature-8',
    feature: 'Feature 8: Session Import + Review',
    description: 'Presenter UI to import completed sessions, review AI analysis, view click timeline with screenshots, and approve follow-up content before sending.',
    status: 'submitted',
    submitted_at: '2026-03-31',
    assignee: 'CCC Fleet',
    prs: []
  },
  {
    id: 'feature-9',
    feature: 'Feature 9: Contact CSV Import + AI Matching',
    description: 'Import CSV of conference attendees, use AI to match badge OCR names to contacts, enrich session data with company/title/email for follow-up.',
    status: 'submitted',
    submitted_at: '2026-03-31',
    assignee: 'CCC Fleet',
    prs: []
  }
];

function loadTaskOverrides() {
  // Check for task status overrides via environment or task files
  const overrides = process.env.FEATURE_TASK_OVERRIDES;
  if (!overrides) return FEATURES;

  try {
    const parsed = JSON.parse(overrides);
    return FEATURES.map(f => {
      const override = parsed[f.id];
      if (override) return Object.assign({}, f, override);
      return f;
    });
  } catch (e) {
    return FEATURES;
  }
}

function createRouter() {
  const router = express.Router();

  router.get('/api/feature-tasks', (req, res) => {
    const tasks = loadTaskOverrides();
    res.json({
      tasks,
      count: tasks.length,
      source: 'CaseyApp_Feature_Document.md',
      updated_at: new Date().toISOString()
    });
  });

  return router;
}

module.exports = { createRouter, FEATURES };
