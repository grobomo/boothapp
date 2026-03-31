'use strict';

const assert = require('assert');
const { renderKeyTakeaways, escapeHtml, formatTimestamp, TAKEAWAY_CSS } = require('../lib/report-notes');

async function runTests() {
    let passed = 0;

    // -- escapeHtml --
    {
        assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
        assert.strictEqual(escapeHtml('"hello"'), '&quot;hello&quot;');
        assert.strictEqual(escapeHtml(''), '');
        assert.strictEqual(escapeHtml(null), '');
        passed += 4;
    }

    // -- formatTimestamp --
    {
        const result = formatTimestamp('2026-03-31T10:00:00Z');
        assert.ok(result.length > 0, 'formatTimestamp returns non-empty string');
        assert.strictEqual(formatTimestamp(''), '');
        assert.strictEqual(formatTimestamp(null), '');
        passed += 3;
    }

    // -- renderKeyTakeaways: empty input --
    {
        assert.strictEqual(renderKeyTakeaways(null), '');
        assert.strictEqual(renderKeyTakeaways([]), '');
        assert.strictEqual(renderKeyTakeaways(undefined), '');
        passed += 3;
    }

    // -- renderKeyTakeaways: single note --
    {
        const html = renderKeyTakeaways([
            { timestamp: '2026-03-31T10:00:00Z', author: 'Joel', content: 'Prospect very engaged with XDR' },
        ]);
        assert.ok(html.includes('Key Takeaways'), 'has section title');
        assert.ok(html.includes('SE Notes'), 'has subtitle');
        assert.ok(html.includes('Joel'), 'has author');
        assert.ok(html.includes('Prospect very engaged with XDR'), 'has content');
        passed += 4;
    }

    // -- renderKeyTakeaways: chronological order --
    {
        const html = renderKeyTakeaways([
            { timestamp: '2026-03-31T10:05:00Z', author: 'B', content: 'Second note' },
            { timestamp: '2026-03-31T10:00:00Z', author: 'A', content: 'First note' },
        ]);
        const posFirst = html.indexOf('First note');
        const posSecond = html.indexOf('Second note');
        assert.ok(posFirst < posSecond, 'first note comes before second chronologically');
        assert.ok(html.includes('A'), 'author A present');
        assert.ok(html.includes('B'), 'author B present');
        passed += 3;
    }

    // -- renderKeyTakeaways: XSS escaping --
    {
        const html = renderKeyTakeaways([
            { timestamp: 'T', author: '<script>xss</script>', content: '<img onerror="alert(1)">' },
        ]);
        assert.ok(!html.includes('<script>xss'), 'no unescaped script tag');
        assert.ok(html.includes('&lt;script&gt;'), 'script tag escaped');
        assert.ok(!html.includes('<img onerror'), 'no unescaped img tag');
        passed += 3;
    }

    // -- TAKEAWAY_CSS is a non-empty string --
    {
        assert.ok(typeof TAKEAWAY_CSS === 'string');
        assert.ok(TAKEAWAY_CSS.includes('.takeaway-item'));
        passed += 2;
    }

    console.log(`report-notes.test.js: ${passed}/${passed} tests passed`);
}

runTests().catch((err) => {
    console.error('FAIL:', err.message);
    process.exit(1);
});
