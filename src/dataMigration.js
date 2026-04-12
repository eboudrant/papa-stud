/**
 * Startup data migration.
 * Runs once before serving requests, upgrading on-disk data files
 * to the current schema version.
 *
 * Schema version is stored in data/meta.json.
 * Each migration transforms from (version) to (version + 1).
 * Pre-migration backups are saved to data/backups/v{N}/ so migrations
 * can be re-tested by restoring the backup and deleting meta.json.
 */

const fs = require('fs');
const path = require('path');

const CURRENT_SCHEMA = 2;

const MIGRATIONS = [
  // v1 → v2: add strategy to profiles and custom templates
  function migrateV1toV2(dataDir) {
    const projectsPath = path.join(dataDir, 'projects.json');
    const templatesPath = path.join(dataDir, 'templates.json');

    // Migrate projects
    try {
      const raw = fs.readFileSync(projectsPath, 'utf8');
      const projects = JSON.parse(raw);
      let changed = false;
      for (const p of projects) {
        if (!p.profiles) {
          p.profiles = [{
            name: 'Paparazzi',
            failures_dir: 'build/paparazzi/failures',
            golden_patterns: ['src/test/snapshots/images/{name}.png'],
            delta_prefix: 'delta-',
            delta_suffix: '',
            actual_suffix: '',
            strategy: 'gradle',
            template_id: 'paparazzi',
          }];
          changed = true;
        }
        for (const pr of p.profiles || []) {
          if (!pr.strategy) { pr.strategy = 'gradle'; changed = true; }
        }
      }
      if (changed) {
        console.log(`[migration] v1→v2: updated ${projects.length} project(s) in projects.json`);
        atomicWrite(projectsPath, projects);
      } else {
        console.log(`[migration] v1→v2: projects.json already up to date`);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.log(`[migration] v1→v2: skipping projects.json (${e.message})`);
    }

    // Migrate custom templates
    try {
      const raw = fs.readFileSync(templatesPath, 'utf8');
      const templates = JSON.parse(raw);
      let changed = false;
      for (const t of templates) {
        if (!t.strategy) { t.strategy = 'gradle'; changed = true; }
      }
      if (changed) {
        console.log(`[migration] v1→v2: updated ${templates.length} template(s) in templates.json`);
        atomicWrite(templatesPath, templates);
      } else {
        console.log(`[migration] v1→v2: templates.json already up to date`);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.log(`[migration] v1→v2: skipping templates.json (${e.message})`);
    }
  },
];

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function backupDataFiles(dataDir, fromVersion) {
  const backupDir = path.join(dataDir, 'backups', `v${fromVersion}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const file of ['projects.json', 'templates.json']) {
    const src = path.join(dataDir, file);
    const dst = path.join(backupDir, file);
    try {
      fs.copyFileSync(src, dst);
      console.log(`[migration] backed up ${file} → backups/v${fromVersion}/${file}`);
    } catch {}
  }
}

function migrateDataFiles(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const metaPath = path.join(dataDir, 'meta.json');

  let version = 1;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    version = meta.schema_version || 1;
  } catch {}

  if (version >= CURRENT_SCHEMA) {
    console.log(`[migration] schema v${version} is current, nothing to do`);
    return;
  }

  console.log(`[migration] upgrading schema v${version} → v${CURRENT_SCHEMA}`);
  backupDataFiles(dataDir, version);

  for (let v = version; v < CURRENT_SCHEMA; v++) {
    const fn = MIGRATIONS[v - 1];
    if (fn) {
      console.log(`[migration] running v${v}→v${v + 1}`);
      fn(dataDir);
    }
  }

  atomicWrite(metaPath, { schema_version: CURRENT_SCHEMA });
  console.log(`[migration] complete — now at schema v${CURRENT_SCHEMA}`);
}

module.exports = { migrateDataFiles, CURRENT_SCHEMA };
