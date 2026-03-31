'use strict';

// Minimal DOM shims for Node.js testing
global.document = {
    getElementById: function () { return null; },
    head: { appendChild: function () {} },
    createElement: function () {
        return {
            style: {}, className: '', innerHTML: '',
            appendChild: function () {},
            querySelectorAll: function () { return []; },
            querySelector: function () { return null; },
            setAttribute: function () {},
            getAttribute: function () { return '0%'; }
        };
    }
};
global.window = global;
global.CustomEvent = function () {};
global.requestAnimationFrame = function (f) { f(); };

const assert = require('assert');
const SB = require('../components/score-badge');

// ---------------------------------------------------------------------------
// scoreColor boundaries
// ---------------------------------------------------------------------------

console.log('--- scoreColor ---');

{
    assert.strictEqual(SB.scoreColor(100).label, 'High');
    assert.strictEqual(SB.scoreColor(80).label, 'High');
    console.log('  [PASS] 80-100 = High (green)');
}

{
    assert.strictEqual(SB.scoreColor(79).label, 'Medium');
    assert.strictEqual(SB.scoreColor(60).label, 'Medium');
    console.log('  [PASS] 60-79 = Medium (yellow)');
}

{
    assert.strictEqual(SB.scoreColor(59).label, 'Low');
    assert.strictEqual(SB.scoreColor(0).label, 'Low');
    console.log('  [PASS] 0-59 = Low (red)');
}

// ---------------------------------------------------------------------------
// overall averaging
// ---------------------------------------------------------------------------

console.log('--- overall ---');

{
    var result = SB.overall({ engagement: 90, coverage: 80, followUp: 70 });
    assert.strictEqual(result, 80);
    console.log('  [PASS] (90+80+70)/3 = 80');
}

{
    var result = SB.overall({ engagement: 50, coverage: 40, followUp: 30 });
    assert.strictEqual(result, 40);
    console.log('  [PASS] (50+40+30)/3 = 40');
}

{
    var result = SB.overall({ engagement: 0, coverage: 0, followUp: 0 });
    assert.strictEqual(result, 0);
    console.log('  [PASS] (0+0+0)/3 = 0');
}

{
    var result = SB.overall({ engagement: 100, coverage: 100, followUp: 100 });
    assert.strictEqual(result, 100);
    console.log('  [PASS] (100+100+100)/3 = 100');
}

{
    // Rounding: (85+72+60)/3 = 72.333... -> 72
    var result = SB.overall({ engagement: 85, coverage: 72, followUp: 60 });
    assert.strictEqual(result, 72);
    console.log('  [PASS] (85+72+60)/3 = 72 (rounded)');
}

// ---------------------------------------------------------------------------
// color hex values
// ---------------------------------------------------------------------------

console.log('--- color values ---');

{
    assert.strictEqual(SB.scoreColor(90).fill, '#00E676');
    assert.strictEqual(SB.scoreColor(70).fill, '#FFAB00');
    assert.strictEqual(SB.scoreColor(30).fill, '#D71920');
    console.log('  [PASS] Correct hex colors for each tier');
}

// ---------------------------------------------------------------------------
// exports exist
// ---------------------------------------------------------------------------

console.log('--- API surface ---');

{
    assert.strictEqual(typeof SB.render, 'function');
    assert.strictEqual(typeof SB.renderMini, 'function');
    assert.strictEqual(typeof SB.renderDistributionChart, 'function');
    assert.strictEqual(typeof SB.scoreColor, 'function');
    assert.strictEqual(typeof SB.overall, 'function');
    console.log('  [PASS] All 5 public methods exported');
}

console.log('\nAll score-badge tests passed.');
