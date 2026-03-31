"""Follow-up email generator for booth visitor conversations.

Reads summary.json and follow-up.json, produces a personalized HTML email
with inline CSS for email client compatibility.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_email_html(summary: dict, followup: dict) -> str:
    """Build a personalized HTML email from summary and follow-up data.

    Args:
        summary: Dict with keys: visitor_name, company (optional),
                 demos (list of str), takeaways (list of str).
        followup: Dict with keys: actions (list of {title, url, description}),
                  next_steps (list of str), suggested_times (list of str).
    """
    visitor_name = summary.get("visitor_name", "there")
    company = summary.get("company", "")
    demos = summary.get("demos", [])
    takeaways = summary.get("takeaways", [])

    actions = followup.get("actions", [])
    next_steps = followup.get("next_steps", [])
    suggested_times = followup.get("suggested_times", [])

    company_line = f" at {company}" if company else ""

    # --- Demo summary rows ---
    demo_rows = ""
    for demo in demos:
        demo_rows += f"""
                <tr>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 14px; color: #333;">
                    &#8226; {_esc(demo)}
                  </td>
                </tr>"""

    # --- Takeaway rows ---
    takeaway_rows = ""
    for tw in takeaways:
        takeaway_rows += f"""
                <tr>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 14px; color: #333;">
                    &#10003; {_esc(tw)}
                  </td>
                </tr>"""

    # --- Action items ---
    action_rows = ""
    for action in actions:
        title = action.get("title", "")
        url = action.get("url", "")
        desc = action.get("description", "")
        link_html = (
            f'<a href="{_esc(url)}" style="color: #D32029; text-decoration: underline;">{_esc(title)}</a>'
            if url
            else _esc(title)
        )
        action_rows += f"""
                <tr>
                  <td style="padding: 10px 12px; border-bottom: 1px solid #eee;">
                    <span style="font-size: 14px; font-weight: 600; color: #222;">{link_html}</span>
                    <br>
                    <span style="font-size: 13px; color: #555;">{_esc(desc)}</span>
                  </td>
                </tr>"""

    # --- Next steps ---
    next_step_rows = ""
    for step in next_steps:
        next_step_rows += f"""
                <tr>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 14px; color: #333;">
                    &#9654; {_esc(step)}
                  </td>
                </tr>"""

    # --- Suggested meeting times ---
    meeting_rows = ""
    if suggested_times:
        meeting_rows = """
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 4px;">"""
        for t in suggested_times:
            meeting_rows += f"""
                <tr>
                  <td style="padding: 6px 12px; font-size: 14px; color: #333;">
                    &#128197; {_esc(t)}
                  </td>
                </tr>"""
        meeting_rows += """
              </table>"""

    date_str = datetime.utcnow().strftime("%B %d, %Y")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Follow-Up from Trend Micro</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, Helvetica, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <!-- Main container -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color: #D32029; padding: 28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size: 22px; font-weight: bold; color: #ffffff;">
                    Trend Micro
                  </td>
                  <td align="right" style="font-size: 12px; color: #ffcccc;">
                    {_esc(date_str)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 32px 16px 32px;">
              <p style="margin: 0 0 12px 0; font-size: 18px; color: #222; font-weight: 600;">
                Hi {_esc(visitor_name)},
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #444;">
                Thank you for visiting the Trend Micro booth{_esc(company_line)}! It was great speaking
                with you. Here is a personalized recap of our conversation and the resources
                we discussed.
              </p>
            </td>
          </tr>

          <!-- Demo Summary -->
          <tr>
            <td style="padding: 8px 32px 16px 32px;">
              <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #D32029;">
                What We Demonstrated
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fafafa; border-radius: 6px;">{demo_rows}
              </table>
            </td>
          </tr>

          <!-- Key Takeaways -->
          <tr>
            <td style="padding: 8px 32px 16px 32px;">
              <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #D32029;">
                Key Takeaways
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fafafa; border-radius: 6px;">{takeaway_rows}
              </table>
            </td>
          </tr>

          <!-- Follow-Up Actions -->
          <tr>
            <td style="padding: 8px 32px 16px 32px;">
              <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #D32029;">
                Recommended Resources
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fafafa; border-radius: 6px;">{action_rows}
              </table>
            </td>
          </tr>

          <!-- Next Steps -->
          <tr>
            <td style="padding: 8px 32px 16px 32px;">
              <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #D32029;">
                Next Steps
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fafafa; border-radius: 6px;">{next_step_rows}
              </table>
            </td>
          </tr>

          <!-- Suggested Meeting Times -->
          <tr>
            <td style="padding: 8px 32px 24px 32px;">
              <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #D32029;">
                Let's Continue the Conversation
              </p>
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #444;">
                I'd love to schedule a follow-up call. Here are some times that work:
              </p>{meeting_rows}
              <p style="margin: 12px 0 0 0; font-size: 13px; color: #666;">
                Reply to this email or reach out directly to confirm a time that works for you.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f8f8; padding: 20px 32px; border-top: 1px solid #eee;">
              <p style="margin: 0 0 4px 0; font-size: 13px; color: #666;">
                Best regards,<br>
                <strong style="color: #333;">The Trend Micro Team</strong>
              </p>
              <p style="margin: 8px 0 0 0; font-size: 11px; color: #999;">
                Trend Micro Incorporated &mdash; Securing Your Connected World
              </p>
            </td>
          </tr>

        </table>
        <!-- /Main container -->
      </td>
    </tr>
  </table>
</body>
</html>"""
    return html


def _esc(text: str) -> str:
    """Minimal HTML escaping for dynamic content."""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def generate_email(summary_path: str, followup_path: str, output_path: str) -> str:
    """Main entry point: load inputs, build HTML, write to output_path.

    Returns the absolute path of the written file.
    """
    summary = load_json(summary_path)
    followup = load_json(followup_path)
    html = build_email_html(summary, followup)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return str(out.resolve())


def main():
    parser = argparse.ArgumentParser(
        description="Generate a personalized follow-up email from booth visit data."
    )
    parser.add_argument(
        "--summary", required=True, help="Path to summary.json"
    )
    parser.add_argument(
        "--followup", required=True, help="Path to follow-up.json"
    )
    parser.add_argument(
        "--output",
        default="output/personalized-email.html",
        help="Output HTML path (default: output/personalized-email.html)",
    )
    args = parser.parse_args()

    result = generate_email(args.summary, args.followup, args.output)
    print(f"Email written to: {result}")


if __name__ == "__main__":
    main()
