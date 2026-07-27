import { defaultSpawn } from "./run-v2-tests.ts";

const outcome = await defaultSpawn("bash", ["-c", "echo partial; sleep 120 & exit 0"], { timeout: 300 });
if (!outcome.timedOut) {
  process.exit(2);
}
if (!outcome.stdout.includes("partial")) {
  process.exit(3);
}
process.stdout.write(outcome.stdout);
