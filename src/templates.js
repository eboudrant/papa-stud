/**
 * Profile templates for common screenshot testing tools.
 * Built-in templates for Paparazzi and Roborazzi, plus user-defined custom templates.
 */

const path = require('path');
const { readJson, writeJson } = require('./jsonStore');

let DATA_DIR = path.join(process.cwd(), 'data');

function setDataDir(dir) { DATA_DIR = dir; }

const BUILTIN_TEMPLATES = [
  {
    id: 'paparazzi',
    name: 'Paparazzi',
    tool: 'paparazzi',
    builtin: true,
    description: 'Paparazzi',
    failures_dir: 'build/paparazzi/failures',
    // Both patterns are first-class; a project may hold legacy (AGP <9) and
    // AGP-9 / KMP modules side by side.
    golden_dir: 'src/test/snapshots/images',
    golden_patterns: [
      'src/test/snapshots/images/{name}.png',
      'src/androidHostTest/snapshots/images/{name}.png',
    ],
    delta_prefix: 'delta-',
    delta_suffix: '',
    actual_suffix: '',
  },
  {
    id: 'roborazzi',
    name: 'Roborazzi',
    tool: 'roborazzi',
    builtin: true,
    description: 'Roborazzi',
    failures_dir: 'build/outputs/roborazzi',
    golden_dir: 'src/test/goldens/roborazzi',
    golden_patterns: ['src/test/goldens/roborazzi/**/{name}.png'],
    delta_prefix: '',
    delta_suffix: '_compare',
    actual_suffix: '_actual',
  },
  {
    id: 'compose-screenshot',
    name: 'Compose Screenshot',
    tool: 'compose',
    builtin: true,
    description: 'Google',
    failures_dir: 'build/outputs/screenshotTest-results/preview/debug/rendered',
    golden_dir: 'src/screenshotTestDebug/reference',
    golden_patterns: ['src/screenshotTestDebug/reference/**/{name}.png'],
    delta_prefix: '',
    delta_suffix: '',
    actual_suffix: '',
  },
  {
    id: 'swift-snapshot',
    name: 'swift-snapshot-testing',
    tool: 'swift-snapshot',
    builtin: true,
    beta: true,
    description: 'Point-Free',
    failures_dir: '',
    golden_dir: '__Snapshots__',
    golden_patterns: ['__Snapshots__/**/{name}.png'],
    delta_prefix: '',
    delta_suffix: '',
    actual_suffix: '',
  },
];

function customPath() {
  return path.join(DATA_DIR, 'templates.json');
}

function readCustom() {
  return readJson(customPath()) || [];
}

function writeCustom(templates) {
  writeJson(customPath(), templates);
}

function listTemplates() {
  return [...BUILTIN_TEMPLATES, ...readCustom()];
}

function getTemplate(templateId) {
  return listTemplates().find(t => t.id === templateId) || null;
}

function createTemplate(data) {
  const custom = readCustom();
  const tid = data.id || (data.name || 'custom').toLowerCase().replace(/ /g, '-');
  const filtered = custom.filter(t => t.id !== tid);
  const template = {
    id: tid,
    name: data.name || 'Custom',
    tool: data.tool || 'custom',
    builtin: false,
    description: data.description || '',
    failures_dir: data.failures_dir || '',
    golden_dir: data.golden_dir || '',
    golden_patterns: data.golden_patterns || [],
    delta_prefix: data.delta_prefix !== undefined ? data.delta_prefix : 'delta-',
    delta_suffix: data.delta_suffix || '',
    actual_suffix: data.actual_suffix || '',
  };
  filtered.push(template);
  writeCustom(filtered);
  return template;
}

function deleteTemplate(templateId) {
  if (BUILTIN_TEMPLATES.some(t => t.id === templateId)) return false;
  const custom = readCustom();
  const filtered = custom.filter(t => t.id !== templateId);
  if (filtered.length === custom.length) return false;
  writeCustom(filtered);
  return true;
}

function templateToProfile(template) {
  const profile = {
    name: template.name || '',
    failures_dir: template.failures_dir || '',
    golden_dir: template.golden_dir || '',
    golden_patterns: template.golden_patterns || [],
    delta_prefix: template.delta_prefix !== undefined ? template.delta_prefix : 'delta-',
    delta_suffix: template.delta_suffix || '',
    actual_suffix: template.actual_suffix || '',
    template_id: template.id || '',
  };
  return profile;
}

function importTemplates(incoming) {
  const custom = readCustom();
  const byId = new Map(custom.map(t => [t.id, t]));
  for (const t of incoming) {
    if (BUILTIN_TEMPLATES.some(b => b.id === t.id)) continue;
    byId.set(t.id, { ...t, builtin: false });
  }
  writeCustom([...byId.values()]);
}

function resetTemplates() {
  writeCustom([]);
}

module.exports = {
  BUILTIN_TEMPLATES,
  listTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
  importTemplates,
  resetTemplates,
  templateToProfile,
  setDataDir,
};
