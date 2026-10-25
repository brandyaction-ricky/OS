"""Draw a bounded subtitle plate. Text is data, never an ffmpeg filter expression."""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont


def draw_caption(text, output, font_path, compact=False, width=720, height=1280, font=38, line=52, maxWidth=600, margin=36, compactTop=840, bottom=1100):
    """The plate for one frame size: 720×1280 (9:16) by default; the renderer passes the 1:1 and 4:5 numbers for feed ads."""
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    face = ImageFont.truetype(font_path, font)
    lines = []
    current = ""
    for char in text:
        if char == "\n" or draw.textlength(current + char, font=face) > maxWidth:
            lines.append(current)
            current = "" if char == "\n" else char
        else:
            current += char
    if current:
        lines.append(current)
    if len(lines) > 4:
        raise ValueError("SHORTFORM_CAPTION_TOO_LONG")
    # Wide originals sit above this plate; portrait originals keep the bottom safe area.
    top = compactTop if compact else bottom - max(1, len(lines)) * line
    end = top + max(1, len(lines)) * line + 22
    draw.rounded_rectangle((margin, top - 18, width - margin, end), radius=16, fill=(0, 0, 0, 210))
    for index, value in enumerate(lines):
        draw.text((width // 2, top + index * line), value, font=face, fill="white", anchor="mt")
    image.save(output)


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as stream:
        payload = json.load(stream)
    sizes = {key: payload[key] for key in ("width", "height", "font", "line", "maxWidth", "margin", "compactTop", "bottom") if key in payload}
    draw_caption(payload["text"], sys.argv[2], os.environ.get(
        "SHORTFORM_FONT_FILE", "/System/Library/Fonts/AppleSDGothicNeo.ttc"), payload.get("compact", False), **sizes)
