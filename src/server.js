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

createApp().listen(port, '0.0.0.0', () => {
  console.log('\n  Papa Stud.io is running!');
  console.log(`    ->  http://localhost:${port}`);
  console.log('    Press Ctrl+C to stop\n');
});
