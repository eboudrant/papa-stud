/**
 * JSON file helpers with atomic writes (tmp + rename).
 * Used by projects.js, templates.js, and dataMigration.js.
 */

const fs = require('fs');
const path = require('path');

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    // Corrupt / partially written file (e.g. crash or power loss mid-write).
    // Move it aside so the app can recover instead of 500ing on every route.
    let moved = null;
    try {
      moved = p + '.corrupt-' + Date.now();
      fs.renameSync(p, moved);
    } catch (renameErr) {
      moved = null;
      console.error(`jsonStore: failed to move corrupt file aside: ${p} (${renameErr.message})`);
    }
    console.error(
      `jsonStore: unreadable JSON in ${p} (${err.message})` +
        (moved ? ` — moved to ${moved}` : '')
    );
    return null;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

module.exports = { readJson, writeJson };
