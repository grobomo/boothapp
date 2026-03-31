// Management Server API Tests
// Run: npm test (starts server, runs tests, shuts down)
// Requires: better-sqlite3 (uses in-memory DB via MANAGEMENT_DB=:memory:)

const http = require('http');
const path = require('path');

const PORT = 14567; // High port to avoid conflicts
const BASE = `http://localhost:${PORT}`;
let passed = 0;
let failed = 0;
let sessionCookie = '';
let server;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' }
    };
    if (sessionCookie) opts.headers['Cookie'] = sessionCookie;

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        // Capture Set-Cookie for session management
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, body: parsed, setCookie });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}`);
    failed++;
  }
}

async function run() {
  console.log('CaseyApp Management Server -- API Tests\n');

  // --------------------------------------------------
  // Health
  // --------------------------------------------------
  console.log('[Health]');
  const health = await request('GET', '/api/health');
  assert('returns 200', health.status === 200);
  assert('status is ok', health.body.status === 'ok');
  assert('has version', typeof health.body.version === 'string');

  // --------------------------------------------------
  // Auth -- no cookie
  // --------------------------------------------------
  console.log('\n[Auth Guards]');
  const noAuth = await request('GET', '/api/events');
  assert('events without auth returns 401', noAuth.status === 401);

  const noAuthUsers = await request('GET', '/api/users');
  assert('users without auth returns 401', noAuthUsers.status === 401);

  // --------------------------------------------------
  // Auth -- bad credentials
  // --------------------------------------------------
  console.log('\n[Auth - Login]');
  const badLogin = await request('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
  assert('bad password returns 401', badLogin.status === 401);

  const missingFields = await request('POST', '/api/auth/login', {});
  assert('missing fields returns 400', missingFields.status === 400);

  // Login with default admin
  const login = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin' });
  assert('admin login returns 200', login.status === 200);
  assert('returns username', login.body.username === 'admin');
  assert('returns role', login.body.role === 'admin');
  assert('force_password_change is true', login.body.force_password_change === true);
  assert('sets session cookie', login.setCookie && login.setCookie.some(c => c.startsWith('session=')));

  // Extract session cookie
  if (login.setCookie) {
    const raw = login.setCookie.find(c => c.startsWith('session='));
    if (raw) sessionCookie = raw.split(';')[0];
  }

  // --------------------------------------------------
  // Auth -- me endpoint
  // --------------------------------------------------
  console.log('\n[Auth - Me]');
  const me = await request('GET', '/api/auth/me');
  assert('me returns 200', me.status === 200);
  assert('me returns admin username', me.body.username === 'admin');

  // --------------------------------------------------
  // Auth -- change password
  // --------------------------------------------------
  console.log('\n[Auth - Password Change]');
  const shortPw = await request('POST', '/api/auth/change-password', { new_password: 'ab' });
  assert('short password returns 400', shortPw.status === 400);

  const changePw = await request('POST', '/api/auth/change-password', { new_password: 'newpass123' });
  assert('change password returns 200', changePw.status === 200);
  assert('changed flag is true', changePw.body.changed === true);

  // Verify force_password_change cleared
  const meAfter = await request('GET', '/api/auth/me');
  assert('force_password_change now false', meAfter.body.force_password_change === false);

  // Re-login with new password
  const reLogin = await request('POST', '/api/auth/login', { username: 'admin', password: 'newpass123' });
  assert('re-login with new password works', reLogin.status === 200);
  if (reLogin.setCookie) {
    const raw = reLogin.setCookie.find(c => c.startsWith('session='));
    if (raw) sessionCookie = raw.split(';')[0];
  }

  // --------------------------------------------------
  // Events CRUD
  // --------------------------------------------------
  console.log('\n[Events]');
  const createEvent = await request('POST', '/api/events', { name: 'Black Hat 2026', date: '2026-08-01', location: 'Las Vegas' });
  assert('create event returns 201', createEvent.status === 201);
  assert('event has name', createEvent.body.name === 'Black Hat 2026');
  assert('event has id', typeof createEvent.body.id === 'number');
  const eventId = createEvent.body.id;

  const noName = await request('POST', '/api/events', {});
  assert('create event without name returns 400', noName.status === 400);

  const listEvents = await request('GET', '/api/events');
  assert('list events returns 200', listEvents.status === 200);
  assert('events array has 1 item', listEvents.body.events.length === 1);

  const updateEvent = await request('PUT', `/api/events/${eventId}`, { location: 'Mandalay Bay' });
  assert('update event returns 200', updateEvent.status === 200);
  assert('location updated', updateEvent.body.location === 'Mandalay Bay');

  // Activate event
  const activate = await request('POST', `/api/events/${eventId}/activate`);
  assert('activate event returns 200', activate.status === 200);
  assert('event is active', activate.body.active === 1);

  const activeEvent = await request('GET', '/api/events/active');
  assert('get active event returns 200', activeEvent.status === 200);
  assert('active event matches', activeEvent.body.id === eventId);

  // --------------------------------------------------
  // Demo PCs
  // --------------------------------------------------
  console.log('\n[Demo PCs]');
  const createPC = await request('POST', '/api/demo-pcs', { name: 'booth-pc-1', event_id: eventId });
  assert('create demo PC returns 201', createPC.status === 201);
  assert('PC has name', createPC.body.name === 'booth-pc-1');
  const pcId = createPC.body.id;

  const noPcName = await request('POST', '/api/demo-pcs', { event_id: eventId });
  assert('create PC without name returns 400', noPcName.status === 400);

  const listPCs = await request('GET', `/api/events/${eventId}/demo-pcs`);
  assert('list PCs returns 200', listPCs.status === 200);
  assert('PCs array has 1 item', listPCs.body.demo_pcs.length === 1);

  // QR pairing payload
  const qr = await request('GET', `/api/demo-pcs/${pcId}/qr-payload`);
  assert('qr payload returns 200', qr.status === 200);
  assert('qr type is caseyapp-pair', qr.body.type === 'caseyapp-pair');
  assert('qr version is 2', qr.body.v === 2);
  assert('qr has eventId', qr.body.eventId === eventId);
  assert('qr has demoPcId', qr.body.demoPcId === 'booth-pc-1');
  assert('qr has badgeFields', Array.isArray(qr.body.badgeFields));
  assert('qr has eventName', qr.body.eventName === 'Black Hat 2026');

  // --------------------------------------------------
  // Sessions (DB-only, S3 calls may fail without credentials)
  // --------------------------------------------------
  console.log('\n[Sessions]');
  const createSession = await request('POST', '/api/sessions', {
    visitor_name: 'Sarah Mitchell',
    visitor_company: 'Acme Corp',
    visitor_title: 'VP SecOps',
    demo_pc: 'booth-pc-1',
    event_id: eventId
  });

  if (createSession.status === 201) {
    assert('create session returns 201', true);
    assert('session has id', typeof createSession.body.session_id === 'string');
    const sessionId = createSession.body.session_id;

    const listSessions = await request('GET', `/api/sessions?event_id=${eventId}`);
    assert('list sessions returns 200', listSessions.status === 200);
    assert('sessions has items', listSessions.body.sessions.length >= 1);

    const getSession = await request('GET', `/api/sessions/${sessionId}`);
    assert('get session returns 200', getSession.status === 200);
    assert('session has visitor name', getSession.body.visitor_name === 'Sarah Mitchell');

    // Stop audio
    const stopAudio = await request('POST', `/api/sessions/${sessionId}/stop-audio`);
    if (stopAudio.status === 200) {
      assert('stop audio returns 200', true);
      assert('audio_opted_out is true', stopAudio.body.audio_opted_out === true);
    } else {
      console.log('  SKIP  stop-audio (S3 error, expected without credentials)');
    }

    // End session
    const endSession = await request('POST', `/api/sessions/${sessionId}/end`);
    if (endSession.status === 200) {
      assert('end session returns 200', true);
      assert('session status is ended', endSession.body.status === 'ended');
    } else {
      console.log('  SKIP  end-session (S3 error, expected without credentials)');
    }
  } else {
    console.log('  SKIP  session tests (S3 access required for create)');
  }

  // --------------------------------------------------
  // Users (admin only)
  // --------------------------------------------------
  console.log('\n[Users]');
  const listUsers = await request('GET', '/api/users');
  assert('list users returns 200', listUsers.status === 200);
  assert('users has admin', listUsers.body.users.some(u => u.username === 'admin'));

  const createUser = await request('POST', '/api/users', { username: 'se1', password: 'demo1234', role: 'user' });
  assert('create user returns 201', createUser.status === 201);
  assert('user has force_password_change', createUser.body.force_password_change === true);
  assert('user role is user', createUser.body.role === 'user');
  const userId = createUser.body.id;

  const dupUser = await request('POST', '/api/users', { username: 'se1', password: 'other', role: 'user' });
  assert('duplicate username returns 409', dupUser.status === 409);

  // Reset password
  const resetPw = await request('POST', `/api/users/${userId}/reset-password`, { password: 'reset123' });
  assert('reset password returns 200', resetPw.status === 200);

  // Delete user
  const deleteUser = await request('DELETE', `/api/users/${userId}`);
  assert('delete user returns 200', deleteUser.status === 200);

  // Cannot delete yourself
  const adminUser = listUsers.body.users.find(u => u.username === 'admin');
  if (adminUser) {
    const selfDelete = await request('DELETE', `/api/users/${adminUser.id}`);
    assert('cannot delete yourself returns 400', selfDelete.status === 400);
  }

  // --------------------------------------------------
  // Contacts (via event)
  // --------------------------------------------------
  console.log('\n[Contacts]');
  const listContacts = await request('GET', `/api/events/${eventId}/contacts`);
  assert('list contacts returns 200', listContacts.status === 200);
  assert('contacts count is 0', listContacts.body.count === 0);

  // --------------------------------------------------
  // Cleanup: delete demo PC, then event
  // --------------------------------------------------
  console.log('\n[Cleanup]');
  const deletePC = await request('DELETE', `/api/demo-pcs/${pcId}`);
  assert('delete demo PC returns 200', deletePC.status === 200);

  // Event has sessions referencing it via FK, so delete returns 500
  // This validates the FK constraint is enforced
  if (createSession.status === 201) {
    const deleteEventWithSessions = await request('DELETE', `/api/events/${eventId}`);
    assert('delete event with sessions returns 409 (FK constraint)', deleteEventWithSessions.status === 409);
  } else {
    const deleteEvent = await request('DELETE', `/api/events/${eventId}`);
    assert('delete event returns 200', deleteEvent.status === 200);
  }

  // --------------------------------------------------
  // Auth -- logout
  // --------------------------------------------------
  console.log('\n[Auth - Logout]');
  const logout = await request('POST', '/api/auth/logout');
  assert('logout returns 200', logout.status === 200);
  assert('logged_out flag is true', logout.body.logged_out === true);

  // Verify logged out
  sessionCookie = '';
  const afterLogout = await request('GET', '/api/events');
  assert('after logout returns 401', afterLogout.status === 401);

  // --------------------------------------------------
  // Summary
  // --------------------------------------------------
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(50)}`);

  return failed;
}

// Start server, run tests, shut down
async function main() {
  // Use test-specific DB and port
  process.env.MANAGEMENT_DB = ':memory:';
  process.env.PORT = String(PORT);

  // Clear module cache to pick up env changes
  delete require.cache[require.resolve('../server')];
  delete require.cache[require.resolve('../lib/db')];
  delete require.cache[require.resolve('../lib/auth')];

  const app = require('../server');

  // Wait for server to be listening
  await new Promise((resolve) => {
    const check = () => {
      http.get(`${BASE}/api/health`, (res) => {
        if (res.statusCode === 200) resolve();
        else setTimeout(check, 100);
      }).on('error', () => setTimeout(check, 100));
    };
    setTimeout(check, 200);
  });

  const failures = await run();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
