/**
 * Generate MP4 video from scan failure delta images using ffmpeg.
 * Progress bar overlay rendered as raw PNG using Buffer + zlib.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { execFileSync, spawnSync } = require('child_process');

const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
const FRAME_MS = 160;
const BG_COLOR = [26, 26, 26];
const BG_HEX = `0x${BG_COLOR.map(c => c.toString(16).padStart(2, '0')).join('')}`;
const OVERLAY_H = 8;

let _hasFfmpeg = null;

function hasFfmpeg() {
  if (_hasFfmpeg === null) {
    try {
      execFileSync('which', ['ffmpeg'], { stdio: 'ignore' });
      _hasFfmpeg = true;
    } catch {
      _hasFfmpeg = false;
    }
  }
  return _hasFfmpeg;
}

function generateVideo(failures, outputPath) {
  if (!hasFfmpeg()) throw new Error('ffmpeg not found');

  const deltas = failures
    .filter(f => f.delta_path && fs.existsSync(f.delta_path))
    .map(f => ({ failure: f, deltaPath: f.delta_path }));

  if (!deltas.length) throw new Error('No delta images found');

  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-video-'));
  try {
    const overlayPaths = [];
    for (let i = 0; i < deltas.length; i++) {
      const progress = (i + 1) / deltas.length;
      const overlay = renderOverlay(progress);
      const opath = path.join(tmpdir, `overlay_${String(i).padStart(5, '0')}.png`);
      fs.writeFileSync(opath, overlay);
      overlayPaths.push(opath);
    }

    const framePaths = [];
    const batchSize = os.cpus().length || 4;
    const cmds = [];

    for (let i = 0; i < deltas.length; i++) {
      const { failure: f, deltaPath } = deltas[i];
      const out = path.join(tmpdir, `frame_${String(i).padStart(5, '0')}.png`);
      framePaths.push(out);

      const filename = f.filename || '';
      const mod = f.module || '';
      const profile = f.profile || '';
      const diffPct = f.diff_pct;
      const counter = `${i + 1} / ${deltas.length}`;
      let info = `${mod}${profile ? ' / ' + profile : ''}  -  ${counter}`;
      if (diffPct != null) info += `  (${diffPct.toFixed(3)}%)`;

      const filenameEsc = escapeDrawtext(filename);
      const infoEsc = escapeDrawtext(info);
      const bottomZone = 20 + 18 + 6 + 14 + 10 + OVERLAY_H;
      const imgH = FRAME_HEIGHT - 20 - bottomZone;

      cmds.push([
        'ffmpeg', '-y', '-i', deltaPath, '-i', overlayPaths[i],
        '-filter_complex',
        `[0]scale=${FRAME_WIDTH - 40}:${imgH}:force_original_aspect_ratio=decrease,` +
        `pad=${FRAME_WIDTH}:${FRAME_HEIGHT}:(ow-iw)/2:10+(${imgH}-ih)/2:color=${BG_HEX}[bg];` +
        `[bg][1]overlay=0:${FRAME_HEIGHT}-overlay_h,` +
        `drawtext=text='${infoEsc}':fontsize=14:fontcolor=gray:x=(w-text_w)/2:y=${FRAME_HEIGHT}-${bottomZone}+4,` +
        `drawtext=text='${filenameEsc}':fontsize=18:fontcolor=white:x=(w-text_w)/2:y=${FRAME_HEIGHT}-${OVERLAY_H}-28`,
        '-frames:v', '1', out,
      ]);
    }

    // Run in parallel batches (spawnSync to ensure frames finish before concat)
    for (let i = 0; i < cmds.length; i += batchSize) {
      const batch = cmds.slice(i, i + batchSize);
      const procs = batch.map(cmd => spawnSync(cmd[0], cmd.slice(1), { stdio: 'ignore' }));
    }

    // Concatenate frames
    const concatPath = path.join(tmpdir, 'concat.txt');
    let concatContent = '';
    for (const fp of framePaths) {
      concatContent += `file '${fp}'\nduration ${(FRAME_MS / 1000).toFixed(3)}\n`;
    }
    concatContent += `file '${framePaths[framePaths.length - 1]}'\n`;
    fs.writeFileSync(concatPath, concatContent);

    execFileSync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast',
      '-movflags', '+faststart', outputPath,
    ], { stdio: 'ignore' });

  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

function renderOverlay(progress) {
  const barTop = 0;
  const w = FRAME_WIDTH;
  const h = barTop + 8;

  // RGBA pixel buffer
  const buf = Buffer.alloc(w * h * 4, 0);

  const setPixel = (x, y, r, g, b, a) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const off = (y * w + x) * 4;
    buf[off] = r; buf[off + 1] = g; buf[off + 2] = b; buf[off + 3] = a;
  };

  // Progress bar background
  for (let y = barTop; y < barTop + 4; y++) {
    for (let x = 40; x < w - 40; x++) {
      setPixel(x, y, 60, 60, 60, 255);
    }
  }

  // Progress bar fill
  const fillEnd = 40 + Math.floor((w - 80) * progress);
  for (let y = barTop; y < barTop + 4; y++) {
    for (let x = 40; x < fillEnd; x++) {
      setPixel(x, y, 34, 197, 94, 255);
    }
  }

  return encodeRgbaPng(w, h, buf);
}

function encodeRgbaPng(width, height, pixelBuf) {
  // Build raw scanlines with filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter none
    pixelBuf.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData) >>> 0);
    return Buffer.concat([len, typeAndData, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return crc ^ 0xFFFFFFFF;
}

function escapeDrawtext(text) {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:');
}

module.exports = { hasFfmpeg, generateVideo };
