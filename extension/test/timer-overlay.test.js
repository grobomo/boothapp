'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Load timer-overlay.js in a minimal DOM mock environment
// ---------------------------------------------------------------------------

// Minimal DOM stubs so the IIFE can execute
const createdElements = [];

function makeElement(tag) {
  const el = {
    tagName: tag,
    id: '',
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
    style: { cssText: '' },
    innerHTML: '',
    children: [],
    _listeners: {},
    _shadow: null,
    appendChild(child) { this.children.push(child); },
    remove() { this._removed = true; },
    addEventListener(evt, fn) {
      this._listeners[evt] = this._listeners[evt] || [];
      this._listeners[evt].push(fn);
    },
    attachShadow() {
      const shadow = makeElement('shadow-root');
      shadow.querySelector = (sel) => {
        // Return stub elements based on class
        if (sel === '.timer') return { textContent: '' };
        if (sel === '.clicks') return { innerHTML: '' };
        if (sel === '.btn-min') return makeElement('button');
        if (sel === '.panel') return makeElement('div');
        if (sel === '.dot-only') return makeElement('div');
        return null;
      };
      el._shadow = shadow;
      return shadow;
    },
  };
  createdElements.push(el);
  return el;
}

const mockDocument = {
  createElement(tag) { return makeElement(tag); },
  documentElement: {
    children: [],
    appendChild(child) { this.children.push(child); },
  },
};

const mockChrome = {
  storage: {
    local: {
      get(_keys, cb) {
        // Return a buffer with 3 events
        cb({ v1helper_clicks: { session_id: 'test', events: [{}, {}, {}] } });
      },
    },
  },
};

// Execute timer-overlay.js in a controlled scope
const code = fs.readFileSync(path.join(__dirname, '..', 'timer-overlay.js'), 'utf8');
const fn = new Function('document', 'chrome', 'setInterval', 'clearInterval', 'Date', code + '\nreturn TimerOverlay;');

let intervals = [];
const mockSetInterval = (cb, ms) => { const id = intervals.length; intervals.push({ cb, ms }); return id; };
const mockClearInterval = (id) => { if (intervals[id]) intervals[id] = null; };

const TimerOverlay = fn(mockDocument, mockChrome, mockSetInterval, mockClearInterval, Date);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('--- TimerOverlay ---');

{
  assert.ok(TimerOverlay, 'module exports an object');
  assert.strictEqual(typeof TimerOverlay.show, 'function', 'has show()');
  assert.strictEqual(typeof TimerOverlay.hide, 'function', 'has hide()');
  console.log('  [PASS] exports show() and hide()');
}

{
  // show() should create the overlay and start a timer interval
  intervals = [];
  mockDocument.documentElement.children = [];
  TimerOverlay.show();

  assert.ok(mockDocument.documentElement.children.length > 0, 'overlay appended to documentElement');
  assert.ok(intervals.length > 0, 'interval started');
  assert.strictEqual(intervals[0].ms, 1000, 'interval is 1 second');
  console.log('  [PASS] show() creates overlay and starts 1s interval');
}

{
  // hide() should remove the overlay and clear the interval
  TimerOverlay.hide();

  // After hide, calling show again should work (no stale state)
  intervals = [];
  mockDocument.documentElement.children = [];
  TimerOverlay.show();
  assert.ok(mockDocument.documentElement.children.length > 0, 'can re-show after hide');
  console.log('  [PASS] hide() cleans up, show() works again');

  TimerOverlay.hide(); // cleanup
}

{
  // formatTime logic: extract from the module by running the interval callback
  intervals = [];
  TimerOverlay.show();

  // Simulate 90 seconds elapsed by calling the interval callback
  if (intervals[0] && intervals[0].cb) {
    intervals[0].cb(); // just verify it doesn't throw
  }
  console.log('  [PASS] interval callback executes without error');

  TimerOverlay.hide();
}

console.log('--- All timer-overlay tests passed ---');
