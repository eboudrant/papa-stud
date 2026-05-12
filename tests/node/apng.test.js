const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { detectApng, parseApngHeader } = require('../../src/apng');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC32 (PNG-style polynomial). Tiny table-free implementation — fast enough
// for fixtures.
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function ihdr(w, h) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4);
  d[8] = 8; d[9] = 6; // 8-bit RGBA
  return chunk('IHDR', d);
}

function actl(numFrames, numPlays = 0) {
  const d = Buffer.alloc(8);
  d.writeUInt32BE(numFrames, 0); d.writeUInt32BE(numPlays, 4);
  return chunk('acTL', d);
}

function idat(w = 1, h = 1) {
  // One row of one transparent pixel, deflated.
  const raw = Buffer.alloc(1 + 4 * w * h, 0);
  return chunk('IDAT', zlib.deflateSync(raw));
}

function iend() { return chunk('IEND'); }

describe('parseApngHeader', () => {
  it('reports apng=true with frameCount/plays from acTL', () => {
    const buf = Buffer.concat([PNG_SIG, ihdr(4, 4), actl(7, 3), idat(4, 4), iend()]);
    assert.deepEqual(parseApngHeader(buf), { apng: true, frameCount: 7, plays: 3 });
  });

  it('reports apng=false for a plain PNG (no acTL before IDAT)', () => {
    const buf = Buffer.concat([PNG_SIG, ihdr(4, 4), idat(4, 4), iend()]);
    assert.deepEqual(parseApngHeader(buf), { apng: false });
  });

  it('reports apng=false for non-PNG input', () => {
    assert.deepEqual(parseApngHeader(Buffer.from('not a png')), { apng: false });
  });

  it('reports apng=false for empty input', () => {
    assert.deepEqual(parseApngHeader(Buffer.alloc(0)), { apng: false });
  });
});

describe('detectApng', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-apng-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('detects a real APNG file on disk', () => {
    const p = path.join(tmp, 'anim.png');
    fs.writeFileSync(p, Buffer.concat([PNG_SIG, ihdr(2, 2), actl(5), idat(2, 2), iend()]));
    assert.deepEqual(detectApng(p), { apng: true, frameCount: 5, plays: 0 });
  });

  it('returns apng=false for a plain PNG on disk', () => {
    const p = path.join(tmp, 'plain.png');
    fs.writeFileSync(p, Buffer.concat([PNG_SIG, ihdr(2, 2), idat(2, 2), iend()]));
    assert.deepEqual(detectApng(p), { apng: false });
  });

  it('returns apng=false when the file does not exist', () => {
    assert.deepEqual(detectApng(path.join(tmp, 'nope.png')), { apng: false });
  });
});
