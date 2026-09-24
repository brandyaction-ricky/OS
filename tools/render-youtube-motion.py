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
def font(spec: str, size: int) -> ImageFont.FreeTypeFont:
    # "file.ttc#6" selects one face inside a font collection.
    path, _, index = spec.partition("#")
    return ImageFont.truetype(path, size, index=int(index or 0))


def mix(a, b, amount: float):
    return tuple(round(x + (y - x) * clamp(amount)) for x, y in zip(a, b))


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


def arrow(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], amount: float, color=INK, width=4):
    """Connector whose arrowhead tip lands exactly on the final point (a node boundary)."""
    (x1, y1), (x2, y2) = points[-2], points[-1]
    length = max(0.001, math.dist((x1, y1), (x2, y2)))
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    head = 14
    reveal_line(draw, points[:-1] + [(x2 - ux * head * .7, y2 - uy * head * .7)], amount, color, width)
    if amount >= 1:
        draw.polygon([(x2, y2), (x2 - ux * head - uy * head * .5, y2 - uy * head + ux * head * .5),
                      (x2 - ux * head + uy * head * .5, y2 - uy * head - ux * head * .5)], fill=color)


def rounded_path(rect: tuple[float, float, float, float], radius: float) -> list[tuple[float, float]]:
    x1, y1, x2, y2 = rect
    points = [((x1 + x2) / 2, y1)]
    for cx, cy, angle in ((x2 - radius, y1 + radius, -90), (x2 - radius, y2 - radius, 0),
                          (x1 + radius, y2 - radius, 90), (x1 + radius, y1 + radius, 180)):
        points += [(cx + radius * math.cos(math.radians(angle + d)), cy + radius * math.sin(math.radians(angle + d)))
                   for d in range(0, 91, 10)]
    return points + [((x1 + x2) / 2, y1)]


def card(draw: ImageDraw.ImageDraw, rect: tuple[float, float, float, float], amount: float, accent=False):
    # The outline traces the same rounded geometry as the fill.
    if amount > 0:
        draw.rounded_rectangle(rect, radius=18, fill=mix(PAPER, PALE, amount * 1.6))
        reveal_line(draw, rounded_path(rect, 18), amount, RED if accent else INK, 4)


def label(draw: ImageDraw.ImageDraw, value: str, x: float, y: float, fonts: tuple[str, str],
          size=30, accent=False, max_width=230, anchor="mm", color=None):
    face = fonts[1] if accent else fonts[0]
    fits = lambda lines, px: all(draw.textlength(line, font=font(face, px)) <= max_width for line in lines)
    # Prefer one line down to 22px, then break at the space nearest the middle.
    options = [[value]]
    spaces = [i for i, ch in enumerate(value) if ch == " "]
    if spaces:
        cut = min(spaces, key=lambda i: abs(i - len(value) / 2))
        options.append([value[:cut], value[cut + 1:]])
    for lines, floor in zip(options, (22, 18)):
        px = size
        while px > floor and not fits(lines, px):
            px -= 1
        if fits(lines, px):
            step = px * 1.18
            for k, line in enumerate(lines):
                draw.text((x, y + (k - (len(lines) - 1) / 2) * step), line, font=font(face, px),
                          fill=color or (RED if accent else INK), anchor=anchor)
            return
    raise ValueError("Diagram label exceeds its node")


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
            source = source.crop(source.getchannel("A").getbbox() or (0, 0, *source.size))
            source.thumbnail((520, 380), Image.Resampling.LANCZOS)
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

    def size(self, role: str) -> tuple[int, int]:
        if role not in self.parts:
            raise ValueError(f"Private character role unavailable: {role}")
        return self.parts[role][0].size

    def draw(self, frame: Image.Image, role: str, t: float, start: float, left: int):
        source, outline, order = self.parts[role]
        top = 415 - source.height // 2
        progress = phase(t, start, 0.85)
        mask = order.point(lambda value: 255 if value <= round(progress * 255) else 0)
        ink = Image.new("RGBA", source.size, (*INK, 255))
        frame.paste(ink, (left, top), ImageChops.multiply(outline, mask))
        fill = phase(t, start + 0.66, 0.42)
        if fill:
            color = source.copy()
            color.putalpha(source.getchannel("A").point(lambda a: round(a * fill)))
            frame.alpha_composite(color, (left, top))


def draw_motif(frame: Image.Image, beat: dict, scene: dict, t: float, fonts: tuple[str, str], assets: CharacterAssets):
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
        width, height = assets.size(role)
        side = beat["composition"] == "character_left_graphic_right"
        left = 170 if side else 640 - width // 2
        assets.draw(frame, role, t, start, left)
        draw = ImageDraw.Draw(frame)
        if side:
            # Leader lines start just right of the artwork; labels share one left edge.
            x0 = left + width + 30
            rows = labels[:3]
            for i, value in enumerate(rows):
                y = 415 + (i - (len(rows) - 1) / 2) * 96
                reveal_line(draw, [(x0, y), (x0 + 90, y)], phase(t, start + .30 + i * .23, .34), RED, 4)
                if t >= start + .52 + i * .23:
                    label(draw, value, x0 + 112, y, fonts, 36, accent == i, 1130 - x0 - 112, "lm")
        else:
            for i, value in enumerate(labels[:4]):
                right = i % 2 == 1
                y = 415 + (i // 2 - (math.ceil(min(len(labels), 4) / 2) - 1) / 2) * 110
                edge = left + width + 24 if right else left - 24
                reveal_line(draw, [(edge, y), (edge + (50 if right else -50), y)], phase(t, start + .3 + i * .2, .3), RED, 4)
                if t >= start + .5 + i * .2:
                    label(draw, value, edge + (66 if right else -66), y, fonts, 32, accent == i,
                          max(80, (1130 - edge - 66) if right else (edge - 66 - 150)), "lm" if right else "rm")
    elif kind == "comparison":
        for i, value in enumerate(labels):
            x1 = 170 + i * 490
            p = phase(t, start + i * min(.45, span * .19), min(.68, span * .30))
            card(draw, (x1, 280, x1 + 450, 540), p, accent == i)
            if p > .65:
                label(draw, value, x1 + 225, 410, fonts, 42, accent == i, 400)
    elif kind == "rising_curve":
        draw.line((220, 540, 1060, 540), fill=LINE, width=3)
        draw.line((220, 250, 220, 540), fill=LINE, width=3)
        n = len(labels)
        curve = lambda u: (275 + u * 730, 505 - 215 * u ** 1.6)
        reveal_line(draw, [curve(k / 40) for k in range(41)], phase(t, start + .12, min(1.15, span * .6)), RED, 7)
        for i in range(n):
            x, y = curve(i / (n - 1))
            if t >= start + .27 + i * .18:
                draw.ellipse((x - 9, y - 9, x + 9, y + 9), fill=RED if accent == i else INK)
                label(draw, labels[i], x, 580, fonts, 28, accent == i, 230)
    elif kind == "branch":
        root = (475, 225, 805, 315)
        card(draw, root, phase(t, start, .52), accent == 0)
        if t >= start + .39:
            label(draw, labels[0], 640, 270, fonts, 34, accent == 0, 300)
        children = labels[1:]
        gap = 36
        width = min(290, int((960 - gap * (len(children) - 1)) / len(children)))
        for i, value in enumerate(children):
            x = 640 + (i - (len(children) - 1) / 2) * (width + gap)
            rect = (round(x - width / 2), 450, round(x + width / 2), 550)
            arrow(draw, [(640, 315), (640, 380), (x, 380), (x, 450)], phase(t, start + .28 + i * .16, .45), INK, 4)
            p = phase(t, start + .58 + i * .18, .42)
            card(draw, rect, p, accent == i + 1)
            if p > .7:
                label(draw, value, x, 500, fonts, 32, accent == i + 1, width - 32)
    elif kind == "cycle":
        n = len(labels)
        r = 78
        positions = [(640 + 235 * math.sin(2 * math.pi * i / n), 425 - 165 * math.cos(2 * math.pi * i / n)) for i in range(n)]
        for i, (x, y) in enumerate(positions):
            p = phase(t, start + i * .18, .5)
            if p:
                draw.ellipse((x - r, y - r, x + r, y + r), fill=mix(PAPER, PALE, p))
                draw.arc((x - r, y - r, x + r, y + r), -90, -90 + 360 * p, fill=RED if accent == i else INK, width=5)
            if p > .7:
                label(draw, labels[i], x, y, fonts, 30, accent == i, 2 * r - 24)
            nx, ny = positions[(i + 1) % n]
            d = math.dist((x, y), (nx, ny))
            ux, uy = (nx - x) / d, (ny - y) / d
            # Two nodes share one chord, so each direction takes its own side.
            ox, oy = (-uy * 24, ux * 24) if n == 2 else (0, 0)
            arrow(draw, [(x + ux * (r + 8) + ox, y + uy * (r + 8) + oy), (nx - ux * (r + 4) + ox, ny - uy * (r + 4) + oy)],
                  phase(t, start + .55 + i * .16, .36), RED, 4)
    elif kind == "process_stack":
        height, gap = 70, 30
        top = 415 - (len(labels) * height + (len(labels) - 1) * gap) / 2
        for i, value in enumerate(labels):
            y = top + i * (height + gap)
            p = phase(t, start + i * .28, .46)
            card(draw, (390, y, 890, y + height), p, accent == i)
            if p > .65:
                label(draw, value, 640, y + height / 2, fonts, 32, accent == i, 450)
            if i:
                arrow(draw, [(640, y - gap), (640, y)], phase(t, start + i * .28 - .08, .26), RED, 4)
    elif kind == "focus_lens":
        x, y, r = 700, 405, 125
        p = phase(t, start + .05, .9)
        if p:
            draw.arc((x - r, y - r, x + r, y + r), -70, -70 + 360 * p, fill=RED, width=7)
        reveal_line(draw, [(x + r * .707 + 4, y + r * .707 + 4), (x + r * .707 + 84, y + r * .707 + 84)], phase(t, start + .58, .38), INK, 9)
        if p > .62:
            label(draw, labels[accent], x, y, fonts, 44, True, 2 * r - 40)
        # What the lens is not focusing on stays small and muted to its left.
        others = [value for i, value in enumerate(labels) if i != accent]
        for i, value in enumerate(others):
            if t >= start + 1.1 + i * .12:
                ly = y + (i - (len(others) - 1) / 2) * 70
                label(draw, value, 400, ly, fonts, 30, False, 230, "rm", MUTED)
                reveal_line(draw, [(418, ly), (x - r - 16, ly)], phase(t, start + 1.1 + i * .12, .3), LINE, 3)
    elif kind == "timeline":
        n = len(labels)
        points = [(250 + i * 780 / (n - 1), 415) for i in range(n)]
        reveal_line(draw, [(250, 415), (1030, 415)], phase(t, start, min(1.0, span * .5)), INK, 5)
        for i, (x, y) in enumerate(points):
            p = phase(t, start + .25 + i * .24, .33)
            if p:
                radius = 14 * p
                draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=RED if accent == i else INK)
            if p > .75:
                label(draw, labels[i], x, 470 if i % 2 == 0 else 360, fonts, 29, accent == i, 190)
    elif kind == "horizontal_flow":
        n = len(labels)
        gap = 56
        width = min(260, int((960 - gap * (n - 1)) / n))
        centers = [640 + (i - (n - 1) / 2) * (width + gap) for i in range(n)]
        for i, (x, value) in enumerate(zip(centers, labels)):
            p = phase(t, start + i * .26, .44)
            card(draw, (round(x - width / 2), 360, round(x + width / 2), 470), p, accent == i)
            if p > .7:
                label(draw, value, x, 415, fonts, 30, accent == i, width - 26)
            if i:
                arrow(draw, [(centers[i - 1] + width / 2 + 8, 415), (x - width / 2 - 6, 415)],
                      phase(t, start + i * .26 - .16, .28), RED, 4)
    else:
        raise ValueError("Unsupported motion kind")


def render_frame(brief: dict, t: float, fonts: tuple[str, str], assets: CharacterAssets) -> Image.Image:
    timeline = brief["timeline"]
    beats = timeline["beats"]
    active = next((beat for beat in beats if beat["visualStartSeconds"] <= t < beat["endSeconds"]), None)
    frame = Image.new("RGBA", (W, H), (*PAPER, 255))
    if active is None:
        return frame.convert("RGB")
    scene = brief["scenePlan"]["scenes"][active["segmentIndex"]]
    draw_motif(frame, active, scene, t, fonts, assets)
    title = active["displayText"].strip()
    start = active["typographyStartSeconds"]
    if title and start is not None and t >= start:
        opacity = phase(t, start, .24)
        layer = Image.new("RGBA", (W, H))
        draw = ImageDraw.Draw(layer)
        text_font = font(fonts[1], 54 if len(title) <= 18 else 44)
        text_width = draw.textlength(title, font=text_font)
        if text_width > 1040:
            raise ValueError("Typography exceeds the safe area")
        x = (W - text_width) / 2
        y = 120 + round((1 - opacity) * 12)
        emphasized = active["motionLabels"][active["motionAccentIndex"]]
        parts = title.split(emphasized, 1) if emphasized in title else [title]
        runs = [(parts[0], INK), (emphasized, RED), (parts[1], INK)] if len(parts) == 2 else [(title, INK)]
        for part, color in runs:
            if part:
                draw.text((x, y), part, font=text_font, fill=(*color, round(255 * opacity)), anchor="lm")
                x += draw.textlength(part, font=text_font)
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


def self_check(fonts: tuple[str, str]):
    """Render every diagram at its label-count limits with long labels; raises on overflow."""
    words = ["환경을 바꾸는 선택", "방식", "리듬과 반복", "조건", "다음 방향"]
    counts = {"comparison": [2], "focus_lens": [1, 5], "character_trace": []}
    for kind in sorted(KINDS):
        for n in counts.get(kind, [2, 5]):
            beat = {"segmentIndex": 0, "visualStartSeconds": 0, "endSeconds": 4, "motionPacing": "stepped",
                    "motionKind": kind, "motionLabels": words[:n], "motionAccentIndex": n - 1,
                    "composition": "centered_flow", "displayText": "긴 타이포가 들어가는 경우의 핵심 문장입니다",
                    "typographyStartSeconds": .3}
            brief = {"timeline": {"beats": [beat]}, "scenePlan": {"scenes": [{"segmentIndex": 0}]}}
            for t in (.2, 1.0, 3.9):
                render_frame(brief, t, fonts, CharacterAssets(None, None))
    print("self-check ok")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--brief", type=Path)
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--font", required=True, help="Regular face; a collection face is file.ttc#index")
    parser.add_argument("--bold-font", help="Title and accent face; defaults to --font")
    parser.add_argument("--character-manifest", type=Path)
    parser.add_argument("--asset-root", type=Path)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--allow-provisional-study", action="store_true")
    args = parser.parse_args()
    fonts = (args.font, args.bold_font or args.font)
    if args.self_check:
        return self_check(fonts)
    if not (args.brief and args.audio and args.output):
        parser.error("--brief, --audio and --output are required")
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
            process.stdin.write(render_frame(brief, index / args.fps, fonts, assets).tobytes())
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError("Video encoder failed")
    print(args.output)


if __name__ == "__main__":
    main()
