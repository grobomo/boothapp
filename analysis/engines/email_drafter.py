"""
Booth Visitor Analysis -- Post-Session Email Drafter

Generates personalized follow-up emails (HTML + plain text) from completed
booth visitor analysis data. Uses Trend Micro Vision One branding consistent
with the report template.
"""

from __future__ import annotations

import html
import os
import textwrap
from typing import Any


# ---------------------------------------------------------------------------
# Trend Micro brand palette
# ---------------------------------------------------------------------------
_BRAND = {
    "red": "#D71920",
    "dark": "#1A1A2E",
    "darker": "#12121F",
    "accent": "#E63946",
    "green": "#2D936C",
    "yellow": "#E9C46A",
    "light_bg": "#F8F9FA",
    "card_bg": "#FFFFFF",
    "text": "#2D3436",
    "text_muted": "#636E72",
    "border": "#DFE6E9",
}

# ---------------------------------------------------------------------------
# Resource links keyed by topic keyword
# ---------------------------------------------------------------------------
_RESOURCE_LINKS = {
    "xdr": {
        "title": "Vision One XDR Platform Overview",
        "url": "https://www.trendmicro.com/en_us/business/products/vision-one.html",
    },
    "endpoint": {
        "title": "Endpoint Security Solutions",
        "url": "https://www.trendmicro.com/en_us/business/products/endpoint-security.html",
    },
    "cloud": {
        "title": "Cloud Security & Container Protection",
        "url": "https://www.trendmicro.com/en_us/business/products/cloud-security.html",
    },
    "container": {
        "title": "Cloud Security & Container Protection",
        "url": "https://www.trendmicro.com/en_us/business/products/cloud-security.html",
    },
    "zero trust": {
        "title": "Zero Trust Secure Access (ZTSA)",
        "url": "https://www.trendmicro.com/en_us/business/products/zero-trust.html",
    },
    "ztna": {
        "title": "Zero Trust Secure Access (ZTSA)",
        "url": "https://www.trendmicro.com/en_us/business/products/zero-trust.html",
    },
    "ztsa": {
        "title": "Zero Trust Secure Access (ZTSA)",
        "url": "https://www.trendmicro.com/en_us/business/products/zero-trust.html",
    },
    "email": {
        "title": "Email Security & BEC Protection",
        "url": "https://www.trendmicro.com/en_us/business/products/email-security.html",
    },
    "bec": {
        "title": "Email Security & BEC Protection",
        "url": "https://www.trendmicro.com/en_us/business/products/email-security.html",
    },
    "soc": {
        "title": "SOC Modernization with Vision One",
        "url": "https://www.trendmicro.com/en_us/business/solutions/soc-modernization.html",
    },
    "mdr": {
        "title": "Managed Detection & Response",
        "url": "https://www.trendmicro.com/en_us/business/products/managed-detection-response.html",
    },
    "network": {
        "title": "Network Security Solutions",
        "url": "https://www.trendmicro.com/en_us/business/products/network-security.html",
    },
}

# Default SE contact (overridable via se_contact param)
_DEFAULT_SE_CONTACT = {
    "name": "Your Trend Micro SE",
    "title": "Solutions Engineer",
    "email": "se@trendmicro.example.com",
    "phone": "+1 (555) 000-0000",
}


def _esc(value: Any) -> str:
    return html.escape(str(value))


def _first_name(full_name: str) -> str:
    """Extract first name from a full name string."""
    parts = full_name.strip().split()
    return parts[0] if parts else "there"


def _match_resources(data: dict) -> list[dict]:
    """Match relevant resource links based on products and interests."""
    seen_urls: set[str] = set()
    matched: list[dict] = []

    search_text = ""
    for p in data.get("products_demonstrated", []):
        search_text += " " + p.get("name", "") + " " + p.get("note", "")
    for i in data.get("interests", []):
        search_text += " " + i.get("topic", "") + " " + i.get("detail", "")
    search_lower = search_text.lower()

    for keyword, resource in _RESOURCE_LINKS.items():
        if keyword in search_lower and resource["url"] not in seen_urls:
            seen_urls.add(resource["url"])
            matched.append(resource)

    return matched


def _build_next_steps(data: dict) -> list[str]:
    """Generate 3-5 personalized next steps from interests and recommendations."""
    steps: list[str] = []

    for rec in data.get("recommendations", []):
        if isinstance(rec, str):
            steps.append(rec)
        else:
            priority = rec.get("priority", "medium").lower()
            if priority in ("high", "medium"):
                steps.append(rec.get("action", ""))

    if len(steps) < 3:
        for interest in data.get("interests", []):
            topic = interest.get("topic", "")
            if topic:
                steps.append(f"Explore {topic} solutions tailored to your environment")
            if len(steps) >= 3:
                break

    return [s for s in steps if s][:5]


# ---------------------------------------------------------------------------
# HTML email CSS
# ---------------------------------------------------------------------------

_EMAIL_CSS = f"""
body {{
    margin: 0; padding: 0;
    background: {_BRAND['light_bg']};
    font-family: 'Segoe UI', 'Inter', -apple-system, BlinkMacSystemFont,
                 'Helvetica Neue', Arial, sans-serif;
    color: {_BRAND['text']};
    line-height: 1.6;
}}
.email-wrapper {{
    max-width: 640px;
    margin: 0 auto;
    background: {_BRAND['card_bg']};
}}
.email-header {{
    background: linear-gradient(135deg, {_BRAND['dark']} 0%, {_BRAND['darker']} 100%);
    color: #FFFFFF;
    padding: 28px 32px;
    text-align: center;
}}
.email-header .logo {{
    display: inline-block;
    width: 40px; height: 40px;
    background: {_BRAND['red']};
    border-radius: 6px;
    font-weight: 700; font-size: 18px; color: #FFF;
    line-height: 40px; text-align: center;
    vertical-align: middle; margin-right: 10px;
}}
.email-header h1 {{
    display: inline; font-size: 20px; font-weight: 600; vertical-align: middle;
}}
.email-header h1 span {{ color: {_BRAND['red']}; }}
.email-body {{
    padding: 32px;
}}
.email-body p {{
    margin: 0 0 16px; font-size: 15px;
}}
.section-label {{
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: {_BRAND['text_muted']};
    margin: 24px 0 12px; padding-bottom: 6px;
    border-bottom: 2px solid {_BRAND['border']};
}}
.product-list {{
    list-style: none; padding: 0; margin: 0 0 16px;
}}
.product-list li {{
    padding: 8px 0; border-bottom: 1px solid {_BRAND['border']}; font-size: 15px;
}}
.product-list li:last-child {{ border-bottom: none; }}
.product-list .product-name {{
    font-weight: 600; color: {_BRAND['dark']};
}}
.product-list .product-note {{
    color: {_BRAND['text_muted']}; font-size: 13px; display: block; margin-top: 2px;
}}
.steps-list {{
    padding-left: 20px; margin: 0 0 16px;
}}
.steps-list li {{ padding: 6px 0; font-size: 15px; }}
.resources-list {{
    list-style: none; padding: 0; margin: 0 0 16px;
}}
.resources-list li {{ padding: 6px 0; }}
.resources-list a {{
    color: {_BRAND['red']}; text-decoration: none; font-weight: 600; font-size: 14px;
}}
.resources-list a:hover {{ text-decoration: underline; }}
.contact-card {{
    background: {_BRAND['light_bg']};
    border: 1px solid {_BRAND['border']};
    border-radius: 8px; padding: 20px; margin-top: 24px;
}}
.contact-card .contact-name {{
    font-weight: 700; font-size: 16px; color: {_BRAND['dark']};
}}
.contact-card .contact-title {{
    font-size: 13px; color: {_BRAND['text_muted']};
}}
.contact-card .contact-detail {{
    font-size: 14px; margin-top: 8px;
}}
.contact-card .contact-detail a {{
    color: {_BRAND['red']}; text-decoration: none;
}}
.email-footer {{
    text-align: center; padding: 20px 32px;
    font-size: 11px; color: {_BRAND['text_muted']};
    border-top: 1px solid {_BRAND['border']};
}}
"""


# ---------------------------------------------------------------------------
# HTML renderers
# ---------------------------------------------------------------------------

def _render_products_html(products: list[dict]) -> str:
    if not products:
        return ""
    items = []
    for p in products:
        name = _esc(p.get("name", ""))
        note = p.get("note", "")
        note_html = (
            f'<span class="product-note">{_esc(note)}</span>' if note else ""
        )
        items.append(
            f'<li><span class="product-name">{name}</span>{note_html}</li>'
        )
    return (
        '<div class="section-label">What We Covered</div>\n'
        f'<ul class="product-list">{"".join(items)}</ul>'
    )


def _render_steps_html(steps: list[str]) -> str:
    if not steps:
        return ""
    items = "".join(f"<li>{_esc(s)}</li>" for s in steps)
    return (
        '<div class="section-label">Suggested Next Steps</div>\n'
        f'<ol class="steps-list">{items}</ol>'
    )


def _render_resources_html(resources: list[dict]) -> str:
    if not resources:
        return ""
    items = []
    for r in resources:
        title = _esc(r["title"])
        url = _esc(r["url"])
        items.append(f'<li><a href="{url}">{title}</a></li>')
    return (
        '<div class="section-label">Resources</div>\n'
        f'<ul class="resources-list">{"".join(items)}</ul>'
    )


def _render_contact_html(contact: dict) -> str:
    name = _esc(contact.get("name", ""))
    title = _esc(contact.get("title", ""))
    email = _esc(contact.get("email", ""))
    phone = _esc(contact.get("phone", ""))
    lines = [
        f'<div class="contact-name">{name}</div>',
        f'<div class="contact-title">{title}</div>',
        '<div class="contact-detail">',
    ]
    if email:
        lines.append(f'<a href="mailto:{email}">{email}</a>')
    if email and phone:
        lines.append(" | ")
    if phone:
        lines.append(phone)
    lines.append("</div>")
    return (
        '<div class="section-label">Your Contact</div>\n'
        f'<div class="contact-card">{"".join(lines)}</div>'
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_email_html(data: dict, se_contact: dict | None = None) -> str:
    """Generate a professional HTML follow-up email from analysis data.

    Args:
        data: Analysis dictionary with keys: visitor, products_demonstrated,
              interests, recommendations.
        se_contact: Optional SE contact dict with name, title, email, phone.

    Returns:
        Complete HTML email document as a string.
    """
    contact = se_contact or _DEFAULT_SE_CONTACT
    visitor = data.get("visitor", {})
    first = _first_name(visitor.get("name", ""))
    products = data.get("products_demonstrated", [])
    steps = _build_next_steps(data)
    resources = _match_resources(data)

    greeting = f"Hi {_esc(first)},"
    intro = (
        "It was great connecting with you at our booth today. "
        "Thank you for taking the time to explore how Trend Micro Vision One "
        "can help strengthen your security posture."
    )

    products_html = _render_products_html(products)
    steps_html = _render_steps_html(steps)
    resources_html = _render_resources_html(resources)
    contact_html = _render_contact_html(contact)

    closing = (
        "I'd love to continue the conversation and help you evaluate "
        "the solutions that best fit your needs. "
        "Feel free to reach out any time -- I'm here to help."
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Follow-up from Trend Micro</title>
    <style>{_EMAIL_CSS}</style>
</head>
<body>
<div class="email-wrapper">
    <div class="email-header">
        <span class="logo">V1</span>
        <h1>Trend Micro <span>Vision One</span></h1>
    </div>
    <div class="email-body">
        <p>{greeting}</p>
        <p>{_esc(intro)}</p>

        {products_html}
        {steps_html}
        {resources_html}

        <p>{_esc(closing)}</p>

        {contact_html}
    </div>
    <div class="email-footer">
        Trend Micro Vision One &mdash; Securing Your Connected World
    </div>
</div>
</body>
</html>"""


def generate_email_text(data: dict, se_contact: dict | None = None) -> str:
    """Generate a plain-text follow-up email from analysis data.

    Args:
        data: Analysis dictionary with keys: visitor, products_demonstrated,
              interests, recommendations.
        se_contact: Optional SE contact dict with name, title, email, phone.

    Returns:
        Plain-text email body as a string.
    """
    contact = se_contact or _DEFAULT_SE_CONTACT
    visitor = data.get("visitor", {})
    first = _first_name(visitor.get("name", ""))
    products = data.get("products_demonstrated", [])
    steps = _build_next_steps(data)
    resources = _match_resources(data)

    lines: list[str] = []

    lines.append(f"Hi {first},")
    lines.append("")
    lines.append(
        "It was great connecting with you at our booth today. "
        "Thank you for taking the time to explore how Trend Micro Vision One "
        "can help strengthen your security posture."
    )
    lines.append("")

    if products:
        lines.append("WHAT WE COVERED")
        lines.append("-" * 40)
        for p in products:
            name = p.get("name", "")
            note = p.get("note", "")
            if note:
                lines.append(f"  * {name} -- {note}")
            else:
                lines.append(f"  * {name}")
        lines.append("")

    if steps:
        lines.append("SUGGESTED NEXT STEPS")
        lines.append("-" * 40)
        for i, step in enumerate(steps, 1):
            wrapped = textwrap.fill(
                step, width=68, initial_indent=f"  {i}. ", subsequent_indent="     "
            )
            lines.append(wrapped)
        lines.append("")

    if resources:
        lines.append("RESOURCES")
        lines.append("-" * 40)
        for r in resources:
            lines.append(f"  * {r['title']}")
            lines.append(f"    {r['url']}")
        lines.append("")

    lines.append(
        "I'd love to continue the conversation and help you evaluate "
        "the solutions that best fit your needs. "
        "Feel free to reach out any time -- I'm here to help."
    )
    lines.append("")

    lines.append("YOUR CONTACT")
    lines.append("-" * 40)
    lines.append(f"  {contact.get('name', '')}")
    lines.append(f"  {contact.get('title', '')}")
    if contact.get("email"):
        lines.append(f"  {contact['email']}")
    if contact.get("phone"):
        lines.append(f"  {contact['phone']}")
    lines.append("")

    lines.append("--")
    lines.append("Trend Micro Vision One -- Securing Your Connected World")

    return "\n".join(lines)


def draft_email(
    data: dict,
    output_dir: str = "output",
    se_contact: dict | None = None,
) -> tuple[str, str]:
    """Generate both HTML and text emails and write them to files.

    Args:
        data: Analysis dictionary.
        output_dir: Directory to write output files. Created if missing.
        se_contact: Optional SE contact info override.

    Returns:
        Tuple of (html_path, text_path) for the written files.
    """
    os.makedirs(output_dir, exist_ok=True)

    html_content = generate_email_html(data, se_contact)
    text_content = generate_email_text(data, se_contact)

    html_path = os.path.join(output_dir, "draft-email.html")
    text_path = os.path.join(output_dir, "draft-email.txt")

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    with open(text_path, "w", encoding="utf-8") as f:
        f.write(text_content)

    return html_path, text_path
