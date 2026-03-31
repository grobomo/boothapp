'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var validator = require(path.join(__dirname, '..', '..', 'infra', 'validator.js'));
var validateSession = validator.validateSession;
var validateTranscript = validator.validateTranscript;

// -- Helper: build a valid session --
function validSession() {
    return {
        metadata: {
            sessionId: 'sess-001',
            visitorName: 'Sarah Chen',
            company: 'Acme Corp'
        },
        status: 'complete',
        events: [
            { timestamp: 1000, type: 'click', element: 'btn-demo' },
            { timestamp: 2000, type: 'click', element: 'btn-next' },
            { timestamp: 3000, type: 'pageview', url: '/products' }
        ]
    };
}

// -- Helper: build a valid transcript --
function validTranscript() {
    return {
        sessionId: 'sess-001',
        entries: [
            { timestamp: 1000, text: 'Welcome to the demo.' },
            { timestamp: 5000, text: 'Let me show you XDR.' },
            { timestamp: 9000, text: 'Any questions?' }
        ]
    };
}

// =============================================
//  Session validation
// =============================================

test('valid session passes', function () {
    var result = validateSession(validSession());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
});

test('missing metadata fails', function () {
    var s = validSession();
    delete s.metadata;
    var result = validateSession(s);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('metadata') !== -1; }));
});

test('null metadata fails', function () {
    var s = validSession();
    s.metadata = null;
    var result = validateSession(s);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('metadata') !== -1; }));
});

test('missing metadata fields fails', function () {
    var s = validSession();
    s.metadata = { sessionId: 'sess-001' }; // missing visitorName and company
    var result = validateSession(s);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('visitorName') !== -1; }));
    assert.ok(result.errors.some(function (e) { return e.indexOf('company') !== -1; }));
});

test('invalid status fails', function () {
    var s = validSession();
    s.status = 'banana';
    var result = validateSession(s);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('Invalid status') !== -1; }));
});

test('missing status fails', function () {
    var s = validSession();
    delete s.status;
    var result = validateSession(s);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('status') !== -1; }));
});

test('all valid statuses accepted', function () {
    var statuses = ['pending', 'processing', 'complete', 'error'];
    statuses.forEach(function (st) {
        var s = validSession();
        s.status = st;
        var result = validateSession(s);
        assert.equal(result.valid, true, 'Status "' + st + '" should be valid');
    });
});

test('empty events array fails', function () {
    var s = validSession();
    s.events = [];
    var result = validateSession(s);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('empty') !== -1; }));
});

test('events not an array fails', function () {
    var s = validSession();
    s.events = 'not-an-array';
    var result = validateSession(s);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('array') !== -1; }));
});

test('missing timestamps fail', function () {
    var s = validSession();
    s.events = [
        { type: 'click', element: 'btn' },      // no timestamp
        { timestamp: 2000, type: 'click', element: 'btn2' }
    ];
    var result = validateSession(s);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('timestamp') !== -1; }));
});

test('non-chronological timestamps warn', function () {
    var s = validSession();
    s.events = [
        { timestamp: 5000, type: 'click' },
        { timestamp: 2000, type: 'click' },  // out of order
        { timestamp: 8000, type: 'click' }
    ];
    var result = validateSession(s);
    assert.equal(result.valid, true, 'Out-of-order is a warning, not an error');
    assert.ok(result.warnings.length > 0, 'Should have at least one warning');
    assert.ok(result.warnings.some(function (w) { return w.indexOf('chronological') !== -1; }));
});

test('null session fails', function () {
    var result = validateSession(null);
    assert.equal(result.valid, false);
});

test('non-object session fails', function () {
    var result = validateSession('string');
    assert.equal(result.valid, false);
});

// =============================================
//  Transcript validation
// =============================================

test('valid transcript passes', function () {
    var result = validateTranscript(validTranscript());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
});

test('transcript missing sessionId fails', function () {
    var t = validTranscript();
    delete t.sessionId;
    var result = validateTranscript(t);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('sessionId') !== -1; }));
});

test('transcript with empty entries fails', function () {
    var t = validTranscript();
    t.entries = [];
    var result = validateTranscript(t);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('empty') !== -1; }));
});

test('transcript entries not array fails', function () {
    var t = validTranscript();
    t.entries = 'nope';
    var result = validateTranscript(t);
    assert.equal(result.valid, false);
});

test('transcript entry missing timestamp fails', function () {
    var t = validTranscript();
    t.entries = [{ text: 'hello' }];
    var result = validateTranscript(t);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('timestamp') !== -1; }));
});

test('transcript entry missing text fails', function () {
    var t = validTranscript();
    t.entries = [{ timestamp: 1000 }];
    var result = validateTranscript(t);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(function (e) { return e.indexOf('text') !== -1; }));
});

test('null transcript fails', function () {
    var result = validateTranscript(null);
    assert.equal(result.valid, false);
});
