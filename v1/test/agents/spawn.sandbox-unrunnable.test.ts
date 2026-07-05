// Requires real OS process spawning to verify process-group reaping of an
// in-group descendant: this depends on actual kernel process-group semantics
// (spawning with detached: true, then SIGKILL-ing the negative pgid) and
// cannot be reproduced with an injected spawn mock.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../src/agents/spawn.ts";

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-spawn-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-spawn-cwd-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("runAgent process group reaping", () => {
  test(
    "normal close with in-group descendant reaped",
    async () => {
      const bin = join(dir, "agent");
      const pidFile = join(dir, "descendant.pid");
      const script = `#!/usr/bin/env bash
# Spawn a background sleep in the same process group
sleep 120 &
# Record the PID before exiting
echo $! > "${pidFile}"
exit 0
`;
      writeFileSync(bin, script);
      chmodSync(bin, 0o755);

      const result = await runAgent(
        {
          name: "claude",
          binary: bin,
          cwd: realpathSync(cwd),
          buildArgv: () => [],
          stdio: ["ignore", "pipe", "pipe"],
          streamErrorPrefix: "test:",
        },
        "test",
        { cwd },
      );

      expect(result.kind).toBe("ok");

      // Poll for descendant death with bounded retries.
      const pidStr = readFileSync(pidFile, "utf8").trim();
      const pid = parseInt(pidStr, 10);
      expect(pid).toBeGreaterThan(0);

      let descendantDead = false;
      for (let i = 0; i < 20; i++) {
        try {
          // Sending signal 0 checks if process exists without killing it.
          process.kill(pid, 0);
          // Process still exists; wait and retry.
          await new Promise((r) => setTimeout(r, 100));
        } catch (err: unknown) {
          // Process does not exist; reap succeeded.
          if (err instanceof Error && err.message.includes("ESRCH")) {
            descendantDead = true;
            break;
          }
          throw err;
        }
      }
      expect(descendantDead).toBe(true);
    },
    { timeout: 10000 },
  );
});
