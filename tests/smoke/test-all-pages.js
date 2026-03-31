#!/usr/bin/env node
// Smoke test: verify all presenter pages load correctly before demo day.
// Uses only Node.js built-in modules. Exit 0 = all pass, 1 = failures.

var http = require('http');
var path = require('path');
var childProcess = require('child_process');

var PORT = 9876; // avoid conflicts with default 3000
var BASE = 'http://localhost:' + PORT;

// -----------------------------------------------------------------------
// Page definitions: path, expected title substring, expected nav hrefs
// -----------------------------------------------------------------------
var PAGES = [
    {
        path: '/demo.html',
        name: 'Dashboard (demo)',
        titleContains: 'BoothApp',
        navHrefs: []  // demo.html has no <a href> in raw HTML (links are in sessions/export)
    },
    {
        path: '/sessions.html',
        name: 'Sessions',
        titleContains: 'Sessions',
        navHrefs: ['export.html', 'demo.html']
    },
    {
        path: '/export.html',
        name: 'Export',
        titleContains: 'Export',
        navHrefs: ['sessions.html', 'demo.html']
    },
    // Pages requested in spec but not yet implemented -- smoke test catches these gaps
    { path: '/',                  name: 'Index (root)',       titleContains: 'BoothApp', navHrefs: [] },
    { path: '/session-viewer.html', name: 'Session Viewer',  titleContains: 'Session',  navHrefs: [] },
    { path: '/analytics.html',   name: 'Analytics',          titleContains: 'Analytics', navHrefs: [] },
    { path: '/admin.html',       name: 'Admin',              titleContains: 'Admin',     navHrefs: [] },
    { path: '/live-dashboard.html', name: 'Live Dashboard',  titleContains: 'Live',     navHrefs: [] },
    { path: '/demo-mode.html',   name: 'Demo Mode',          titleContains: 'Demo',     navHrefs: [] },
    { path: '/quick-setup.html', name: 'Quick Setup',        titleContains: 'Setup',    navHrefs: [] },
    { path: '/replay.html',      name: 'Replay',             titleContains: 'Replay',   navHrefs: [] },
    { path: '/api-docs.html',    name: 'API Docs',           titleContains: 'API',      navHrefs: [] },
    { path: '/insights.html',    name: 'Insights',           titleContains: 'Insight',  navHrefs: [] },
    { path: '/feedback.html',    name: 'Feedback',           titleContains: 'Feedback', navHrefs: [] },
    { path: '/compare.html',     name: 'Compare',            titleContains: 'Compare',  navHrefs: [] },
    { path: '/settings.html',    name: 'Settings',           titleContains: 'Setting',  navHrefs: [] },
    { path: '/status.html',      name: 'Status',             titleContains: 'Status',   navHrefs: [] },
];

// -----------------------------------------------------------------------
// HTTP GET helper
// -----------------------------------------------------------------------
function fetchPage(url) {
    return new Promise(function (resolve, reject) {
        var req = http.get(url, function (res) {
            var body = '';
            res.on('data', function (chunk) { body += chunk; });
            res.on('end', function () {
                resolve({ status: res.statusCode, body: body });
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, function () {
            req.destroy(new Error('timeout'));
        });
    });
}

// -----------------------------------------------------------------------
// Checks
// -----------------------------------------------------------------------

// 1. HTTP 200
function checkStatus(result) {
    if (result.status !== 200) {
        return 'HTTP ' + result.status + ' (expected 200)';
    }
    return null;
}

// 2. Title or heading contains expected text
function checkTitle(result, page) {
    var titleMatch = result.body.match(/<title[^>]*>([^<]*)<\/title>/i);
    var h1Match = result.body.match(/<h1[^>]*>([^<]*)<\/h1>/i);
    var titleText = (titleMatch ? titleMatch[1] : '') + ' ' + (h1Match ? h1Match[1] : '');

    if (titleText.toLowerCase().indexOf(page.titleContains.toLowerCase()) === -1) {
        return 'Title/heading missing "' + page.titleContains + '" (got: ' +
               (titleMatch ? titleMatch[1].trim() : '(no <title>)') + ')';
    }
    return null;
}

// 3. Nav links present
function checkNav(result, page) {
    var errors = [];
    for (var i = 0; i < page.navHrefs.length; i++) {
        var href = page.navHrefs[i];
        if (result.body.indexOf(href) === -1) {
            errors.push('Missing nav link to ' + href);
        }
    }
    return errors.length ? errors.join('; ') : null;
}

// 4. No broken script imports (src that references a .js file)
function checkScripts(result) {
    var scriptRe = /<script[^>]+src=["']([^"']+)["']/gi;
    var match;
    var broken = [];
    while ((match = scriptRe.exec(result.body)) !== null) {
        var src = match[1];
        // External CDN scripts are OK -- only flag local relative paths
        if (src.indexOf('://') !== -1) continue;
        // We can't resolve local files from here, but flag obviously broken patterns
        // like empty src or src with spaces
        if (!src.trim() || src.indexOf(' ') !== -1) {
            broken.push('Broken script src: "' + src + '"');
        }
    }
    return broken.length ? broken.join('; ') : null;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------
async function main() {
    // Start the presenter server
    var serverPath = path.join(__dirname, '..', '..', 'presenter', 'server.js');
    var server = childProcess.spawn(process.execPath, [serverPath], {
        env: Object.assign({}, process.env, { PORT: String(PORT) }),
        stdio: ['ignore', 'pipe', 'pipe']
    });

    // Wait for server to be ready
    var ready = false;
    for (var attempt = 0; attempt < 30; attempt++) {
        try {
            await fetchPage(BASE + '/demo.html');
            ready = true;
            break;
        } catch (e) {
            await new Promise(function (r) { setTimeout(r, 200); });
        }
    }

    if (!ready) {
        console.error('FATAL: Server failed to start on port ' + PORT);
        server.kill();
        process.exit(1);
    }

    var passed = 0;
    var failed = 0;
    var failures = [];

    console.log('Smoke Test: All Presenter Pages');
    console.log('================================');
    console.log('Server running on port ' + PORT);
    console.log('Testing ' + PAGES.length + ' pages...\n');

    for (var i = 0; i < PAGES.length; i++) {
        var page = PAGES[i];
        var url = BASE + page.path;
        var errors = [];

        try {
            var result = await fetchPage(url);

            var statusErr = checkStatus(result);
            if (statusErr) errors.push(statusErr);

            // Only check content if we got a 200
            if (result.status === 200) {
                var titleErr = checkTitle(result, page);
                if (titleErr) errors.push(titleErr);

                var navErr = checkNav(result, page);
                if (navErr) errors.push(navErr);

                var scriptErr = checkScripts(result);
                if (scriptErr) errors.push(scriptErr);
            }
        } catch (err) {
            errors.push('Request failed: ' + err.message);
        }

        if (errors.length === 0) {
            console.log('  PASS  ' + page.name + ' (' + page.path + ')');
            passed++;
        } else {
            console.log('  FAIL  ' + page.name + ' (' + page.path + ')');
            for (var e = 0; e < errors.length; e++) {
                console.log('        -> ' + errors[e]);
            }
            failures.push({ page: page.name, path: page.path, errors: errors });
            failed++;
        }
    }

    console.log('\n================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed, ' + PAGES.length + ' total');

    if (failures.length > 0) {
        console.log('\nFailed pages:');
        for (var f = 0; f < failures.length; f++) {
            console.log('  - ' + failures[f].page + ' (' + failures[f].path + '): ' + failures[f].errors[0]);
        }
    }

    // Cleanup
    server.kill();

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (err) {
    console.error('Smoke test crashed:', err);
    process.exit(1);
});
