const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sliceImage } = require('../../src/imageSlice');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-slice-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('sliceImage input validation', () => {
  it('rejects negative n', () => {
    assert.throws(() => sliceImage('/anything', -1, 3, tmp), /invalid slice/);
  });

  it('rejects n >= of', () => {
    assert.throws(() => sliceImage('/anything', 3, 3, tmp), /invalid slice/);
    assert.throws(() => sliceImage('/anything', 5, 3, tmp), /invalid slice/);
  });

  it('rejects of < 2', () => {
    assert.throws(() => sliceImage('/anything', 0, 1, tmp), /invalid slice/);
    assert.throws(() => sliceImage('/anything', 0, 0, tmp), /invalid slice/);
  });

  it('rejects non-integer values', () => {
    assert.throws(() => sliceImage('/anything', 0.5, 3, tmp), /invalid slice/);
    assert.throws(() => sliceImage('/anything', 0, 3.5, tmp), /invalid slice/);
  });

  it('rejects when the source path does not exist', () => {
    assert.throws(() => sliceImage('/no/such/path.png', 0, 3, tmp), /source not found/);
  });
});
