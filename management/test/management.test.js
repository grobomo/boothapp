'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Use temp DB
const tmpDb = path.join(__dirname, '..', 'data', 'test-' + Date.now() + '.db');
process.env.MANAGEMENT_DB = tmpDb;

const app = require('../server');

let server;
let port;
let token;

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;

    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

async function run() {
  console.log('Management Server Tests');
  console.log('=======================\n');

  server = app.listen(0);
  port = server.address().port;
  console.log('Test server on port ' + port + '\n');

  // --- Health ---
  console.log('[Health]');
  let r = await req('GET', '/api/health');
  ok(r.status === 200, 'health returns 200');
  ok(r.body.status === 'ok', 'health body ok');

  // --- Auth: no token ---
  console.log('\n[Auth - Unauthenticated]');
  r = await req('GET', '/api/events');
  ok(r.status === 401, 'events require auth');

  // --- Auth: login ---
  console.log('\n[Auth - Login]');
  r = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin' });
  ok(r.status === 200, 'login succeeds');
  ok(r.body.token, 'returns token');
  ok(r.body.user.role === 'admin', 'user is admin');
  ok(r.body.user.force_password_change === true, 'force password change flag');
  token = r.body.token;

  // --- Auth: change password ---
  console.log('\n[Auth - Change Password]');
  r = await req('POST', '/api/auth/change-password', { new_password: 'newpass123' });
  ok(r.status === 200, 'password changed');

  // --- Auth: me ---
  r = await req('GET', '/api/auth/me');
  ok(r.status === 200, '/me returns user');
  ok(r.body.user.username === 'admin', '/me username correct');

  // --- Events ---
  console.log('\n[Events]');
  r = await req('POST', '/api/events', { name: 'RSA 2026', date: '2026-05-04', location: 'San Francisco' });
  ok(r.status === 201, 'create event');
  const eventId = r.body.id;
  ok(eventId, 'event has id');

  r = await req('GET', '/api/events');
  ok(r.status === 200, 'list events');
  ok(r.body.events.length >= 1, 'events not empty');

  r = await req('PUT', '/api/events/' + eventId, { name: 'RSA 2026 Updated', date: '2026-05-05', location: 'SF' });
  ok(r.status === 200, 'update event');

  r = await req('POST', '/api/events/' + eventId + '/activate');
  ok(r.status === 200, 'activate event');

  r = await req('GET', '/api/events/active');
  ok(r.status === 200, 'get active event');
  ok(r.body.event.id === eventId, 'active event matches');

  // --- Demo PCs ---
  console.log('\n[Demo PCs]');
  r = await req('POST', '/api/demo-pcs', { name: 'Demo-Laptop-1', event_id: eventId });
  ok(r.status === 201, 'create demo pc');
  const pcId = r.body.id;

  r = await req('GET', '/api/demo-pcs?event_id=' + eventId);
  ok(r.status === 200, 'list demo pcs');
  ok(r.body.demo_pcs.length === 1, 'one demo pc');

  r = await req('GET', '/api/demo-pcs/' + pcId + '/qr-payload');
  ok(r.status === 200, 'qr payload');
  ok(r.body.payload.type === 'caseyapp-pair', 'qr payload type');
  ok(r.body.payload.v === 2, 'qr payload v2');

  // --- Badge Profiles ---
  console.log('\n[Badge Profiles]');
  r = await req('POST', '/api/badges/profiles', {
    name: 'RSA Badge', event_id: eventId,
    field_mappings: [{ field_type: 'name', label: 'Name' }, { field_type: 'company', label: 'Company' }],
  });
  ok(r.status === 201, 'create badge profile');
  const profileId = r.body.id;

  r = await req('GET', '/api/badges/profiles/' + profileId);
  ok(r.status === 200, 'get badge profile');
  ok(r.body.profile.field_mappings.length === 2, 'profile has 2 field mappings');

  r = await req('PUT', '/api/badges/profiles/' + profileId, {
    field_mappings: [{ field_type: 'name', label: 'Full Name' }],
    extraction_prompt: 'Extract name only',
  });
  ok(r.status === 200, 'update badge profile');

  // --- Sessions ---
  console.log('\n[Sessions]');
  r = await req('POST', '/api/sessions/create', {
    event_id: eventId, visitor_name: 'Jane Smith', visitor_company: 'Acme Corp', visitor_title: 'CTO',
  });
  ok(r.status === 201, 'create session');
  const sessionId = r.body.session_id;
  ok(sessionId, 'session has id');

  r = await req('GET', '/api/sessions?event_id=' + eventId);
  ok(r.status === 200, 'list sessions');
  ok(r.body.sessions.length === 1, 'one session');

  r = await req('GET', '/api/sessions/' + sessionId);
  ok(r.status === 200, 'get session by id');
  ok(r.body.session.visitor_name === 'Jane Smith', 'visitor name correct');

  r = await req('POST', '/api/sessions/' + sessionId + '/stop-audio');
  ok(r.status === 200, 'stop audio');
  ok(r.body.audio_opted_out === true, 'audio opted out');

  r = await req('POST', '/api/sessions/' + sessionId + '/end');
  ok(r.status === 200, 'end session');
  ok(r.body.status === 'complete', 'session complete');

  // --- Pairing ---
  console.log('\n[Pairing]');
  r = await req('POST', '/api/pair', { event_id: eventId, demo_pc_id: pcId, device_id: 'phone-abc123', device_name: 'SE Phone 1' });
  ok(r.status === 200, 'pair device to demo pc');
  ok(r.body.paired === true, 'pairing confirmed');
  ok(r.body.event_name, 'pairing returns event name');

  r = await req('GET', '/api/pair/status/' + pcId);
  ok(r.status === 200, 'check pairing status');
  ok(r.body.paired === true, 'demo pc is paired');
  ok(r.body.device_id === 'phone-abc123', 'paired device id correct');

  // Re-pair (upsert)
  r = await req('POST', '/api/pair', { event_id: eventId, demo_pc_id: pcId, device_id: 'phone-xyz999', device_name: 'SE Phone 2' });
  ok(r.status === 200, 're-pair succeeds');

  r = await req('GET', '/api/pair/status/' + pcId);
  ok(r.body.device_id === 'phone-xyz999', 're-pair updated device');

  // --- Badge Scan & Start ---
  console.log('\n[Badge Scan & Start]');
  r = await req('POST', '/api/badges/scan-and-start', { event_id: eventId, demo_pc_id: pcId, visitor_name: 'Bob Test', visitor_company: 'TestCorp' });
  ok(r.status === 201, 'scan-and-start creates session');
  ok(r.body.session_id, 'scan-and-start returns session id');
  ok(r.body.visitor_name === 'Bob Test', 'scan-and-start visitor name');
  ok(r.body.source === 'badge-scan', 'scan-and-start source is badge-scan');
  const scanSessionId = r.body.session_id;

  r = await req('GET', '/api/sessions/' + scanSessionId);
  ok(r.status === 200, 'scan-created session exists in db');
  ok(r.body.session.visitor_company === 'TestCorp', 'scan-created session has company');

  // --- Contacts ---
  console.log('\n[Contacts]');
  r = await req('GET', '/api/contacts?event_id=' + eventId);
  ok(r.status === 200, 'list contacts (empty)');
  ok(r.body.contacts.length === 0, 'no contacts yet');

  // Contact matching with no contacts
  r = await req('POST', '/api/contacts/match', { event_id: eventId });
  ok(r.status === 200, 'match with no contacts');

  // --- User Management ---
  console.log('\n[User Management]');
  r = await req('POST', '/api/auth/users', { username: 'testuser', password: 'testpass', role: 'user' });
  ok(r.status === 201, 'create user');
  const userId = r.body.id;

  r = await req('GET', '/api/auth/users');
  ok(r.status === 200, 'list users');
  ok(r.body.users.length === 2, 'two users');

  r = await req('POST', '/api/auth/users/' + userId + '/reset-password', { new_password: 'newtest' });
  ok(r.status === 200, 'reset user password');

  r = await req('DELETE', '/api/auth/users/' + userId);
  ok(r.status === 200, 'delete user');

  // --- Static file serving ---
  console.log('\n[Dashboard]');
  r = await req('GET', '/');
  ok(r.status === 200, 'serves index.html');
  ok(typeof r.body === 'string' && r.body.includes('CaseyApp'), 'index.html contains CaseyApp');

  // --- Cleanup ---
  console.log('\n[Cleanup]');
  r = await req('DELETE', '/api/pair/' + pcId);
  ok(r.status === 200, 'unpair device');

  r = await req('DELETE', '/api/demo-pcs/' + pcId);
  ok(r.status === 200, 'delete demo pc');

  r = await req('DELETE', '/api/events/' + eventId);
  ok(r.status === 200, 'delete event');

  r = await req('POST', '/api/auth/logout');
  ok(r.status === 200, 'logout');

  // Verify logged out
  token = null;
  r = await req('GET', '/api/events');
  ok(r.status === 401, 'logged out requires auth');

  // --- Summary ---
  console.log('\n=======================');
  console.log('Passed: ' + passed + '  Failed: ' + failed);
  console.log('Total: ' + (passed + failed));

  server.close();
  try { fs.unlinkSync(tmpDb); } catch (_) {}

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  if (server) server.close();
  try { fs.unlinkSync(tmpDb); } catch (_) {}
  process.exit(1);
});
