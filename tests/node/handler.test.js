const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projects = require('../../src/projects');
const { createApp } = require('../../src/handler');

let tmpdir;
let server;
let baseUrl;

beforeEach(async () => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-handler-test-'));
  projects.setDataDir(tmpdir);
  await new Promise(resolve => {
    server = createApp().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

async function postJson(pathname, body) {
  const res = await fetch(baseUrl + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

describe('POST /api/projects path validation', () => {
  it('rejects path that does not exist', async () => {
    const res = await postJson('/api/projects', { path: '/definitely/not/a/real/dir/xyz123' });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /does not exist/);
  });

  it('rejects path that is a file, not a directory', async () => {
    const filePath = path.join(tmpdir, 'somefile.txt');
    fs.writeFileSync(filePath, 'hi');
    const res = await postJson('/api/projects', { path: filePath });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /not a directory/);
  });

  it('rejects ~/path that resolves to a non-existent directory', async () => {
    const res = await postJson('/api/projects', { path: '~/__papastud_nope_xyz_no_such_dir__' });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /does not exist/);
  });

  it('accepts an existing directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-real-proj-'));
    try {
      const res = await postJson('/api/projects', { path: dir });
      assert.equal(res.status, 201);
      assert.equal(res.data.path, dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts ~ home directory', async () => {
    const res = await postJson('/api/projects', { path: '~' });
    assert.equal(res.status, 201);
    assert.equal(res.data.path, os.homedir());
  });

  it('rejects empty body', async () => {
    const res = await postJson('/api/projects', {});
    assert.equal(res.status, 400);
    assert.match(res.data.error, /path required/);
  });

  it('rejects relative path', async () => {
    const res = await postJson('/api/projects', { path: '../etc' });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /absolute path required/);
  });

  it('rejects bare relative segment', async () => {
    const res = await postJson('/api/projects', { path: 'some/dir' });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /absolute path required/);
  });
});
