"""Generate MP4 video from scan failure delta images using ffmpeg.

Each frame shows the delta image fit-centered on a dark background
with filename and module info overlaid via ffmpeg drawtext.
No external Python dependencies — just ffmpeg.
"""

import os
import shutil
import subprocess
import tempfile


FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
FRAME_MS = 160
BG_COLOR = "0x1a1a1a"


def _escape_drawtext(text):
    """Escape text for ffmpeg drawtext filter."""
    for ch in ("\\", "'", ":", "[", "]", ";", ","):
        text = text.replace(ch, "\\" + ch)
    return text


def has_ffmpeg():
    return shutil.which("ffmpeg") is not None


def generate_video(failures, output_path):
    """Generate MP4 from failure delta images.

    Each failure's delta image becomes one frame with text overlay.
    """
    if not has_ffmpeg():
        raise RuntimeError("ffmpeg not found")

    deltas = [(f, f.get("delta_path")) for f in failures if f.get("delta_path")]
    deltas = [(f, p) for f, p in deltas if os.path.isfile(p)]
    if not deltas:
        raise RuntimeError("No delta images found")

    with tempfile.TemporaryDirectory() as tmpdir:
        # Generate one padded/scaled frame per failure using ffmpeg
        frame_paths = []
        for i, (f, delta_path) in enumerate(deltas):
            out = os.path.join(tmpdir, f"frame_{i:05d}.png")
            filename = f.get("filename", "")
            module = f.get("module", "")
            profile = f.get("profile", "")
            counter = f"{i + 1} / {len(deltas)}"
            info = f"{module}{' / ' + profile if profile else ''}  -  {counter}"

            filename_esc = _escape_drawtext(filename)
            info_esc = _escape_drawtext(info)

            # ffmpeg: scale to fit, pad to frame size, add text
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    delta_path,
                    "-vf",
                    (
                        f"scale={FRAME_WIDTH - 40}:{FRAME_HEIGHT - 100}"
                        f":force_original_aspect_ratio=decrease,"
                        f"pad={FRAME_WIDTH}:{FRAME_HEIGHT}"
                        f":(ow-iw)/2:(oh-iw*{FRAME_HEIGHT - 100}/{FRAME_WIDTH - 40})/2+10"
                        f":color={BG_COLOR},"
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
                ],
                check=True,
                capture_output=True,
            )
            frame_paths.append(out)

        if not frame_paths:
            raise RuntimeError("No frames generated")

        # Create concat file for variable-frame input
        concat_path = os.path.join(tmpdir, "concat.txt")
        with open(concat_path, "w") as cf:
            for fp in frame_paths:
                cf.write(f"file '{fp}'\n")
                cf.write(f"duration {FRAME_MS / 1000:.3f}\n")
            # Repeat last frame to avoid ffmpeg truncation
            cf.write(f"file '{frame_paths[-1]}'\n")

        # Stitch into MP4
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
