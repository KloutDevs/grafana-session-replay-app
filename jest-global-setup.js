// Creates the synthetic sessions the tests read when there are no local recordings in
// tests/fixtures. Time-relative, so they are regenerated on every run.
const { existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

module.exports = async () => {
  if (!existsSync(join(__dirname, 'tests', 'fixtures'))) {
    execFileSync(process.execPath, [join(__dirname, 'scripts', 'make-synthetic.mjs')], { stdio: 'ignore' });
  }
};
