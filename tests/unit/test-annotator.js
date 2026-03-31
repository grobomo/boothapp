#!/usr/bin/env node
// Unit test: annotator-overlay.js module logic
'use strict';

var BoothAnnotator = require('../../presenter/components/annotator-overlay.js');
var passed = 0;
var failed = 0;

function assert(desc, ok) {
  if (ok) {
    console.log('  PASS: ' + desc);
    passed++;
  } else {
    console.log('  FAIL: ' + desc);
    failed++;
  }
}

console.log('== annotator-overlay unit tests ==\n');

// -- Module exports --
assert('BoothAnnotator is a constructor function', typeof BoothAnnotator === 'function');
assert('renderOntoImage is a static function', typeof BoothAnnotator.renderOntoImage === 'function');
assert('__StrokeRenderer is exposed', typeof BoothAnnotator.__StrokeRenderer === 'function');

// -- Stroke serialization round-trip --
var strokes = [
  { tool: 'pen', color: '#ff3b30', points: [{x: 10, y: 20}, {x: 30, y: 40}, {x: 50, y: 60}] },
  { tool: 'highlighter', color: '#ffcc00', points: [{x: 0, y: 0}, {x: 100, y: 100}] },
  { tool: 'arrow', color: '#007aff', points: [{x: 5, y: 5}, {x: 200, y: 150}] },
  { tool: 'text', color: '#34c759', points: [{x: 50, y: 50}], text: 'Test annotation' }
];

var json = JSON.stringify(strokes);
var parsed = JSON.parse(json);

assert('Serialization preserves stroke count', parsed.length === 4);
assert('Pen stroke has correct tool', parsed[0].tool === 'pen');
assert('Pen stroke has 3 points', parsed[0].points.length === 3);
assert('Text stroke preserves text field', parsed[3].text === 'Test annotation');
assert('Arrow stroke has correct color', parsed[2].color === '#007aff');
assert('Highlighter points round-trip', parsed[1].points[0].x === 0 && parsed[1].points[1].y === 100);

// -- Annotations JSON format --
var annotationsDoc = {
  session_id: 'TEST-001',
  updated_at: new Date().toISOString(),
  annotations: {}
};
annotationsDoc.annotations['screenshot_001.jpg'] = {
  strokes: strokes,
  updated_at: new Date().toISOString()
};
annotationsDoc.annotations['screenshot_002.jpg'] = {
  strokes: [strokes[0]],
  updated_at: new Date().toISOString()
};

var docJson = JSON.stringify(annotationsDoc);
var docParsed = JSON.parse(docJson);

assert('Annotations doc has session_id', docParsed.session_id === 'TEST-001');
assert('Annotations doc has 2 screenshot entries', Object.keys(docParsed.annotations).length === 2);
assert('Screenshot 1 has 4 strokes', docParsed.annotations['screenshot_001.jpg'].strokes.length === 4);
assert('Screenshot 2 has 1 stroke', docParsed.annotations['screenshot_002.jpg'].strokes.length === 1);

// -- Empty strokes edge case --
var emptyStrokes = [];
var emptyJson = JSON.stringify(emptyStrokes);
assert('Empty strokes serializes to []', emptyJson === '[]');

// -- StrokeRenderer instantiation --
// Create a minimal mock context
var mockCtx = {
  save: function(){}, restore: function(){}, beginPath: function(){}, closePath: function(){},
  moveTo: function(){}, lineTo: function(){}, stroke: function(){}, fill: function(){},
  fillRect: function(){}, fillText: function(){}, measureText: function(){ return {width: 100}; },
  font: '', globalAlpha: 1, globalCompositeOperation: '', strokeStyle: '', fillStyle: '',
  lineWidth: 1, lineCap: '', lineJoin: ''
};

var renderer = new BoothAnnotator.__StrokeRenderer(mockCtx);
assert('StrokeRenderer instantiates with context', renderer.ctx === mockCtx);

// Render each stroke type without error
var renderError = false;
try {
  renderer.drawStroke(strokes[0]); // pen
  renderer.drawStroke(strokes[1]); // highlighter
  renderer.drawStroke(strokes[2]); // arrow
  renderer.drawStroke(strokes[3]); // text
} catch (e) {
  renderError = true;
  console.log('  Render error:', e.message);
}
assert('StrokeRenderer draws all 4 stroke types without error', !renderError);

// -- Single-point stroke (should not crash) --
var singlePt = { tool: 'pen', color: '#000', points: [{x: 5, y: 5}] };
try {
  renderer.drawStroke(singlePt);
  assert('Single-point pen stroke does not crash', true);
} catch (e) {
  assert('Single-point pen stroke does not crash', false);
}

// -- Summary --
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
