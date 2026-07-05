// Real git subprocess stalls: exercises the GIT_SUBPROCESS_OPTS kill/timeout path itself, so a
// fake ReviewGitOps (which never spawns) can't stand in — this is the genuine stall-path case.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitReviewPass } from "../../../src/modes/patch/review.ts";
import { beginHangFixtureTracking, reapActiveHangFixtures, writeIdleHangScript } from "../../idle-hang-fixtures.ts";

const HANG_FIXTURE_TRACKING_ID = import.meta.path;

beforeEach(() => {
  beginHangFixtureTracking(HANG_FIXTURE_TRACKING_ID);
}, 20_000);

afterEach(() => {
  reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
}, 20_000);

function setupPatchReviewRepo(): { dir: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "jarvis-patch-review-parent-"));
  const dir = join(parent, "repo");
  const origin = join(parent, "origin.git");
  mkdirSync(dir);
  execSync(`git init --bare ${origin}`);
  execSync("git init -b main", { cwd: dir });
  execSync("git config user.email 'test@example.com'", { cwd: dir });
  execSync("git config user.name 'Test User'", { cwd: dir });
  execSync(`git remote add origin ${origin}`, { cwd: dir });
  writeFileSync(join(dir, "impl.txt"), "seed\n");
  execSync("git add -A", { cwd: dir });
  execSync("git commit -m 'seed'", { cwd: dir });
  execSync("git push -u origin main", { cwd: dir });
  return { dir, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

describe("patch review helpers real git subprocess stalls", () => {
  test("stalled real git subprocess in commitReviewPass fails within 25s with fixture reaped", () => {
    const { dir, cleanup } = setupPatchReviewRepo();
    const binDir = mkdtempSync(join(tmpdir(), "jarvis-review-git-stall-bin-"));
    const originalPath = process.env.PATH;
    try {
      writeFileSync(join(dir, "impl.txt"), "changed\n");
      writeIdleHangScript(join(binDir, "git"));
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const startTime = Date.now();
      expect(() => commitReviewPass(1, "claude", dir)).toThrow();
      expect(Date.now() - startTime).toBeLessThan(25_000);
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
      cleanup();
    }
  }, 35_000);
});
