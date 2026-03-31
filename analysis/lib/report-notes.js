'use strict';

// ---------------------------------------------------------------------------
// Report Notes — renders SE session notes as a "Key Takeaways" HTML section
// for inclusion in analysis reports.
// ---------------------------------------------------------------------------

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Format an ISO timestamp into a readable string.
 * @param {string} iso
 * @returns {string}
 */
function formatTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return escapeHtml(iso);
    return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

/**
 * Render a "Key Takeaways" HTML section from session notes.
 *
 * Returns an empty string if notes array is empty or missing,
 * so the section only appears when SEs have added notes.
 *
 * @param {Array<{timestamp: string, author: string, content: string}>} notes
 * @returns {string} HTML string
 */
function renderKeyTakeaways(notes) {
    if (!notes || !notes.length) return '';

    // Sort chronologically
    const sorted = notes.slice().sort((a, b) => {
        return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
    });

    const items = sorted.map((n) => {
        const author = escapeHtml(n.author || 'Unknown');
        const time = formatTimestamp(n.timestamp);
        const content = escapeHtml(n.content || '');
        return `<div class="takeaway-item">
            <div class="takeaway-meta">${author} &mdash; ${time}</div>
            <div class="takeaway-content">${content}</div>
        </div>`;
    });

    return `
    <div class="section-title" style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#636E72;margin:32px 0 16px;padding-bottom:8px;border-bottom:2px solid #DFE6E9;">Key Takeaways</div>
    <div class="card" style="background:#FFFFFF;border:1px solid #DFE6E9;border-radius:10px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:16px;color:#1A1A2E;">SE Notes &amp; Observations</h3>
        ${items.join('\n')}
    </div>`;
}

/**
 * CSS for takeaway items (can be injected into report <style> block).
 */
const TAKEAWAY_CSS = `
.takeaway-item { padding: 12px 0; border-bottom: 1px solid #DFE6E9; }
.takeaway-item:last-child { border-bottom: none; }
.takeaway-meta { font-size: 12px; color: #636E72; margin-bottom: 4px; }
.takeaway-content { font-size: 15px; line-height: 1.6; white-space: pre-wrap; }
`;

module.exports = { renderKeyTakeaways, escapeHtml, formatTimestamp, TAKEAWAY_CSS };
