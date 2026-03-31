var test = require('node:test');
var assert = require('node:assert/strict');
var CostEstimator = require('./cost-estimator.js');

// ---------------------------------------------------------------------------
// Pricing constants
// ---------------------------------------------------------------------------
test('PRICING has correct S3 rate', function () {
  assert.equal(CostEstimator.PRICING.s3PerGBMonth, 0.023);
});

test('PRICING has correct Lambda invocation rate', function () {
  assert.equal(CostEstimator.PRICING.lambdaPerInvocation, 0.0000002);
});

test('PRICING has correct Transcribe rate', function () {
  assert.equal(CostEstimator.PRICING.transcribePerMinute, 0.024);
});

test('PRICING has correct Bedrock input token rate', function () {
  assert.equal(CostEstimator.PRICING.bedrockInputPer1MToken, 3.00);
});

test('PRICING has correct Bedrock output token rate', function () {
  assert.equal(CostEstimator.PRICING.bedrockOutputPer1MToken, 15.00);
});

test('PRICING has correct data transfer rate', function () {
  assert.equal(CostEstimator.PRICING.dataTransferPerGB, 0.09);
});

// ---------------------------------------------------------------------------
// Session defaults
// ---------------------------------------------------------------------------
test('SESSION_DEFAULTS has 5 min audio', function () {
  assert.equal(CostEstimator.SESSION_DEFAULTS.audioMinutes, 5);
});

test('SESSION_DEFAULTS has 2 Lambda invocations', function () {
  assert.equal(CostEstimator.SESSION_DEFAULTS.lambdaInvocations, 2);
});

test('SESSION_DEFAULTS has 8 screenshots', function () {
  assert.equal(CostEstimator.SESSION_DEFAULTS.screenshotCount, 8);
});

// ---------------------------------------------------------------------------
// estimateSession -- structure
// ---------------------------------------------------------------------------
test('estimateSession returns all cost categories', function () {
  var est = CostEstimator.estimateSession();
  assert.ok(est.s3);
  assert.ok(est.lambda);
  assert.ok(est.transcribe);
  assert.ok(est.bedrock);
  assert.ok(est.transfer);
  assert.equal(typeof est.total, 'number');
});

test('estimateSession total is sum of parts', function () {
  var est = CostEstimator.estimateSession();
  var sum = est.s3.cost + est.lambda.cost + est.transcribe.cost + est.bedrock.cost + est.transfer.cost;
  assert.ok(Math.abs(est.total - sum) < 1e-12);
});

test('estimateSession total is positive', function () {
  var est = CostEstimator.estimateSession();
  assert.ok(est.total > 0);
});

// ---------------------------------------------------------------------------
// estimateSession -- realistic ranges
// ---------------------------------------------------------------------------
test('per-session cost is under $1', function () {
  var est = CostEstimator.estimateSession();
  assert.ok(est.total < 1, 'Expected total < $1, got $' + est.total.toFixed(4));
});

test('per-session cost is at least $0.10 (Transcribe alone is $0.12)', function () {
  var est = CostEstimator.estimateSession();
  assert.ok(est.total >= 0.10, 'Expected total >= $0.10, got $' + est.total.toFixed(4));
});

test('Transcribe is the dominant cost for a 5-min session', function () {
  var est = CostEstimator.estimateSession();
  assert.ok(est.transcribe.cost > est.s3.cost);
  assert.ok(est.transcribe.cost > est.lambda.cost);
  assert.ok(est.transcribe.cost > est.transfer.cost);
});

test('S3 storage is measured in MB', function () {
  var est = CostEstimator.estimateSession();
  assert.ok(est.s3.storageMB > 0);
  assert.ok(est.s3.storageMB < 100); // not unreasonably large
});

// ---------------------------------------------------------------------------
// estimateSession -- overrides
// ---------------------------------------------------------------------------
test('audioMinutes override changes Transcribe cost', function () {
  var short = CostEstimator.estimateSession({ audioMinutes: 1 });
  var long  = CostEstimator.estimateSession({ audioMinutes: 30 });
  assert.ok(long.transcribe.cost > short.transcribe.cost);
  assert.equal(short.transcribe.minutes, 1);
  assert.equal(long.transcribe.minutes, 30);
});

test('screenshotCount override changes S3 cost', function () {
  var few  = CostEstimator.estimateSession({ screenshotCount: 1 });
  var many = CostEstimator.estimateSession({ screenshotCount: 50 });
  assert.ok(many.s3.cost > few.s3.cost);
});

test('bedrockInputTokens override changes Bedrock cost', function () {
  var small = CostEstimator.estimateSession({ bedrockInputTokens: 100 });
  var large = CostEstimator.estimateSession({ bedrockInputTokens: 100000 });
  assert.ok(large.bedrock.cost > small.bedrock.cost);
});

test('bedrockOutputTokens override changes Bedrock cost', function () {
  var small = CostEstimator.estimateSession({ bedrockOutputTokens: 100 });
  var large = CostEstimator.estimateSession({ bedrockOutputTokens: 50000 });
  assert.ok(large.bedrock.cost > small.bedrock.cost);
});

// ---------------------------------------------------------------------------
// formatUSD
// ---------------------------------------------------------------------------
test('formatUSD formats small values with 6 decimals', function () {
  assert.equal(CostEstimator.formatUSD(0.000042), '$0.000042');
});

test('formatUSD formats medium values with 4 decimals', function () {
  assert.equal(CostEstimator.formatUSD(0.12), '$0.1200');
});

test('formatUSD formats dollar values with 2 decimals', function () {
  assert.equal(CostEstimator.formatUSD(3.50), '$3.50');
});

// ---------------------------------------------------------------------------
// renderCard (HTML output)
// ---------------------------------------------------------------------------
test('renderCard returns HTML string', function () {
  var est = CostEstimator.estimateSession();
  var html = CostEstimator.renderCard(est, 10);
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('cost-card'));
});

test('renderCard includes all service names', function () {
  var est = CostEstimator.estimateSession();
  var html = CostEstimator.renderCard(est, 1);
  assert.ok(html.includes('S3 Storage'));
  assert.ok(html.includes('Lambda'));
  assert.ok(html.includes('Transcribe'));
  assert.ok(html.includes('Bedrock'));
  assert.ok(html.includes('Data Transfer'));
});

test('renderCard includes session count in running total', function () {
  var est = CostEstimator.estimateSession();
  var html = CostEstimator.renderCard(est, 42);
  assert.ok(html.includes('42 sessions'));
});

test('renderCard includes per-session total', function () {
  var est = CostEstimator.estimateSession();
  var html = CostEstimator.renderCard(est, 1);
  assert.ok(html.includes('Per Session'));
});

test('renderCard includes cost bar', function () {
  var est = CostEstimator.estimateSession();
  var html = CostEstimator.renderCard(est, 1);
  assert.ok(html.includes('cost-bar'));
  assert.ok(html.includes('cost-bar-segment'));
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
test('zero audio minutes gives zero Transcribe cost', function () {
  var est = CostEstimator.estimateSession({ audioMinutes: 0 });
  assert.equal(est.transcribe.cost, 0);
});

test('zero tokens gives zero Bedrock cost', function () {
  var est = CostEstimator.estimateSession({ bedrockInputTokens: 0, bedrockOutputTokens: 0 });
  assert.equal(est.bedrock.cost, 0);
});
