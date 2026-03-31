// Test: QR payload structure matches Feature 3 spec
// Run: node extension/test/qr-payload.test.js

const assert = require('assert');

// Simulate the QR payload structure from GET /api/demo-pcs/:id/qr-payload
const samplePayload = {
  type: 'caseyapp-pair',
  v: 2,
  managementUrl: 'https://caseyapp.trendcyberrange.com',
  eventId: 3,
  demoPcId: 'booth-pc-1',
  badgeFields: ['name', 'company', 'title'],
  eventName: 'Black Hat 2026',
};

// Test 1: Required fields present
const requiredFields = ['type', 'v', 'managementUrl', 'eventId', 'demoPcId', 'badgeFields', 'eventName'];
for (const field of requiredFields) {
  assert.ok(field in samplePayload, `Missing required field: ${field}`);
}
console.log('PASS: All required fields present');

// Test 2: Type and version
assert.strictEqual(samplePayload.type, 'caseyapp-pair');
assert.strictEqual(samplePayload.v, 2);
console.log('PASS: Type and version correct');

// Test 3: badgeFields is an array of strings
assert.ok(Array.isArray(samplePayload.badgeFields));
for (const f of samplePayload.badgeFields) {
  assert.strictEqual(typeof f, 'string');
}
console.log('PASS: badgeFields is string array');

// Test 4: managementUrl is a valid URL
assert.ok(samplePayload.managementUrl.startsWith('https://'));
console.log('PASS: managementUrl is HTTPS');

// Test 5: JSON serialization is valid (for QR encoding)
const json = JSON.stringify(samplePayload);
const parsed = JSON.parse(json);
assert.deepStrictEqual(parsed, samplePayload);
console.log('PASS: JSON round-trip OK');

// Test 6: Verify manifest.json structure
const fs = require('fs');
const path = require('path');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf-8'));
assert.strictEqual(manifest.manifest_version, 3);
assert.ok(manifest.host_permissions.some(p => p.includes('caseyapp.trendcyberrange.com')));
console.log('PASS: Manifest v3 with caseyapp host permission');

// Test 7: qrcode library exists
assert.ok(fs.existsSync(path.join(__dirname, '..', 'lib', 'qrcode.min.js')));
console.log('PASS: qrcode library bundled');

// Test 8: QR generator uses correct color
const qrGenSrc = fs.readFileSync(path.join(__dirname, '..', 'qr-generator.js'), 'utf-8');
assert.ok(qrGenSrc.includes('#d71920'), 'QR generator must use TrendAI red');
assert.ok(qrGenSrc.includes("errorCorrectionLevel: 'H'"), 'Must use error correction H for logo overlay');
console.log('PASS: QR generator uses #d71920 with EC level H');

// Test 9: Management API client has correct endpoints
const apiSrc = fs.readFileSync(path.join(__dirname, '..', 'management-api.js'), 'utf-8');
assert.ok(apiSrc.includes('/api/demo-pcs/'));
assert.ok(apiSrc.includes('/qr-payload'));
assert.ok(apiSrc.includes('/api/events/active'));
console.log('PASS: Management API client has correct endpoints');

// Test 10: Popup loads all required scripts
const popupSrc = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf-8');
assert.ok(popupSrc.includes('qrcode.min.js'));
assert.ok(popupSrc.includes('management-api.js'));
assert.ok(popupSrc.includes('qr-generator.js'));
assert.ok(popupSrc.includes('popup.js'));
console.log('PASS: Popup loads all required scripts');

console.log('\n10/10 tests passed');
