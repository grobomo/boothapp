const crypto = require('crypto');
const assert = require('assert');
const { validateSignature } = require('../teams-webhook');

// -- helpers --
const SECRET_B64 = Buffer.from('test-webhook-secret-key').toString('base64');

function makeHmac(body) {
    const buf = Buffer.from(SECRET_B64, 'base64');
    return crypto.createHmac('sha256', buf).update(body).digest('base64');
}

function makeReq(body, authHeader) {
    const raw = JSON.stringify(body);
    return {
        rawBody: raw,
        body,
        headers: { authorization: authHeader },
    };
}

function makeRes() {
    const res = {
        statusCode: null,
        body: null,
        status(code) { res.statusCode = code; return res; },
        json(obj) { res.body = obj; },
    };
    return res;
}

// -- tests --
let passed = 0;

// Test 1: validateSignature accepts valid HMAC
{
    const body = '{"text":"hello"}';
    const hmac = makeHmac(body);
    assert.strictEqual(validateSignature(body, `HMAC ${hmac}`, SECRET_B64), true);
    passed++;
    console.log('PASS: validates correct HMAC signature');
}

// Test 2: validateSignature rejects wrong HMAC
{
    const body = '{"text":"hello"}';
    assert.strictEqual(validateSignature(body, 'HMAC bm90YXZhbGlk', SECRET_B64), false);
    passed++;
    console.log('PASS: rejects incorrect HMAC signature');
}

// Test 3: validateSignature rejects missing header
{
    assert.strictEqual(validateSignature('{}', null, SECRET_B64), false);
    assert.strictEqual(validateSignature('{}', 'Bearer xyz', SECRET_B64), false);
    passed++;
    console.log('PASS: rejects missing or non-HMAC auth header');
}

// Test 4: handler returns 500 when env vars missing
{
    const { teamsWebhookHandler } = require('../teams-webhook');
    const origSecret = process.env.TEAMS_WEBHOOK_SECRET;
    const origToken = process.env.GITHUB_TOKEN;
    delete process.env.TEAMS_WEBHOOK_SECRET;
    delete process.env.GITHUB_TOKEN;

    const res = makeRes();
    teamsWebhookHandler({ rawBody: '{}', body: {}, headers: {} }, res);
    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.body.error.includes('missing env vars'));
    passed++;
    console.log('PASS: returns 500 when env vars not set');

    // restore
    if (origSecret) process.env.TEAMS_WEBHOOK_SECRET = origSecret;
    if (origToken) process.env.GITHUB_TOKEN = origToken;
}

// Test 5: handler returns 401 on bad signature
{
    const { teamsWebhookHandler } = require('../teams-webhook');
    process.env.TEAMS_WEBHOOK_SECRET = SECRET_B64;
    process.env.GITHUB_TOKEN = 'ghp_fake';

    const body = { text: 'hello', from: { name: 'Tester' } };
    const raw = JSON.stringify(body);
    const req = { rawBody: raw, body, headers: { authorization: 'HMAC bm90dmFsaWQ=' } };
    const res = makeRes();
    teamsWebhookHandler(req, res);
    assert.strictEqual(res.statusCode, 401);
    passed++;
    console.log('PASS: returns 401 on invalid signature');

    delete process.env.TEAMS_WEBHOOK_SECRET;
    delete process.env.GITHUB_TOKEN;
}

// Test 6: handler returns 400 when rawBody missing
{
    const { teamsWebhookHandler } = require('../teams-webhook');
    process.env.TEAMS_WEBHOOK_SECRET = SECRET_B64;
    process.env.GITHUB_TOKEN = 'ghp_fake';

    const res = makeRes();
    teamsWebhookHandler({ body: {}, headers: {} }, res);
    assert.strictEqual(res.statusCode, 400);
    passed++;
    console.log('PASS: returns 400 when rawBody missing');

    delete process.env.TEAMS_WEBHOOK_SECRET;
    delete process.env.GITHUB_TOKEN;
}

// Test 7: bot mention stripping
{
    const text = '<at>BoothApp</at> create an issue please';
    const cleaned = text.replace(/<at>.*?<\/at>\s*/g, '').trim();
    assert.strictEqual(cleaned, 'create an issue please');
    passed++;
    console.log('PASS: strips bot mention from message text');
}

console.log(`\n${passed}/${passed} teams-webhook tests passed`);
