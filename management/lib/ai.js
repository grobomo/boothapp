const https = require('https');
const http = require('http');

// AI provider: tries RONE AI gateway first, falls back to direct Anthropic
const RONE_AI_API_KEY = process.env.RONE_AI_API_KEY || '';
const RONE_AI_BASE_URL = process.env.RONE_AI_BASE_URL || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

function getProvider() {
  if (RONE_AI_API_KEY && RONE_AI_BASE_URL) {
    return { baseUrl: RONE_AI_BASE_URL, apiKey: RONE_AI_API_KEY, type: 'rone' };
  }
  if (ANTHROPIC_API_KEY) {
    return { baseUrl: 'https://api.anthropic.com', apiKey: ANTHROPIC_API_KEY, type: 'anthropic' };
  }
  return null;
}

function makeRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Call Claude with messages (supports text + image content blocks)
async function chat(messages, options = {}) {
  const provider = getProvider();
  if (!provider) throw new Error('No AI provider configured (set RONE_AI_API_KEY or ANTHROPIC_API_KEY)');

  const url = provider.type === 'rone'
    ? `${provider.baseUrl}/v1/messages`
    : `${provider.baseUrl}/v1/messages`;

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': provider.apiKey,
    'anthropic-version': '2023-06-01'
  };

  const body = JSON.stringify({
    model: options.model || 'claude-sonnet-4-20250514',
    max_tokens: options.maxTokens || 4096,
    messages,
    ...(options.system ? { system: options.system } : {})
  });

  const parsed = new URL(url);
  const resp = await makeRequest(url, {
    method: 'POST',
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname,
    headers
  }, body);

  return resp;
}

// Extract text from Claude response
function extractText(response) {
  if (response?.content) {
    return response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }
  return '';
}

// Badge extraction: send image + profile to Claude Vision
async function extractBadgeFields(imageBase64, mediaType, badgeProfile) {
  const profilePrompt = badgeProfile?.extraction_prompt ||
    'Extract the following fields from this badge photo: name, company, title. Return JSON with field_type as keys.';

  const messages = [{
    role: 'user',
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 }
      },
      {
        type: 'text',
        text: profilePrompt + '\n\nReturn ONLY valid JSON like: {"name":"...","company":"...","title":"..."}'
      }
    ]
  }];

  const resp = await chat(messages, { maxTokens: 1024 });
  const text = extractText(resp);

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error('Could not parse badge fields from AI response');
}

// Contact matching: find best match for a visitor in a contact list
async function matchContact(visitorName, visitorCompany, contacts) {
  const contactList = contacts.map((c, i) =>
    `${i + 1}. ${c.name || 'N/A'} | ${c.company || 'N/A'} | ${c.email || 'N/A'} | ${c.title || 'N/A'}`
  ).join('\n');

  const messages = [{
    role: 'user',
    content: `Match this visitor to the best contact in the list.

Visitor: ${visitorName}${visitorCompany ? ' from ' + visitorCompany : ''}

Contact list:
${contactList}

Consider: name variations, nicknames, company abbreviations, OCR typos.
Return ONLY valid JSON: {"match_index": <1-based index or 0 if no match>, "confidence": <0-100>, "reasoning": "..."}`
  }];

  const resp = await chat(messages, { maxTokens: 512 });
  const text = extractText(resp);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return { match_index: 0, confidence: 0, reasoning: 'Could not parse AI response' };
}

module.exports = { chat, extractText, extractBadgeFields, matchContact, getProvider };
