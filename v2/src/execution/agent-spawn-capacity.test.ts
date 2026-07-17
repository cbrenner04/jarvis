import { describe, expect, it } from "bun:test";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { DaemonClient } from "../commands/cleanup.ts";
import type { StateStore } from "../persistence/state-store.ts";
import {
  type CapacityGuardConfig,
  type CapacityRefusal,
  type CapacityWarning,
  checkAgentSpawnCapacity,
  classifyCapacityTier,
  countDedupWorktrees,
  createPreSpawnGuard,
} from "./agent-spawn-capacity.ts";

const mockDaemonClient: DaemonClient = async () => [];
const mockStore: StateStore = { findRunByProjectBranch: () => null } as unknown as StateStore;

function worktreeListOutput(count: number): string {
  return Array.from({ length: count }, (_, i) => `worktree /path/wt${i + 1}`)
    .map((line) => `${line}\n`)
    .join("");
}

function makeGitRunner(args: {
  commonDir?: string;
  worktreeCount: number;
  onPrune?: () => void;
}): AsyncSubprocessRunner {
  return {
    async runAsync(cmd: string, cmdArgs: string[]) {
      if (cmd === "git" && cmdArgs[0] === "worktree" && cmdArgs[1] === "prune") {
        args.onPrune?.();
        return "";
      }
      if (cmd === "git" && cmdArgs[0] === "rev-parse" && cmdArgs[1] === "--git-common-dir") {
        if (args.commonDir === undefined) throw new Error("git failed");
        return `${args.commonDir}\n`;
      }
      if (cmd === "git" && cmdArgs[0] === "worktree" && cmdArgs[1] === "list") {
        return worktreeListOutput(args.worktreeCount);
      }
      return "";
    },
  };
}

describe("agent-spawn-capacity", () => {
  describe("classifyCapacityTier", () => {
    const config: CapacityGuardConfig = {
      warnThreshold: 5,
      refuseThreshold: 10,
    };

    it("returns ok when count is below warn threshold", () => {
      const result = classifyCapacityTier(3, config);
      expect(result.kind).toBe("ok");
    });

    it("returns warning when count is at or above warn threshold but below refuse", () => {
      const result = classifyCapacityTier(5, config);
      expect(result.kind).toBe("warning");
      expect((result as CapacityWarning).count).toBe(5);
    });

    it("returns refusal when count is at or above refuse threshold", () => {
      const result = classifyCapacityTier(10, config);
      expect(result.kind).toBe("refusal");
      expect((result as CapacityRefusal).count).toBe(10);
    });

    it("returns refusal when count is null (fail closed)", () => {
      const result = classifyCapacityTier(null, config);
      expect(result.kind).toBe("refusal");
      expect((result as CapacityRefusal).count).toBeNull();
    });
  });

  describe("countDedupWorktrees", () => {
    it("returns 0 for empty registry", async () => {
      const count = await countDedupWorktrees({}, makeGitRunner({ commonDir: "/fake/.git", worktreeCount: 0 }));
      expect(count).toBe(0);
    });

    it("returns null when git common-dir fails", async () => {
      const registry: Record<string, ProjectRegistryEntry> = {
        "test-project": { root: "/fake/project" },
      };

      const count = await countDedupWorktrees(registry, makeGitRunner({ worktreeCount: 0 }));
      expect(count).toBeNull();
    });

    it("deduplicates worktrees by common dir", async () => {
      const registry: Record<string, ProjectRegistryEntry> = {
        "project-a": { root: "/shared" },
        "project-b": { root: "/shared" }, // same repo, different alias
      };

      // Should count worktrees only once, even though registry has two aliases
      const count = await countDedupWorktrees(registry, makeGitRunner({ commonDir: "/shared/.git", worktreeCount: 2 }));
      expect(count).toBe(2);
    });
  });

  describe("checkAgentSpawnCapacity", () => {
    const config: CapacityGuardConfig = { warnThreshold: 5, refuseThreshold: 10 };
    const registry: Record<string, ProjectRegistryEntry> = {
      "test-project": { root: "/fake/project" },
    };

    it("refuses when count is at refuse threshold", async () => {
      let pruned = false;
      const result = await checkAgentSpawnCapacity({
        registry,
        runner: makeGitRunner({ commonDir: "/fake/.git", worktreeCount: 10, onPrune: () => (pruned = true) }),
        daemonClient: mockDaemonClient,
        store: mockStore,
        config,
      });

      expect(result.kind).toBe("refusal");
      expect((result as CapacityRefusal).count).toBe(10);
      expect(pruned).toBe(true);
    });

    it("warns when count is in warn band", async () => {
      const result = await checkAgentSpawnCapacity({
        registry,
        runner: makeGitRunner({ commonDir: "/fake/.git", worktreeCount: 7 }),
        daemonClient: mockDaemonClient,
        store: mockStore,
        config,
      });

      expect(result.kind).toBe("warning");
      expect((result as CapacityWarning).count).toBe(7);
    });

    it("returns ok when count is below warn threshold", async () => {
      const result = await checkAgentSpawnCapacity({
        registry,
        runner: makeGitRunner({ commonDir: "/fake/.git", worktreeCount: 2 }),
        daemonClient: mockDaemonClient,
        store: mockStore,
        config,
      });

      expect(result.kind).toBe("ok");
    });
  });

  describe("createPreSpawnGuard", () => {
    const config: CapacityGuardConfig = { warnThreshold: 5, refuseThreshold: 10 };
    const registry: Record<string, ProjectRegistryEntry> = {
      "test-project": { root: "/fake/project" },
    };

    it("returns a guard that checks capacity and reports warning", async () => {
      const guard = createPreSpawnGuard({
        registry,
        runner: makeGitRunner({ commonDir: "/fake/.git", worktreeCount: 6 }),
        daemonClient: mockDaemonClient,
        store: mockStore,
        config,
      });

      const result = await guard.check();
      expect(result.kind).toBe("warning");
      expect((result as CapacityWarning).message).toContain("6");
    });

    it("returns a guard that reports refusal", async () => {
      const guard = createPreSpawnGuard({
        registry,
        runner: makeGitRunner({ commonDir: "/fake/.git", worktreeCount: 11 }),
        daemonClient: mockDaemonClient,
        store: mockStore,
        config,
      });

      const result = await guard.check();
      expect(result.kind).toBe("refusal");
      expect((result as CapacityRefusal).message).toContain("jarvis cleanup");
    });
  });
});
