import { describe, expect, test } from "bun:test";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { AsyncSubprocessError } from "../../../shared/subprocess.ts";
import { type RunStatus, type StateStore, TERMINAL_RUN_STATUSES } from "../persistence/state-store.ts";
import { checkEligibility, type DaemonClient, type DiscoveredWorktree } from "./cleanup.ts";

const HEAD_OID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function eligibilityRunner(
  options: {
    prState?: (branch: string) => "MERGED" | "OPEN";
    headPresent?: boolean;
    onGh?: (args: string[]) => void;
  } = {},
): AsyncSubprocessRunner {
  const prState = options.prState ?? (() => "MERGED" as const);
  const headPresent = options.headPresent ?? true;
  return {
    runAsync: async (cmd, args) => {
      if (cmd === "git" && args[0] === "show-ref") {
        if (!headPresent) throw new AsyncSubprocessError("missing", 1, "", "", undefined);
        if (args.includes("--quiet")) return "";
        return `${HEAD_OID}\n`;
      }
      if (cmd === "gh") {
        options.onGh?.(args);
        if (args[1] === "view") {
          const branch = args[2] ?? "";
          const state = prState(branch);
          return JSON.stringify(
            state === "MERGED"
              ? { state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" }
              : { state: "OPEN", mergedAt: null },
          );
        }
        if (args[1] === "list") {
          const branch = args[3] ?? "";
          const state = prState(branch);
          return JSON.stringify([{ state, headRefOid: HEAD_OID }]);
        }
      }
      throw new Error(`Unexpected: ${cmd} ${args.join(" ")}`);
    },
  };
}

const mergedPrRunner = eligibilityRunner();
const emptyStore: StateStore = { listRuns: () => [] } as unknown as StateStore;

function storeWithRun(status: RunStatus, branch = "test"): StateStore {
  return {
    listRuns: () => [
      {
        id: "run",
        project: "project",
        specRef: "spec",
        createdAt: Date.now(),
        status,
        attemptCount: 1,
        worktreePath: "/path",
        branch,
        specPath: "/spec.md",
        attempts: [],
      },
    ],
  } as unknown as StateStore;
}

describe("checkEligibility: eligibility gate", () => {
  describe("differential merged-vs-open", () => {
    test("returns eligible for merged branch A and ineligible for open branch B with same mock runner", async () => {
      const diffRunner = eligibilityRunner({
        prState: (branch) => (branch === "branch-a" ? "MERGED" : "OPEN"),
      });
      const daemonClient: DaemonClient = async () => [];
      const candidateA: DiscoveredWorktree = { path: "/path/a", branch: "branch-a" };
      const candidateB: DiscoveredWorktree = { path: "/path/b", branch: "branch-b" };

      const resultA = await checkEligibility(candidateA, "project", diffRunner, daemonClient, emptyStore);
      const resultB = await checkEligibility(candidateB, "project", diffRunner, daemonClient, emptyStore);

      expect(resultA.status).toBe("eligible");
      expect(resultB.status).toBe("ineligible");
      if (resultB.status === "ineligible") expect(resultB.reason).toMatch(/merged PR authority changed|OPEN/);
    });

    test("asserts exact gh argv for merged PR head authority lookup", async () => {
      const capturedArgs: string[] = [];
      const captureRunner = eligibilityRunner({
        onGh: (args) => {
          capturedArgs.push(...args);
        },
      });
      const candidate: DiscoveredWorktree = { path: "/path", branch: "test-branch" };
      await checkEligibility(candidate, "project", captureRunner, async () => [], emptyStore);

      expect(capturedArgs).toEqual([
        "pr",
        "list",
        "--head",
        "test-branch",
        "--state",
        "all",
        "--json",
        "state,headRefOid",
      ]);
    });
  });

  describe("differential daemon-reachable-vs-unreachable", () => {
    test("returns eligible when daemon client resolves with no live run, ineligible when daemon throws", async () => {
      const branch = "merged-branch";
      const candidate: DiscoveredWorktree = { path: "/path", branch };
      const result1 = await checkEligibility(candidate, "project", mergedPrRunner, async () => [], emptyStore);
      expect(result1.status).toBe("eligible");

      const result2 = await checkEligibility(
        candidate,
        "project",
        mergedPrRunner,
        async () => {
          throw new Error("Connection refused");
        },
        emptyStore,
      );
      expect(result2.status).toBe("ineligible");
      if (result2.status === "ineligible") expect(result2.reason).toContain("Daemon unreachable");
    });

    test("asserts daemon client is invoked with correct project and branch", async () => {
      let capturedProject = "";
      let capturedBranch = "";
      const candidate: DiscoveredWorktree = { path: "/path", branch: "my-branch" };
      await checkEligibility(
        candidate,
        "my-project",
        mergedPrRunner,
        async (project, branch) => {
          capturedProject = project;
          capturedBranch = branch;
          return [];
        },
        emptyStore,
      );

      expect(capturedProject).toBe("my-project");
      expect(capturedBranch).toBe("my-branch");
    });
  });

  describe("differential durable-run", () => {
    test("returns ineligible for non-terminal run, eligible for terminal run", async () => {
      const branch = "merged-branch";
      const daemonClient: DaemonClient = async () => [];
      const candidate: DiscoveredWorktree = { path: "/path", branch };

      expect(
        (
          await checkEligibility(
            candidate,
            "project",
            mergedPrRunner,
            daemonClient,
            storeWithRun("in-progress", branch),
          )
        ).status,
      ).toBe("ineligible");
      expect(
        (await checkEligibility(candidate, "project", mergedPrRunner, daemonClient, storeWithRun("completed", branch)))
          .status,
      ).toBe("eligible");
    });

    test("returns eligible when store has no run for branch", async () => {
      const candidate: DiscoveredWorktree = { path: "/path", branch: "unknown-branch" };
      expect((await checkEligibility(candidate, "project", mergedPrRunner, async () => [], emptyStore)).status).toBe(
        "eligible",
      );
    });

    test("correctly distinguishes terminal vs non-terminal statuses", async () => {
      const daemonClient: DaemonClient = async () => [];
      const candidate: DiscoveredWorktree = { path: "/path", branch: "test" };

      for (const status of ["in-progress", "paused", "queued", "budget-soft-stopped"] as const) {
        expect(
          (await checkEligibility(candidate, "project", mergedPrRunner, daemonClient, storeWithRun(status))).status,
        ).toBe("ineligible");
      }
      for (const status of TERMINAL_RUN_STATUSES) {
        expect(
          (await checkEligibility(candidate, "project", mergedPrRunner, daemonClient, storeWithRun(status))).status,
        ).toBe("eligible");
      }
      const liveResult = await checkEligibility(
        candidate,
        "project",
        mergedPrRunner,
        async () => [{ isLive: true }],
        storeWithRun("killed"),
      );
      expect(liveResult.status).toBe("ineligible");
      if (liveResult.status === "ineligible") expect(liveResult.reason).toContain("Daemon reports live run");
    });
  });

  describe("fail closed", () => {
    test("returns ineligible if gh command fails", async () => {
      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd) => {
          if (cmd === "git") return `${HEAD_OID}\n`;
          if (cmd === "gh") throw new AsyncSubprocessError("gh: not found", 127, "", "gh: not found", "ENOENT");
          throw new Error(`Unexpected: ${cmd}`);
        },
      };
      const candidate: DiscoveredWorktree = { path: "/path", branch: "test" };
      const result = await checkEligibility(candidate, "project", runner, async () => [], emptyStore);
      expect(result.status).toBe("ineligible");
      if (result.status === "ineligible") expect(result.reason).toContain("merged PR authority changed");
    });

    test("propagates when listRuns throws", async () => {
      const store: StateStore = {
        listRuns: () => {
          throw new Error("Database error");
        },
      } as unknown as StateStore;
      const candidate: DiscoveredWorktree = { path: "/path", branch: "test" };
      try {
        await checkEligibility(candidate, "project", mergedPrRunner, async () => [], store);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(String(err)).toContain("Database error");
      }
    });
  });

  describe("integration: combined eligibility checks", () => {
    test("all checks pass → eligible", async () => {
      const candidate: DiscoveredWorktree = { path: "/path", branch: "test" };
      expect((await checkEligibility(candidate, "project", mergedPrRunner, async () => [], emptyStore)).status).toBe(
        "eligible",
      );
    });

    test("any check fails → ineligible with reason", async () => {
      const runner = eligibilityRunner({ prState: () => "OPEN" });
      const candidate: DiscoveredWorktree = { path: "/path", branch: "test" };
      const result = await checkEligibility(candidate, "project", runner, async () => [], emptyStore);
      expect(result.status).toBe("ineligible");
      if (result.status === "ineligible") expect(result.reason).toContain("merged PR authority changed");
    });

    test("falls back to gh pr view when local head is absent", async () => {
      const captured: string[] = [];
      const runner = eligibilityRunner({
        headPresent: false,
        onGh: (args) => {
          captured.push(args[1] ?? "");
        },
      });
      const candidate: DiscoveredWorktree = { path: "/path", branch: "detached-merge" };
      expect((await checkEligibility(candidate, "project", runner, async () => [], emptyStore)).status).toBe(
        "eligible",
      );
      expect(captured).toContain("view");
    });

    test("daemon client receives correct args", async () => {
      const capturedCalls: Array<[string, string]> = [];
      const candidate: DiscoveredWorktree = { path: "/path", branch: "my-branch" };
      await checkEligibility(
        candidate,
        "my-project",
        mergedPrRunner,
        async (project, branch) => {
          capturedCalls.push([project, branch]);
          return [];
        },
        emptyStore,
      );
      expect(capturedCalls).toEqual([["my-project", "my-branch"]]);
    });
  });
});
