import { defaultSpawn } from "../run-v2-tests.ts";

const outcome = await defaultSpawn(
  process.execPath,
  [
    "-e",
    `const { spawn } = require('node:child_process');
spawn('sleep', ['120'], { detached: true, stdio: ['ignore', process.stdout.fd, process.stderr.fd] }).unref();
setInterval(() => {}, 1e9);`,
  ],
  { timeout: 250 },
);

if (!outcome.timedOut) {
  process.exit(2);
}
