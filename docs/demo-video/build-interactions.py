#!/usr/bin/env python3
"""Offline render of timestamped real screencasts. --render is explicitly required.

Inputs: .tmp/interaction-capture/{language}/{scene}/capture.json and JPEG frames.
Edit interaction-edit.json to cut actual time ranges or set explicit speed.
No screenshots, UI, motion, long holds, audio or model results are synthesized.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import struct
import subprocess
import sys
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".tmp/interaction-capture"
WORK = ROOT / ".tmp/interaction-render"
OUTPUT = ROOT / "docs/videos"
EDIT = Path(__file__).with_name("interaction-edit.json")
REPORT = OUTPUT / "interaction-verification.json"
LANGUAGES = ("zh-CN", "en")


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(argv: list[str]) -> str:
    result = subprocess.run(argv, check=True, capture_output=True, text=True,
                            cwd=ROOT, timeout=60)
    if result.stderr.strip() and "-count_frames" in argv:
        raise ValueError(f"Decode errors: {result.stderr.strip()}")
    return result.stdout


def atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                         encoding="utf-8")
    temporary.replace(path)


def number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{label} must be finite")
    return result


def scene_name(value: object) -> str:
    if not isinstance(value, str) or not value or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in value):
        raise ValueError("Scene names allow only letters, numbers, _ and -")
    return value


def load_capture(language: str, scene: str) -> tuple[dict, list[dict]]:
    directory = (SOURCE / language / scene).resolve()
    metadata = read_json(directory / "capture.json")
    if "Page.startScreencast" not in str(metadata.get("method", "")):
        raise ValueError(f"Unsupported or unproven capture method: {scene}")
    end = number(metadata["durationMilliseconds"], "durationMilliseconds") / 1000
    frames = []
    metadata["ignored_late_frames"] = 0
    previous = -1.0
    for record in metadata["frames"]:
        timestamp = number(record["milliseconds"], "frame milliseconds") / 1000
        if timestamp < previous or timestamp < 0:
            raise ValueError(f"Invalid/nonmonotonic capture timestamp: {scene}")
        if timestamp > end:
            # Screencast callbacks already in flight may arrive after capture stopped.
            # Preserve source evidence, but never extend the recorded action duration.
            metadata["ignored_late_frames"] += 1
            previous = timestamp
            continue
        path = (directory / record["file"]).resolve(strict=True)
        if not path.is_relative_to(directory) or path.suffix.lower() not in (".jpg", ".jpeg"):
            raise ValueError(f"Invalid JPEG frame path: {scene}")
        with Image.open(path) as image:
            if image.format != "JPEG":
                raise ValueError(f"Expected actual JPEG: {path.name}")
            dimensions = image.size
        item = {"path": path, "time": timestamp, "sha256": sha256(path),
                "dimensions": dimensions}
        if frames and timestamp == previous:
            frames[-1] = item  # At equal arrival times the latest delivered frame wins.
        else:
            frames.append(item)
        previous = timestamp
    if len({frame["sha256"] for frame in frames}) <= 10:
        raise ValueError(f"Insufficient real frame diversity (>10 required): {scene}")
    if not frames or end <= frames[0]["time"]:
        raise ValueError(f"No positive captured interval: {scene}")
    return metadata, frames


def select_intervals(metadata: dict, frames: list[dict], edit: dict) -> tuple[list[tuple], list[dict]]:
    end = metadata["durationMilliseconds"] / 1000
    first = frames[0]["time"]
    speed = number(edit.get("speed", 1), "speed")
    ranges = edit.get("keep")
    if ranges is None:
        ranges = [{"start": first, "end": end, "speed": speed}]
    if not isinstance(ranges, list) or not ranges:
        raise ValueError("keep must be null or a nonempty list of ranges")
    pieces, decisions = [], []
    previous_end = 0.0
    for selected in ranges:
        requested_start = number(selected["start"], "range start")
        stop = number(selected["end"], "range end")
        rate = number(selected.get("speed", speed), "range speed")
        if requested_start < previous_end or stop > end or stop <= requested_start or rate <= 0:
            raise ValueError("Keep ranges must be ordered, within capture, positive and nonoverlapping")
        start = max(first, requested_start)
        if start >= stop:
            raise ValueError("Range contains no available captured frame")
        for index, frame in enumerate(frames):
            next_time = frames[index + 1]["time"] if index + 1 < len(frames) else end
            length = min(stop, next_time) - max(start, frame["time"])
            if length > 0:
                pieces.append((frame, length / rate))
        decisions.append({"requested_start": requested_start, "actual_start": start,
                          "end": stop, "speed": rate, "output_seconds": (stop - start) / rate})
        previous_end = stop
    if len({frame["sha256"] for frame, _ in pieces}) <= 10:
        raise ValueError("Edited clip must still contain >10 unique actual input frames")
    return pieces, decisions


def prepare(language: str, config: dict) -> tuple[list[tuple], list[dict]]:
    pieces, scenes = [], []
    cursor = 0.0
    overrides = config.get("languages", {}).get(language, {})
    for definition in config["scenes"]:
        name = scene_name(definition["name"])
        edit = {**definition, **overrides.get(name, {})}
        metadata, frames = load_capture(language, name)
        selected, ranges = select_intervals(metadata, frames, edit)
        duration = sum(length for _, length in selected)
        scenes.append({"name": name, "output_start": cursor,
                       "output_end": cursor + duration, "output_duration": duration,
                       "capture_method": metadata["method"],
                       "source_dimensions": list(frames[0]["dimensions"]),
                       "reported_viewport": metadata.get("viewport"),
                       "capture_duration_seconds": metadata["durationMilliseconds"] / 1000,
                       "first_frame_seconds": frames[0]["time"],
                       "marks": metadata.get("marks", []), "keep": ranges,
                       "input_frames": len(frames),
                        "ignored_late_frames": metadata["ignored_late_frames"],
                       "unique_input_frames": len({f["sha256"] for f in frames}),
                       "unique_selected_frames": len({f["sha256"] for f, _ in selected}),
                       "capture_sha256": sha256(SOURCE / language / name / "capture.json"),
                       "frames": [{"file": str(f["path"].relative_to(ROOT)),
                                   "arrival_seconds": f["time"], "sha256": f["sha256"]}
                                  for f in frames]})
        pieces.extend(selected)
        cursor += duration
    if not pieces or len({f["dimensions"] for f, _ in pieces}) != 1:
        raise ValueError("All captured frames must share one real pixel size")
    return pieces, scenes


def concat_quote(path: Path) -> str:
    value = str(path)
    if "\n" in value or "\r" in value:
        raise ValueError("Newline in frame path")
    return "'" + value.replace("'", "'\\''") + "'"


def write_concat(path: Path, pieces: list[tuple]) -> None:
    lines = ["ffconcat version 1.0"]
    for frame, duration in pieces:
        lines += ["file " + concat_quote(frame["path"]),
                  "option framerate 1000", f"duration {duration:.9f}"]
    # The demuxer needs one final repeated file to honor the last duration.
    # Output -t limits this sentinel; it never adds a synthetic final hold.
    lines += ["file " + concat_quote(pieces[-1][0]["path"]), "option framerate 1000"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def faststart(path: Path) -> bool:
    positions = {}
    with path.open("rb") as stream:
        length = path.stat().st_size
        while stream.tell() < length:
            position = stream.tell()
            header = stream.read(8)
            if len(header) != 8:
                raise ValueError("Truncated MP4 atom")
            size, kind = struct.unpack(">I4s", header)
            if size == 1:
                size = struct.unpack(">Q", stream.read(8))[0]
            if size == 0:
                size = length - position
            if size < stream.tell() - position or position + size > length:
                raise ValueError("Invalid MP4 atom")
            positions.setdefault(kind, position)
            stream.seek(position + size)
    return positions.get(b"moov", math.inf) < positions.get(b"mdat", -1)


def probe(path: Path, expected: float, config: dict, ffprobe: str) -> dict:
    data = json.loads(run([ffprobe, "-v", "error", "-count_frames", "-show_streams",
                           "-show_format", "-of", "json", str(path)]))
    streams = data["streams"]
    if len(streams) != 1 or streams[0]["codec_type"] != "video":
        raise ValueError("Expected one video stream and no audio")
    stream = streams[0]
    start, duration = float(stream["start_time"]), float(stream["duration"])
    fps = config["fps"]
    decoded = int(stream["nb_read_frames"])
    checks = {
        "codec": stream["codec_name"] == "h264", "pixels": stream["pix_fmt"] == "yuv420p",
        "size": [stream["width"], stream["height"]] == [config["width"], config["height"]],
        "fps": Fraction(stream["avg_frame_rate"]) == fps,
        "sar": stream["sample_aspect_ratio"] == "1:1",
        "dar": Fraction(stream["display_aspect_ratio"].replace(":", "/")) == Fraction(config["width"], config["height"]),
        "start": abs(start) < 0.001, "duration": abs(duration - expected) <= 1 / fps + 0.001,
        "container_duration": abs(float(data["format"]["duration"]) - duration) < 0.001,
        "decoded_frames": abs(decoded - duration * fps) < 0.01,
        "faststart": faststart(path), "no_audio": True,
    }
    if not all(checks.values()):
        raise ValueError(f"Media validation failed: {checks}")
    data["format"]["filename"] = str(path.relative_to(ROOT))
    return {"probe": data, "checks": checks, "expected_seconds": expected,
            "start_seconds": start, "duration_seconds": duration, "end_seconds": start + duration,
            "decoded_frames": decoded, "decode_method": "ffprobe -count_frames", "sha256": sha256(path)}


def render_language(language: str, config: dict, prepared: tuple, overwrite: bool) -> dict:
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise ValueError("Local ffmpeg and ffprobe are required; no automatic install")
    pieces, scenes = prepared
    work = WORK / language
    work.mkdir(parents=True, exist_ok=True)
    listing = work / "frames.ffconcat"
    write_concat(listing, pieces)
    duration = sum(length for _, length in pieces)
    movie = OUTPUT / f"dsh-claude-compat-interactive-{language}.mp4"
    poster = OUTPUT / f"dsh-claude-compat-interactive-{language}-poster.png"
    mode = "-y" if overwrite else "-n"
    width, height = config["width"], config["height"]
    run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", mode,
         "-f", "concat", "-safe", "0", "-i", str(listing), "-t", f"{duration:.9f}",
         "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,setparams=range=limited",
         "-fps_mode", "cfr", "-r", str(config["fps"]), "-an", "-c:v", "libx264",
         "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-color_range", "tv", "-movflags", "+faststart", str(movie)])
    media = probe(movie, duration, config, ffprobe)
    review = OUTPUT / "interactive-review" / language
    review.mkdir(parents=True, exist_ok=True)
    keyframes = []
    for scene in scenes:
        timestamp = scene["output_start"] + scene["output_duration"] / 2
        path = review / f"{scene['name']}.png"
        run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", mode,
             "-ss", str(timestamp), "-i", str(movie), "-frames:v", "1", "-update", "1", str(path)])
        keyframes.append({"scene": scene["name"], "seconds": timestamp,
                          "file": str(path.relative_to(ROOT)), "sha256": sha256(path)})
    poster_time = min(1.0, duration / 2)
    run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", mode, "-ss", str(poster_time),
         "-i", str(movie), "-frames:v", "1", "-update", "1", str(poster)])
    return {"status": "media_verified_visual_review_pending", "built_at": datetime.now(timezone.utc).isoformat(),
            "media": media, "scenes": scenes, "keyframes": keyframes,
            "poster": {"file": str(poster.relative_to(ROOT)), "seconds": poster_time, "sha256": sha256(poster)},
            "edit_sha256": sha256(EDIT), "builder_sha256": sha256(Path(__file__)),
            "tools": {"python": sys.version, "ffmpeg": run([ffmpeg, "-version"]).splitlines()[0]},
            "limits": "Input hash diversity is not semantic proof of successful interaction; inspect footage. No audio. No synthetic frames; CFR repeats/drops real frames as necessary."}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lang", choices=(*LANGUAGES, "both"), default="both")
    parser.add_argument("--render", action="store_true", help="explicitly enable encoding and final keyframe extraction")
    parser.add_argument("--preview", action="store_true", help="with --render, also identifies extracted actual per-scene review frames (always generated)")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if not args.render:
        parser.error("No encoding performed: --render is required; --help is safe before captures exist")
    try:
        config = read_json(EDIT)
        if config.get("fps") != 30 or any(not isinstance(config.get(k), int) or config[k] < 2 or config[k] % 2 for k in ("width", "height")):
            raise ValueError("Expected fps30 and positive even output dimensions")
        names = [scene_name(scene["name"]) for scene in config["scenes"]]
        if len(names) != len(set(names)) or not names:
            raise ValueError("Scene names must be unique and nonempty")
        languages = LANGUAGES if args.lang == "both" else (args.lang,)
        prepared = {lang: prepare(lang, config) for lang in languages}
        report = read_json(REPORT) if REPORT.exists() else {"languages": {}}
        for lang in languages:
            targets = [OUTPUT / f"dsh-claude-compat-interactive-{lang}{suffix}" for suffix in (".mp4", "-poster.png")]
            targets += [OUTPUT / "interactive-review" / lang / f"{name}.png" for name in names]
            if not args.overwrite and any(p.exists() for p in targets):
                raise FileExistsError(f"Existing output for {lang}; explicit --overwrite required")
        # Invalidate all selected prior success records BEFORE any output replacement.
        for lang in languages:
            report.setdefault("languages", {})[lang] = {"status": "render_pending_not_verified"}
        atomic_json(REPORT, report)
        for lang in languages:
            try:
                report["languages"][lang] = render_language(lang, config, prepared[lang], args.overwrite)
            except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
                report["languages"][lang] = {"status": "failed_not_verified", "error_type": type(error).__name__}
                atomic_json(REPORT, report)
                raise
            atomic_json(REPORT, report)
            print(f"Rendered and decoded: {lang}, {report['languages'][lang]['media']['duration_seconds']:.3f}s")
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f"Build failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
