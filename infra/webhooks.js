"use strict";

/**
 * Webhook notification system for BoothApp session analysis.
 *
 * Fires webhooks to configured URLs when a session analysis completes.
 * Supports Slack, Microsoft Teams (Adaptive Card), and generic HTTP POST.
 *
 * Configuration via environment variables:
 *   WEBHOOK_SLACK_URL    - Slack incoming webhook URL
 *   WEBHOOK_TEAMS_URL    - Microsoft Teams incoming webhook URL
 *   WEBHOOK_GENERIC_URL  - Generic HTTP POST endpoint
 *   WEBHOOK_MAX_RETRIES  - Max retry attempts (default: 3)
 *   WEBHOOK_TIMEOUT_MS   - Request timeout in ms (default: 10000)
 *
 * Default: no webhooks configured (all functions are no-ops).
 */

const MAX_RETRIES_DEFAULT = 3;
const TIMEOUT_MS_DEFAULT = 10000;
const BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Payload formatters
// ---------------------------------------------------------------------------

/**
 * Format session data as a Slack message payload.
 */
function formatSlackPayload(session) {
  const visitor = session.visitor || {};
  const name = visitor.name || "Unknown Visitor";
  const company = visitor.company || "N/A";
  const title = visitor.title || "";
  const score = session.engagement_score != null ? session.engagement_score : "N/A";

  const products = (session.products_demonstrated || [])
    .map((p) => (typeof p === "string" ? p : p.name || "Unknown"))
    .join(", ") || "None";

  const interests = (session.interests || [])
    .map((i) => {
      const topic = typeof i === "string" ? i : i.topic || "Unknown";
      const conf = typeof i === "string" ? "" : ` (${i.confidence || "?"})`;
      return `${topic}${conf}`;
    })
    .join(", ") || "None";

  return {
    text: `Booth session analysis complete: ${name} (${company})`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Booth Session Analysis Complete", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Visitor:*\n${name}` },
          { type: "mrkdwn", text: `*Company:*\n${company}` },
          { type: "mrkdwn", text: `*Title:*\n${title || "N/A"}` },
          { type: "mrkdwn", text: `*Engagement Score:*\n${score}` },
        ],
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Products Demonstrated:*\n${products}` },
          { type: "mrkdwn", text: `*Interests:*\n${interests}` },
        ],
      },
    ],
  };
}

/**
 * Format session data as a Microsoft Teams Adaptive Card payload.
 */
function formatTeamsPayload(session) {
  const visitor = session.visitor || {};
  const name = visitor.name || "Unknown Visitor";
  const company = visitor.company || "N/A";
  const title = visitor.title || "";
  const score = session.engagement_score != null ? String(session.engagement_score) : "N/A";

  const products = (session.products_demonstrated || [])
    .map((p) => (typeof p === "string" ? p : p.name || "Unknown"))
    .join(", ") || "None";

  const interests = (session.interests || [])
    .map((i) => {
      const topic = typeof i === "string" ? i : i.topic || "Unknown";
      const conf = typeof i === "string" ? "" : ` (${i.confidence || "?"})`;
      return `${topic}${conf}`;
    })
    .join(", ") || "None";

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              size: "Large",
              weight: "Bolder",
              text: "Booth Session Analysis Complete",
            },
            {
              type: "ColumnSet",
              columns: [
                {
                  type: "Column",
                  width: "stretch",
                  items: [
                    { type: "TextBlock", text: "Visitor", weight: "Bolder", isSubtle: true },
                    { type: "TextBlock", text: name, wrap: true },
                  ],
                },
                {
                  type: "Column",
                  width: "stretch",
                  items: [
                    { type: "TextBlock", text: "Company", weight: "Bolder", isSubtle: true },
                    { type: "TextBlock", text: company, wrap: true },
                  ],
                },
              ],
            },
            {
              type: "ColumnSet",
              columns: [
                {
                  type: "Column",
                  width: "stretch",
                  items: [
                    { type: "TextBlock", text: "Title", weight: "Bolder", isSubtle: true },
                    { type: "TextBlock", text: title || "N/A", wrap: true },
                  ],
                },
                {
                  type: "Column",
                  width: "stretch",
                  items: [
                    { type: "TextBlock", text: "Engagement Score", weight: "Bolder", isSubtle: true },
                    { type: "TextBlock", text: score, wrap: true },
                  ],
                },
              ],
            },
            {
              type: "FactSet",
              facts: [
                { title: "Products", value: products },
                { title: "Interests", value: interests },
              ],
            },
          ],
        },
      },
    ],
  };
}

/**
 * Format session data as a generic JSON payload for HTTP POST.
 */
function formatGenericPayload(session) {
  const visitor = session.visitor || {};
  return {
    event: "session_analysis_complete",
    timestamp: new Date().toISOString(),
    session_id: session.session_id || session.report_id || null,
    visitor: {
      name: visitor.name || null,
      company: visitor.company || null,
      title: visitor.title || null,
      email: visitor.email || null,
    },
    engagement_score: session.engagement_score != null ? session.engagement_score : null,
    products_demonstrated: (session.products_demonstrated || []).map((p) =>
      typeof p === "string" ? p : p.name || "Unknown"
    ),
    interests: (session.interests || []).map((i) =>
      typeof i === "string" ? i : { topic: i.topic, confidence: i.confidence }
    ),
    recommendations: session.recommendations || [],
  };
}

// ---------------------------------------------------------------------------
// Delivery engine
// ---------------------------------------------------------------------------

/**
 * Send a webhook with retry and exponential backoff.
 *
 * @param {string} url        - Target webhook URL
 * @param {object} payload    - JSON-serializable payload
 * @param {string} targetName - Human-readable name for logging (e.g. "slack")
 * @param {object} [options]  - { maxRetries, timeoutMs, fetchFn, logFn }
 * @returns {Promise<{target: string, url: string, success: boolean, attempts: number, error?: string}>}
 */
async function deliverWebhook(url, payload, targetName, options = {}) {
  const maxRetries = options.maxRetries ?? MAX_RETRIES_DEFAULT;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS_DEFAULT;
  const fetchFn = options.fetchFn || globalThis.fetch;
  const log = options.logFn || _log;

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log("info", `Webhook delivery attempt ${attempt}/${maxRetries} to ${targetName}`, { url });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        log("info", `Webhook delivered to ${targetName}`, {
          url,
          status: response.status,
          attempt,
        });
        return { target: targetName, url, success: true, attempts: attempt };
      }

      lastError = `HTTP ${response.status}`;
      log("warn", `Webhook ${targetName} returned ${response.status}`, {
        url,
        attempt,
      });
    } catch (err) {
      lastError = err.name === "AbortError" ? "timeout" : err.message;
      log("warn", `Webhook ${targetName} failed: ${lastError}`, {
        url,
        attempt,
      });
    }

    // Exponential backoff before next retry (skip delay after last attempt)
    if (attempt < maxRetries) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      if (!options._skipDelay) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  log("error", `Webhook delivery to ${targetName} failed after ${maxRetries} attempts`, {
    url,
    error: lastError,
  });

  return {
    target: targetName,
    url,
    success: false,
    attempts: maxRetries,
    error: lastError,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Send webhook notifications for a completed session analysis.
 *
 * Reads webhook URLs from environment variables. If no URLs are configured,
 * this is a no-op. All deliveries happen in parallel.
 *
 * @param {object} sessionData - The session analysis result data
 * @param {object} [options]   - Override options (env, fetchFn, logFn, etc.)
 * @returns {Promise<Array<{target, url, success, attempts, error?}>>}
 */
async function notifyWebhooks(sessionData, options = {}) {
  const env = options.env || process.env;
  const log = options.logFn || _log;

  const targets = [];

  const slackUrl = env.WEBHOOK_SLACK_URL;
  if (slackUrl) {
    targets.push({
      name: "slack",
      url: slackUrl,
      payload: formatSlackPayload(sessionData),
    });
  }

  const teamsUrl = env.WEBHOOK_TEAMS_URL;
  if (teamsUrl) {
    targets.push({
      name: "teams",
      url: teamsUrl,
      payload: formatTeamsPayload(sessionData),
    });
  }

  const genericUrl = env.WEBHOOK_GENERIC_URL;
  if (genericUrl) {
    targets.push({
      name: "generic",
      url: genericUrl,
      payload: formatGenericPayload(sessionData),
    });
  }

  if (targets.length === 0) {
    log("info", "No webhooks configured, skipping notifications");
    return [];
  }

  const maxRetries = parseInt(env.WEBHOOK_MAX_RETRIES, 10) || MAX_RETRIES_DEFAULT;
  const timeoutMs = parseInt(env.WEBHOOK_TIMEOUT_MS, 10) || TIMEOUT_MS_DEFAULT;

  log("info", `Sending webhooks to ${targets.length} target(s)`, {
    targets: targets.map((t) => t.name),
  });

  const results = await Promise.all(
    targets.map((t) =>
      deliverWebhook(t.url, t.payload, t.name, {
        maxRetries,
        timeoutMs,
        fetchFn: options.fetchFn,
        logFn: log,
        _skipDelay: options._skipDelay,
      })
    )
  );

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  log("info", `Webhook delivery complete: ${succeeded} succeeded, ${failed} failed`);

  return results;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function _log(level, message, meta) {
  const ts = new Date().toISOString();
  const metaStr = meta ? " " + JSON.stringify(meta) : "";
  const line = `[${ts}] [webhook:${level}] ${message}${metaStr}`;
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  notifyWebhooks,
  deliverWebhook,
  formatSlackPayload,
  formatTeamsPayload,
  formatGenericPayload,
};
