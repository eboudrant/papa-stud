"""Generate MP4 video from scan failure delta images using ffmpeg.

Each frame shows a progress bar with running stick figure at top,
delta image fit-centered, and filename overlay at bottom.
No external Python dependencies — uses struct/zlib for PNG generation.
"""

import math
import os
import shutil
import struct
import subprocess
import tempfile
import zlib

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
FRAME_MS = 160
BG_COLOR = (26, 26, 26)
BAR_HEIGHT = 30
BAR_Y = 8


def has_ffmpeg():
    return shutil.which("ffmpeg") is not None


def generate_video(failures, output_path):
    """Generate MP4 from failure delta images."""
    if not has_ffmpeg():
        raise RuntimeError("ffmpeg not found")

    deltas = [(f, f.get("delta_path")) for f in failures if f.get("delta_path")]
    deltas = [(f, p) for f, p in deltas if os.path.isfile(p)]
    if not deltas:
        raise RuntimeError("No delta images found")

    with tempfile.TemporaryDirectory() as tmpdir:
        total_frames = len(deltas)
        trip_frames = _compute_trips(total_frames)

        overlay_paths = []
        for i in range(len(deltas)):
            progress = (i + 1) / len(deltas)
            overlay = _render_overlay(progress, i, total_frames, trip_frames)
            opath = os.path.join(tmpdir, f"overlay_{i:05d}.png")
            with open(opath, "wb") as fp:
                fp.write(overlay)
            overlay_paths.append(opath)

        # Generate frames in parallel batches using ffmpeg
        frame_paths = []
        batch_size = os.cpu_count() or 4
        cmds = []
        for i, (f, delta_path) in enumerate(deltas):
            out = os.path.join(tmpdir, f"frame_{i:05d}.png")
            frame_paths.append(out)
            filename = f.get("filename", "")
            module = f.get("module", "")
            profile = f.get("profile", "")
            diff_pct = f.get("diff_pct")
            counter = f"{i + 1} / {len(deltas)}"
            info = f"{module}{' / ' + profile if profile else ''}  -  {counter}"
            if diff_pct is not None:
                info += f"  ({diff_pct:.3f}%)"

            filename_esc = _escape_drawtext(filename)
            info_esc = _escape_drawtext(info)
            bg_hex = f"0x{BG_COLOR[0]:02x}{BG_COLOR[1]:02x}{BG_COLOR[2]:02x}"
            img_h = FRAME_HEIGHT - BAR_HEIGHT - 90

            cmds.append(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    delta_path,
                    "-i",
                    overlay_paths[i],
                    "-filter_complex",
                    (
                        f"[0]scale={FRAME_WIDTH - 40}:{img_h}"
                        f":force_original_aspect_ratio=decrease,"
                        f"pad={FRAME_WIDTH}:{FRAME_HEIGHT}"
                        f":(ow-iw)/2:{BAR_HEIGHT + 50}+({img_h}-ih)/2"
                        f":color={bg_hex}[bg];"
                        f"[bg][1]overlay=0:0,"
                        f"drawtext=text='{filename_esc}'"
                        f":fontsize=18:fontcolor=white"
                        f":x=(w-text_w)/2:y=h-55,"
                        f"drawtext=text='{info_esc}'"
                        f":fontsize=14:fontcolor=gray"
                        f":x=(w-text_w)/2:y=h-28"
                    ),
                    "-frames:v",
                    "1",
                    out,
                ]
            )

        # Run in parallel batches
        for batch_start in range(0, len(cmds), batch_size):
            batch = cmds[batch_start : batch_start + batch_size]
            procs = [
                subprocess.Popen(
                    cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
                for cmd in batch
            ]
            for p in procs:
                p.wait()

        if not frame_paths:
            raise RuntimeError("No frames generated")

        concat_path = os.path.join(tmpdir, "concat.txt")
        with open(concat_path, "w") as cf:
            for fp in frame_paths:
                cf.write(f"file '{fp}'\n")
                cf.write(f"duration {FRAME_MS / 1000:.3f}\n")
            cf.write(f"file '{frame_paths[-1]}'\n")

        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                concat_path,
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-preset",
                "fast",
                "-movflags",
                "+faststart",
                str(output_path),
            ],
            check=True,
            capture_output=True,
        )


def _render_overlay(progress, frame_idx, total_frames, trip_frames):
    """Render a transparent PNG overlay with progress bar + running stick figure."""
    bar_top = 38  # bar sits below the stick figure
    w, h = FRAME_WIDTH, bar_top + 8
    pixels = [[(0, 0, 0, 0) for _ in range(w)] for _ in range(h)]

    # Progress bar (the "ground" the figure runs on)
    for y in range(bar_top, bar_top + 4):
        for x in range(40, w - 40):
            pixels[y][x] = (60, 60, 60, 255)

    # Progress bar fill (green)
    fill_end = 40 + int((w - 80) * progress)
    for y in range(bar_top, bar_top + 4):
        for x in range(40, fill_end):
            pixels[y][x] = (34, 197, 94, 255)

    # Stick figure — only for videos with 30+ frames
    if total_frames > 30:
        fig_x = 40 + int((w - 80) * progress)
        fig_y = bar_top - 25
        _draw_stick_figure(pixels, fig_x, fig_y, w, h, frame_idx, trip_frames)

    return _encode_rgba_png(w, h, pixels)


def _compute_trips(total_frames):
    """Pick 2 random trip points in the first 50% of the video. Returns a set of frame indices."""
    import random

    if total_frames < 30:
        return set()
    half = total_frames // 2
    candidates = list(range(5, max(6, half - 5)))
    random.shuffle(candidates)
    trips = []
    for c in candidates:
        if all(abs(c - t) >= 6 for t in trips):
            trips.append(c)
        if len(trips) == 2:
            break
    result = set()
    for t in trips:
        result.update([t, t + 1, t + 2])
    return result


def _draw_stick_figure(pixels, cx, cy, w, h, frame, trip_frames):
    """Draw a running stick figure. Trips and falls occasionally."""
    phase = frame % 4
    tripping = frame in trip_frames
    color = (255, 255, 255, 255)

    def px(x, y):
        if 0 <= x < w and 0 <= y < h:
            pixels[y][x] = color

    def line(x0, y0, x1, y1):
        steps = max(abs(x1 - x0), abs(y1 - y0), 1)
        for t in range(steps + 1):
            x = x0 + (x1 - x0) * t // steps
            y = y0 + (y1 - y0) * t // steps
            px(x, y)
            px(x + 1, y)

    if tripping:
        # Determine trip phase: find which trip start this belongs to
        tp = 0
        for start in sorted(t for t in trip_frames if t - 1 not in trip_frames):
            if frame == start:
                tp = 0
            elif frame == start + 1:
                tp = 1
            elif frame == start + 2:
                tp = 2

        if tp == 0:
            # Stumbling — leaning forward
            for a in range(360):
                rad = math.radians(a)
                px(cx + 3 + int(4 * math.cos(rad)), cy + int(4 * math.sin(rad)))
            line(cx + 2, cy + 5, cx - 2, cy + 16)
            line(cx + 2, cy + 8, cx + 8, cy + 14)
            line(cx + 2, cy + 8, cx - 4, cy + 6)
            line(cx - 2, cy + 16, cx - 6, cy + 25)
            line(cx - 2, cy + 16, cx + 3, cy + 25)
        elif tp == 1:
            # Falling — horizontal
            for a in range(360):
                rad = math.radians(a)
                px(cx + 8 + int(4 * math.cos(rad)), cy + 18 + int(4 * math.sin(rad)))
            line(cx + 4, cy + 20, cx - 8, cy + 22)
            line(cx, cy + 21, cx - 4, cy + 16)
            line(cx, cy + 21, cx + 6, cy + 15)
            line(cx - 8, cy + 22, cx - 12, cy + 25)
            line(cx - 8, cy + 22, cx - 4, cy + 25)
        else:
            # Splat — flat on ground
            for a in range(360):
                rad = math.radians(a)
                px(cx + 10 + int(3 * math.cos(rad)), cy + 22 + int(3 * math.sin(rad)))
            line(cx + 7, cy + 24, cx - 8, cy + 25)
            line(cx - 2, cy + 25, cx - 6, cy + 20)
            line(cx - 2, cy + 25, cx + 4, cy + 19)
            line(cx - 8, cy + 25, cx - 10, cy + 22)
            line(cx - 8, cy + 25, cx - 5, cy + 22)
    else:
        # Normal running
        for a in range(360):
            rad = math.radians(a)
            px(cx + int(4 * math.cos(rad)), cy + int(4 * math.sin(rad)))
        line(cx, cy + 5, cx, cy + 16)
        arm_swing = [-4, -2, 2, 4][phase]
        line(cx, cy + 8, cx - 6, cy + 12 + arm_swing)
        line(cx, cy + 8, cx + 6, cy + 12 - arm_swing)
        leg_swing = [-5, -2, 3, 5][phase]
        line(cx, cy + 16, cx - 4 + leg_swing, cy + 25)
        line(cx, cy + 16, cx + 4 - leg_swing, cy + 25)


def _encode_rgba_png(width, height, pixels):
    """Encode RGBA pixel data as PNG."""
    raw = b""
    for y in range(height):
        raw += b"\x00"
        for x in range(width):
            r, g, b, a = pixels[y][x]
            raw += bytes([r, g, b, a])

    def chunk(chunk_type, data):
        c = chunk_type + data
        return (
            struct.pack(">I", len(data))
            + c
            + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _escape_drawtext(text):
    """Escape text for ffmpeg drawtext filter."""
    for ch in ("\\", "'", ":", "[", "]", ";", ","):
        text = text.replace(ch, "\\" + ch)
    return text
