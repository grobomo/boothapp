#!/usr/bin/env node
// email-report.js -- Format session summary as email-ready HTML
//
// Usage: node email-report.js <sessionPath>
//   sessionPath: local directory or s3://bucket/sessions/<sessionId>
//
// Reads: output/summary.html, metadata.json, output/follow-up.json
// Writes: output/email-ready.html

'use strict';

const fs = require('fs');
const path = require('path');

// Lazy-load AWS SDK only when needed (keeps local/test usage dependency-free)
let _s3;
function getS3() {
  if (!_s3) {
    const sdk = require('@aws-sdk/client-s3');
    _s3 = { S3Client: sdk.S3Client, GetObjectCommand: sdk.GetObjectCommand, PutObjectCommand: sdk.PutObjectCommand };
  }
  return _s3;
}

const [, , sessionPath] = process.argv;

if (!sessionPath) {
  console.error('Usage: email-report.js <sessionPath>');
  process.exit(1);
}

const IS_S3 = sessionPath.startsWith('s3://');
const REGION = process.env.AWS_REGION || 'us-east-1';

function parseS3Path(s3Uri) {
  const without = s3Uri.replace('s3://', '');
  const slashIdx = without.indexOf('/');
  if (slashIdx === -1) return { bucket: without, prefix: '' };
  return {
    bucket: without.slice(0, slashIdx),
    prefix: without.slice(slashIdx + 1),
  };
}

async function readFile(location) {
  if (IS_S3) {
    const { bucket, prefix } = parseS3Path(sessionPath);
    const key = prefix ? `${prefix}/${location}` : location;
    const { S3Client, GetObjectCommand } = getS3();
    const client = new S3Client({ region: REGION });
    const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks = [];
    for await (const chunk of resp.Body) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }
  return fs.readFileSync(path.join(sessionPath, location), 'utf8');
}

async function readJson(location) {
  return JSON.parse(await readFile(location));
}

async function writeOutput(location, content) {
  if (IS_S3) {
    const { bucket, prefix } = parseS3Path(sessionPath);
    const key = prefix ? `${prefix}/${location}` : location;
    const { S3Client, PutObjectCommand } = getS3();
    const client = new S3Client({ region: REGION });
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: 'text/html',
    }));
    console.log(`[email-report] Written to s3://${bucket}/${key}`);
  } else {
    const outPath = path.join(sessionPath, location);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf8');
    console.log(`[email-report] Written to ${outPath}`);
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return isoString;
  }
}

function buildEmail(summaryHtml, metadata, followUp) {
  const visitorName = escapeHtml(metadata.visitor_name || 'Valued Visitor');
  const seName = escapeHtml(metadata.se_name || '');
  const sessionDate = formatDate(metadata.started_at || metadata.ended_at);
  const visitorCompany = escapeHtml(
    followUp.visitor_company || metadata.visitor_company || ''
  );
  const visitorEmail = escapeHtml(followUp.visitor_email || '');
  const tenantUrl = escapeHtml(followUp.tenant_url || '');
  const summaryUrl = escapeHtml(followUp.summary_url || '');
  const priority = (followUp.priority || 'medium').toLowerCase();

  const priorityColors = {
    high:   { bg: '#dc2626', text: '#ffffff' },
    medium: { bg: '#d97706', text: '#ffffff' },
    low:    { bg: '#6b7280', text: '#ffffff' },
  };
  const pColor = priorityColors[priority] || priorityColors.medium;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your Vision One Demo Summary</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;line-height:1.6;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">

  <!-- Wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9">
    <tr>
      <td align="center" style="padding:32px 16px">

        <!-- Email Container -->
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">

          <!-- BRANDING HEADER -->
          <!-- Replace src with your logo URL. Recommended: 200x50px, transparent PNG -->
          <tr>
            <td style="background-color:#0f172a;padding:24px 32px;text-align:center">
              <!-- LOGO PLACEHOLDER: Replace with <img src="https://your-domain.com/logo.png" alt="Company Logo" width="200" style="display:block;margin:0 auto"> -->
              <div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.02em">TREND MICRO</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:4px;letter-spacing:0.05em">VISION ONE</div>
            </td>
          </tr>

          <!-- GREETING -->
          <tr>
            <td style="padding:32px 32px 16px 32px">
              <div style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:8px">Thank you for visiting our booth, ${visitorName}!</div>
              <div style="font-size:14px;color:#64748b">
                ${sessionDate ? 'Demo on ' + sessionDate : ''}
                ${visitorCompany ? ' &middot; ' + visitorCompany : ''}
                ${seName ? ' &middot; Presented by ' + seName : ''}
              </div>
            </td>
          </tr>

          <!-- META ROW -->
          <tr>
            <td style="padding:0 32px 24px 32px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${visitorEmail ? '<td style="padding:8px 12px;background-color:#f8fafc;border-radius:6px;font-size:13px;color:#475569"><strong>Email:</strong> ' + visitorEmail + '</td>' : ''}
                  <td style="padding:8px 12px;background-color:#f8fafc;border-radius:6px;font-size:13px;color:#475569;text-align:right">
                    <span style="display:inline-block;background-color:${pColor.bg};color:${pColor.text};padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">${escapeHtml(priority)} priority</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td style="padding:0 32px">
              <div style="border-top:1px solid #e2e8f0"></div>
            </td>
          </tr>

          <!-- SESSION SUMMARY (embedded from summary.html) -->
          <tr>
            <td style="padding:24px 32px">
              <div style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:16px">Session Summary</div>
              <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;font-size:14px;line-height:1.7;color:#334155">
${summaryHtml}
              </div>
            </td>
          </tr>

          <!-- FOLLOW-UP CTA -->
          <tr>
            <td style="padding:8px 32px 32px 32px;text-align:center">
              <div style="font-size:14px;color:#475569;margin-bottom:16px">Ready to explore further? Access your personalized Vision One environment:</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
                <tr>
                  <td style="background-color:#2563eb;border-radius:6px">
                    <a href="${tenantUrl || summaryUrl || '#'}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.02em">
                      Explore Vision One
                    </a>
                  </td>
                </tr>
              </table>
              ${tenantUrl ? '<div style="font-size:12px;color:#94a3b8;margin-top:12px">Your tenant is available for 30 days</div>' : ''}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center">
              <div style="font-size:12px;color:#94a3b8;line-height:1.5">
                This summary was generated by Trend Micro BoothApp.<br>
                Questions? Reply to this email or contact your account team.
              </div>
            </td>
          </tr>

        </table>
        <!-- /Email Container -->

      </td>
    </tr>
  </table>
  <!-- /Wrapper -->

</body>
</html>`;
}

async function run() {
  console.log(`[email-report] Reading from ${sessionPath}`);

  let summaryHtml, metadata, followUp;

  try {
    summaryHtml = await readFile('output/summary.html');
  } catch (err) {
    console.error(`[email-report] Failed to read output/summary.html: ${err.message}`);
    process.exit(1);
  }

  try {
    metadata = await readJson('metadata.json');
  } catch (err) {
    console.error(`[email-report] Failed to read metadata.json: ${err.message}`);
    process.exit(1);
  }

  try {
    followUp = await readJson('output/follow-up.json');
  } catch (err) {
    console.warn(`[email-report] follow-up.json not found, using defaults`);
    followUp = {};
  }

  const emailHtml = buildEmail(summaryHtml, metadata, followUp);
  await writeOutput('output/email-ready.html', emailHtml);
  console.log('[email-report] Done');
}

run().catch((err) => {
  console.error(`[email-report] FATAL: ${err.message}`);
  process.exit(1);
});
