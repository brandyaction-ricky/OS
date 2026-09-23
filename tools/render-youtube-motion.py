"""Render a private narrated motion study from a verified v6 word timeline.

The caller supplies the final audio, Sol scene plan, word-aligned timeline, and
an owner-controlled character manifest. No provider calls or uploads occur here.
"""

from __future__ import annotations

import argparse
from functools import lru_cache
import hashlib
import json
import math
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


W, H = 1280, 720
PAPER = (254, 254, 252)
INK = (25, 28, 31)
MUTED = (105, 111, 116)
RED = (225, 43, 49)
PALE = (246, 246, 243)
LINE = (216, 218, 218)
VERSION = "brandyaction-speech-motion-v6"
KINDS = {"character_trace", "comparison", "rising_curve", "branch", "cycle", "process_stack", "focus_lens", "timeline", "horizontal_flow"}


def clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def ease(value: float) -> float:
    value = clamp(value)
    return value * value * (3 - 2 * value)


def phase(t: float, start: float, duration: float) -> float:
    return ease((t - start) / max(0.001, duration))


@lru_cache(maxsize=32)
def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def center_text(draw: ImageDraw.ImageDraw, text: str, cx: float, y: float, f: ImageFont.FreeTypeFont, color=INK):
    bounds = draw.textbbox((0, 0), text, font=f)
    draw.text((cx - (bounds[2] - bounds[0]) / 2, y), text, font=f, fill=color)


def reveal_line(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], amount: float, color=INK, width=5):
    amount = clamp(amount)
    if amount <= 0 or len(points) < 2:
        return
    lengths = [math.dist(points[i], points[i + 1]) for i in range(len(points) - 1)]
    remaining = sum(lengths) * amount
    shown = [points[0]]
    for i, length in enumerate(lengths):
        if remaining >= length:
            shown.append(points[i + 1])
            remaining -= length
        else:
            ratio = remaining / max(0.001, length)
            shown.append((points[i][0] + (points[i + 1][0] - points[i][0]) * ratio,
                          points[i][1] + (points[i + 1][1] - points[i][1]) * ratio))
            break
    if len(shown) > 1:
        draw.line(shown, fill=color, width=width, joint="curve")


def card(draw: ImageDraw.ImageDraw, rect: tuple[int, int, int, int], amount: float, accent=False):
    x1, y1, x2, y2 = rect
    radius = 19
    path = [(x1 + radius, y1), (x2 - radius, y1), (x2, y1 + radius), (x2, y2 - radius),
            (x2 - radius, y2), (x1 + radius, y2), (x1, y2 - radius), (x1, y1 + radius), (x1 + radius, y1)]
    if amount > 0:
        draw.rounded_rectangle(rect, radius=radius, fill=PALE)
        reveal_line(draw, path, amount, RED if accent else INK, 4)


def label(draw: ImageDraw.ImageDraw, value: str, cx: float, y: float, font_path: str,
          size=28, accent=False, max_width=230):
    while size > 16 and draw.textbbox((0, 0), value, font=font(font_path, size))[2] > max_width:
        size -= 1
    if draw.textbbox((0, 0), value, font=font(font_path, size))[2] > max_width:
        raise ValueError("Diagram label exceeds its node")
    center_text(draw, value, cx, y, font(font_path, size), RED if accent else INK)


class CharacterAssets:
    def __init__(self, manifest_path: Path | None, root: Path | None):
        self.parts: dict[str, tuple[Image.Image, Image.Image, Image.Image]] = {}
        if manifest_path is None or root is None:
            return
        catalog = json.loads(manifest_path.read_text())
        if catalog.get("version") != "brandyaction-character-assets-v1":
            raise ValueError("Character manifest version changed")
        root = root.resolve()
        for item in catalog.get("assets", []):
            file = (root / item["file"]).resolve()
            if not file.is_relative_to(root) or hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
                raise ValueError("Character asset path or checksum changed")
            source = Image.open(file).convert("RGBA")
            source.thumbnail((570, 390), Image.Resampling.LANCZOS)
            width, height = source.size
            dark = bytearray(width * height)
            order = bytearray(width * height)
            for y in range(height):
                for x in range(width):
                    i = y * width + x
                    r, g, b, a = source.getpixel((x, y))
                    if a > 70 and max(r, g, b) < 145 and (r + g + b) / 3 < 105:
                        dark[i] = a
                    order[i] = round(255 * clamp(.68 * y / max(1, height - 1) + .32 * x / max(1, width - 1)))
            dark_mask = Image.frombytes("L", (width, height), bytes(dark))
            outline = ImageChops.subtract(dark_mask, dark_mask.filter(ImageFilter.MinFilter(5)))
            self.parts[item["role"]] = source, outline, Image.frombytes("L", (width, height), bytes(order))

    def draw(self, frame: Image.Image, role: str, t: float, start: float, left: int):
        if role not in self.parts:
            raise ValueError(f"Private character role unavailable: {role}")
        source, outline, order = self.parts[role]
        top = 220 + round((390 - source.height) / 2)
        progress = phase(t, start, 0.85)
        mask = order.point(lambda value: 255 if value <= round(progress * 255) else 0)
        ink = Image.new("RGBA", source.size, (*INK, 255))
        frame.paste(ink, (left, top), ImageChops.multiply(outline, mask))
        fill = phase(t, start + 0.66, 0.42)
        if fill:
            color = source.copy()
            color.putalpha(source.getchannel("A").point(lambda a: round(a * fill)))
            frame.alpha_composite(color, (left, top))


def draw_motif(frame: Image.Image, beat: dict, scene: dict, t: float, fonts: str, assets: CharacterAssets):
    draw = ImageDraw.Draw(frame)
    start = beat["visualStartSeconds"]
    span = beat["endSeconds"] - start
    pacing = {"gentle": .78, "stepped": 1.0, "sweep": 1.20, "snap": 1.50}[beat["motionPacing"]]
    t = start + (t - start) * pacing
    labels = beat["motionLabels"]
    accent = beat["motionAccentIndex"]
    kind = beat["motionKind"]
    if kind == "character_trace":
        role = scene.get("characterAssetRole")
        assets.draw(frame, role, t, start, 155 if beat["composition"] == "character_left_graphic_right" else 350)
        draw = ImageDraw.Draw(frame)
        if beat["composition"] == "character_left_graphic_right":
            for i, value in enumerate(labels[:3]):
                x, y = 875, 280 + i * 92
                reveal_line(draw, [(620, y + 18), (742, y + 18)], phase(t, start + .30 + i * .23, .34), RED, 4)
                if t >= start + .52 + i * .23:
                    label(draw, value, x, y, fonts, 29, accent == i, 300)
        else:
            for i, value in enumerate(labels[:3]):
                x, y = (390, 260) if i == 0 else (870, 270 + (i - 1) * 105)
                p = phase(t, start + .25 + i * .2, .45)
                if p:
                    draw.arc((x - 27, y - 27, x + 27, y + 27), -90, -90 + 360 * p, fill=RED, width=4)
                if p > .9:
                    label(draw, value, x, y + 35, fonts, 23, accent == i)
    elif kind == "comparison":
        for i, value in enumerate(labels):
            x1 = 155 + i * 500
            p = phase(t, start + i * min(.45, span * .19), min(.68, span * .30))
            card(draw, (x1, 270, x1 + 470, 530), p, accent == i)
            if p > .65:
                label(draw, value, x1 + 235, 370, fonts, 34, accent == i, 420)
        reveal_line(draw, [(635, 400), (645, 400)], phase(t, start + .55, .25), LINE, 3)
    elif kind == "rising_curve":
        draw.line((220, 550, 1060, 550), fill=LINE, width=3)
        draw.line((220, 255, 220, 550), fill=LINE, width=3)
        n = len(labels)
        points = [(275 + i * 730 / (n - 1), 505 - i * 200 / (n - 1) + (22 if i % 2 else 0)) for i in range(n)]
        reveal_line(draw, points, phase(t, start + .12, min(1.15, span * .6)), RED, 7)
        for i, (x, y) in enumerate(points):
            if t >= start + .27 + i * .18:
                draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=RED)
                label(draw, labels[i], x, 574, fonts, 22, accent == i, 180)
    elif kind == "branch":
        root = (490, 240, 790, 330)
        card(draw, root, phase(t, start, .52), accent == 0)
        if t >= start + .39:
            label(draw, labels[0], 640, 260, fonts, 30, accent == 0, 260)
        children = labels[1:]
        width = min(290, int(940 / len(children) - 25))
        for i, value in enumerate(children):
            x = 640 + (i - (len(children) - 1) / 2) * (width + 27)
            rect = (round(x - width / 2), 455, round(x + width / 2), 555)
            reveal_line(draw, [(640, 330), (640, 390), (x, 390), (x, 455)], phase(t, start + .28 + i * .16, .45), INK, 4)
            p = phase(t, start + .58 + i * .18, .42)
            card(draw, rect, p, accent == i + 1)
            if p > .7:
                label(draw, value, x, 481, fonts, 26, accent == i + 1, width - 28)
    elif kind == "cycle":
        n = len(labels)
        positions = [(640 + 230 * math.sin(2 * math.pi * i / n), 410 - 155 * math.cos(2 * math.pi * i / n)) for i in range(n)]
        for i, (x, y) in enumerate(positions):
            p = phase(t, start + i * .18, .5)
            if p:
                draw.arc((x - 65, y - 65, x + 65, y + 65), -90, -90 + 360 * p, fill=RED if accent == i else INK, width=5)
            if p > .7:
                label(draw, labels[i], x, y - 18, fonts, 25, accent == i, 110)
            nx, ny = positions[(i + 1) % n]
            reveal_line(draw, [(x + (nx - x) * .28, y + (ny - y) * .28),
                               (nx - (nx - x) * .28, ny - (ny - y) * .28)],
                        phase(t, start + .55 + i * .16, .36), RED, 4)
    elif kind == "process_stack":
        spacing = min(100, int(350 / len(labels)))
        top = 245 + max(0, (5 - len(labels)) * 24)
        for i, value in enumerate(labels):
            y = top + i * spacing
            p = phase(t, start + i * .28, .46)
            card(draw, (390, y, 890, y + 76), p, accent == i)
            if p > .65:
                label(draw, value, 640, y + 17, fonts, 29, accent == i, 450)
            if i:
                reveal_line(draw, [(640, y - spacing + 76), (640, y)], phase(t, start + i * .28 - .08, .26), RED, 4)
    elif kind == "focus_lens":
        x, y = 640, 398
        p = phase(t, start + .05, .9)
        if p:
            draw.arc((x - 125, y - 125, x + 125, y + 125), -70, -70 + 360 * p, fill=RED, width=7)
        reveal_line(draw, [(728, 486), (807, 565)], phase(t, start + .58, .38), INK, 7)
        if p > .62:
            label(draw, labels[accent], x, y - 20, fonts, 33, True, 215)
        for i, value in enumerate(labels):
            if i != accent and t >= start + 1.1 + i * .12:
                label(draw, value, 915, 295 + i * 65, fonts, 23, False, 240)
    elif kind == "timeline":
        n = len(labels)
        points = [(250 + i * 780 / (n - 1), 405) for i in range(n)]
        reveal_line(draw, [(250, 405), (1030, 405)], phase(t, start, min(1.0, span * .5)), INK, 5)
        for i, (x, y) in enumerate(points):
            p = phase(t, start + .25 + i * .24, .33)
            if p:
                r = 13 * p
                draw.ellipse((x-r, y-r, x+r, y+r), fill=RED if accent == i else INK)
            if p > .75:
                label(draw, labels[i], x, 452 if i % 2 == 0 else 318, fonts, 23, accent == i, 190)
    elif kind == "horizontal_flow":
        n = len(labels)
        width = min(260, int(920 / n - 28))
        centers = [640 + (i - (n - 1) / 2) * (width + 26) for i in range(n)]
        for i, (x, value) in enumerate(zip(centers, labels)):
            p = phase(t, start + i * .26, .44)
            card(draw, (round(x-width/2), 340, round(x+width/2), 450), p, accent == i)
            if p > .7:
                label(draw, value, x, 375, fonts, 24, accent == i, width - 22)
            if i:
                reveal_line(draw, [(centers[i-1] + width/2, 395), (x-width/2, 395)], phase(t, start + i * .26 - .16, .28), RED, 4)
    else:
        raise ValueError("Unsupported motion kind")


def render_frame(brief: dict, t: float, font_path: str, assets: CharacterAssets) -> Image.Image:
    timeline = brief["timeline"]
    beats = timeline["beats"]
    active = next((beat for beat in beats if beat["visualStartSeconds"] <= t < beat["endSeconds"]), None)
    frame = Image.new("RGBA", (W, H), (*PAPER, 255))
    if active is None:
        return frame.convert("RGB")
    scene = brief["scenePlan"]["scenes"][active["segmentIndex"]]
    draw_motif(frame, active, scene, t, font_path, assets)
    title = active["displayText"].strip()
    start = active["typographyStartSeconds"]
    if title and start is not None and t >= start:
        opacity = phase(t, start, .24)
        layer = Image.new("RGBA", (W, H))
        draw = ImageDraw.Draw(layer)
        size = 47 if len(title) <= 21 else 37
        text_font = font(font_path, size)
        bounds = draw.textbbox((0, 0), title, font=text_font)
        text_width = bounds[2] - bounds[0]
        if text_width > 1040:
            raise ValueError("Typography exceeds the safe area")
        x = (W - text_width) / 2
        y = 91 + round((1 - opacity) * 12)
        emphasized = active["motionLabels"][active["motionAccentIndex"]]
        if emphasized in title:
            before, after = title.split(emphasized, 1)
            for part, color in ((before, INK), (emphasized, RED), (after, INK)):
                if part:
                    draw.text((x, y), part, font=text_font, fill=(*color, round(255 * opacity)))
                    x += draw.textbbox((0, 0), part, font=text_font)[2]
        else:
            draw.text((x, y), title, font=text_font, fill=(*INK, round(255 * opacity)))
        frame.alpha_composite(layer)
    return frame.convert("RGB")


def check_brief(brief: dict, audio: Path, allow_provisional_study: bool):
    if brief.get("timingSource") != "verified_word" and not (
        allow_provisional_study and brief.get("timingSource") == "provisional_pause"
    ):
        raise ValueError("Only verified word timing may render unless a provisional design study is explicitly requested")
    timeline = brief.get("timeline", {})
    if timeline.get("templateVersion") != VERSION or hashlib.sha256(audio.read_bytes()).hexdigest() != timeline.get("audioSha256"):
        raise ValueError("Final audio checksum or visual template version changed")
    duration = float(timeline.get("audioDurationSeconds", 0))
    if not 0 < duration <= 14_400:
        raise ValueError("Invalid final audio duration")
    scenes = brief.get("scenePlan", {}).get("scenes", [])
    prior_end = 0.0
    for beat in timeline.get("beats", []):
        start, end = float(beat["visualStartSeconds"]), float(beat["endSeconds"])
        if start < prior_end - .02 or end <= start or end > duration + .05 or beat["motionKind"] not in KINDS:
            raise ValueError("Invalid beat order, duration or motion kind")
        prior_end = end
        index = beat["segmentIndex"]
        if index < 0 or index >= len(scenes) or scenes[index]["segmentIndex"] != index:
            raise ValueError("Scene and timeline mismatch")
        if brief["timingSource"] == "verified_word":
            beat_index = beat["beatIndex"]
            if beat_index < 0 or beat_index >= len(scenes[index]["visualBeats"]):
                raise ValueError("Scene beat index is invalid")
            planned = scenes[index]["visualBeats"][beat_index]
            for field in ("spokenAnchor", "visualAction", "composition", "motionKind", "motionPacing",
                          "motionLabels", "motionAccentIndex", "graphicSpec", "displayText", "typographyAnchor"):
                if beat[field] != planned[field]:
                    raise ValueError("Scene plan changed after word alignment")
        labels = beat["motionLabels"]
        if not 1 <= len(labels) <= 5 or not 0 <= beat["motionAccentIndex"] < len(labels):
            raise ValueError("Invalid motion labels")
        if (beat["motionKind"] == "comparison" and len(labels) != 2) or (beat["motionKind"] not in {"comparison", "character_trace", "focus_lens"} and len(labels) < 2):
            raise ValueError("Motion structure has too few labels")
        if beat["motionKind"] == "character_trace" and not scenes[index].get("characterAssetRole"):
            raise ValueError("Character asset role missing")
        typo = beat["typographyStartSeconds"]
        if typo is not None and (typo <= start or typo >= end):
            raise ValueError("Typography must follow drawing and precede beat end")
        if (typo is None) != (not beat["displayText"]):
            raise ValueError("Visible typography must have a word time")
    if not timeline.get("beats"):
        raise ValueError("No timed beats")
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(audio)],
                           check=True, capture_output=True, text=True)
    if abs(float(probe.stdout.strip()) - duration) > .25:
        raise ValueError("Final audio duration differs from verified word timeline")
    return duration


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--brief", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--font", required=True)
    parser.add_argument("--character-manifest", type=Path)
    parser.add_argument("--asset-root", type=Path)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--allow-provisional-study", action="store_true")
    args = parser.parse_args()
    if not 12 <= args.fps <= 30:
        raise ValueError("FPS outside supported range")
    brief = json.loads(args.brief.read_text())
    duration = check_brief(brief, args.audio, args.allow_provisional_study)
    assets = CharacterAssets(args.character_manifest, args.asset_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
               "-video_size", f"{W}x{H}", "-framerate", str(args.fps), "-i", "pipe:0", "-i", str(args.audio),
               "-t", str(duration), "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(args.output)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    try:
        for index in range(math.ceil(duration * args.fps)):
            process.stdin.write(render_frame(brief, index / args.fps, args.font, assets).tobytes())
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError("Video encoder failed")
    print(args.output)


if __name__ == "__main__":
    main()
