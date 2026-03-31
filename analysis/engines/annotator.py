"""Screenshot annotator — draws click markers on session screenshots.

Given screenshots and click data from a session, annotates each screenshot with:
  1. Red circle around the clicked element location
  2. Sequence number label (1, 2, 3...)
  3. Tooltip showing element text or aria-label

Usage:
  python -m analysis.engines.annotator s3://bucket/sessions/SESSION_ID

Or as a library:
  from analysis.engines.annotator import annotate_session
  annotate_session("s3://bucket/sessions/SESSION_ID")
"""

import io
import json
import logging
import os
import subprocess
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image, ImageDraw, ImageFont

import boto3

logger = logging.getLogger(__name__)

# Annotation style constants
CIRCLE_RADIUS = 28
CIRCLE_WIDTH = 3
CIRCLE_COLOR = (220, 40, 40, 200)  # red, semi-transparent
NUMBER_COLOR = (255, 255, 255)
NUMBER_BG = (220, 40, 40, 220)
TOOLTIP_BG = (30, 30, 30, 210)
TOOLTIP_TEXT = (240, 240, 240)
TOOLTIP_PADDING = 6
MAX_TOOLTIP_LEN = 40

REGION = os.environ.get("AWS_REGION", "us-east-1")


def _get_s3():
    return boto3.client("s3", region_name=REGION)


def _parse_s3_path(s3_path):
    """Parse s3://bucket/key/prefix into (bucket, key_prefix)."""
    path = s3_path.replace("s3://", "")
    bucket, _, prefix = path.partition("/")
    return bucket, prefix.rstrip("/")


def _read_json_s3(s3, bucket, key):
    resp = s3.get_object(Bucket=bucket, Key=key)
    return json.loads(resp["Body"].read())


def _read_image_s3(s3, bucket, key):
    resp = s3.get_object(Bucket=bucket, Key=key)
    return Image.open(io.BytesIO(resp["Body"].read())).convert("RGBA")


def _upload_image_s3(s3, bucket, key, img):
    buf = io.BytesIO()
    # Convert RGBA to RGB for JPEG output
    rgb = Image.new("RGB", img.size, (0, 0, 0))
    rgb.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
    rgb.save(buf, format="JPEG", quality=85)
    buf.seek(0)
    s3.put_object(Bucket=bucket, Key=key, Body=buf, ContentType="image/jpeg")


def _load_font(size):
    """Try to load a TTF font, fall back to default."""
    for candidate in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]:
        if os.path.exists(candidate):
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def _get_element_label(click_event):
    """Extract a human-readable label from click event data."""
    elem = click_event.get("element", {})
    if isinstance(elem, str):
        return elem[:MAX_TOOLTIP_LEN]
    text = elem.get("text", "") or elem.get("aria-label", "") or elem.get("id", "")
    if not text:
        text = click_event.get("page_title", "")
    return text[:MAX_TOOLTIP_LEN] if text else ""


def annotate_screenshot(img, clicks_on_image):
    """Draw annotations on a single screenshot.

    Args:
        img: PIL Image (RGBA)
        clicks_on_image: list of dicts with keys:
            index (int), coordinates ({x, y}), element (dict or str)

    Returns:
        Annotated PIL Image (RGBA)
    """
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font_num = _load_font(18)
    font_tip = _load_font(13)

    for click in clicks_on_image:
        coords = click.get("coordinates", {})
        x = coords.get("x", 0)
        y = coords.get("y", 0)
        seq = click.get("index", 0)
        label = _get_element_label(click)

        # 1. Red circle around click location
        r = CIRCLE_RADIUS
        draw.ellipse(
            [x - r, y - r, x + r, y + r],
            outline=CIRCLE_COLOR,
            width=CIRCLE_WIDTH,
        )

        # 2. Sequence number badge (top-left of circle)
        num_text = str(seq)
        num_bbox = font_num.getbbox(num_text)
        nw = num_bbox[2] - num_bbox[0] + 10
        nh = num_bbox[3] - num_bbox[1] + 6
        nx = x - r - 4
        ny = y - r - nh + 2
        # Keep badge on screen
        nx = max(0, min(nx, img.width - nw))
        ny = max(0, ny)
        draw.rounded_rectangle([nx, ny, nx + nw, ny + nh], radius=4, fill=NUMBER_BG)
        draw.text((nx + 5, ny + 2), num_text, fill=NUMBER_COLOR, font=font_num)

        # 3. Tooltip with element text (below circle)
        if label:
            tip_bbox = font_tip.getbbox(label)
            tw = tip_bbox[2] - tip_bbox[0] + TOOLTIP_PADDING * 2
            th = tip_bbox[3] - tip_bbox[1] + TOOLTIP_PADDING * 2
            tx = x - tw // 2
            ty = y + r + 6
            # Keep tooltip on screen
            tx = max(0, min(tx, img.width - tw))
            ty = min(ty, img.height - th)
            draw.rounded_rectangle([tx, ty, tx + tw, ty + th], radius=4, fill=TOOLTIP_BG)
            draw.text(
                (tx + TOOLTIP_PADDING, ty + TOOLTIP_PADDING),
                label,
                fill=TOOLTIP_TEXT,
                font=font_tip,
            )

    return Image.alpha_composite(img, overlay)


def annotate_session(session_s3_path):
    """Annotate all screenshots in a session and upload to output/annotated/.

    Args:
        session_s3_path: e.g. "s3://bucket/sessions/SESSION_ID"

    Returns:
        Number of annotated screenshots produced.
    """
    s3 = _get_s3()
    bucket, prefix = _parse_s3_path(session_s3_path)

    # Load clicks data
    clicks_key = f"{prefix}/clicks/clicks.json"
    try:
        clicks_data = _read_json_s3(s3, bucket, clicks_key)
    except Exception as e:
        logger.warning("Could not load clicks.json: %s", e)
        return 0

    events = clicks_data.get("events", [])
    if not events:
        logger.info("No click events — skipping annotation")
        return 0

    # Group clicks by screenshot file
    screenshot_clicks = {}
    for ev in events:
        ss_file = ev.get("screenshot_file", "")
        if not ss_file:
            continue
        screenshot_clicks.setdefault(ss_file, []).append(ev)

    if not screenshot_clicks:
        logger.info("No screenshots referenced in clicks — skipping annotation")
        return 0

    count = 0
    for ss_rel_path, clicks in sorted(screenshot_clicks.items()):
        ss_key = f"{prefix}/{ss_rel_path}"
        try:
            img = _read_image_s3(s3, bucket, ss_key)
        except Exception as e:
            logger.warning("Could not load screenshot %s: %s", ss_key, e)
            continue

        annotated = annotate_screenshot(img, clicks)

        # Output path: output/annotated/<original-filename>
        filename = os.path.basename(ss_rel_path)
        out_key = f"{prefix}/output/annotated/{filename}"
        _upload_image_s3(s3, bucket, out_key, annotated)
        logger.info("Annotated %s -> %s", ss_rel_path, out_key)
        count += 1

    logger.info("Annotated %d screenshots for session", count)
    return count


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(sys.argv) < 2:
        print("Usage: python -m analysis.engines.annotator <s3://bucket/sessions/SESSION_ID>")
        sys.exit(1)
    n = annotate_session(sys.argv[1])
    print(f"Annotated {n} screenshots")
