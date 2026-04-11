const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectCurrentFailures, deltaToBase, resolveGolden, processSingleModule, scanProject } = require('../../src/scanner');
const { listTemplates, getTemplate, templateToProfile } = require('../../src/templates');

function makePng(filePath, width = 10, height = 10) {
  const zlib = require('zlib');
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const off = y * (1 + width * 3) + 1 + x * 3;
      raw[off] = 128; raw[off + 1] = 128; raw[off + 2] = 128;
    }
  }
  const compressed = zlib.deflateSync(raw);

  function chunk(type, data) {
    const typeBuf = Buffer.from(type);
    const combined = Buffer.concat([typeBuf, data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcVal = crc32(combined);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crcVal >>> 0);
    return Buffer.concat([len, combined, crc]);
  }

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
    }
    return c ^ 0xFFFFFFFF;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
}

let tmpdir;
beforeEach(() => { tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-test-')); });
afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }); });

describe('detectCurrentFailures', () => {
  it('filters stale files', () => {
    makePng(path.join(tmpdir, 'delta-current1.png'));
    makePng(path.join(tmpdir, 'delta-current2.png'));
    const stale = path.join(tmpdir, 'delta-stale.png');
    makePng(stale);
    fs.utimesSync(stale, new Date(1000000000), new Date(1000000000));

    const result = detectCurrentFailures(tmpdir);
    const names = new Set(result.map(f => path.basename(f)));
    assert.deepEqual(names, new Set(['delta-current1.png', 'delta-current2.png']));
  });

  it('empty directory', () => {
    assert.deepEqual(detectCurrentFailures(tmpdir), []);
  });

  it('non-delta files ignored', () => {
    makePng(path.join(tmpdir, 'not-a-delta.png'));
    makePng(path.join(tmpdir, 'delta-real.png'));
    const result = detectCurrentFailures(tmpdir);
    assert.equal(result.length, 1);
    assert.ok(path.basename(result[0]) === 'delta-real.png');
  });
});

describe('scanProject', () => {
  it('scans module with failures', () => {
    const root = tmpdir;
    const failures = path.join(root, 'app', 'build', 'paparazzi', 'failures');
    const golden = path.join(root, 'app', 'src', 'test', 'snapshots', 'images');
    fs.mkdirSync(failures, { recursive: true });
    fs.mkdirSync(golden, { recursive: true });

    makePng(path.join(golden, 'com.example_MyTest_testFoo.png'));
    fs.utimesSync(path.join(golden, 'com.example_MyTest_testFoo.png'), new Date(1000000000), new Date(1000000000));
    makePng(path.join(failures, 'delta-com.example_MyTest_testFoo.png'));
    makePng(path.join(failures, 'com.example_MyTest_testFoo.png'));

    const result = scanProject(root);
    assert.equal(result.modules.length, 1);
    assert.equal(result.modules[0].name, ':app');
    assert.equal(result.failures.length, 1);

    const f = result.failures[0];
    assert.equal(f.module, ':app');
    assert.equal(f.package, 'com.example');
    assert.equal(f.class_name, 'MyTest');
    assert.equal(f.method, 'testFoo');
    assert.equal(f.has_golden, true);
    assert.equal(f.has_actual, true);
    assert.equal(f.status, 'pending');
  });

  it('no failures returns empty', () => {
    const result = scanProject(tmpdir);
    assert.deepEqual(result.modules, []);
    assert.deepEqual(result.failures, []);
  });

  it('missing golden detected', () => {
    const failures = path.join(tmpdir, 'build', 'paparazzi', 'failures');
    fs.mkdirSync(failures, { recursive: true });
    makePng(path.join(failures, 'delta-com.example_Test_method.png'));
    makePng(path.join(failures, 'com.example_Test_method.png'));

    const result = scanProject(tmpdir);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].has_golden, false);
  });

  it('stale delta filtered when xml newer and passing', () => {
    const root = tmpdir;
    const failures = path.join(root, 'app', 'build', 'paparazzi', 'failures');
    const xmlDir = path.join(root, 'app', 'build', 'test-results', 'testDebugUnitTest');
    fs.mkdirSync(failures, { recursive: true });
    fs.mkdirSync(xmlDir, { recursive: true });

    makePng(path.join(failures, 'delta-com.example_Test_method.png'));
    fs.utimesSync(path.join(failures, 'delta-com.example_Test_method.png'), new Date(1000000000), new Date(1000000000));

    const xml = '<?xml version="1.0"?><testsuite tests="1" failures="0" errors="0" skipped="0" time="1.0"><testcase name="test" classname="Test" time="1.0"/></testsuite>';
    fs.writeFileSync(path.join(xmlDir, 'TEST-Test.xml'), xml);

    const result = scanProject(root);
    assert.equal(result.failures.length, 0);
  });

  it('stale delta filtered when xml newer even with failures', () => {
    const root = tmpdir;
    const failures = path.join(root, 'app', 'build', 'paparazzi', 'failures');
    const xmlDir = path.join(root, 'app', 'build', 'test-results', 'testDebugUnitTest');
    fs.mkdirSync(failures, { recursive: true });
    fs.mkdirSync(xmlDir, { recursive: true });

    // Stale delta from a previous run (very old mtime)
    makePng(path.join(failures, 'delta-com.example_OldTest_oldMethod.png'));
    fs.utimesSync(path.join(failures, 'delta-com.example_OldTest_oldMethod.png'), new Date(1000000000), new Date(1000000000));

    // Fresh delta from current run
    makePng(path.join(failures, 'delta-com.example_NewTest_newMethod.png'));

    // XML says 1 failure (not 0) — stale delta should still be filtered
    const xml = '<?xml version="1.0"?><testsuite tests="2" failures="1" errors="0" skipped="0" time="1.0"><testcase name="newMethod" classname="NewTest" time="0.5"><failure message="differ (by 1.5%)">delta-com.example_NewTest_newMethod.png</failure></testcase><testcase name="oldMethod" classname="OldTest" time="0.5"/></testsuite>';
    fs.writeFileSync(path.join(xmlDir, 'TEST-Tests.xml'), xml);

    const result = scanProject(root);
    // Only the fresh delta should be included, not the stale one
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].filename, 'com.example_NewTest_newMethod.png');
  });

  it('snapshot count included', () => {
    const root = tmpdir;
    const paparazzi = path.join(root, 'app', 'build', 'paparazzi');
    fs.mkdirSync(paparazzi, { recursive: true });
    const golden = path.join(root, 'app', 'src', 'test', 'snapshots', 'images');
    fs.mkdirSync(golden, { recursive: true });
    makePng(path.join(golden, 'test1.png'));
    makePng(path.join(golden, 'test2.png'));
    makePng(path.join(golden, 'test3.png'));

    const result = scanProject(root);
    assert.equal(result.modules.length, 1);
    assert.equal(result.modules[0].snapshot_count, 3);
    assert.equal(result.modules[0].failure_count, 0);
  });
});

describe('profiles', () => {
  it('multi profile scan', () => {
    const root = tmpdir;
    const baselineFail = path.join(root, 'app', 'build', 'paparazzi', 'failures');
    const figmaFail = path.join(root, 'app', 'build', 'paparazzi', 'figma-failures');
    const golden = path.join(root, 'app', 'src', 'test', 'snapshots', 'images');
    fs.mkdirSync(baselineFail, { recursive: true });
    fs.mkdirSync(figmaFail, { recursive: true });
    fs.mkdirSync(golden, { recursive: true });

    makePng(path.join(golden, 'test1.png'));
    fs.utimesSync(path.join(golden, 'test1.png'), new Date(1000000000), new Date(1000000000));

    makePng(path.join(baselineFail, 'delta-test1.png'));
    makePng(path.join(baselineFail, 'test1.png'));
    makePng(path.join(figmaFail, 'delta-figma1.png'));
    makePng(path.join(figmaFail, 'figma1.png'));

    const profiles = [
      { name: 'baseline', failures_dir: 'build/paparazzi/failures', golden_dir: 'src/test/snapshots/images', golden_patterns: ['src/test/snapshots/images/{name}.png'] },
      { name: 'figma', failures_dir: 'build/paparazzi/figma-failures', golden_dir: 'src/test/snapshots/images', golden_patterns: ['src/test/snapshots/images/{name}.png'] },
    ];

    const [moduleData, failures] = processSingleModule(baselineFail, ':app', path.join(root, 'app'), profiles);
    assert.equal(moduleData.failure_count, 2);
    assert.equal(moduleData.profile_counts.baseline, 1);
    assert.equal(moduleData.profile_counts.figma, 1);
    assert.equal(failures[0].profile, 'baseline');
    assert.equal(failures[1].profile, 'figma');
  });

  it('golden pattern fallback', () => {
    const root = tmpdir;
    const failDir = path.join(root, 'mod', 'build', 'paparazzi', 'failures');
    fs.mkdirSync(failDir, { recursive: true });
    const allDir = path.join(root, 'mod', 'assets', 'all');
    const exDir = path.join(root, 'mod', 'assets', 'examples');
    fs.mkdirSync(allDir, { recursive: true });
    fs.mkdirSync(exDir, { recursive: true });

    makePng(path.join(allDir, 'test-a@4x.png'));
    fs.utimesSync(path.join(allDir, 'test-a@4x.png'), new Date(1000000000), new Date(1000000000));
    makePng(path.join(failDir, 'delta-test-a.png'));
    makePng(path.join(failDir, 'test-a.png'));

    makePng(path.join(exDir, 'test-b.png'));
    fs.utimesSync(path.join(exDir, 'test-b.png'), new Date(1000000000), new Date(1000000000));
    makePng(path.join(failDir, 'delta-test-b.png'));
    makePng(path.join(failDir, 'test-b.png'));

    const profiles = [{
      name: 'figma', failures_dir: 'build/paparazzi/failures', golden_dir: 'assets/all',
      golden_patterns: ['assets/all/{name}@4x.png', 'assets/all/{name}.png', 'assets/examples/{name}.png'],
    }];

    const [, failures] = processSingleModule(failDir, ':mod', path.join(root, 'mod'), profiles);
    assert.equal(failures.length, 2);
    const fa = failures.find(f => f.filename === 'test-a.png');
    assert.ok(fa.golden_path.includes('@4x'));
    const fb = failures.find(f => f.filename === 'test-b.png');
    assert.ok(fb.golden_path.includes('examples'));
  });

  it('profile failure tagged', () => {
    const root = tmpdir;
    const failDir = path.join(root, 'build', 'paparazzi', 'failures');
    fs.mkdirSync(failDir, { recursive: true });
    makePng(path.join(failDir, 'delta-test.png'));
    makePng(path.join(failDir, 'test.png'));

    const profiles = [{ name: 'custom', failures_dir: 'build/paparazzi/failures', golden_dir: 'golden', golden_patterns: ['golden/{name}.png'] }];
    const [, failures] = processSingleModule(failDir, ':root', root, profiles);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].profile, 'custom');
  });
});

describe('roborazzi naming', () => {
  it('roborazzi compare suffix', () => {
    const root = tmpdir;
    const failDir = path.join(root, 'mod', 'build', 'outputs', 'roborazzi');
    const goldenDir = path.join(root, 'mod', 'src', 'test', 'goldens', 'roborazzi', 'pkg');
    fs.mkdirSync(failDir, { recursive: true });
    fs.mkdirSync(goldenDir, { recursive: true });

    makePng(path.join(failDir, 'testFoo.1_bar_compare.png'));
    makePng(path.join(failDir, 'testFoo.1_bar_actual.png'));
    makePng(path.join(goldenDir, 'testFoo.1_bar.png'));
    fs.utimesSync(path.join(goldenDir, 'testFoo.1_bar.png'), new Date(1000000000), new Date(1000000000));

    const profiles = [{
      name: 'Roborazzi', failures_dir: 'build/outputs/roborazzi', golden_dir: 'src/test/goldens/roborazzi',
      golden_patterns: ['src/test/goldens/roborazzi/**/{name}.png'],
      delta_prefix: '', delta_suffix: '_compare', actual_suffix: '_actual',
    }];

    const [, failures] = processSingleModule(failDir, ':mod', path.join(root, 'mod'), profiles);
    assert.equal(failures.length, 1);
    const f = failures[0];
    assert.equal(f.filename, 'testFoo.1_bar.png');
    assert.ok(f.delta_path.includes('_compare'));
    assert.ok(f.actual_path.includes('_actual'));
    assert.ok(f.golden_path.includes('goldens'));
  });

  it('delta to base with suffix', () => {
    assert.equal(deltaToBase('testFoo_compare.png', '', '_compare'), 'testFoo.png');
    assert.equal(deltaToBase('delta-testFoo.png', 'delta-', ''), 'testFoo.png');
    assert.equal(deltaToBase('delta-testFoo_diff.png', 'delta-', '_diff'), 'testFoo.png');
  });

  it('glob golden pattern', () => {
    const root = tmpdir;
    const deep = path.join(root, 'src', 'goldens', 'pkg', 'TestClass');
    fs.mkdirSync(deep, { recursive: true });
    makePng(path.join(deep, 'testMethod.png'));

    const result = resolveGolden(root, ['src/goldens/**/{name}.png'], 'testMethod.png');
    assert.ok(result !== null);
    assert.ok(result.includes('TestClass'));
  });
});

describe('templates', () => {
  it('builtin templates exist', () => {
    const tmps = listTemplates();
    const ids = tmps.map(t => t.id);
    assert.ok(ids.includes('paparazzi'));
    assert.ok(ids.includes('roborazzi'));
  });

  it('template to profile', () => {
    const t = getTemplate('roborazzi');
    const p = templateToProfile(t);
    assert.equal(p.name, 'Roborazzi');
    assert.equal(p.delta_suffix, '_compare');
    assert.equal(p.actual_suffix, '_actual');
    assert.equal(p.template_id, 'roborazzi');
  });
});
