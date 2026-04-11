/**
 * JUnit XML parsing for Gradle test results.
 * Extracted so the scanner can swap in other result formats (e.g., iOS xctestrun).
 */

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/**
 * Parse all JUnit XML files under build/test-results/ for a Gradle module.
 * Scans all variant subdirectories (testDebugUnitTest, testReleaseUnitTest, etc.).
 * Returns [stats, newestMtime] or [null, 0] if no XML found.
 */
function parseJunitXml(modulePath) {
  const stats = { tests: 0, passed: 0, failed: 0, skipped: 0, errors: 0, time: 0 };
  let found = false;
  let newestMtime = 0;

  for (const [fullPath, parsed] of iterateXmlFiles(modulePath)) {
    found = true;
    stats.tests += parsed.tests;
    stats.failed += parsed.failed;
    stats.skipped += parsed.skipped;
    stats.errors += parsed.errors;
    stats.time += parsed.time;
    const mtime = fs.statSync(fullPath).mtimeMs / 1000;
    if (mtime > newestMtime) newestMtime = mtime;
  }

  if (!found) return [null, 0];
  stats.passed = stats.tests - stats.failed - stats.skipped - stats.errors;
  stats.time = Math.round(stats.time * 100) / 100;
  return [stats, newestMtime];
}

/**
 * Extract diff percentages from JUnit XML failure messages.
 * Paparazzi includes "differ (by X%)" and "delta-{name}.png" in failure text.
 * Returns { filename: percentage }.
 */
function parseDiffPercentages(modulePath) {
  const result = {};
  for (const [fullPath] of iterateXmlFiles(modulePath, { raw: true })) {
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const parsed = xmlParser.parse(content);
      const suite = parsed.testsuite;
      if (!suite) continue;
      const testcases = Array.isArray(suite.testcase) ? suite.testcase : (suite.testcase ? [suite.testcase] : []);
      for (const tc of testcases) {
        const failure = tc.failure;
        if (!failure) continue;
        const msg = typeof failure === 'string' ? failure : (failure['@_message'] || '');
        const pctMatch = msg.match(/differ \(by ([\d.]+)%\)/);
        const deltaMatch = msg.match(/delta-([^\s]+\.png)/);
        if (pctMatch && deltaMatch) {
          const fname = deltaMatch[1].split('/').pop();
          result[fname] = parseFloat(pctMatch[1]);
        }
      }
    } catch {
      // Skip unparseable XML
    }
  }
  return result;
}

/**
 * Iterate over all TEST-*.xml files under build/test-results/.
 * Yields [fullPath, parsedStats] for each valid XML.
 * With { raw: true }, yields [fullPath] without parsing stats.
 */
function* iterateXmlFiles(modulePath, { raw } = {}) {
  const testResultsDir = path.join(modulePath, 'build', 'test-results');
  let variants;
  try {
    variants = fs.readdirSync(testResultsDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);
  } catch { return; }

  for (const variant of variants) {
    const resultsDir = path.join(testResultsDir, variant);
    let xmlFiles;
    try {
      xmlFiles = fs.readdirSync(resultsDir).filter(f => f.startsWith('TEST-') && f.endsWith('.xml'));
    } catch { continue; }
    for (const xmlFile of xmlFiles) {
      const fullPath = path.join(resultsDir, xmlFile);
      if (raw) {
        yield [fullPath];
      } else {
        const parsed = parseSingleXml(fullPath);
        if (parsed) yield [fullPath, parsed];
      }
    }
  }
}

function parseSingleXml(xmlPath) {
  try {
    const content = fs.readFileSync(xmlPath, 'utf8');
    const parsed = xmlParser.parse(content);
    const root = parsed.testsuite;
    if (!root) return null;
    return {
      tests: parseInt(root['@_tests'] || '0'),
      failed: parseInt(root['@_failures'] || '0'),
      skipped: parseInt(root['@_skipped'] || '0'),
      errors: parseInt(root['@_errors'] || '0'),
      time: parseFloat(root['@_time'] || '0'),
    };
  } catch {
    return null;
  }
}

module.exports = { parseJunitXml, parseDiffPercentages };
