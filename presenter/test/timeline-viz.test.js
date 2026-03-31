'use strict';

const assert = require('assert');
const BoothTimeline = require('../components/timeline-viz.js');

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

console.log('--- module export ---');

{
    assert.strictEqual(typeof BoothTimeline, 'function');
    console.log('  [PASS] exports a constructor function');
}

{
    const methods = Object.keys(BoothTimeline.prototype);
    assert.ok(methods.includes('setEvents'), 'has setEvents');
    assert.ok(methods.includes('render'), 'has render');
    assert.ok(methods.includes('destroy'), 'has destroy');
    assert.ok(methods.includes('_buildCard'), 'has _buildCard');
    assert.ok(methods.includes('_toggleExpand'), 'has _toggleExpand');
    assert.ok(methods.includes('_resolveProduct'), 'has _resolveProduct');
    console.log('  [PASS] all 6 prototype methods present');
}

// ---------------------------------------------------------------------------
// setEvents - sorting
// ---------------------------------------------------------------------------

console.log('--- setEvents ---');

{
    var inst = Object.create(BoothTimeline.prototype);
    inst._expandedIdx = 0;
    inst.setEvents([
        { type: 'click', timestamp: 3000 },
        { type: 'transcript', timestamp: 1000 },
        { type: 'click', timestamp: 2000 },
    ]);
    assert.strictEqual(inst._events.length, 3);
    assert.strictEqual(inst._events[0].timestamp, 1000);
    assert.strictEqual(inst._events[1].timestamp, 2000);
    assert.strictEqual(inst._events[2].timestamp, 3000);
    assert.strictEqual(inst._expandedIdx, -1, 'resets expanded index');
    console.log('  [PASS] sorts events by timestamp ascending');
}

{
    var inst = Object.create(BoothTimeline.prototype);
    inst.setEvents(null);
    assert.deepStrictEqual(inst._events, []);
    console.log('  [PASS] handles null input');
}

{
    var inst = Object.create(BoothTimeline.prototype);
    inst.setEvents([]);
    assert.deepStrictEqual(inst._events, []);
    console.log('  [PASS] handles empty array');
}

{
    // Verify it doesn't mutate the original array
    var original = [
        { type: 'click', timestamp: 3000 },
        { type: 'click', timestamp: 1000 },
    ];
    var inst = Object.create(BoothTimeline.prototype);
    inst.setEvents(original);
    assert.strictEqual(original[0].timestamp, 3000, 'original not mutated');
    assert.strictEqual(inst._events[0].timestamp, 1000, 'internal copy sorted');
    console.log('  [PASS] does not mutate input array');
}

// ---------------------------------------------------------------------------
// _resolveProduct
// ---------------------------------------------------------------------------

console.log('--- _resolveProduct ---');

{
    var inst = Object.create(BoothTimeline.prototype);

    // Explicit product field takes priority
    var p = inst._resolveProduct({ product: 'Custom Module' });
    assert.strictEqual(p, 'Custom Module');
    console.log('  [PASS] returns explicit product field');
}

{
    var inst = Object.create(BoothTimeline.prototype);
    var cases = [
        ['https://app.trendmicro.com/vision-one/dashboard', 'Vision One XDR'],
        ['https://app.trendmicro.com/xdr/alerts', 'Vision One XDR'],
        ['https://app.example.com/cloud-security', 'Cloud Security'],
        ['https://app.example.com/cloud-one/posture', 'Cloud Security'],
        ['https://app.example.com/zero-trust/access', 'Zero Trust'],
        ['https://app.example.com/ztsa/config', 'Zero Trust'],
        ['https://app.example.com/endpoint/agents', 'Endpoint Security'],
        ['https://app.example.com/epp/policies', 'Endpoint Security'],
        ['https://app.example.com/email-security/quarantine', 'Email Security'],
        ['https://app.example.com/network-defense/ips', 'Network Defense'],
        ['https://app.example.com/tippingpoint/rules', 'Network Defense'],
        ['https://app.example.com/workload/inventory', 'Workload Security'],
        ['https://app.example.com/container/clusters', 'Container Security'],
    ];
    for (var i = 0; i < cases.length; i++) {
        var result = inst._resolveProduct({ url: cases[i][0] });
        assert.strictEqual(result, cases[i][1], 'URL: ' + cases[i][0]);
    }
    console.log('  [PASS] resolves all ' + cases.length + ' URL patterns');
}

{
    var inst = Object.create(BoothTimeline.prototype);
    var p = inst._resolveProduct({ url: 'https://example.com/unknown-page' });
    assert.strictEqual(p, null);
    console.log('  [PASS] returns null for unknown URL');
}

{
    var inst = Object.create(BoothTimeline.prototype);
    var p = inst._resolveProduct({});
    assert.strictEqual(p, null);
    console.log('  [PASS] returns null for event with no url or product');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\nAll timeline-viz tests passed.');
