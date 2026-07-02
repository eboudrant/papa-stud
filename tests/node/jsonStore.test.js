const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJson, writeJson } = require('../../src/jsonStore');

let tmpdir;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-jsonstore-test-'));
});

afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

describe('jsonStore', () => {
  it('readJson returns null for a missing file', () => {
    assert.equal(readJson(path.join(tmpdir, 'nope.json')), null);
  });

  it('round-trips writeJson -> readJson', () => {
    const p = path.join(tmpdir, 'nested', 'data.json');
    const data = { projects: [{ id: 'p1', name: 'Demo' }], count: 2 };
    writeJson(p, data);
    assert.deepEqual(readJson(p), data);
  });

  it('readJson on corrupt JSON returns null and moves the file aside', () => {
    const p = path.join(tmpdir, 'projects.json');
    fs.writeFileSync(p, '{invalid');

    assert.equal(readJson(p), null);

    // Original path is gone.
    assert.equal(fs.existsSync(p), false);

    // A sibling *.corrupt-* file exists with the bad content.
    const siblings = fs.readdirSync(tmpdir).filter((f) => f.startsWith('projects.json.corrupt-'));
    assert.equal(siblings.length, 1);
    assert.equal(fs.readFileSync(path.join(tmpdir, siblings[0]), 'utf8'), '{invalid');
  });

  it('recovers: writeJson to the same path works after corruption', () => {
    const p = path.join(tmpdir, 'projects.json');
    fs.writeFileSync(p, '{invalid');
    assert.equal(readJson(p), null);

    const data = { projects: [] };
    writeJson(p, data);
    assert.deepEqual(readJson(p), data);
  });
});
