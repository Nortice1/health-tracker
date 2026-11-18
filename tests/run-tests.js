// Every harness runs in its own process. No Google account or credentials needed.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
let failed = 0;
const files = fs.readdirSync(__dirname).filter(f => /^test_.*\.js$/.test(f)).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
  const ok = result.status === 0 && !result.error;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file}`);
  if (!ok) {
    failed++;
    console.error(result.error || result.stdout + result.stderr);
  }
}
console.log(`${files.length - failed}/${files.length} harnesses passed (offline mocks).`);
process.exitCode = failed ? 1 : 0;
