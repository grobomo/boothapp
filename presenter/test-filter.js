/**
 * Tests for session search & filter bar.
 * Validates HTML structure, filter controls, product chips,
 * URL parameter helpers, and client-side filter logic.
 *
 * Run: node presenter/test-filter.js
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

// Load demo.html
var demoPath = path.join(__dirname, 'demo.html');
var demo = fs.readFileSync(demoPath, 'utf8');

console.log('\n=== Filter Bar HTML Structure ===\n');

// Filter bar container
assertMatch(demo, /id="filterBar"/, 'Filter bar container exists (id="filterBar")');
assertMatch(demo, /class="filter-bar"/, 'Filter bar has correct class');

// Search input
assertMatch(demo, /id="filterSearch"/, 'Search input exists (id="filterSearch")');
assertMatch(demo, /placeholder="Visitor name or company/, 'Search has descriptive placeholder');
assertMatch(demo, /type="text"\s+id="filterSearch"/, 'Search is text input');

// Company dropdown
assertMatch(demo, /id="filterCompany"/, 'Company select exists (id="filterCompany")');
assertMatch(demo, /<option value="">All Companies<\/option>/, 'Company select has "All" default option');

// Score range
assertMatch(demo, /id="filterScoreMin"/, 'Score min input exists');
assertMatch(demo, /id="filterScoreMax"/, 'Score max input exists');
assertMatch(demo, /type="number"\s+id="filterScoreMin"/, 'Score min is number input');
assertMatch(demo, /type="number"\s+id="filterScoreMax"/, 'Score max is number input');

// Date range
assertMatch(demo, /id="filterDateFrom"/, 'Date from input exists');
assertMatch(demo, /id="filterDateTo"/, 'Date to input exists');
assertMatch(demo, /type="date"\s+id="filterDateFrom"/, 'Date from is date input');
assertMatch(demo, /type="date"\s+id="filterDateTo"/, 'Date to is date input');

// Product chips container
assertMatch(demo, /id="filterProducts"/, 'Product chips container exists');

// Clear button
assertMatch(demo, /id="filterClear"/, 'Clear button exists');
assertMatch(demo, /class="filter-clear"/, 'Clear button has correct class');

// Filter count
assertMatch(demo, /id="filterCount"/, 'Filter count display exists');

console.log('\n=== Sessions Table Structure ===\n');

// Sessions table
assertMatch(demo, /class="sessions-table-wrap"/, 'Sessions table wrapper exists');
assertMatch(demo, /class="sessions-table"/, 'Sessions table exists');
assertMatch(demo, /id="sessionsBody"/, 'Sessions table body exists (id="sessionsBody")');
assertMatch(demo, /id="sessionsEmpty"/, 'Empty state message exists');

// Table headers
assertMatch(demo, /<th>Visitor<\/th>/, 'Visitor column header');
assertMatch(demo, /<th>Company<\/th>/, 'Company column header');
assertMatch(demo, /<th>Date<\/th>/, 'Date column header');
assertMatch(demo, /<th>Score<\/th>/, 'Score column header');
assertMatch(demo, /<th>Products<\/th>/, 'Products column header');

console.log('\n=== Filter CSS Styles ===\n');

assertMatch(demo, /\.filter-bar\s*\{/, 'Filter bar CSS defined');
assertMatch(demo, /\.filter-input/, 'Filter input CSS defined');
assertMatch(demo, /\.filter-select/, 'Filter select CSS defined');
assertMatch(demo, /\.filter-chip/, 'Filter chip CSS defined');
assertMatch(demo, /\.filter-chip\.active/, 'Active filter chip CSS defined');
assertMatch(demo, /\.filter-clear/, 'Clear button CSS defined');
assertMatch(demo, /\.sessions-table/, 'Sessions table CSS defined');
assertMatch(demo, /\.session-score--high/, 'High score CSS class defined');
assertMatch(demo, /\.session-score--medium/, 'Medium score CSS class defined');
assertMatch(demo, /\.session-score--low/, 'Low score CSS class defined');
assertMatch(demo, /\.session-product-tag/, 'Product tag CSS defined');

console.log('\n=== JavaScript Filter Logic ===\n');

// Filter functions exist
assertMatch(demo, /function applyFilters\(\)/, 'applyFilters function defined');
assertMatch(demo, /function clearFilters\(\)/, 'clearFilters function defined');
assertMatch(demo, /function setupFilterBar\(\)/, 'setupFilterBar function defined');
assertMatch(demo, /function readFiltersFromUI\(\)/, 'readFiltersFromUI function defined');
assertMatch(demo, /function writeFiltersToUI\(\)/, 'writeFiltersToUI function defined');

// URL persistence
assertMatch(demo, /function getFilterParams\(\)/, 'getFilterParams function defined');
assertMatch(demo, /function setFilterParams\(/, 'setFilterParams function defined');
assertMatch(demo, /URLSearchParams/, 'Uses URLSearchParams for URL params');
assertMatch(demo, /history\.replaceState/, 'Uses replaceState for URL updates (no page reload)');

// Client-side filtering
assertMatch(demo, /\.filter\(function\s*\(s\)/, 'Uses Array.filter for client-side filtering');
assertMatch(demo, /toLowerCase\(\)\.indexOf\(q\)/, 'Case-insensitive text search');

// Filter event listeners
assertMatch(demo, /addEventListener\('input', applyFilters\)/, 'Search input triggers instant filtering');
assertMatch(demo, /addEventListener\('change', applyFilters\)/, 'Select change triggers filtering');

// Session data model
assertMatch(demo, /function generateSessions\(\)/, 'generateSessions function defined');
assertMatch(demo, /state\.sessions\s*=\s*generateSessions\(\)/, 'Sessions generated on boot');

// Score classification
assertMatch(demo, /s\.score >= 80.*high.*s\.score >= 60.*medium.*low/, 'Score classification: high >= 80, medium >= 60, low < 60');

// Product filter (any match)
assertMatch(demo, /s\.products\.indexOf\(filterState\.products\[i\]\)/, 'Product filter checks session products');

// Filter label elements
assertMatch(demo, /<label class="filter-label"[^>]*for="filterSearch"/, 'Search label with for attribute');
assertMatch(demo, /<label class="filter-label"[^>]*for="filterCompany"/, 'Company label with for attribute');

console.log('\n=== Responsive Design ===\n');

assertMatch(demo, /\.filter-group\s*\{\s*min-width:\s*100%/, 'Filter groups go full-width on mobile');

console.log('\n=== URL Parameter Handling ===\n');

// Verify URL params cover all filter fields
assertMatch(demo, /params\.get\('q'\)/, 'URL param: q (search)');
assertMatch(demo, /params\.get\('company'\)/, 'URL param: company');
assertMatch(demo, /params\.get\('scoreMin'\)/, 'URL param: scoreMin');
assertMatch(demo, /params\.get\('scoreMax'\)/, 'URL param: scoreMax');
assertMatch(demo, /params\.get\('dateFrom'\)/, 'URL param: dateFrom');
assertMatch(demo, /params\.get\('dateTo'\)/, 'URL param: dateTo');
assertMatch(demo, /params\.get\('products'\)/, 'URL param: products');

// Restore from URL on boot
assertMatch(demo, /urlFilters\s*=\s*getFilterParams\(\)/, 'Reads URL params on boot');
assertMatch(demo, /writeFiltersToUI\(\)/, 'Writes restored filters to UI');

// Summary
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
