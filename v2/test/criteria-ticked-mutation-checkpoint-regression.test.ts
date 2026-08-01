import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyTickedMutationCheckpoints } from "../src/execution/criteria-ticked-mutation-checkpoint-verifier.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const ROWS = [
  {
    sha: "56cfcff8",
    criterion:
      "- [x] `tui-entry.test.tsx` — drives row navigation through the injected input hook; Mutation checkpoint: selection-driven list collapse during the ↑ walk must turn pin RED.",
    checkpointFragment: "selection-driven list collapse",
  },
  {
    sha: "56cfcff8",
    criterion:
      "- [x] `tui-entry.test.tsx` — aligns selectable node ids with left-pane tree rows for the measured terminal size; Mutation checkpoint: currentState lacking measured terminalColumns/terminalRows when selectNextRun/selectPreviousRun call monitorSelectableNodeIds must turn pin RED.",
    checkpointFragment: "terminalColumns/terminalRows",
  },
  {
    sha: "1f75bad7",
    criterion:
      "- [x] `tui-entry.test.tsx` — overflow fixture forward j then k retraces the exact reverse visit order; Mutation checkpoint: reintroducing `ids[0]` fallthrough when `indexOf` is `-1` in selectNextRun/selectPreviousRun turns this pin RED.",
    checkpointFragment: "ids[0]` fallthrough",
  },
] as const;

function buildRegressionWorktree(sha: string): string {
  const worktree = mkdtempSync(join(tmpdir(), `mutation-regression-${sha}-`));
  for (const file of ["package.json", "tsconfig.json", "bunfig.toml"]) {
    const source = join(REPO_ROOT, file);
    if (existsSync(source)) cpSync(source, join(worktree, file));
  }
  cpSync(join(REPO_ROOT, "shared"), join(worktree, "shared"), { recursive: true });
  cpSync(join(REPO_ROOT, "scripts"), join(worktree, "scripts"), { recursive: true });
  const archive = execFileSync("git", ["archive", "--format=tar", sha, "v2/src/tui"], {
    cwd: REPO_ROOT,
    maxBuffer: 50 * 1024 * 1024,
  });
  execFileSync("tar", ["-xf", "-"], { cwd: worktree, input: archive });
  return worktree;
}

describe("criteria-ticked mutation-checkpoint regression", () => {
  const worktrees: string[] = [];

  afterAll(() => {
    for (const dir of worktrees) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const [index, row] of ROWS.entries()) {
    test(`row ${index + 1} at ${row.sha} detects surviving inversion`, async () => {
      const worktree = buildRegressionWorktree(row.sha);
      worktrees.push(worktree);
      const subspec = `## Acceptance criteria\n\n${row.criterion}\n`;

      const result = await verifyTickedMutationCheckpoints(worktree, subspec, {
        // Historical rows document inversions that were hollow at merge time (suite stayed green).
        runScopedTests: async () => true,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.hollow.some(
            (hollow) =>
              hollow.comment.includes(row.checkpointFragment) &&
              hollow.path.endsWith("tui-entry.test.tsx") &&
              hollow.line > 0,
          ),
        ).toBe(true);
      }
    }, 180_000);
  }
});
