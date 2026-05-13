/**
 * Paparazzi source-set conventions before vs after AGP 9 + KMP. Goldens
 * moved from `src/test/snapshots/...` to `src/androidHostTest/snapshots/...`;
 * failure outputs and JUnit paths are unchanged. Centralized so the rewrite
 * rule is in one place and the literals don't drift across scanner / watcher.
 *
 * Lives in its own module to keep `scanner.js` and `strategies/gradle.js`
 * out of a require cycle.
 */

'use strict';

const LEGACY_PAPARAZZI_PREFIX = 'src/test/snapshots/';
const AGP9_PAPARAZZI_PREFIX = 'src/androidHostTest/snapshots/';

function agp9Sibling(s) {
  return s && s.includes(LEGACY_PAPARAZZI_PREFIX)
    ? s.replace(LEGACY_PAPARAZZI_PREFIX, AGP9_PAPARAZZI_PREFIX)
    : null;
}

module.exports = {
  LEGACY_PAPARAZZI_PREFIX,
  AGP9_PAPARAZZI_PREFIX,
  agp9Sibling,
};
