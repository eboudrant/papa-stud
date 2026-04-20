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
const { writeJson } = require('./jsonStore');

const CURRENT_SCHEMA = 2;

const MIGRATIONS = [
  // v1 → v2: add strategy to projects, strip result_source from profiles and templates
  function migrateV1toV2(dataDir) {
    const projectsPath = path.join(dataDir, 'projects.json');
    const templatesPath = path.join(dataDir, 'templates.json');
    const templates = require('./templates');
    templates.setDataDir(dataDir);

    // Migrate projects: add project-level strategy, create profiles if missing, strip result_source
    try {
      const raw = fs.readFileSync(projectsPath, 'utf8');
      const projects = JSON.parse(raw);
      let changed = false;
      for (const p of projects) {
        if (!p.strategy) { p.strategy = 'gradle'; changed = true; }
        if (!p.profiles) {
          const paparazzi = templates.getTemplate('paparazzi');
          p.profiles = [templates.templateToProfile(paparazzi)];
          changed = true;
        }
        for (const pr of p.profiles || []) {
          if ('result_source' in pr) { delete pr.result_source; changed = true; }
          if ('strategy' in pr) { delete pr.strategy; changed = true; }
        }
      }
      if (changed) {
        console.log(`[migration] v1→v2: updated ${projects.length} project(s) in projects.json`);
        writeJson(projectsPath, projects);
      } else {
        console.log(`[migration] v1→v2: projects.json already up to date`);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.log(`[migration] v1→v2: skipping projects.json (${e.message})`);
    }

    // Migrate custom templates: strip result_source and profile-level strategy
    try {
      const raw = fs.readFileSync(templatesPath, 'utf8');
      const tmpls = JSON.parse(raw);
      let changed = false;
      for (const t of tmpls) {
        if ('result_source' in t) { delete t.result_source; changed = true; }
        if ('strategy' in t) { delete t.strategy; changed = true; }
      }
      if (changed) {
        console.log(`[migration] v1→v2: updated ${tmpls.length} template(s) in templates.json`);
        writeJson(templatesPath, tmpls);
      } else {
        console.log(`[migration] v1→v2: templates.json already up to date`);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.log(`[migration] v1→v2: skipping templates.json (${e.message})`);
    }
  },
];

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

  writeJson(metaPath, { schema_version: CURRENT_SCHEMA });
  console.log(`[migration] complete — now at schema v${CURRENT_SCHEMA}`);
}

module.exports = { migrateDataFiles, CURRENT_SCHEMA };
