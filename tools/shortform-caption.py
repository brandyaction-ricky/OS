"""Draw a bounded subtitle plate. Text is data, never an ffmpeg filter expression."""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont


def draw_caption(text, output, font_path, compact=False):
    image = Image.new("RGBA", (720, 1280), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(font_path, 38)
    lines = []
    line = ""
    for char in text:
        if char == "\n" or draw.textlength(line + char, font=font) > 600:
            lines.append(line)
            line = "" if char == "\n" else char
        else:
            line += char
    if line:
        lines.append(line)
    if len(lines) > 4:
        raise ValueError("SHORTFORM_CAPTION_TOO_LONG")
    # Wide originals sit above this plate; portrait originals keep the bottom safe area.
    top = 840 if compact else 1100 - max(1, len(lines)) * 52
    bottom = top + max(1, len(lines)) * 52 + 22
    draw.rounded_rectangle((36, top - 18, 684, bottom), radius=16, fill=(0, 0, 0, 210))
    for index, value in enumerate(lines):
        draw.text((360, top + index * 52), value, font=font, fill="white", anchor="mt")
    image.save(output)


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as stream:
        payload = json.load(stream)
    draw_caption(payload["text"], sys.argv[2], os.environ.get(
        "SHORTFORM_FONT_FILE", "/System/Library/Fonts/AppleSDGothicNeo.ttc"), payload.get("compact", False))
