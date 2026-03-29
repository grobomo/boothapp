// ─── MCP Status (placeholder) ────────────────────────────────────────────────

document.getElementById('statusText').textContent = 'MCP relay not configured';
document.getElementById('toolCount').textContent = '30';

// ─── Session Status ───────────────────────────────────────────────────────────

function updateSessionStatus() {
  chrome.storage.local.get(['v1helper_session'], (result) => {
    const session = result.v1helper_session;
    const dot = document.getElementById('sessionDot');
    const text = document.getElementById('sessionText');
    if (session && session.active && session.session_id) {
      dot.classList.add('active');
      text.textContent = 'Session Active: ' + session.session_id;
      text.classList.add('active');
    } else {
      dot.classList.remove('active');
      text.textContent = 'No Active Session';
      text.classList.remove('active');
    }
  });
}

updateSessionStatus();

// ─── S3 Config ────────────────────────────────────────────────────────────────

const S3_KEYS = ['s3Bucket', 's3Region', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken'];

function isConfigured(config) {
  return !!(config.s3Bucket && config.s3Region && config.awsAccessKeyId && config.awsSecretAccessKey);
}

function updateConfiguredBadge(config) {
  const badge = document.getElementById('s3ConfiguredBadge');
  badge.style.display = isConfigured(config) ? 'inline' : 'none';
}

// Load saved values and pre-fill fields
chrome.storage.local.get(S3_KEYS, (config) => {
  if (config.s3Bucket)            document.getElementById('s3Bucket').value = config.s3Bucket;
  if (config.s3Region)            document.getElementById('s3Region').value = config.s3Region;
  if (config.awsAccessKeyId)      document.getElementById('awsAccessKeyId').value = config.awsAccessKeyId;
  if (config.awsSecretAccessKey)  document.getElementById('awsSecretAccessKey').value = config.awsSecretAccessKey;
  if (config.awsSessionToken)     document.getElementById('awsSessionToken').value = config.awsSessionToken;
  updateConfiguredBadge(config);
});

// Save button
document.getElementById('s3SaveBtn').addEventListener('click', () => {
  const config = {
    s3Bucket:           document.getElementById('s3Bucket').value.trim(),
    s3Region:           document.getElementById('s3Region').value.trim(),
    awsAccessKeyId:     document.getElementById('awsAccessKeyId').value.trim(),
    awsSecretAccessKey: document.getElementById('awsSecretAccessKey').value.trim(),
    awsSessionToken:    document.getElementById('awsSessionToken').value.trim(),
  };
  chrome.storage.local.set(config, () => {
    updateConfiguredBadge(config);
    const btn = document.getElementById('s3SaveBtn');
    const orig = btn.textContent;
    btn.textContent = 'Saved ✓';
    btn.classList.add('saved');
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('saved');
    }, 1500);
  });
});

// Pre-fill Demo button
document.getElementById('s3DemoBtn').addEventListener('click', () => {
  document.getElementById('s3Bucket').value = 'boothapp-sessions-752266476357';
  document.getElementById('s3Region').value = 'us-east-1';
});

// Collapsible toggle
document.getElementById('s3ConfigToggle').addEventListener('click', () => {
  const body = document.getElementById('s3ConfigBody');
  const arrow = document.getElementById('s3Arrow');
  const collapsed = body.classList.toggle('collapsed');
  arrow.textContent = collapsed ? '▶' : '▼';
});
