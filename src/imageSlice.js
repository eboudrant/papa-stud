/**
 * Crop one of N equal vertical slices out of a PNG / APNG via ffmpeg.
 *
 * Paparazzi-style profiles emit a single composite image with
 * `[expected | diff | actual]` side-by-side. Slicing it lets the detail-page
 * Toggle / Slider modes show one panel at a time, and lets shared APNG
 * scrubbing drive each panel as its own canvas.
 *
 * Slices are cached on disk by source-path SHA + slice index — repeated
 * loads are a static file send.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

let _ffmpegPath = undefined;
const FFMPEG_SEARCH = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];

function findFfmpeg() {
  if (_ffmpegPath !== undefined) return _ffmpegPath;
  try {
    const r = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
    if (r.status === 0) { _ffmpegPath = r.stdout.trim(); return _ffmpegPath; }
  } catch {}
  for (const p of FFMPEG_SEARCH) {
    if (fs.existsSync(p)) { _ffmpegPath = p; return p; }
  }
  _ffmpegPath = null;
  return null;
}

function slicePath(cacheRoot, srcPath, n, of) {
  const key = crypto.createHash('sha1').update(srcPath).digest('hex').slice(0, 16);
  return path.join(cacheRoot, key, `${n}-of-${of}.png`);
}

// Run ffmpeg to crop the n-th of `of` equal vertical slices, output as APNG
// (which is also a valid PNG when the source has a single frame).
function generateSlice(srcPath, n, of, outPath) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg not found');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const r = spawnSync(ffmpeg, [
    '-y',
    '-i', srcPath,
    '-filter:v', `crop=iw/${of}:ih:${n}*iw/${of}:0`,
    '-f', 'apng',
    '-plays', '0',
    outPath,
  ], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`ffmpeg crop failed (status ${r.status}): ${(r.stderr || '').slice(-300)}`);
  }
}

// Returns the on-disk path to the cached slice, generating it on first hit.
// Cache key includes the source mtime so a re-recorded composite invalidates.
function sliceImage(srcPath, n, of, cacheRoot) {
  if (!Number.isInteger(n) || !Number.isInteger(of) || n < 0 || of < 2 || n >= of) {
    throw new Error(`invalid slice ${n} of ${of}`);
  }
  const out = slicePath(cacheRoot, srcPath, n, of);
  let srcMtime;
  try { srcMtime = fs.statSync(srcPath).mtimeMs; }
  catch { throw new Error('source not found'); }
  let outMtime = -1;
  try { outMtime = fs.statSync(out).mtimeMs; } catch {}
  if (outMtime < srcMtime) generateSlice(srcPath, n, of, out);
  return out;
}

module.exports = { sliceImage, findFfmpeg };
