#!/usr/bin/env node
// Unit tests for analysis/email-report.js

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

function setupSession(dir, metadataOverrides, followUpOverrides) {
  const outputDir = path.join(dir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const metadata = Object.assign({
    session_id: 'TEST001',
    visitor_name: 'Jane Smith',
    started_at: '2026-08-05T14:32:00Z',
    ended_at: '2026-08-05T14:47:00Z',
    demo_pc: 'booth-pc-3',
    se_name: 'Casey Mondoux',
    status: 'completed',
  }, metadataOverrides || {});

  const followUp = Object.assign({
    session_id: 'TEST001',
    visitor_email: 'jane@acmecorp.com',
    visitor_company: 'Acme Corp',
    subject: 'Your Vision One Demo Summary',
    summary_url: 'https://example.com/summary',
    tenant_url: 'https://portal.xdr.trendmicro.com/tenant-abc',
    priority: 'high',
    tags: ['endpoint', 'xdr'],
    sdr_notes: 'CISO evaluating XDR solutions',
  }, followUpOverrides || {});

  const summaryHtml = '<h2>Executive Summary</h2><p>Visitor showed strong interest in endpoint detection.</p>';

  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  fs.writeFileSync(path.join(outputDir, 'follow-up.json'), JSON.stringify(followUp, null, 2));
  fs.writeFileSync(path.join(outputDir, 'summary.html'), summaryHtml);
}

function runEmailReport(sessionDir) {
  const script = path.join(__dirname, '..', 'email-report.js');
  execFileSync('node', [script, sessionDir], { stdio: 'pipe', timeout: 10000 });
  return fs.readFileSync(path.join(sessionDir, 'output', 'email-ready.html'), 'utf8');
}

// --- Test 1: Full data ---

console.log('\nTest 1: Full data - all fields present');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-test-'));
  setupSession(dir);
  const html = runEmailReport(dir);

  assert(html.includes('<!DOCTYPE html>'), 'valid HTML document');
  assert(html.includes('Jane Smith'), 'visitor name present');
  assert(html.includes('Acme Corp'), 'company present');
  assert(html.includes('Casey Mondoux'), 'SE name present');
  assert(html.includes('August 5, 2026'), 'formatted date present');
  assert(html.includes('jane@acmecorp.com'), 'visitor email present');
  assert(html.includes('high priority'), 'priority badge present');
  assert(html.includes('endpoint detection'), 'summary content embedded');
  assert(html.includes('Explore Vision One'), 'CTA button present');
  assert(html.includes('portal.xdr.trendmicro.com'), 'tenant URL in CTA');
  assert(html.includes('30 days'), 'tenant availability note present');
  assert(html.includes('TREND MICRO'), 'branding placeholder present');
  assert(html.includes('VISION ONE'), 'product branding present');
  assert(html.includes('LOGO PLACEHOLDER'), 'logo placeholder comment present');

  fs.rmSync(dir, { recursive: true });
}

// --- Test 2: Missing follow-up.json ---

console.log('\nTest 2: Missing follow-up.json - graceful defaults');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-test-'));
  setupSession(dir);
  fs.unlinkSync(path.join(dir, 'output', 'follow-up.json'));
  const html = runEmailReport(dir);

  assert(html.includes('Jane Smith'), 'visitor name from metadata');
  assert(html.includes('Explore Vision One'), 'CTA still present');
  assert(!html.includes('undefined'), 'no undefined values');

  fs.rmSync(dir, { recursive: true });
}

// --- Test 3: HTML escaping ---

console.log('\nTest 3: HTML escaping - XSS prevention');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-test-'));
  setupSession(dir, {
    visitor_name: '<script>alert("xss")</script>',
    se_name: 'O\'Reilly & Associates',
  });
  const html = runEmailReport(dir);

  assert(!html.includes('<script>alert'), 'script tags escaped');
  assert(html.includes('&lt;script&gt;'), 'angle brackets converted to entities');
  assert(html.includes('O&#39;Reilly &amp; Associates'), 'quotes and ampersands escaped');

  fs.rmSync(dir, { recursive: true });
}

// --- Test 4: Email-safe HTML structure ---

console.log('\nTest 4: Email-safe HTML structure');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-test-'));
  setupSession(dir);
  const html = runEmailReport(dir);

  assert(html.includes('role="presentation"'), 'tables use role=presentation');
  assert(html.includes('cellpadding="0"'), 'tables have cellpadding reset');
  assert(html.includes('style='), 'inline styles present (email-safe)');
  assert(!html.match(/<link\s+rel="stylesheet"/), 'no external stylesheets');
  assert(!html.match(/<style>/), 'no style blocks (all inline)');
  assert(html.includes('<!--[if mso]>'), 'Outlook conditional comments present');

  fs.rmSync(dir, { recursive: true });
}

// --- Test 5: Output size ---

console.log('\nTest 5: Output size is reasonable');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-test-'));
  setupSession(dir);
  const html = runEmailReport(dir);
  const sizeKb = Buffer.byteLength(html) / 1024;

  assert(sizeKb < 100, `HTML size ${sizeKb.toFixed(1)}KB under 100KB`);
  assert(sizeKb > 1, `HTML size ${sizeKb.toFixed(1)}KB is not suspiciously small`);

  fs.rmSync(dir, { recursive: true });
}

// --- Test 6: Minimal metadata ---

console.log('\nTest 6: Minimal metadata - only required fields');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-test-'));
  setupSession(dir, {
    session_id: 'MIN001',
    visitor_name: null,
    se_name: null,
    started_at: null,
  }, {
    visitor_email: null,
    visitor_company: null,
    tenant_url: null,
    priority: null,
  });
  const html = runEmailReport(dir);

  assert(html.includes('Valued Visitor'), 'fallback name used');
  assert(!html.includes('undefined'), 'no undefined leaked');
  assert(!html.includes('null'), 'no null leaked');
  assert(html.includes('Explore Vision One'), 'CTA still renders');

  fs.rmSync(dir, { recursive: true });
}

// --- Results ---

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
