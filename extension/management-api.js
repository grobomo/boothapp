// Management Server API client
// Connects to caseyapp.trendcyberrange.com for event/demo PC management

const ManagementAPI = (() => {
  const DEFAULT_URL = 'https://caseyapp.trendcyberrange.com';

  async function getBaseUrl() {
    const { managementUrl } = await chrome.storage.local.get(['managementUrl']);
    return managementUrl || DEFAULT_URL;
  }

  async function request(method, path, body) {
    const baseUrl = await getBaseUrl();
    const url = `${baseUrl}${path}`;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path}: ${res.status} ${text}`);
    }
    return res.json();
  }

  return {
    // Get the currently active event
    async getActiveEvent() {
      return request('GET', '/api/events/active');
    },

    // Register a demo PC for the active event
    async registerDemoPC(name) {
      return request('POST', '/api/demo-pcs', { name });
    },

    // Get QR payload for a registered demo PC
    async getQRPayload(demoPcId) {
      return request('GET', `/api/demo-pcs/${encodeURIComponent(demoPcId)}/qr-payload`);
    },

    // Health check
    async ping() {
      const baseUrl = await getBaseUrl();
      const res = await fetch(`${baseUrl}/api/health`, { method: 'GET' });
      return res.ok;
    },

    getBaseUrl,
    DEFAULT_URL,
  };
})();
