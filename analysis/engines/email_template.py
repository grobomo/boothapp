"""Generate a follow-up email HTML template for booth visitors.

Takes summary.json and follow-up.json data and produces a self-contained
HTML email that can be sent directly to the visitor. Uses table-based
layout for email client compatibility.
"""


def _esc(val):
    """HTML-escape a string value."""
    if val is None:
        return ""
    return (
        str(val)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _build_product_rows(products):
    """Build HTML table rows for products demonstrated."""
    if not products:
        return ""
    rows = []
    for p in products:
        rows.append(
            f'<tr><td style="padding:8px 16px;font-size:14px;color:#1e293b;'
            f'border-bottom:1px solid #f1f5f9">'
            f'<span style="display:inline-block;width:8px;height:8px;'
            f'border-radius:50%;background:#D32F2F;margin-right:10px;'
            f'vertical-align:middle"></span>{_esc(p)}</td></tr>'
        )
    return "\n".join(rows)


def _build_recommendation_rows(interests, follow_up_actions):
    """Build HTML rows combining top interests and follow-up actions."""
    rows = []
    # Top interests as personalized recommendations
    for i in (interests or [])[:3]:
        topic = i.get("topic", "") if isinstance(i, dict) else str(i)
        evidence = i.get("evidence", "") if isinstance(i, dict) else ""
        desc = f"{_esc(topic)}"
        if evidence:
            desc += f' <span style="color:#64748b;font-size:13px">-- {_esc(evidence)}</span>'
        rows.append(
            f'<tr><td style="padding:10px 16px;font-size:14px;color:#1e293b;'
            f'border-bottom:1px solid #f1f5f9;line-height:1.6">'
            f'<span style="color:#D32F2F;font-weight:700;margin-right:8px">*</span>'
            f'{desc}</td></tr>'
        )
    # Follow-up actions as next steps
    for action in (follow_up_actions or [])[:3]:
        rows.append(
            f'<tr><td style="padding:10px 16px;font-size:14px;color:#1e293b;'
            f'border-bottom:1px solid #f1f5f9;line-height:1.6">'
            f'<span style="color:#D32F2F;font-weight:700;margin-right:8px">></span>'
            f'{_esc(action)}</td></tr>'
        )
    return "\n".join(rows) if rows else ""


def render_follow_up_email(summary, follow_up, metadata=None):
    """Render a follow-up email HTML template for a booth visitor.

    Args:
        summary: Dict from summary.json (visitor_name, products_demonstrated,
                 key_interests, follow_up_actions, executive_summary, etc.)
        follow_up: Dict from follow-up.json (tenant_url, summary_url, priority, etc.)
        metadata: Optional dict from metadata.json (se_name, started_at, etc.)

    Returns:
        Complete HTML string ready to send as an email body.
    """
    meta = metadata or {}
    visitor_name = _esc(
        summary.get("visitor_name")
        or meta.get("visitor_name")
        or "Valued Visitor"
    )
    se_name = _esc(meta.get("se_name", summary.get("se_name", "")))
    executive_summary = _esc(summary.get("executive_summary", ""))

    products = summary.get("products_demonstrated", [])
    interests = summary.get("key_interests", [])
    follow_up_actions = summary.get("follow_up_actions", [])

    tenant_url = follow_up.get("tenant_url", "")
    summary_url = follow_up.get("summary_url", "")
    cta_url = tenant_url or summary_url or "#"

    product_rows = _build_product_rows(products)
    recommendation_rows = _build_recommendation_rows(interests, follow_up_actions)

    # Products section (only if products exist)
    products_section = ""
    if product_rows:
        products_section = f"""
              <!-- PRODUCTS -->
              <tr>
                <td style="padding:0 32px 24px 32px">
                  <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#D32F2F;margin-bottom:12px">What We Covered</div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
                    {product_rows}
                  </table>
                </td>
              </tr>"""

    # Recommendations section (only if content exists)
    recommendations_section = ""
    if recommendation_rows:
        recommendations_section = f"""
              <!-- RECOMMENDATIONS -->
              <tr>
                <td style="padding:0 32px 24px 32px">
                  <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#D32F2F;margin-bottom:12px">Personalized for You</div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
                    {recommendation_rows}
                  </table>
                </td>
              </tr>"""

    # Executive summary section
    exec_section = ""
    if executive_summary:
        exec_section = f"""
              <!-- EXECUTIVE SUMMARY -->
              <tr>
                <td style="padding:0 32px 24px 32px">
                  <div style="background:#FFF5F5;border-left:4px solid #D32F2F;border-radius:0 8px 8px 0;padding:16px 20px;font-size:14px;color:#1e293b;line-height:1.7">
                    {executive_summary}
                  </div>
                </td>
              </tr>"""

    # Tenant link section
    tenant_note = ""
    if tenant_url:
        tenant_note = (
            '<div style="font-size:12px;color:#94a3b8;margin-top:12px">'
            "Your personalized Vision One environment is available for 30 days</div>"
        )

    # SE sign-off
    sign_off = "The Trend Micro Team"
    if se_name:
        sign_off = f"{se_name} &amp; The Trend Micro Team"

    return f"""<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your Vision One Demo Follow-Up</title>
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

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#B71C1C 0%,#D32F2F 100%);padding:32px 32px 28px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#ffffff;letter-spacing:0.02em">TREND MICRO</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.8);margin-top:4px;letter-spacing:0.08em;text-transform:uppercase">Vision One Demo Follow-Up</div>
            </td>
          </tr>

          <!-- GREETING -->
          <tr>
            <td style="padding:32px 32px 16px 32px">
              <div style="font-size:22px;font-weight:700;color:#1e293b;margin-bottom:12px">Hi {visitor_name},</div>
              <div style="font-size:15px;color:#475569;line-height:1.7">
                Thank you for stopping by our booth and taking the time to explore Trend Micro Vision One with us. We put together this personalized summary based on what we discussed during your demo.
              </div>
            </td>
          </tr>
{exec_section}
{products_section}
{recommendations_section}
          <!-- CTA -->
          <tr>
            <td style="padding:8px 32px 32px 32px;text-align:center">
              <div style="font-size:15px;color:#475569;margin-bottom:20px">Ready to continue exploring? Schedule a follow-up with our team:</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
                <tr>
                  <td style="background:#D32F2F;border-radius:6px">
                    <a href="{_esc(cta_url)}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.02em">
                      Schedule a Follow-Up Meeting
                    </a>
                  </td>
                </tr>
              </table>
              {tenant_note}
            </td>
          </tr>

          <!-- SIGN-OFF -->
          <tr>
            <td style="padding:0 32px 32px 32px">
              <div style="border-top:1px solid #e2e8f0;padding-top:24px;font-size:14px;color:#475569;line-height:1.7">
                Looking forward to connecting again soon.<br>
                <strong>{sign_off}</strong>
              </div>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center">
              <div style="font-size:12px;color:#94a3b8;line-height:1.5">
                This email was generated by Trend Micro BoothApp.<br>
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
</html>"""
