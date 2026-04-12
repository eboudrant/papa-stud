/**
 * Strategy registry.
 * Each strategy handles module discovery, watch dirs, and path resolution
 * for a specific project type.
 */

const gradle = require('./gradle');

const strategies = { gradle };

function getStrategy(name) {
  return strategies[name || 'gradle'] || strategies.gradle;
}

module.exports = { getStrategy, strategies };
