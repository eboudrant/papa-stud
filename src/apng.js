/**
 * Minimal APNG header inspection.
 *
 * APNG is a regular PNG file with extra chunks. The marker is `acTL`, which
 * MUST appear after IHDR and before the first IDAT. `acTL` carries
 * `num_frames` (uint32) and `num_plays` (uint32). We don't need to decode any
 * frames here — that happens client-side via UPNG.js — we just need a yes/no
 * detection so the UI knows whether to swap an `<img>` for a frame stepper.
 */

'use strict';

const fs = require('fs');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function detectApng(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(1024);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    return parseApngHeader(buf.subarray(0, bytes));
  } catch {
    return { apng: false };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function parseApngHeader(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { apng: false };
  }
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') {
      if (offset + 8 + 8 > buf.length) return { apng: true };
      return {
        apng: true,
        frameCount: buf.readUInt32BE(offset + 8),
        plays: buf.readUInt32BE(offset + 12),
      };
    }
    if (type === 'IDAT') return { apng: false };
    offset += 8 + length + 4;
  }
  return { apng: false };
}

module.exports = { detectApng, parseApngHeader };
