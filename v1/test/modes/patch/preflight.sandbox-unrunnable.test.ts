// Real git subprocess stall regression: readRemoteHeadBranch's `git ls-remote` call
// must not hang the caller past the shared git-subprocess bound.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybeWarnAboutUnmergedPlanBranch } from "../../../src/modes/patch/preflight.ts";
import type { RunIo } from "../../../src/modes/patch/run.ts";
import {
  beginHangFixtureTracking,
  IDLE_HANG_BODY,
  reapActiveHangFixtures,
  trackHangFixtureScript,
} from "../../idle-hang-fixtures.ts";

const HANG_FIXTURE_TRACKING_ID = import.meta.path;

beforeEach(() => {
  beginHangFixtureTracking(HANG_FIXTURE_TRACKING_ID);
}, 30_000);

afterEach(() => {
  reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
}, 30_000);

/** Writes a `git` shim that hangs only when invoked with `stallArgs`, forwarding everything else to the real git. */
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

function setupPlanBranchRepo(specName: string): { dir: string; specPath: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "preflight-plan-branch-"));
  const origin = join(parent, "origin.git");
  const dir = join(parent, "work");
  execSync(`git init --bare ${origin}`, { stdio: "pipe" });
  execSync(`git init ${dir}`, { stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: dir, stdio: "pipe" });
  execSync(`git remote add origin ${origin}`, { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m seed", { cwd: dir, stdio: "pipe" });
  execSync("git branch -M main", { cwd: dir, stdio: "pipe" });
  execSync("git push -u origin main", { cwd: dir, stdio: "pipe" });
  execSync(`git checkout -b plan/${specName}`, { cwd: dir, stdio: "pipe" });
  execSync(`git push -u origin plan/${specName}`, { cwd: dir, stdio: "pipe" });
  execSync("git checkout main", { cwd: dir, stdio: "pipe" });
  const specPath = join(dir, "spec", specName, "index.md");
  return { dir, specPath, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

describe("maybeWarnAboutUnmergedPlanBranch stall bound", () => {
  test("stalled git ls-remote for default branch fails within the shared bound", () => {
    const specName = "feature";
    const { dir, specPath, cleanup } = setupPlanBranchRepo(specName);
    const binDir = mkdtempSync(join(tmpdir(), "preflight-git-stall-bin-"));
    const originalPath = process.env.PATH;
    try {
      const realGitPath = execSync("command -v git", { encoding: "utf8" }).trim();
      writeSelectiveGitStallScript(join(binDir, "git"), realGitPath, ["ls-remote", "--symref", "origin", "HEAD"]);
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      let stderr = "";
      const io: RunIo = { stdout: () => {}, stderr: (s) => (stderr += s) };
      const startTime = Date.now();
      maybeWarnAboutUnmergedPlanBranch({ io, projectRoot: dir, specPath, gitEnabled: true });
      expect(Date.now() - startTime).toBeLessThan(25_000);
      expect(stderr).toBe("");
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
      cleanup();
    }
  }, 60_000);
});
