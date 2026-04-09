'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const composeDir = path.join(__dirname, '..', 'compose-app');
const isWin = process.platform === 'win32';
const cmd = isWin ? 'gradlew.bat' : './gradlew';
const r = spawnSync(cmd, [':composeApp:testDebugUnitTest'], {
  cwd: composeDir,
  stdio: 'inherit',
  shell: isWin,
});
process.exit(r.status === null ? 1 : r.status);
