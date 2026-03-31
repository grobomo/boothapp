'use strict';

// ---------------------------------------------------------------------------
// Email follow-up template generator.
//
// Takes correlator output ({ segments, summary }) and produces a personalized
// follow-up email template for sales reps to send to booth visitors.
// ---------------------------------------------------------------------------

const TOPIC_CONTENT = {
  'XDR': {
    subject: 'See how XDR unifies your security operations',
    blurb: 'Our Agentic SIEM & XDR platform correlates alerts across endpoints, email, cloud, and network -- giving your SOC a single pane of glass with AI-powered investigation.',
    cta: 'Book a live XDR demo',
    resource: 'https://www.trendmicro.com/en_us/business/products/detection-response.html',
  },
  'Endpoint Security': {
    subject: 'Next-gen endpoint protection tailored to your environment',
    blurb: 'From workload protection to EDR, our endpoint platform stops threats before they execute -- with minimal performance impact on your servers and desktops.',
    cta: 'Start a free endpoint trial',
    resource: 'https://www.trendmicro.com/en_us/business/products/endpoint-security.html',
  },
  'ZTSA': {
    subject: 'Zero Trust access without the complexity',
    blurb: 'Trend Micro Zero Trust Secure Access continuously verifies user identity and device posture before granting access to private apps -- no VPN required.',
    cta: 'See ZTSA in action',
    resource: 'https://www.trendmicro.com/en_us/business/products/zero-trust.html',
  },
  'Cloud Security': {
    subject: 'Secure your cloud from build to runtime',
    blurb: 'Whether you run containers, serverless, or VMs, Cloud Security provides unified visibility and automated protection across AWS, Azure, and GCP.',
    cta: 'Explore cloud security',
    resource: 'https://www.trendmicro.com/en_us/business/products/cloud-security.html',
  },
  'Email Security': {
    subject: 'Stop phishing and BEC before they reach the inbox',
    blurb: 'Our email security uses AI-powered analysis to catch phishing, business email compromise, and zero-day attachments -- protecting Microsoft 365 and Google Workspace.',
    cta: 'Try email protection free',
    resource: 'https://www.trendmicro.com/en_us/business/products/email-security.html',
  },
};

const ENGAGEMENT_TIERS = {
  high: {
    greeting: 'It was great having an in-depth conversation with you at the booth!',
    tone: 'technical',
    includeTranscriptHighlights: true,
  },
  medium: {
    greeting: 'Thanks for stopping by our booth and checking out our solutions!',
    tone: 'balanced',
    includeTranscriptHighlights: false,
  },
  low: {
    greeting: 'Thanks for visiting us at the event! We noticed you browsed some of our solutions and wanted to share a few resources.',
    tone: 'nurture',
    includeTranscriptHighlights: false,
  },
};

/**
 * Extract notable transcript snippets from high-engagement segments.
 *
 * @param {Array} segments - correlator segments
 * @param {number} maxSnippets - max snippets to return (default 3)
 * @returns {string[]} transcript excerpts
 */
function extractHighlights(segments, maxSnippets) {
  const limit = maxSnippets || 3;
  return segments
    .filter((s) => s.engagement_score === 'high' && s.transcript_text)
    .slice(0, limit)
    .map((s) => {
      const text = s.transcript_text;
      return text.length > 200 ? text.slice(0, 197) + '...' : text;
    });
}

/**
 * Build topic content blocks for the email body.
 *
 * @param {string[]} topics - detected topic names from correlator summary
 * @returns {Object[]} array of { topic, subject, blurb, cta, resource }
 */
function buildTopicBlocks(topics) {
  if (!topics || !topics.length) return [];
  return topics
    .filter((t) => TOPIC_CONTENT[t])
    .map((t) => ({ topic: t, ...TOPIC_CONTENT[t] }));
}

/**
 * Generate a follow-up email template from correlator output.
 *
 * @param {Object} correlatorOutput - { segments, summary } from correlate()
 * @param {Object} [visitor]        - optional visitor info { name, company, email }
 * @returns {Object} { subject, greeting, topicBlocks, highlights, cta, tone }
 */
function generateTemplate(correlatorOutput, visitor) {
  const { segments = [], summary = {} } = correlatorOutput || {};
  const { topics = [], avgEngagement = 'low' } = summary;

  const tier = ENGAGEMENT_TIERS[avgEngagement] || ENGAGEMENT_TIERS.low;
  const topicBlocks = buildTopicBlocks(topics);
  const highlights = tier.includeTranscriptHighlights
    ? extractHighlights(segments)
    : [];

  // Pick subject line: use primary topic if available, else generic
  const primaryTopic = topicBlocks[0];
  const subject = primaryTopic
    ? primaryTopic.subject
    : 'Great meeting you -- here are some resources from Trend Micro';

  // Build the greeting with optional visitor name
  const name = (visitor && visitor.name) ? visitor.name : 'there';
  const greeting = `Hi ${name},\n\n${tier.greeting}`;

  // Build body sections
  const bodySections = [];

  if (highlights.length > 0) {
    bodySections.push({
      type: 'highlights',
      heading: 'From our conversation',
      items: highlights,
    });
  }

  if (topicBlocks.length > 0) {
    bodySections.push({
      type: 'topics',
      heading: 'Solutions we discussed',
      items: topicBlocks.map((tb) => ({
        topic: tb.topic,
        blurb: tb.blurb,
        cta: tb.cta,
        resource: tb.resource,
      })),
    });
  }

  const closingCta = primaryTopic
    ? `Ready to take the next step? ${primaryTopic.cta}: ${primaryTopic.resource}`
    : 'Explore our full platform: https://www.trendmicro.com/en_us/business.html';

  return {
    subject,
    greeting,
    bodySections,
    closingCta,
    tone: tier.tone,
    topicCount: topicBlocks.length,
    engagementTier: avgEngagement,
  };
}

/**
 * Render a template to plain text email body.
 *
 * @param {Object} template - output from generateTemplate()
 * @returns {string} plain text email
 */
function renderPlainText(template) {
  const lines = [];

  lines.push(template.greeting);
  lines.push('');

  for (const section of template.bodySections) {
    lines.push(`--- ${section.heading} ---`);
    lines.push('');

    if (section.type === 'highlights') {
      for (const item of section.items) {
        lines.push(`  "${item}"`);
      }
    } else if (section.type === 'topics') {
      for (const item of section.items) {
        lines.push(`* ${item.topic}: ${item.blurb}`);
        lines.push(`  ${item.cta}: ${item.resource}`);
        lines.push('');
      }
    }
    lines.push('');
  }

  lines.push(template.closingCta);
  lines.push('');
  lines.push('Best regards,');
  lines.push('The Trend Micro Team');

  return lines.join('\n');
}

module.exports = {
  generateTemplate,
  renderPlainText,
  extractHighlights,
  buildTopicBlocks,
  TOPIC_CONTENT,
  ENGAGEMENT_TIERS,
};
