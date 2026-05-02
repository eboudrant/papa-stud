const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  walkTestNodes,
  classifyAttachment,
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
  it('classifies a single failure attachment', () => {
    assert.deepEqual(classifyAttachment('testVariants.normal.failure'), { role: 'failure', baseName: 'testVariants.normal', index: 1 });
  });
  it('extracts numeric index for failure-N', () => {
    assert.deepEqual(classifyAttachment('testVariants.normal.failure-2'), { role: 'failure', baseName: 'testVariants.normal', index: 2 });
  });
  it('classifies reference and difference', () => {
    assert.equal(classifyAttachment('foo.reference').role, 'reference');
    assert.equal(classifyAttachment('foo.difference-3').role, 'difference');
    assert.equal(classifyAttachment('foo.difference-3').index, 3);
  });
  it('falls back to other for unknown names', () => {
    assert.equal(classifyAttachment('foo.bar').role, 'other');
    assert.equal(classifyAttachment('').role, 'other');
  });
});

describe('groupManifestByTest', () => {
  it('groups attachments per test identifier and resolves their on-disk paths', () => {
    const manifest = [
      {
        testIdentifier: 'A/test1()',
        attachments: [
          { exportedFileName: 'a-fail-1.png', suggestedHumanReadableName: 'test1.failure-1', isAssociatedWithFailure: true },
          { exportedFileName: 'a-ref-1.png', suggestedHumanReadableName: 'test1.reference-1', isAssociatedWithFailure: true },
        ],
      },
      {
        testIdentifier: 'B/test2()',
        attachments: [
          { exportedFileName: 'b-fail.png', suggestedHumanReadableName: 'test2.failure', isAssociatedWithFailure: true },
        ],
      },
    ];
    const byTest = groupManifestByTest(manifest, '/tmp/cache');
    assert.equal(byTest.size, 2);
    const a = byTest.get('A/test1()');
    assert.equal(a.length, 2);
    assert.equal(a[0].exportedFile, '/tmp/cache/a-fail-1.png');
    assert.equal(a[0].role, 'failure');
    assert.equal(a[0].index, 1);
    assert.equal(a[1].role, 'reference');
  });
});

describe('pairAttachmentsForTest', () => {
  it('emits one row per failure-N pairing reference / difference by index', () => {
    const items = [
      { role: 'failure', index: 1, baseName: 'testFoo.preset', exportedFile: '/c/f1.png', timestamp: 100 },
      { role: 'reference', index: 1, baseName: 'testFoo.preset', exportedFile: '/c/r1.png' },
      { role: 'difference', index: 1, baseName: 'testFoo.preset', exportedFile: '/c/d1.png' },
      { role: 'failure', index: 2, baseName: 'testFoo.preset', exportedFile: '/c/f2.png', timestamp: 200 },
      { role: 'reference', index: 2, baseName: 'testFoo.preset', exportedFile: '/c/r2.png' },
    ];
    const paired = pairAttachmentsForTest(items);
    assert.equal(paired.length, 2);
    assert.deepEqual(paired[0], {
      index: 1, baseName: 'testFoo.preset',
      actualPath: '/c/f1.png', referencePath: '/c/r1.png', differencePath: '/c/d1.png',
      timestamp: 100,
    });
    assert.equal(paired[1].differencePath, null);
  });

  it('returns [] when no failure attachment present', () => {
    const items = [{ role: 'reference', index: 1, baseName: 'x', exportedFile: '/r' }];
    assert.deepEqual(pairAttachmentsForTest(items), []);
  });
});
