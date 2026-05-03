const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  walkTestNodes,
  classifyAttachment,
  ensureExtension,
  groupManifestByTest,
  pairAttachmentsForTest,
} = require('../../src/xcresultParser');

describe('walkTestNodes', () => {
  it('counts pass / fail / skip across nested suites', () => {
    const root = [{
      nodeType: 'Test Plan',
      children: [{
        nodeType: 'Unit test bundle',
        name: 'ArgoComponentTests',
        children: [{
          nodeType: 'Test Suite',
          name: 'CUDMiniModuleSnapshotTests',
          children: [
            { nodeType: 'Test Case', name: 'testVariants()', nodeIdentifier: 'CUDMiniModuleSnapshotTests/testVariants()', result: 'Failed' },
            { nodeType: 'Test Case', name: 'testEmpty()', nodeIdentifier: 'CUDMiniModuleSnapshotTests/testEmpty()', result: 'Passed' },
            { nodeType: 'Test Case', name: 'testSkipped()', nodeIdentifier: 'CUDMiniModuleSnapshotTests/testSkipped()', result: 'Skipped' },
          ],
        }],
      }],
    }];

    const { stats, failures } = walkTestNodes(root);
    assert.equal(stats.passed, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.skipped, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].testIdentifier, 'CUDMiniModuleSnapshotTests/testVariants()');
    assert.equal(failures[0].name, 'testVariants()');
  });

  it('returns zero stats on empty input', () => {
    const { stats, failures } = walkTestNodes([]);
    assert.deepEqual(stats, { passed: 0, failed: 0, skipped: 0, expectedFailure: 0 });
    assert.equal(failures.length, 0);
  });
});

describe('classifyAttachment', () => {
  it('parses Xcode flattened naming <role>_<pos>_<uuid>.png', () => {
    assert.deepEqual(
      classifyAttachment('failure_1_6C3C5C0C-0D82-443A-A351-8C1C2EC10E76.png'),
      { role: 'failure', groupKey: '6C3C5C0C-0D82-443A-A351-8C1C2EC10E76' },
    );
  });
  it('classifies reference and difference', () => {
    assert.equal(classifyAttachment('reference_0_AAAA-BBBB.png').role, 'reference');
    assert.equal(classifyAttachment('difference_2_AAAA-BBBB.png').role, 'difference');
  });
  it('returns role=other for the issue description', () => {
    assert.equal(classifyAttachment('Complete Issue Description.txt').role, 'other');
  });
  it('returns role=other for an empty name', () => {
    assert.equal(classifyAttachment('').role, 'other');
  });
});

describe('groupManifestByTest', () => {
  it('groups attachments per test identifier and resolves their on-disk paths', () => {
    const manifest = [
      {
        testIdentifier: 'A/test1()',
        attachments: [
          { exportedFileName: 'fff.png', suggestedHumanReadableName: 'failure_1_UUID-A.png' },
          { exportedFileName: 'rrr.png', suggestedHumanReadableName: 'reference_0_UUID-A.png' },
        ],
      },
    ];
    const byTest = groupManifestByTest(manifest, '/tmp/cache');
    const a = byTest.get('A/test1()');
    assert.equal(a.length, 2);
    assert.equal(a[0].exportedFile, '/tmp/cache/fff.png');
    assert.equal(a[0].role, 'failure');
    assert.equal(a[0].groupKey, 'UUID-A');
  });
});

describe('pairAttachmentsForTest', () => {
  it('groups reference / failure / difference by groupKey (one assertion = one triplet)', () => {
    const items = [
      { role: 'reference', groupKey: 'U1', exportedFile: '/c/r1.png' },
      { role: 'failure', groupKey: 'U1', exportedFile: '/c/f1.png', timestamp: 100 },
      { role: 'difference', groupKey: 'U1', exportedFile: '/c/d1.png' },
      { role: 'reference', groupKey: 'U2', exportedFile: '/c/r2.png' },
      { role: 'failure', groupKey: 'U2', exportedFile: '/c/f2.png', timestamp: 200 },
    ];
    const paired = pairAttachmentsForTest(items);
    assert.equal(paired.length, 2);
    const u1 = paired.find(p => p.actualPath === '/c/f1.png');
    assert.deepEqual(u1, {
      actualPath: '/c/f1.png', differencePath: '/c/d1.png',
      timestamp: 100,
    });
    assert.equal(paired.find(p => p.actualPath === '/c/f2.png').differencePath, null);
  });

  it('returns [] when no failure attachment present', () => {
    const items = [{ role: 'reference', groupKey: 'U1', exportedFile: '/r' }];
    assert.deepEqual(pairAttachmentsForTest(items), []);
  });

  it('skips role=other (e.g. issue description text)', () => {
    const items = [
      { role: 'failure', groupKey: 'U1', exportedFile: '/f', timestamp: 0 },
      { role: 'other', groupKey: 'Complete Issue Description', exportedFile: '/t' },
    ];
    assert.equal(pairAttachmentsForTest(items).length, 1);
  });
});

describe('ensureExtension', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-ext-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('renames the file and returns the new path', () => {
    const orig = path.join(tmp, 'abc');
    fs.writeFileSync(orig, 'data');
    const out = ensureExtension(orig, 'whatever.png');
    assert.equal(out, orig + '.png');
    assert.ok(fs.existsSync(out));
    assert.ok(!fs.existsSync(orig));
  });

  it('is idempotent on a second pass', () => {
    const orig = path.join(tmp, 'abc');
    fs.writeFileSync(orig, 'data');
    const first = ensureExtension(orig, 'x.png');
    const second = ensureExtension(first, 'x.png');
    assert.equal(first, second);
    assert.ok(fs.existsSync(second));
  });

  it('returns the path unchanged when humanName has no extension', () => {
    assert.equal(ensureExtension('/foo/bar', 'noext'), '/foo/bar');
  });
});
