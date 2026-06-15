/**
 * Papa Stud.io — Screenshot Failure Reviewer
 * Node.js entry point. Run with: node src/server.js
 */

const path = require('path');
const { createApp } = require('./handler');
const { migrateDataFiles } = require('./dataMigration');

const dataDir = path.join(process.cwd(), 'data');
migrateDataFiles(dataDir);

const port = parseInt(process.env.PORT || '8770', 10);

// Bind to loopback only. Papa Stud is a single-user local tool with no auth or
// rate limiting — the threat model (.claude/rules/dev_workflow.md) assumes no
// remote attacker, which is what justifies dismissing the web-app CodeQL rules
// on /api/images, /api/config/reset, etc. Binding 0.0.0.0 would expose those to
// the LAN and break that assumption. Electron already binds 127.0.0.1.
createApp().listen(port, '127.0.0.1', () => {
  console.log('\n  Papa Stud.io is running!');
  console.log(`    ->  http://localhost:${port}`);
  console.log('    Press Ctrl+C to stop\n');
});
