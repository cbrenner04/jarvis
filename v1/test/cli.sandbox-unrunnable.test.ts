// This test requires real OS exec through the `bin/jarvis1` symlink path and cannot run in sandbox mode.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("bin/jarvis1", () => {
  test("resolves the repo path when invoked through a symlink", () => {
    const binDir = mkdtempSync(join(tmpdir(), "jarvis-bin-"));
    const linkPath = join(binDir, "jarvis1");
    symlinkSync(resolve("bin/jarvis1"), linkPath);

    try {
      const result = Bun.spawnSync([linkPath, "help"], {
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("Usage: jarvis1");
      expect(result.stderr.toString()).toBe("");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
