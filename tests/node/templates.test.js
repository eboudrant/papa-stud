const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const templates = require('../../src/templates');

let tmpdir;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-tmpl-test-'));
  templates.setDataDir(tmpdir);
});

afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

describe('createTemplate', () => {
  it('rejects a name whose derived id collides with a built-in template', () => {
    assert.throws(
      () => templates.createTemplate({ name: 'Paparazzi' }),
      /template id "paparazzi" conflicts with a built-in template/
    );
    // Nothing persisted
    const customCount = templates.listTemplates().length - templates.BUILTIN_TEMPLATES.length;
    assert.equal(customCount, 0);
  });

  it('rejects an explicit id that collides with a built-in template', () => {
    assert.throws(
      () => templates.createTemplate({ id: 'roborazzi', name: 'My Tool' }),
      /template id "roborazzi" conflicts with a built-in template/
    );
  });

  it('creates a non-colliding template and getTemplate returns it', () => {
    const t = templates.createTemplate({ name: 'My Tool', failures_dir: 'build/failures' });
    assert.equal(t.id, 'my-tool');
    assert.equal(t.builtin, false);
    const found = templates.getTemplate('my-tool');
    assert.ok(found);
    assert.equal(found.name, 'My Tool');
    assert.equal(found.failures_dir, 'build/failures');
  });

  it('replaces rather than duplicates when the same custom id is created twice', () => {
    templates.createTemplate({ name: 'My Tool', description: 'first' });
    templates.createTemplate({ name: 'My Tool', description: 'second' });
    const customs = templates.listTemplates().filter(t => t.id === 'my-tool');
    assert.equal(customs.length, 1);
    assert.equal(customs[0].description, 'second');
  });
});

describe('deleteTemplate', () => {
  it('deletes a custom template by id', () => {
    templates.createTemplate({ name: 'My Tool' });
    assert.ok(templates.getTemplate('my-tool'));
    assert.equal(templates.deleteTemplate('my-tool'), true);
    assert.equal(templates.getTemplate('my-tool'), null);
  });
});
