const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createWatcher } = require('../../src/watcher');

let tmpdir;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-watch-'));
});

afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

function makeStrategy() {
  return {
    resolveModulePath: (name, root) => path.join(root, name),
    getWatchDirs: (modulePath) => new Set([path.join(modulePath, 'watch')]),
    discoverModules: function* () {},
  };
}

function makeWatcher(calls) {
  const modulePath = path.join(tmpdir, 'm');
  const watchDir = path.join(modulePath, 'watch');
  fs.mkdirSync(watchDir, { recursive: true });
  const w = createWatcher(
    [{ name: 'm' }],
    tmpdir,
    (name) => calls.push(name),
    null,
    makeStrategy()
  );
  return { w, watchDir };
}

// fs mtime resolution is coarse on some filesystems, set explicitly
function bumpMtime(p, secondsInFuture = 10) {
  const future = new Date(Date.now() + secondsInFuture * 1000);
  fs.utimesSync(p, future, future);
}

describe('PollingWatcher', () => {
  it('does not fire on start', () => {
    const calls = [];
    const { w } = makeWatcher(calls);
    w._tick();
    assert.deepEqual(calls, []);
    w.stop();
  });

  it('fires when watched dir mtime changes', () => {
    const calls = [];
    const { w, watchDir } = makeWatcher(calls);
    bumpMtime(watchDir);
    w._tick();
    assert.deepEqual(calls, ['m']);
    w.stop();
  });

  it('fires when a first-level subdir mtime changes (grandchild update)', () => {
    // Simulates JUnit XML being rewritten in build/test-results/testDebugUnitTest/
    // The parent dir's mtime is unchanged but the subdir's is.
    const calls = [];
    const { w, watchDir } = makeWatcher(calls);
    const sub = path.join(watchDir, 'testDebugUnitTest');
    fs.mkdirSync(sub);
    // Rebuild the watcher so the subdir is part of the baseline
    w.stop();
    const w2 = createWatcher(
      [{ name: 'm' }],
      tmpdir,
      (name) => calls.push(name),
      null,
      makeStrategy()
    );
    bumpMtime(sub);
    w2._tick();
    assert.deepEqual(calls, ['m']);
    w2.stop();
  });

  it('does not fire repeatedly for the same mtime', () => {
    const calls = [];
    const { w, watchDir } = makeWatcher(calls);
    bumpMtime(watchDir);
    w._tick();
    w._tick();
    w._tick();
    assert.deepEqual(calls, ['m']);
    w.stop();
  });

  it('handles missing watch dir without throwing', () => {
    const calls = [];
    const w = createWatcher(
      [{ name: 'absent' }],
      tmpdir,
      (name) => calls.push(name),
      null,
      makeStrategy()
    );
    assert.doesNotThrow(() => w._tick());
    fs.mkdirSync(path.join(tmpdir, 'absent', 'watch'), { recursive: true });
    w._tick();
    assert.deepEqual(calls, ['absent']);
    w.stop();
  });
});
