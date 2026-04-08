/**
 * Parse Paparazzi snapshot filenames into structured components.
 *
 * Filename format: {packageName}_{className}_{methodName}[_{snapshotName}].png
 * Example: app.cash.paparazzi.sample_HelloComposeTest_compose.png
 */

function parseFilename(filename) {
  const raw = filename;
  let name = filename;
  if (name.endsWith('.png')) name = name.slice(0, -4);

  const parts = name.split('_');
  if (parts.length < 2) return fallback(raw);

  const packageParts = [];
  let classIdx = null;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.includes('.')) {
      packageParts.push(part);
    } else if (part && part[0] === part[0].toUpperCase() && part[0] !== part[0].toLowerCase()) {
      classIdx = i;
      break;
    } else {
      if (!packageParts.length) {
        packageParts.push(part);
      } else {
        classIdx = i;
        break;
      }
    }
  }

  if (classIdx === null || classIdx >= parts.length - 1) return fallback(raw);

  const pkg = packageParts.length ? packageParts.join('.') : '';
  const className = parts[classIdx];
  const method = parts[classIdx + 1];
  const snapshotName = classIdx + 2 < parts.length ? parts.slice(classIdx + 2).join('_') : null;

  return { package: pkg, class_name: className, method, snapshot_name: snapshotName, raw };
}

function fallback(raw) {
  return { package: '', class_name: '', method: '', snapshot_name: null, raw };
}

module.exports = { parseFilename };
