#!/usr/bin/env python3
"""Offline real-screenshot video builder. Preview before rendering; no downloads.

Run with the bundled Pillow Python returned by load_workspace_dependencies.
All paths are relative to this repository, regardless of the working directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import subprocess
import sys
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PREVIEW = ROOT / ".tmp/demo-video-v2"
OUTPUT = ROOT / "docs/videos"
SIZE = (1920, 1200)
FPS = 30
NAVY = "#101827"
FONT_CANDIDATES = (
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)


def run(args: list[str]) -> str:
    """Run local tools without shell expansion and with a bounded timeout."""
    result = subprocess.run(args, cwd=ROOT, check=True, capture_output=True,
                            text=True, timeout=60)
    if result.stderr.strip() and "-count_frames" in args:
        raise ValueError(f"Decode reported errors: {result.stderr.strip()}")
    return result.stdout.strip()


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def save_png(image: Image.Image, path: Path, overwrite: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb" if overwrite else "xb") as stream:
        image.save(stream, format="PNG")


def text_line(draw: ImageDraw.ImageDraw, text: str, xy: tuple[int, int],
              style: tuple[str, int, int, str]) -> None:
    """Fit a single line; fail instead of silently producing unreadable text."""
    font_path, size, minimum, color = style
    if "\n" in text:
        raise ValueError("Captions must stay on one line each")
    while size >= minimum:
        font = ImageFont.truetype(font_path, size)
        if draw.textlength(text, font=font) <= 1840:
            draw.text(xy, text, font=font, fill=color, anchor="lt")
            return
        size -= 1
    raise ValueError(f"Text is too long at readable font size: {text}")


def compose(scene: dict, lang: str, config: dict, badge: str,
            font: str) -> tuple[Image.Image, dict]:
    source = HERE / "screenshots" / lang / scene["screenshot"]
    source_hash = digest(source)
    canvas = Image.new("RGB", SIZE, NAVY)
    draw = ImageDraw.Draw(canvas)
    text_line(draw, badge, (40, 20), (font, 18, 16, "#91a8c3"))
    text_line(draw, scene[lang]["heading"], (40, 55), (font, 56, 42, "#f3f7fd"))
    text_line(draw, scene[lang]["subtitle"], (40, 116), (font, 26, 23, "#bdcadd"))
    with Image.open(source) as original:
        original.load()
        dimensions = original.size
        screenshot = ImageOps.contain(original.convert("RGB"), (1840, 940),
                                      Image.Resampling.LANCZOS)
    position = (40 + (1840 - screenshot.width) // 2,
                160 + (940 - screenshot.height) // 2)
    draw.rectangle((39, 159, 1880, 1100), fill="#192437", outline="#33435b")
    canvas.paste(screenshot, position)
    if scene["id"] == "closing":
        text_line(draw, config["install_command"], (40, 1130),
                  (font, 32, 28, "#b4e4d2"))
    else:
        label = "真实界面截图" if lang == "zh-CN" else "Captured product UI"
        text_line(draw, label, (40, 1130), (font, 20, 18, "#91a8c3"))
    return canvas, {"path": str(source.relative_to(ROOT)), "sha256": source_hash,
                    "original_size": dimensions, "fit_size": screenshot.size,
                    "position": position, "crop": None}


def faststart(path: Path) -> bool:
    """Check top-level MP4 atoms: metadata must precede media data."""
    atoms = []
    with path.open("rb") as stream:
        length = path.stat().st_size
        while stream.tell() < length:
            header = stream.read(8)
            if len(header) != 8:
                raise ValueError("Truncated MP4 atom header")
            size, kind = struct.unpack(">I4s", header)
            header_size = 8
            if size == 1:
                size = struct.unpack(">Q", stream.read(8))[0]
                header_size = 16
            if size == 0:
                size = length - stream.tell() + header_size
            if size < header_size or stream.tell() + size - header_size > length:
                raise ValueError("Invalid MP4 atom size")
            atoms.append(kind)
            stream.seek(size - header_size, 1)
    return b"moov" in atoms and b"mdat" in atoms and atoms.index(b"moov") < atoms.index(b"mdat")


def probe_media(path: Path, ffprobe: str) -> dict:
    probe = json.loads(run([ffprobe, "-v", "error", "-count_frames",
                            "-show_format", "-show_streams", "-of", "json", str(path)]))
    streams = probe["streams"]
    if len(streams) != 1 or streams[0]["codec_type"] != "video":
        raise ValueError("Expected exactly one video stream and no audio")
    video = streams[0]
    start = float(video["start_time"])
    duration = float(video["duration"])
    checks = {
        "size": (video["width"], video["height"]) == SIZE,
        "codec": video["codec_name"] == "h264",
        "pixel_format": video["pix_fmt"] == "yuv420p",
        "sar": video["sample_aspect_ratio"] == "1:1",
        "dar": video["display_aspect_ratio"] == "8:5",
        "fps": Fraction(video["avg_frame_rate"]) == FPS,
        "duration": abs(duration - 20) < 0.001,
        "container_duration": abs(float(probe["format"]["duration"]) - 20) < 0.001,
        "start": abs(start) < 0.001,
        "decoded_frames": int(video["nb_read_frames"]) == 600,
        "no_audio": True,
        "faststart": faststart(path),
    }
    if not all(checks.values()):
        raise ValueError(f"Media validation failed: {checks}")
    # Keep the complete probe, but avoid embedding this machine's absolute path.
    probe["format"]["filename"] = str(path.relative_to(ROOT))
    return {"probe": probe, "checks": checks, "start_seconds": start,
            "duration_seconds": duration, "end_seconds": start + duration,
            "decode_method": "ffprobe -count_frames", "decoded_frames": 600,
            "sha256": digest(path)}


def render(lang: str, scenes: list[dict], ffmpeg: str,
           overwrite: bool) -> tuple[Path, Path]:
    movie = OUTPUT / f"dsh-claude-compat-{lang}.mp4"
    poster = OUTPUT / f"dsh-claude-compat-{lang}-poster.png"
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
               "-y" if overwrite else "-n"]
    filters = []
    for index, scene in enumerate(scenes):
        command += ["-loop", "1", "-framerate", str(FPS), "-t", str(scene["duration"]),
                    "-i", str(PREVIEW / lang / f"{scene['id']}.png")]
        filters.append(f"[{index}:v]trim=duration={scene['duration']},"
                       f"setpts=PTS-STARTPTS,setsar=1,format=yuv420p,"
                       f"fade=t=in:st=0:d=0.2:color=0x101827[v{index}]")
    filters.append("".join(f"[v{i}]" for i in range(4)) + "concat=n=4:v=1:a=0[out]")
    command += ["-filter_complex", ";".join(filters), "-map", "[out]", "-an",
                "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt",
                "yuv420p", "-r", str(FPS), "-frames:v", "600", "-movflags", "+faststart",
                str(movie)]
    run(command)
    run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
         "-y" if overwrite else "-n", "-ss", "2", "-i", str(movie),
         "-frames:v", "1", "-update", "1", str(poster)])
    return movie, poster


def load_config() -> dict:
    config = json.loads((HERE / "scenes.json").read_text(encoding="utf-8"))
    expected = [("skills", 0, 5, "skills.png"), ("plugins", 5, 5, "plugins.png"),
                ("history", 10, 6, "history.png"), ("closing", 16, 4, "plugins.png")]
    actual = [(s["id"], s["start"], s["duration"], s["screenshot"]) for s in config["scenes"]]
    if actual != expected:
        raise ValueError("Expected four scenes at 0–5, 5–10, 10–16 and 16–20 seconds")
    return config


def build(args: argparse.Namespace) -> None:
    config = load_config()
    scenes = config["scenes"]
    languages = ["en", "zh-CN"] if args.lang == "both" else [args.lang]
    font = next((p for p in FONT_CANDIDATES if Path(p).is_file()), None)
    if font is None:
        raise ValueError("No local CJK font found; install nothing automatically")
    targets = [PREVIEW / lang / f"{s['id']}.png" for lang in languages for s in scenes]
    report_path = OUTPUT / "verification.json"
    if not args.preview:
        targets += [OUTPUT / f"dsh-claude-compat-{lang}{suffix}"
                    for lang in languages for suffix in (".mp4", "-poster.png")]
        targets.append(report_path)
    for lang in languages:
        for name in ("skills", "plugins", "history"):
            source = HERE / "screenshots" / lang / f"{name}.png"
            if not source.is_file():
                raise FileNotFoundError(f"Missing real screenshot: {source}")
    if not args.overwrite:
        existing = [str(p.relative_to(ROOT)) for p in targets if p.exists()]
        if existing:
            raise FileExistsError("Refusing overwrite; use --overwrite: " + ", ".join(existing))
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not args.preview and (ffmpeg is None or ffprobe is None):
        raise ValueError("Local ffmpeg and ffprobe must be on PATH")
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    commit = run(["git", "rev-parse", "HEAD"])
    dirty = bool(run(["git", "status", "--porcelain"]))
    badge = f"DeepSeek Harness  /  {config['product']}  /  v{version}"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    records = report.setdefault("languages", {})
    for lang in languages:
        captures = []
        for scene in scenes:
            image, capture = compose(scene, lang, config, badge, font)
            save_png(image, PREVIEW / lang / f"{scene['id']}.png", args.overwrite)
            captures.append({"scene": scene["id"], "start": scene["start"],
                             "end": scene["start"] + scene["duration"], **capture})
        if args.preview:
            print(f"Preview only: {PREVIEW / lang}")
            continue
        OUTPUT.mkdir(parents=True, exist_ok=True)
        movie, poster = render(lang, scenes, ffmpeg, args.overwrite)
        records[lang] = {
            "built_at": datetime.now(timezone.utc).isoformat(),
            "source": {"version": version, "commit": commit, "dirty": dirty,
                       "builder_sha256": digest(Path(__file__)),
                       "scenes_sha256": digest(HERE / "scenes.json")},
            "tools": {"python": sys.version, "pillow": PILLOW_VERSION,
                      "ffmpeg": run([ffmpeg, "-version"]).splitlines()[0],
                      "ffprobe": run([ffprobe, "-version"]).splitlines()[0]},
            "font": font, "captures": captures, "media": probe_media(movie, ffprobe),
            "poster": {"path": str(poster.relative_to(ROOT)), "seconds": 2,
                       "sha256": digest(poster)},
            "visual_review": "pending human review; hashes do not establish capture authenticity",
        }
        with report_path.open("w" if args.overwrite or report_path.exists() else "x",
                              encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        print(f"Rendered and media-checked: {movie}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lang", choices=("en", "zh-CN", "both"), default="both")
    parser.add_argument("--preview", action="store_true", help="compose PNGs only; do not render")
    parser.add_argument("--overwrite", action="store_true", help="explicitly allow replacing outputs")
    args = parser.parse_args()
    try:
        build(args)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        detail = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f"Build failed: {detail}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
