/**
 * Config export/import with versioning and migration.
 * Current version: 1
 *
 * To add a migration:
 *  1. Bump CURRENT_VERSION
 *  2. Add a migration function to MIGRATIONS (keyed by target version)
 *  3. The migration receives the bundle and returns the migrated bundle
 */

const CURRENT_VERSION = 1;

// Migrations keyed by target version.
// Each fn(bundle) transforms from (version-1) to (version).
const MIGRATIONS = new Map();

function migrate(bundle) {
  if (!bundle || typeof bundle.version !== 'number') {
    throw new Error('invalid config bundle: missing version');
  }
  if (bundle.version > CURRENT_VERSION) {
    throw new Error(`config version ${bundle.version} is newer than supported (${CURRENT_VERSION})`);
  }
  let current = bundle.version;
  while (current < CURRENT_VERSION) {
    const next = current + 1;
    if (!MIGRATIONS.has(next)) throw new Error(`missing migration from version ${current} to ${next}`);
    bundle = MIGRATIONS.get(next)(bundle);
    current = next;
  }
  bundle.version = CURRENT_VERSION;
  return bundle;
}

function createExportBundle(allProjects, customTemplates) {
  return {
    version: CURRENT_VERSION,
    exported: new Date().toISOString(),
    projects: allProjects,
    templates: customTemplates,
  };
}

module.exports = { CURRENT_VERSION, migrate, createExportBundle };
