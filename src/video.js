/**
 * Generate MP4 video from scan failure delta images using ffmpeg.
 * Progress bar + text overlay rendered as raw PNG — no drawtext needed.
 * Fully async — does not block the event loop.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { spawn } = require('child_process');

const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
const FRAME_MS = 160;
const BG = [26, 26, 26];
const BG_HEX = `0x${BG.map(c => c.toString(16).padStart(2, '0')).join('')}`;

// Overlay: progress bar + filename + info text rendered at the bottom
const OVERLAY_H = 52; // total overlay height
const BAR_Y = 44;     // progress bar Y within overlay
const BAR_H = 4;

let _ffmpegPath = undefined;

const FFMPEG_SEARCH_PATHS = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
];

function findFfmpeg() {
  if (_ffmpegPath !== undefined) return _ffmpegPath;
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('which', ['ffmpeg'], { stdio: 'pipe' });
    if (result.status === 0) {
      _ffmpegPath = result.stdout.toString().trim();
      return _ffmpegPath;
    }
  } catch {}
  for (const p of FFMPEG_SEARCH_PATHS) {
    if (fs.existsSync(p)) { _ffmpegPath = p; return p; }
  }
  _ffmpegPath = null;
  return null;
}

function hasFfmpeg() {
  return findFfmpeg() !== null;
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr.slice(0, 300)}`));
    });
    proc.on('error', reject);
  });
}

async function generateVideo(failures, outputPath) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg not found');

  const deltas = failures
    .filter(f => f.delta_path && fs.existsSync(f.delta_path))
    .map(f => ({ failure: f, deltaPath: f.delta_path }));

  if (!deltas.length) throw new Error('No delta images found');

  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-video-'));
  try {
    const overlayPaths = [];
    const imgH = FRAME_HEIGHT - 10 - OVERLAY_H;

    for (let i = 0; i < deltas.length; i++) {
      const { failure: f } = deltas[i];
      const progress = (i + 1) / deltas.length;
      const filename = f.filename || '';
      const mod = f.module || '';
      const profile = f.profile || '';
      const diffPct = f.diff_pct;
      const counter = `${i + 1} / ${deltas.length}`;
      let info = `${mod}${profile ? ' / ' + profile : ''}  -  ${counter}`;
      if (diffPct != null) info += `  (${diffPct.toFixed(3)}%)`;

      const overlay = renderOverlay(progress, filename, info);
      const opath = path.join(tmpdir, `overlay_${String(i).padStart(5, '0')}.png`);
      fs.writeFileSync(opath, overlay);
      overlayPaths.push(opath);
    }

    // Build frame commands — no drawtext, text is baked into overlay PNG
    const framePaths = [];
    const cmds = [];
    for (let i = 0; i < deltas.length; i++) {
      const { deltaPath } = deltas[i];
      const out = path.join(tmpdir, `frame_${String(i).padStart(5, '0')}.png`);
      framePaths.push(out);

      cmds.push([
        ffmpeg, '-y', '-i', deltaPath, '-i', overlayPaths[i],
        '-filter_complex',
        `[0]scale=${FRAME_WIDTH - 40}:${imgH}:force_original_aspect_ratio=decrease,` +
        `pad=${FRAME_WIDTH}:${FRAME_HEIGHT}:(ow-iw)/2:5+(${imgH}-ih)/2:color=${BG_HEX}[bg];` +
        `[bg][1]overlay=0:${FRAME_HEIGHT}-${OVERLAY_H}`,
        '-frames:v', '1', out,
      ]);
    }

    // Run in parallel batches (async)
    const batchSize = os.cpus().length || 4;
    for (let i = 0; i < cmds.length; i += batchSize) {
      const batch = cmds.slice(i, i + batchSize);
      await Promise.all(batch.map(cmd => runCmd(cmd[0], cmd.slice(1))));
    }

    // Concatenate
    const concatPath = path.join(tmpdir, 'concat.txt');
    let concatContent = '';
    for (const fp of framePaths) {
      concatContent += `file '${fp}'\nduration ${(FRAME_MS / 1000).toFixed(3)}\n`;
    }
    concatContent += `file '${framePaths[framePaths.length - 1]}'\n`;
    fs.writeFileSync(concatPath, concatContent);

    await runCmd(ffmpeg, [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast',
      '-movflags', '+faststart', outputPath,
    ]);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

// --- Bitmap font for overlay text ---
// 5x7 pixel font for ASCII 32-126
const FONT_W = 5;
const FONT_H = 7;
const FONT_SPACING = 1;

// Compact 5x7 font glyphs — each char is 7 rows of 5-bit bitmaps
const GLYPH_DATA = {
  ' ': [0,0,0,0,0,0,0],
  '!': [4,4,4,4,4,0,4],
  '.': [0,0,0,0,0,0,4],
  ',': [0,0,0,0,0,4,8],
  ':': [0,0,4,0,0,4,0],
  '-': [0,0,0,14,0,0,0],
  '_': [0,0,0,0,0,0,31],
  '/': [1,1,2,4,8,16,16],
  '(': [2,4,8,8,8,4,2],
  ')': [8,4,2,2,2,4,8],
  '%': [24,25,2,4,8,19,3],
  '0': [14,17,19,21,25,17,14],
  '1': [4,12,4,4,4,4,14],
  '2': [14,17,1,2,4,8,31],
  '3': [14,17,1,6,1,17,14],
  '4': [2,6,10,18,31,2,2],
  '5': [31,16,30,1,1,17,14],
  '6': [6,8,16,30,17,17,14],
  '7': [31,1,2,4,8,8,8],
  '8': [14,17,17,14,17,17,14],
  '9': [14,17,17,15,1,2,12],
  'a': [0,0,14,1,15,17,15],
  'b': [16,16,30,17,17,17,30],
  'c': [0,0,14,16,16,17,14],
  'd': [1,1,15,17,17,17,15],
  'e': [0,0,14,17,31,16,14],
  'f': [6,9,8,28,8,8,8],
  'g': [0,0,15,17,15,1,14],
  'h': [16,16,22,25,17,17,17],
  'i': [4,0,12,4,4,4,14],
  'j': [2,0,6,2,2,18,12],
  'k': [16,16,18,20,24,20,18],
  'l': [12,4,4,4,4,4,14],
  'm': [0,0,26,21,21,17,17],
  'n': [0,0,22,25,17,17,17],
  'o': [0,0,14,17,17,17,14],
  'p': [0,0,30,17,30,16,16],
  'q': [0,0,15,17,15,1,1],
  'r': [0,0,22,25,16,16,16],
  's': [0,0,15,16,14,1,30],
  't': [8,8,28,8,8,9,6],
  'u': [0,0,17,17,17,19,13],
  'v': [0,0,17,17,17,10,4],
  'w': [0,0,17,17,21,21,10],
  'x': [0,0,17,10,4,10,17],
  'y': [0,0,17,17,15,1,14],
  'z': [0,0,31,2,4,8,31],
  'A': [14,17,17,31,17,17,17],
  'B': [30,17,17,30,17,17,30],
  'C': [14,17,16,16,16,17,14],
  'D': [30,17,17,17,17,17,30],
  'E': [31,16,16,30,16,16,31],
  'F': [31,16,16,30,16,16,16],
  'G': [14,17,16,23,17,17,14],
  'H': [17,17,17,31,17,17,17],
  'I': [14,4,4,4,4,4,14],
  'J': [7,2,2,2,2,18,12],
  'K': [17,18,20,24,20,18,17],
  'L': [16,16,16,16,16,16,31],
  'M': [17,27,21,17,17,17,17],
  'N': [17,17,25,21,19,17,17],
  'O': [14,17,17,17,17,17,14],
  'P': [30,17,17,30,16,16,16],
  'Q': [14,17,17,17,21,18,13],
  'R': [30,17,17,30,20,18,17],
  'S': [14,17,16,14,1,17,14],
  'T': [31,4,4,4,4,4,4],
  'U': [17,17,17,17,17,17,14],
  'V': [17,17,17,17,10,10,4],
  'W': [17,17,17,21,21,21,10],
  'X': [17,17,10,4,10,17,17],
  'Y': [17,17,10,4,4,4,4],
  'Z': [31,1,2,4,8,16,31],
  '@': [14,17,23,21,23,16,14],
  '#': [10,10,31,10,31,10,10],
};

function drawText(pixels, w, h, x, y, text, r, g, b) {
  for (let ci = 0; ci < text.length; ci++) {
    const ch = text[ci];
    const glyph = GLYPH_DATA[ch];
    if (!glyph) { x += FONT_W + FONT_SPACING; continue; }
    for (let row = 0; row < FONT_H; row++) {
      const bits = glyph[row];
      for (let col = 0; col < FONT_W; col++) {
        if (bits & (1 << (FONT_W - 1 - col))) {
          const px = x + col;
          const py = y + row;
          if (px >= 0 && px < w && py >= 0 && py < h) {
            const off = (py * w + px) * 4;
            pixels[off] = r; pixels[off + 1] = g; pixels[off + 2] = b; pixels[off + 3] = 255;
          }
        }
      }
    }
    x += FONT_W + FONT_SPACING;
  }
}

function textWidth(text) {
  return text.length * (FONT_W + FONT_SPACING) - FONT_SPACING;
}

// --- Overlay rendering ---

function renderOverlay(progress, filename, info) {
  const w = FRAME_WIDTH;
  const h = OVERLAY_H;
  const buf = Buffer.alloc(w * h * 4, 0);

  // Background strip
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const off = (y * w + x) * 4;
      buf[off] = BG[0]; buf[off + 1] = BG[1]; buf[off + 2] = BG[2]; buf[off + 3] = 255;
    }
  }

  // Info text (gray, top of overlay)
  if (info) {
    const tx = Math.floor((w - textWidth(info)) / 2);
    drawText(buf, w, h, tx, 4, info, 140, 140, 140);
  }

  // Filename (white, below info)
  if (filename) {
    const tx = Math.floor((w - textWidth(filename)) / 2);
    drawText(buf, w, h, tx, 16, filename, 255, 255, 255);
  }

  // Progress bar background
  for (let y = BAR_Y; y < BAR_Y + BAR_H; y++) {
    for (let x = 40; x < w - 40; x++) {
      const off = (y * w + x) * 4;
      buf[off] = 60; buf[off + 1] = 60; buf[off + 2] = 60; buf[off + 3] = 255;
    }
  }

  // Progress bar fill
  const fillEnd = 40 + Math.floor((w - 80) * progress);
  for (let y = BAR_Y; y < BAR_Y + BAR_H; y++) {
    for (let x = 40; x < fillEnd; x++) {
      const off = (y * w + x) * 4;
      buf[off] = 34; buf[off + 1] = 197; buf[off + 2] = 94; buf[off + 3] = 255;
    }
  }

  return encodeRgbaPng(w, h, buf);
}

function encodeRgbaPng(width, height, pixelBuf) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    pixelBuf.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw);

  function chunk(type, data) {
    const typeBuf = Buffer.from(type);
    const combined = Buffer.concat([typeBuf, data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(combined) >>> 0);
    return Buffer.concat([len, combined, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return crc ^ 0xFFFFFFFF;
}

module.exports = { hasFfmpeg, generateVideo };
