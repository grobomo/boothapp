/**
 * Accessibility tests for presenter pages using axe-core pattern.
 * Validates ARIA labels, keyboard navigation, skip links, contrast,
 * and alt text without requiring a browser (DOM parsing checks).
 *
 * Run: node presenter/test-a11y.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;

function assert(condition, msg) {
    if (condition) {
        passed++;
        console.log('  PASS: ' + msg);
    } else {
        failed++;
        console.log('  FAIL: ' + msg);
    }
}

function assertMatch(html, pattern, msg) {
    assert(pattern.test(html), msg);
}

function assertNoMatch(html, pattern, msg) {
    assert(!pattern.test(html), msg);
}

// Load demo.html
var demoPath = path.join(__dirname, 'demo.html');
var demo = fs.readFileSync(demoPath, 'utf8');

console.log('\n=== demo.html accessibility checks ===\n');

// 1. Skip-to-content link
console.log('[Skip Link]');
assertMatch(demo, /class="skip-link"[^>]*href="#main-content"/, 'Skip-to-content link exists with href="#main-content"');
assertMatch(demo, /id="main-content"/, 'Main content target (id="main-content") exists');

// 2. ARIA labels on interactive/status elements
console.log('\n[ARIA Labels]');
assertMatch(demo, /aria-live="polite"/, 'aria-live="polite" used for dynamic content');
assertMatch(demo, /aria-label="Dashboard statistics"/, 'Cards region has aria-label');
assertMatch(demo, /aria-label="Active sessions count"/, 'Sessions card has aria-label');
assertMatch(demo, /aria-label="Total demos count"/, 'Demos card has aria-label');
assertMatch(demo, /aria-label="Reports generated count"/, 'Reports card has aria-label');
assertMatch(demo, /aria-label="Live activity feed"/, 'Feed section has aria-label');
assertMatch(demo, /aria-label="Pipeline breakdown"/, 'Pipeline panel has aria-label');
assertMatch(demo, /aria-label="Top products by demo count"/, 'Products panel has aria-label');
assertMatch(demo, /aria-label="Current time"/, 'Clock has aria-label');

// 3. Decorative elements hidden from screen readers
console.log('\n[Decorative Elements]');
assertMatch(demo, /id="particles"[^>]*aria-hidden="true"/, 'Particle canvas is aria-hidden');
assertMatch(demo, /class="bg-grid"[^>]*aria-hidden="true"/, 'Background grid is aria-hidden');
assertMatch(demo, /class="bg-glow bg-glow--1"[^>]*aria-hidden="true"/, 'Glow element is aria-hidden');
assertMatch(demo, /class="live-dot"[^>]*aria-hidden="true"/, 'Live dot is aria-hidden');

// 4. SVG accessibility
console.log('\n[SVG Alt Text]');
assertMatch(demo, /<svg[^>]*role="img"[^>]*aria-label="BoothApp logo"/, 'Logo SVG has role="img" and aria-label');
assertMatch(demo, /<title>Sessions icon<\/title>/, 'Sessions card SVG has <title>');
assertMatch(demo, /<title>Demos icon<\/title>/, 'Demos card SVG has <title>');
assertMatch(demo, /<title>Reports icon<\/title>/, 'Reports card SVG has <title>');
assertMatch(demo, /ringChart[^>]*role="img"[^>]*aria-label/, 'Ring chart SVG has role="img" and aria-label');

// 5. Semantic HTML
console.log('\n[Semantic HTML]');
assertMatch(demo, /<main\s+id="main-content"/, '<main> element wraps content');
assertMatch(demo, /<footer\s+class="footer"[^>]*role="contentinfo"/, '<footer> with role="contentinfo"');
assertMatch(demo, /<header\s+class="header"/, '<header> element present');
assertMatch(demo, /<h2\s+class="feed-title"/, 'Feed title uses <h2>');
assertMatch(demo, /<h2\s+class="panel-box-title"/, 'Panel titles use <h2>');

// 6. Focus styles
console.log('\n[Focus Styles]');
assertMatch(demo, /focus-visible/, 'focus-visible styles defined');
assertMatch(demo, /\.skip-link:focus/, 'Skip link has focus styles');

// 7. Color contrast check (verify the CSS variable)
console.log('\n[Color Contrast]');
// The --text-dim was #6B7385 (fails 4.5:1 on #06080C) and should now be #8B93A5 (passes)
assertMatch(demo, /--text-dim:\s*#8B93A5/, 'text-dim color updated to #8B93A5 (passes 4.5:1 contrast ratio)');
assertNoMatch(demo, /--text-dim:\s*#6B7385/, 'Old text-dim #6B7385 (fails contrast) is gone');

// 8. lang attribute
console.log('\n[Language]');
assertMatch(demo, /<html\s+lang="en"/, 'html element has lang="en"');

// Summary
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
