'use strict';

const assert = require('assert');
const http = require('http');

// Mock S3 to avoid real AWS calls. We intercept the S3Client at module level.
const noteStore = {};

// We need to mock the S3 client before requiring server.js.
// Since server.js creates the S3 client at module level, we mock the SDK.
const originalSend = null;

// Instead of mocking the SDK, we test the API behavior by starting the
// express app on a random port and using the loadNotes/saveNotes exports.
// For integration tests, we directly test loadNotes/saveNotes with mock clients.

function makeS3Mock() {
    const store = {};
    return {
        send: async (cmd) => {
            const name = cmd.constructor.name;
            if (name === 'GetObjectCommand') {
                const key = cmd.input.Key;
                if (!(key in store)) {
                    const err = new Error('NoSuchKey');
                    err.name = 'NoSuchKey';
                    throw err;
                }
                return {
                    Body: {
                        transformToString: async () => store[key],
                    },
                };
            } else if (name === 'PutObjectCommand') {
                store[cmd.input.Key] = cmd.input.Body;
                return {};
            }
            throw new Error('Unexpected command: ' + name);
        },
        _store: store,
    };
}

async function runTests() {
    let passed = 0;
    const { loadNotes, saveNotes } = require('../../presenter/server');

    // -- loadNotes: returns empty array when key not found --
    {
        const mock = makeS3Mock();
        const notes = await loadNotes('nonexistent', mock);
        assert.deepStrictEqual(notes, []);
        passed++;
    }

    // -- saveNotes + loadNotes roundtrip --
    {
        const mock = makeS3Mock();
        const testNotes = [
            { timestamp: '2026-01-01T00:00:00Z', author: 'SE', content: 'Test note' },
        ];
        await saveNotes('sess-1', testNotes, mock);

        // Verify saved to correct key
        assert.ok('sess-1/notes.json' in mock._store);

        // Verify loadNotes reads it back
        const loaded = await loadNotes('sess-1', mock);
        assert.strictEqual(loaded.length, 1);
        assert.strictEqual(loaded[0].content, 'Test note');
        assert.strictEqual(loaded[0].author, 'SE');
        passed += 3;
    }

    // -- saveNotes: appending multiple notes --
    {
        const mock = makeS3Mock();
        await saveNotes('sess-2', [
            { timestamp: 'T1', author: 'A', content: 'First' },
        ], mock);
        const first = await loadNotes('sess-2', mock);
        first.push({ timestamp: 'T2', author: 'B', content: 'Second' });
        await saveNotes('sess-2', first, mock);

        const result = await loadNotes('sess-2', mock);
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].content, 'First');
        assert.strictEqual(result[1].content, 'Second');
        passed += 3;
    }

    // -- saveNotes: content is valid JSON --
    {
        const mock = makeS3Mock();
        await saveNotes('sess-3', [
            { timestamp: 'T', author: 'A', content: 'Hello' },
        ], mock);
        const raw = mock._store['sess-3/notes.json'];
        const parsed = JSON.parse(raw);
        assert.ok(Array.isArray(parsed.notes));
        assert.strictEqual(parsed.notes[0].content, 'Hello');
        passed += 2;
    }

    console.log(`notes-api.test.js: ${passed}/${passed} tests passed`);
}

runTests().catch((err) => {
    console.error('FAIL:', err.message);
    process.exit(1);
});
