/**
 * JSON file helpers with atomic writes (tmp + rename).
 * Used by projects.js, templates.js, and dataMigration.js.
 */

const fs = require('fs');
const path = require('path');

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

module.exports = { readJson, writeJson };
