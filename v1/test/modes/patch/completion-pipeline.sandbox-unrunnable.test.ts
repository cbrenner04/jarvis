// This test requires real git history + a real upstream remote to exercise discardFixupCommits' force-push path.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discardFixupCommits } from "../../../src/modes/patch/completion-pipeline.ts";
import {
  beginHangFixtureTracking,
  IDLE_HANG_BODY,
  reapActiveHangFixtures,
  trackHangFixtureScript,
} from "../../idle-hang-fixtures.ts";

const HANG_FIXTURE_TRACKING_ID = import.meta.path;

function writeSelectiveGitStallScript(path: string, realGitPath: string, stallArgs: string[]): void {
  const matchExpr = stallArgs.map((arg, i) => `"$${i + 1}" = "${arg}"`).join(" -a ");
  const script = `#!/usr/bin/env bash
set -euo pipefail
if [ $# -ge ${stallArgs.length} ] && [ ${matchExpr} ]; then
${IDLE_HANG_BODY}
fi
exec "${realGitPath}" "$@"
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  trackHangFixtureScript(path);
}

let dir: string;
let bareDir: string;

beforeEach(() => {
  beginHangFixtureTracking(HANG_FIXTURE_TRACKING_ID);
  dir = mkdtempSync(join(tmpdir(), "jarvis-completion-pipeline-test-"));
  bareDir = mkdtempSync(join(tmpdir(), "jarvis-completion-pipeline-bare-"));

  execSync("git init -q", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: dir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -q -b main", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -q -m 'seed'", { cwd: dir, stdio: "pipe" });

  execSync(`git init -q --bare ${bareDir}`, { stdio: "pipe" });
  execSync(`git remote add origin ${bareDir}`, { cwd: dir, stdio: "pipe" });
  execSync("git push -u -q origin main", { cwd: dir, stdio: "pipe" });
});

afterEach(() => {
  reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
  rmSync(dir, { recursive: true, force: true });
  rmSync(bareDir, { recursive: true, force: true });
});

describe("discardFixupCommits", () => {
  test("stalled git push --force-with-lease fails within 15s and warns via fanout", () => {
    // An unresolvable "baseline" makes `git reset --hard` fail (caught, non-fatal), leaving HEAD at the
    // fixup commit so the headSha !== baselineSha check falls through to the force-push call site.
    const unresolvableBaselineSha = "1234567890123456789012345678901234567890";
    writeFileSync(join(dir, "fixup.txt"), "fixup\n");
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'fixup'", { cwd: dir, stdio: "pipe" });

    const binDir = mkdtempSync(join(tmpdir(), "jarvis-completion-pipeline-push-stall-bin-"));
    const originalPath = process.env.PATH;
    const harness: string[] = [];
    try {
      const realGitPath = execSync("command -v git", { encoding: "utf8" }).trim();
      writeSelectiveGitStallScript(join(binDir, "git"), realGitPath, ["push"]);
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const startTime = Date.now();
      discardFixupCommits(dir, unresolvableBaselineSha, (tag, text) => {
        if (tag === "harness") harness.push(text.trim());
      });
      expect(Date.now() - startTime).toBeLessThan(15_000);
      expect(harness.some((line) => line.includes("failed to force-push after discard"))).toBe(true);
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
