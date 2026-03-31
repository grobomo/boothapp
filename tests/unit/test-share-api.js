#!/usr/bin/env node
// Unit test: /api/share/:sessionId endpoint
'use strict';

var http = require('http');
var passed = 0;
var failed = 0;
var PORT = 3098;

function assert(desc, ok) {
  if (ok) {
    console.log('  PASS: ' + desc);
    passed++;
  } else {
    console.log('  FAIL: ' + desc);
    failed++;
  }
}

function get(path, cb) {
  http.get('http://localhost:' + PORT + path, function (res) {
    var data = '';
    res.on('data', function (d) { data += d; });
    res.on('end', function () { cb(res.statusCode, data); });
  }).on('error', function (e) { cb(0, e.message); });
}

process.env.PORT = PORT;

var app = require('../../presenter/server.js');

setTimeout(function () {
  console.log('Share API tests');
  console.log('===============');

  // Test 1: valid session ID returns share URL
  get('/api/share/B291047', function (status, body) {
    assert('GET /api/share/B291047 returns 200', status === 200);

    var json = JSON.parse(body);
    assert('response has session_id', json.session_id === 'B291047');
    assert('response has share_url', json.share_url.includes('share.html?session=B291047'));

    // Test 2: session ID with special chars is sanitized
    get('/api/share/test%3Cscript%3E', function (status2, body2) {
      var json2 = JSON.parse(body2);
      assert('XSS in session ID is sanitized', !json2.session_id.includes('<'));

      // Test 3: share.html is served as static file
      get('/share.html', function (status3) {
        assert('share.html is served', status3 === 200);

        console.log('');
        console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
        process.exit(failed > 0 ? 1 : 0);
      });
    });
  });
}, 500);
