const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const projects = require('../../src/projects');
const templates = require('../../src/templates');
const config = require('../../src/config');

let tmpdir;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-config-test-'));
  projects.setDataDir(tmpdir);
});

afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

describe('config export', () => {
  it('creates bundle with current version', () => {
    const bundle = config.createExportBundle([], []);
    assert.equal(bundle.version, config.CURRENT_VERSION);
    assert.ok(bundle.exported);
    assert.deepEqual(bundle.projects, []);
    assert.deepEqual(bundle.templates, []);
  });

  it('includes projects and templates', () => {
    const bundle = config.createExportBundle(
      [{ id: 'p1', name: 'proj', path: '/tmp' }],
      [{ id: 't1', name: 'tmpl', builtin: false }],
    );
    assert.equal(bundle.projects.length, 1);
    assert.equal(bundle.templates.length, 1);
    assert.equal(bundle.projects[0].id, 'p1');
    assert.equal(bundle.templates[0].id, 't1');
  });
});

describe('config migrate', () => {
  it('passes through current version', () => {
    const bundle = { version: 1, projects: [], templates: [] };
    const result = config.migrate(bundle);
    assert.equal(result.version, config.CURRENT_VERSION);
  });

  it('rejects missing version', () => {
    assert.throws(() => config.migrate({}), /missing version/);
    assert.throws(() => config.migrate(null), /missing version/);
  });

  it('rejects future version', () => {
    assert.throws(
      () => config.migrate({ version: 999, projects: [], templates: [] }),
      /newer than supported/,
    );
  });
});

describe('config import/export roundtrip', () => {
  it('export then import restores projects', () => {
    const p = projects.addProject('test-proj', '/tmp/test');
    const exported = config.createExportBundle(projects.listProjects(), []);

    // Reset and reimport
    projects.resetProjects();
    assert.equal(projects.listProjects().length, 0);

    const migrated = config.migrate(exported);
    projects.importProjects(migrated.projects);
    const restored = projects.listProjects();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, p.id);
    assert.equal(restored[0].name, 'test-proj');
  });

  it('export then import restores custom templates', () => {
    templates.createTemplate({ name: 'My Tool', tool: 'custom', failures_dir: 'build/failures' });
    const custom = templates.listTemplates().filter(t => !t.builtin);
    const exported = config.createExportBundle([], custom);

    templates.resetTemplates();
    const customAfterReset = templates.listTemplates().filter(t => !t.builtin);
    assert.equal(customAfterReset.length, 0);

    const migrated = config.migrate(exported);
    templates.importTemplates(migrated.templates);
    const restored = templates.listTemplates().filter(t => !t.builtin);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].name, 'My Tool');
  });

  it('import merges without duplicating', () => {
    const p = projects.addProject('proj-a', '/tmp/a');
    projects.addProject('proj-b', '/tmp/b');
    assert.equal(projects.listProjects().length, 2);

    // Import proj-a again with updated path
    const updated = { ...p, path: '/tmp/a-updated' };
    projects.importProjects([updated]);
    const all = projects.listProjects();
    assert.equal(all.length, 2);
    assert.equal(all.find(x => x.id === p.id).path, '/tmp/a-updated');
  });

  it('import skips builtin templates', () => {
    const before = templates.listTemplates().filter(t => !t.builtin).length;
    templates.importTemplates([{ id: 'paparazzi', name: 'Hacked', builtin: true }]);
    const after = templates.listTemplates().filter(t => !t.builtin).length;
    assert.equal(after, before);
  });
});
