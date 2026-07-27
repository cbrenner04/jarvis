// Real OS process-group semantics: a descendant that survives direct-parent SIGKILL while
// holding inherited stdout/stderr cannot be reproduced with an injected spawn mock.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("defaultSpawn process group timeout", () => {
  test(
    "invoking subprocess exits within bound when a descendant holds inherited pipes past parent exit",
    () => {
      const repoRoot = join(import.meta.dir, "..");
      const child = spawnSync(process.execPath, [join(repoRoot, "scripts/run-v2-tests-spawn-probe.ts")], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stdout).toContain("partial");
    },
    { timeout: 15_000 },
  );
});
