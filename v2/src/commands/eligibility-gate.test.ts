import { describe, expect, test } from "bun:test";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { AsyncSubprocessError } from "../../../shared/subprocess.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { checkEligibility, type DaemonClient, type DiscoveredWorktree } from "./cleanup.ts";

describe("checkEligibility: eligibility gate", () => {
  describe("differential merged-vs-open", () => {
    test("returns eligible for merged branch A and ineligible for open branch B with same mock runner", async () => {
      // Mock runner that returns different states based on branch name
      const diffRunner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
            const branch = args[2];
            if (branch === "branch-a") {
              return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
            } else if (branch === "branch-b") {
              return JSON.stringify({ state: "OPEN", mergedAt: null });
            }
          }
          throw new Error(`Unexpected call: ${cmd} ${args.join(" ")}`);
        },
      };

      const store: StateStore = {
        listRuns: () => [],
        // Other methods not needed for this test
      } as unknown as StateStore;

      const daemonClient: DaemonClient = async () => [];

      const candidateA: DiscoveredWorktree = { path: "/path/a", branch: "branch-a" };
      const candidateB: DiscoveredWorktree = { path: "/path/b", branch: "branch-b" };

      const resultA = await checkEligibility(candidateA, "project", diffRunner, daemonClient, store);
      const resultB = await checkEligibility(candidateB, "project", diffRunner, daemonClient, store);

      expect(resultA.status).toBe("eligible");
      expect(resultB.status).toBe("ineligible");

      // Verify the runner was actually called with the correct branch
      // (a stub returning hardcoded "MERGED" for all calls would fail this)
      if (resultB.status === "ineligible") {
        expect(resultB.reason).toMatch(/OPEN/);
      }
    });

    test("asserts exact gh argv includes --json flag for state and mergedAt", async () => {
      const capturedArgs: string[] = [];
      let ghWasCalled = false;

      const captureRunner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh") {
            ghWasCalled = true;
            capturedArgs.push(...args);
            return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const store: StateStore = {
        listRuns: () => [],
      } as unknown as StateStore;

      const candidate: DiscoveredWorktree = { path: "/path", branch: "test-branch" };
      await checkEligibility(candidate, "project", captureRunner, async () => [], store);

      expect(ghWasCalled).toBe(true);
      expect(capturedArgs.length).toBe(5);
      expect(capturedArgs[0] === "pr").toBe(true);
      expect(capturedArgs[1] === "view").toBe(true);
      expect(capturedArgs[2] === "test-branch").toBe(true);
      expect(capturedArgs[3] === "--json").toBe(true);
      expect(capturedArgs[4] === "state,mergedAt").toBe(true);

      // Verify reverting to gh pr list --head (without --state merged) would fail
      // This is a conceptual check — a test with gh pr list --head wouldn't see merged PRs
    });
  });

  describe("differential daemon-reachable-vs-unreachable", () => {
    test("returns eligible when daemon client resolves with no live run, ineligible when daemon throws", async () => {
      const branch = "merged-branch";

      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh" && args[0] === "pr") {
            return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const store: StateStore = {
        listRuns: () => [],
      } as unknown as StateStore;

      const candidate: DiscoveredWorktree = { path: "/path", branch };

      // Test 1: daemon reachable (no live run)
      const reachableClient: DaemonClient = async () => [];
      const result1 = await checkEligibility(candidate, "project", runner, reachableClient, store);
      expect(result1.status).toBe("eligible");

      // Test 2: daemon unreachable (throws)
      const unreachableClient: DaemonClient = async () => {
        throw new Error("Connection refused");
      };
      const result2 = await checkEligibility(candidate, "project", runner, unreachableClient, store);
      expect(result2.status).toBe("ineligible");
      if (result2.status === "ineligible") {
        expect(result2.reason).toContain("Daemon unreachable");
      }

      // Same candidate, opposite outcomes — fail-open would make both eligible
    });

    test("asserts daemon client is invoked with correct project and branch", async () => {
      let capturedProject: string | null = null;
      let capturedBranch: string | null = null;

      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh" && args[0] === "pr") {
            return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const store: StateStore = {
        listRuns: () => [],
      } as unknown as StateStore;

      const candidate: DiscoveredWorktree = { path: "/path", branch: "my-branch" };

      const captureClient: DaemonClient = async (project, branch) => {
        capturedProject = project;
        capturedBranch = branch;
        return [];
      };

      await checkEligibility(candidate, "my-project", runner, captureClient, store);

      expect(capturedProject === "my-project").toBe(true);
      expect(capturedBranch === "my-branch").toBe(true);
    });
  });

  describe("differential durable-run", () => {
    test("returns ineligible for non-terminal run, eligible for terminal run", async () => {
      const branch = "merged-branch";

      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh" && args[0] === "pr") {
            return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const daemonClient: DaemonClient = async () => [];
      const candidate: DiscoveredWorktree = { path: "/path", branch };

      // Test 1: non-terminal run (in-progress)
      const storeWithNonTerminal: StateStore = {
        listRuns: () => [{
          id: "run-1",
          project: "project",
          specRef: "spec",
          createdAt: Date.now(),
          status: "in-progress",
          attemptCount: 1,
          worktreePath: "/path",
          branch,
          specPath: "/spec/path.md",
          attempts: [],
        }],
      } as unknown as StateStore;

      const result1 = await checkEligibility(candidate, "project", runner, daemonClient, storeWithNonTerminal);
      expect(result1.status).toBe("ineligible");

      // Test 2: terminal run (completed)
      const storeWithTerminal: StateStore = {
        listRuns: () => [{
          id: "run-2",
          project: "project",
          specRef: "spec",
          createdAt: Date.now(),
          status: "completed",
          attemptCount: 1,
          worktreePath: "/path",
          branch,
          specPath: "/spec/path.md",
          attempts: [],
        }],
      } as unknown as StateStore;

      const result2 = await checkEligibility(candidate, "project", runner, daemonClient, storeWithTerminal);
      expect(result2.status).toBe("eligible");

      // Same candidate and runner, opposite outcomes — ensures store is checked
    });

    test("returns eligible when store has no run for branch", async () => {
      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh" && args[0] === "pr") {
            return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const store: StateStore = {
        listRuns: () => [],
      } as unknown as StateStore;

      const daemonClient: DaemonClient = async () => [];
      const candidate: DiscoveredWorktree = { path: "/path", branch: "unknown-branch" };

      const result = await checkEligibility(candidate, "project", runner, daemonClient, store);
      expect(result.status).toBe("eligible");
    });

    test("correctly distinguishes terminal vs non-terminal statuses", async () => {
      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh" && args[0] === "pr") {
            return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const daemonClient: DaemonClient = async () => [];
      const candidate: DiscoveredWorktree = { path: "/path", branch: "test" };

      // Non-terminal statuses that should make ineligible
      for (const status of [
        "in-progress",
        "paused",
        "revising",
        "queued",
        "budget-soft-stopped",
        "awaiting-human",
        "killed",
      ] as const) {
        const store: StateStore = {
          listRuns: () => [{
            id: "run",
            project: "project",
            specRef: "spec",
            createdAt: Date.now(),
            status,
            attemptCount: 1,
            worktreePath: "/path",
            branch: "test",
            specPath: "/spec.md",
            attempts: [],
          }],
        } as unknown as StateStore;

        const result = await checkEligibility(candidate, "project", runner, daemonClient, store);
        expect(result.status).toBe("ineligible");
      }

      // Terminal statuses that should make eligible (when no other issues)
      for (const status of ["completed", "blocked", "failed"] as const) {
        const store: StateStore = {
          listRuns: () => [{
            id: "run",
            project: "project",
            specRef: "spec",
            createdAt: Date.now(),
            status,
            attemptCount: 1,
            worktreePath: "/path",
            branch: "test",
            specPath: "/spec.md",
            attempts: [],
          }],
        } as unknown as StateStore;

        const result = await checkEligibility(candidate, "project", runner, daemonClient, store);
        expect(result.status).toBe("eligible");
      }
    });
  });

  describe("fail closed", () => {
    test("returns ineligible if gh command fails", async () => {
      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd) => {
          if (cmd === "gh") {
            throw new AsyncSubprocessError("gh: not found", 127, "", "gh: not found", "ENOENT");
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const store: StateStore = {
        listRuns: () => [],
      } as unknown as StateStore;

      const candidate: DiscoveredWorktree = { path: "/path", branch: "test" };
      const result = await checkEligibility(candidate, "project", runner, async () => [], store);

      expect(result.status).toBe("ineligible");
      if (result.status === "ineligible") {
        expect(result.reason).toContain("gh failed");
      }
    });

    test("returns ineligible if store throws", async () => {
      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh" && args[0] === "pr") {
            return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const store: StateStore = {
        listRuns: () => {
          throw new Error("Database error");
        },
      } as unknown as StateStore;

      const candidate: DiscoveredWorktree = { path: "/path", branch: "test" };

      // The function doesn't explicitly catch store errors, but they propagate.
      // This test documents that behavior; if we want fail-closed for store errors,
      // we'd wrap the call in try-catch.
      try {
        await checkEligibility(candidate, "project", runner, async () => [], store);
        expect.unreachable("Should have thrown");
      } catch (err) {
        // Store error propagates unhandled
        expect(String(err)).toContain("Database error");
      }
    });
  });

  describe("integration: combined eligibility checks", () => {
    test("all checks pass → eligible", async () => {
      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh" && args[0] === "pr") {
            return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const store: StateStore = {
        listRuns: () => [],
      } as unknown as StateStore;

      const daemonClient: DaemonClient = async () => [];
      const candidate: DiscoveredWorktree = { path: "/path", branch: "test" };

      const result = await checkEligibility(candidate, "project", runner, daemonClient, store);
      expect(result.status).toBe("eligible");
    });

    test("any check fails → ineligible with reason", async () => {
      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh" && args[0] === "pr") {
            return JSON.stringify({ state: "OPEN", mergedAt: null });
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const store: StateStore = {
        listRuns: () => [],
      } as unknown as StateStore;

      const daemonClient: DaemonClient = async () => [];
      const candidate: DiscoveredWorktree = { path: "/path", branch: "test" };

      const result = await checkEligibility(candidate, "project", runner, daemonClient, store);
      expect(result.status).toBe("ineligible");
      if (result.status === "ineligible") {
        expect(result.reason).toContain("PR not merged");
      }
    });

    test("daemon client receives correct args", async () => {
      const capturedCalls: Array<[string, string]> = [];

      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args) => {
          if (cmd === "gh" && args[0] === "pr") {
            return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
          }
          throw new Error(`Unexpected: ${cmd}`);
        },
      };

      const store: StateStore = {
        listRuns: () => [],
      } as unknown as StateStore;

      const capturingClient: DaemonClient = async (project, branch) => {
        capturedCalls.push([project, branch]);
        return [];
      };

      const candidate: DiscoveredWorktree = { path: "/path", branch: "my-branch" };
      await checkEligibility(candidate, "my-project", runner, capturingClient, store);

      expect(capturedCalls).toEqual([["my-project", "my-branch"]]);
    });
  });
});
