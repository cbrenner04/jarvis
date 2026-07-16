import { describe, expect, test } from "bun:test";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { Run } from "../persistence/state-store.ts";
import { cleanupMergedWorkspaces, discoverCleanupCandidates } from "./cleanup.ts";

function harness(overrides: { live?: boolean; durable?: boolean; failRemove?: boolean } = {}) {
  const calls: Array<[string, string[]]> = [];
  const runner: AsyncSubprocessRunner = {
    async runAsync(command, args) {
      calls.push([command, args]);
      if (command === "git" && args[0] === "worktree" && args[1] === "list") {
        return "worktree /repo\nbranch refs/heads/main\n\nworktree /home/worktrees/demo/plan/nested\nbranch refs/heads/plan/nested\n\n";
      }
      if (command === "gh") return "MERGED\n";
      if (overrides.failRemove && command === "git" && args[0] === "worktree" && args[1] === "remove") throw new Error("locked");
      return "";
    },
  };
  return {
    calls,
    deps: {
      runner,
      jarvisRoot: "/home",
      listDurableRuns: (): Run[] => overrides.durable ? [{ project: "demo", worktreePath: "/home/worktrees/demo/plan/nested", status: "in-progress" } as Run] : [],
      listLiveRuns: async (): Promise<DaemonListRunRow[]> => overrides.live ? [{ runId: "live", project: "demo", branch: "plan/nested", status: "in-progress", isLive: true }] : [],
    },
  };
}

const projects = { demo: { root: "/repo" } };

describe("cleanupMergedWorkspaces", () => {
  test("discovers slash-nested merged worktrees and dry runs without mutations", async () => {
    const { deps, calls } = harness();
    const result = await cleanupMergedWorkspaces(projects, deps, true);
    expect(result.candidates).toEqual([{ project: "demo", root: "/repo", path: "/home/worktrees/demo/plan/nested", branch: "plan/nested" }]);
    expect(calls.some(([, args]) => args[1] === "remove" || args[1] === "-D")).toBe(false);
  });

  test("fails closed for durable or daemon-live ownership", async () => {
    expect(await discoverCleanupCandidates(projects, harness({ durable: true }).deps)).toEqual([]);
    expect(await discoverCleanupCandidates(projects, harness({ live: true }).deps)).toEqual([]);
  });

  test("removes only the worktree and local branch, isolating failures", async () => {
    const success = harness();
    const result = await cleanupMergedWorkspaces(projects, success.deps, false);
    expect(result.removed).toHaveLength(1);
    expect(success.calls).toContainEqual(["git", ["worktree", "remove", "--force", "/home/worktrees/demo/plan/nested"]]);
    expect(success.calls).toContainEqual(["git", ["branch", "-D", "plan/nested"]]);
    expect(success.calls.some(([command, args]) => command === "git" && args[0] === "push")).toBe(false);
    const failure = await cleanupMergedWorkspaces(projects, harness({ failRemove: true }).deps, false);
    expect(failure.failures).toHaveLength(1);
  });
});
