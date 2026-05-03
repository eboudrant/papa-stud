/**
 * Strategy registry.
 * Each strategy handles module discovery, watch dirs, and path resolution
 * for a specific project type.
 */

const gradle = require('./gradle');
const swiftSnapshot = require('./swift-snapshot');

const DEFAULT_STRATEGY = 'gradle';
const strategies = { gradle, 'swift-snapshot': swiftSnapshot };

function getStrategy(name) {
  const key = name || DEFAULT_STRATEGY;
  const s = strategies[key];
  if (!s) throw new Error(`unknown strategy: ${key}`);
  return s;
}

module.exports = { getStrategy, strategies, DEFAULT_STRATEGY };
