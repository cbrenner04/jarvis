import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { bindHarnessReadyFlipEvidenceLookup } from "./completion-publisher.ts";
import { leasedHarnessFullSuiteGateSpawnCount, liveGateInvocationLeaseCount } from "./gate-invocation-lease.ts";
import type { PipelineTerminalAction } from "./pipeline-definition.ts";
import { ReadyGateError } from "./ready-finalize.ts";
import {
  createDefaultSupersedeGh,
  createExecuteTerminalPublication,
  TerminalPublicationError,
  type TerminalPublicationInput,
} from "./terminal-publication.ts";

const baseInput = {
  worktreePath: "/tmp/worktree",
  branch: "feature-branch",
  baseRef: "main",
  prNumber: 42,
  prUrl: "https://github.com/user/repo/pull/42",
} satisfies Omit<TerminalPublicationInput, "terminalAction">;

function ghCommandError(message: string, stderr: string): Error & { status: number; stderr: string } {
  const error = new Error(message) as Error & { status: number; stderr: string };
  error.status = 1;
  error.stderr = stderr;
  return error;
}

function trackPreservationSeams(closeCalls: string[], deleteCalls: string[]) {
  return {
    ghClose: async (branch: string, worktreePath: string) => {
      closeCalls.push(`${branch}:${worktreePath}`);
    },
    ghDelete: async (branch: string, worktreePath: string) => {
      deleteCalls.push(`${branch}:${worktreePath}`);
    },
  };
}

/** Mocks the raw `gh` command so the pre-flip resolver sees a single open draft PR. */
function ghResolvesOpenDraft(
  prNumber: number,
  prUrl: string,
  baseRef = "main",
  probeState?: "MERGED" | "CLOSED" | "probe_throw",
) {
  return async (_cwd: string, args: readonly string[]) => {
    if (
      probeState !== undefined &&
      args[0] === "pr" &&
      args[1] === "view" &&
      args[2] === String(prNumber) &&
      args[3] === "--json" &&
      args[4] === "state,mergedAt,isCrossRepository"
    ) {
      if (probeState === "probe_throw") {
        throw new Error("gh pr view state probe failed");
      }
      return JSON.stringify({
        state: probeState,
        mergedAt: probeState === "MERGED" ? "2024-01-01T00:00:00Z" : null,
        isCrossRepository: false,
      });
    }
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify([{ number: prNumber, baseRefName: baseRef, isDraft: true, state: "OPEN" }]);
    }
    if (args[0] === "pr" && args[1] === "view") {
      return JSON.stringify({ number: prNumber, url: prUrl, baseRefName: baseRef });
    }
    throw new Error(`unexpected gh args: ${args.join(" ")}`);
  };
}

/** Mocks the raw `gh` command so the pre-flip resolver sees no open PR for the branch/base. */
function ghResolvesNoOpenPr() {
  return async (_cwd: string, args: readonly string[]) => {
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify([]);
    }
    throw new Error(`unexpected gh args: ${args.join(" ")}`);
  };
}

/** Mocks the raw `gh` command so the pre-flip resolver sees an open PR that has left draft state. */
function ghResolvesOpenNonDraft(prNumber: number, baseRef = "main") {
  return async (_cwd: string, args: readonly string[]) => {
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify([{ number: prNumber, baseRefName: baseRef, isDraft: false, state: "OPEN" }]);
    }
    throw new Error(`unexpected gh args: ${args.join(" ")}`);
  };
}

afterEach(() => {});

describe("executeTerminalPublication", () => {
  it("executes each terminal action type once against fake publication", async () => {
    const gateCalls: string[] = [];
    const flipCalls: string[] = [];
    const mergeCalls: string[] = [];

    const execute = createExecuteTerminalPublication({
      runReadyGate: async (worktreePath, baseRef) => {
        gateCalls.push(`${worktreePath}:${baseRef}`);
      },
      gh: ghResolvesOpenDraft(42, "https://github.com/user/repo/pull/42"),
      ghReadyFlip: async (prNumber, worktreePath) => {
        flipCalls.push(`${prNumber}:${worktreePath}`);
      },
      ghMerge: async (branch, worktreePath) => {
        mergeCalls.push(`${branch}:${worktreePath}`);
      },
    });

    const leaveDraft = await execute({ ...baseInput, terminalAction: "leave-draft" });
    expect(leaveDraft).toEqual({ prNumber: 42, prUrl: "https://github.com/user/repo/pull/42" });
    expect(gateCalls).toHaveLength(0);
    expect(flipCalls).toHaveLength(0);
    expect(mergeCalls).toHaveLength(0);

    gateCalls.length = 0;
    flipCalls.length = 0;
    mergeCalls.length = 0;

    const ready = await execute({ ...baseInput, terminalAction: "ready" });
    expect(ready).toEqual({ prNumber: 42, prUrl: "https://github.com/user/repo/pull/42" });
    expect(gateCalls).toEqual(["/tmp/worktree:main"]);
    expect(flipCalls).toEqual(["42:/tmp/worktree"]);
    expect(mergeCalls).toHaveLength(0);

    gateCalls.length = 0;
    flipCalls.length = 0;
    mergeCalls.length = 0;

    const merge = await execute({ ...baseInput, terminalAction: "merge" });
    expect(merge).toEqual({ prNumber: 42, prUrl: "https://github.com/user/repo/pull/42" });
    expect(gateCalls).toEqual(["/tmp/worktree:main"]);
    expect(flipCalls).toEqual(["42:/tmp/worktree"]);
    expect(mergeCalls).toEqual(["feature-branch:/tmp/worktree"]);
  });

  it("does not ready-flip or merge after a red ready gate", async () => {
    let flipCalls = 0;
    let mergeCalls = 0;

    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {
        throw new ReadyGateError("bun run ready", 1, "tests failed\n");
      },
      ghReadyFlip: async () => {
        flipCalls += 1;
      },
      ghMerge: async () => {
        mergeCalls += 1;
      },
    });

    for (const terminalAction of ["ready", "merge"] as const satisfies PipelineTerminalAction[]) {
      await expect(execute({ ...baseInput, terminalAction })).rejects.toBeInstanceOf(TerminalPublicationError);
      expect(flipCalls).toBe(0);
      expect(mergeCalls).toBe(0);
      flipCalls = 0;
      mergeCalls = 0;
    }
  });

  it("retains PR evidence on ready gate failure", async () => {
    const closeCalls: string[] = [];
    const deleteCalls: string[] = [];

    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {
        throw new ReadyGateError("bun run ready", 1, "gate output\n", false, {
          kind: "ready_gate_out_of_scope",
          outsidePaths: ["v2/src/untouched.test.ts"],
        });
      },
      ...trackPreservationSeams(closeCalls, deleteCalls),
    });

    try {
      await execute({ ...baseInput, terminalAction: "ready" });
      throw new Error("expected ready gate failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TerminalPublicationError);
      const publicationError = error as TerminalPublicationError;
      expect(publicationError.terminalAction).toBe("ready");
      expect(publicationError.prNumber).toBe(42);
      expect(publicationError.prUrl).toBe("https://github.com/user/repo/pull/42");
      expect(publicationError.failure.operation).toBe("bun run ready");
      expect(publicationError.failure.exitCode).toBe(1);
      expect(publicationError.failure.stdoutTail).toContain("gate output");
      expect(publicationError.failure.message).toContain("gateFailureKind=ready_gate_out_of_scope");
      expect(publicationError.failure.message).toContain("outsidePaths=v2/src/untouched.test.ts");
    }

    expect(closeCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("keeps short gate output whole and truncates long output to its tail", async () => {
    const runWithOutput = async (output: string): Promise<string | undefined> => {
      const execute = createExecuteTerminalPublication({
        runReadyGate: async () => {
          throw new ReadyGateError("bun run ready", 1, output);
        },
      });
      try {
        await execute({ ...baseInput, terminalAction: "ready" });
        throw new Error("expected ready gate failure");
      } catch (error) {
        expect(error).toBeInstanceOf(TerminalPublicationError);
        return (error as TerminalPublicationError).failure.stdoutTail;
      }
    };

    const short = `head${"s".repeat(4000)}tail`;
    expect(short.length).toBeLessThanOrEqual(4096);
    expect(await runWithOutput(short)).toBe(short);

    const long = `head${"l".repeat(5000)}tail`;
    expect(long.length).toBeGreaterThan(4096);
    const longTail = await runWithOutput(long);
    expect(longTail).toHaveLength(4096);
    expect(longTail).toBe(long.slice(-4096));
    expect(longTail?.startsWith("head")).toBe(false);
  });

  it("retains PR evidence on terminal mutation failure", async () => {
    const closeCalls: string[] = [];
    const deleteCalls: string[] = [];
    const preservation = trackPreservationSeams(closeCalls, deleteCalls);

    const executeReady = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesOpenDraft(42, "https://github.com/user/repo/pull/42"),
      ghReadyFlip: async () => {
        throw ghCommandError("flip failed", "not a draft");
      },
      ...preservation,
    });

    try {
      await executeReady({ ...baseInput, terminalAction: "ready" });
      throw new Error("expected ready flip failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TerminalPublicationError);
      const publicationError = error as TerminalPublicationError;
      expect(publicationError.terminalAction).toBe("ready");
      expect(publicationError.failure.operation).toBe("gh pr ready");
      expect(publicationError.failure.exitCode).toBe(1);
      expect(publicationError.failure.stderrTail).toBe("not a draft");
    }

    const executeMerge = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesOpenDraft(42, "https://github.com/user/repo/pull/42"),
      ghReadyFlip: async () => {},
      ghMerge: async () => {
        throw ghCommandError("merge failed", "merge blocked");
      },
      ...preservation,
    });

    try {
      await executeMerge({ ...baseInput, terminalAction: "merge" });
      throw new Error("expected merge failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TerminalPublicationError);
      const publicationError = error as TerminalPublicationError;
      expect(publicationError.terminalAction).toBe("merge");
      expect(publicationError.failure.operation).toBe("gh pr merge");
      expect(publicationError.failure.exitCode).toBe(1);
      expect(publicationError.failure.stderrTail).toBe("merge blocked");
    }

    expect(closeCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("fails fast for ready and merge without PR evidence", async () => {
    const ghCalls: string[] = [];

    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {
        ghCalls.push("gate");
      },
      ghReadyFlip: async () => {
        ghCalls.push("flip");
      },
      ghMerge: async () => {
        ghCalls.push("merge");
      },
    });

    for (const terminalAction of ["ready", "merge"] as const satisfies PipelineTerminalAction[]) {
      await expect(
        execute({
          worktreePath: baseInput.worktreePath,
          branch: baseInput.branch,
          baseRef: baseInput.baseRef,
          terminalAction,
        }),
      ).rejects.toBeInstanceOf(TerminalPublicationError);
    }

    expect(ghCalls).toHaveLength(0);

    const leaveDraft = await execute({
      worktreePath: baseInput.worktreePath,
      branch: baseInput.branch,
      baseRef: baseInput.baseRef,
      terminalAction: "leave-draft",
    });
    expect(leaveDraft).toEqual({});
    expect(ghCalls).toHaveLength(0);
  });

  it("re-resolves the open draft and flips it ready, ignoring stale persisted PR evidence", async () => {
    const flipCalls: string[] = [];

    // baseInput.prNumber (42) is stale persisted evidence for a since-merged PR; the branch's
    // current open draft is #99 on the same branch/base.
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesOpenDraft(99, "https://github.com/user/repo/pull/99"),
      ghReadyFlip: async (prNumber, worktreePath) => {
        flipCalls.push(`${prNumber}:${worktreePath}`);
      },
    });

    const result = await execute({ ...baseInput, terminalAction: "ready" });

    expect(flipCalls).toEqual(["99:/tmp/worktree"]);
    expect(result).toEqual({ prNumber: 42, prUrl: "https://github.com/user/repo/pull/42" });
  });

  it("refuses without destroying PR evidence when the resolved open PR is not a draft", async () => {
    const closeCalls: string[] = [];
    const deleteCalls: string[] = [];
    const flipCalls: string[] = [];

    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesOpenNonDraft(42),
      ghReadyFlip: async (prNumber, worktreePath) => {
        flipCalls.push(`${prNumber}:${worktreePath}`);
      },
      ...trackPreservationSeams(closeCalls, deleteCalls),
    });

    try {
      await execute({ ...baseInput, terminalAction: "ready" });
      throw new Error("expected open-non-draft refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(TerminalPublicationError);
      const publicationError = error as TerminalPublicationError;
      expect(publicationError.failure.message).toContain("#42");
      expect(publicationError.failure.message).toContain(baseInput.branch);
      expect(publicationError.failure.message).toContain("expected draft");
      expect(publicationError.failure.message).toContain("close/merge");
    }

    expect(flipCalls).toHaveLength(0);
    expect(closeCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("refuses without destroying PR evidence when no open draft PR is found for the branch", async () => {
    const closeCalls: string[] = [];
    const deleteCalls: string[] = [];
    const flipCalls: string[] = [];

    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesNoOpenPr(),
      ghReadyFlip: async (prNumber, worktreePath) => {
        flipCalls.push(`${prNumber}:${worktreePath}`);
      },
      ...trackPreservationSeams(closeCalls, deleteCalls),
    });

    try {
      await execute({ ...baseInput, terminalAction: "ready" });
      throw new Error("expected no-open-draft refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(TerminalPublicationError);
      const publicationError = error as TerminalPublicationError;
      expect(publicationError.failure.message).toContain(baseInput.branch);
      expect(publicationError.failure.message).toContain("No open draft PR found");
    }

    expect(flipCalls).toHaveLength(0);
    expect(closeCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  for (const terminalAction of ["ready", "merge"] as const satisfies PipelineTerminalAction[]) {
    it(`succeeds without gate or flip when probe reports MERGED (${terminalAction})`, async () => {
      const gateCalls: string[] = [];
      const flipCalls: string[] = [];
      const mergeCalls: string[] = [];
      const execute = createExecuteTerminalPublication({
        runReadyGate: async (worktreePath, baseRef) => {
          gateCalls.push(`${worktreePath}:${baseRef}`);
        },
        gh: ghResolvesOpenDraft(baseInput.prNumber, baseInput.prUrl, "main", "MERGED"),
        ghReadyFlip: async (prNumber, worktreePath) => {
          flipCalls.push(`${prNumber}:${worktreePath}`);
        },
        ghMerge: async (branch, worktreePath) => {
          mergeCalls.push(`${branch}:${worktreePath}`);
        },
      });

      const result = await execute({ ...baseInput, terminalAction });
      expect(result).toEqual({ prNumber: baseInput.prNumber, prUrl: baseInput.prUrl });
      expect(gateCalls).toHaveLength(0);
      expect(flipCalls).toHaveLength(0);
      expect(mergeCalls).toHaveLength(0);
    });
  }

  it("fails with pr_closed when probe reports CLOSED", async () => {
    const gateCalls: string[] = [];
    const flipCalls: string[] = [];
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {
        gateCalls.push("gate");
      },
      gh: ghResolvesOpenDraft(baseInput.prNumber, baseInput.prUrl, "main", "CLOSED"),
      ghReadyFlip: async () => {
        flipCalls.push("flip");
      },
    });

    try {
      await execute({ ...baseInput, terminalAction: "ready" });
      throw new Error("expected closed PR failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TerminalPublicationError);
      const publicationError = error as TerminalPublicationError;
      expect(publicationError.failure.cause).toBe("pr_closed");
      expect(publicationError.failure.operation).toBe("gh pr view");
      expect(publicationError.failure.message).toContain("closed and not merged");
    }

    expect(gateCalls).toHaveLength(0);
    expect(flipCalls).toHaveLength(0);
  });

  it("runs ready gate and flip when state probe throws", async () => {
    const gateCalls: string[] = [];
    const flipCalls: string[] = [];
    const execute = createExecuteTerminalPublication({
      runReadyGate: async (worktreePath, baseRef) => {
        gateCalls.push(`${worktreePath}:${baseRef}`);
      },
      gh: ghResolvesOpenDraft(baseInput.prNumber, baseInput.prUrl, "main", "probe_throw"),
      ghReadyFlip: async (prNumber, worktreePath) => {
        flipCalls.push(`${prNumber}:${worktreePath}`);
      },
    });

    const result = await execute({ ...baseInput, terminalAction: "ready" });
    expect(result).toEqual({ prNumber: baseInput.prNumber, prUrl: baseInput.prUrl });
    expect(gateCalls).toEqual(["/tmp/worktree:main"]);
    expect(flipCalls).toEqual(["42:/tmp/worktree"]);
  });

  it("propagates an unexpected resolution error unwrapped, without destroying PR evidence", async () => {
    const closeCalls: string[] = [];
    const deleteCalls: string[] = [];

    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: async () => {
        throw new Error("gh pr list failed: rate limited");
      },
      ...trackPreservationSeams(closeCalls, deleteCalls),
    });

    try {
      await execute({ ...baseInput, terminalAction: "ready" });
      throw new Error("expected resolution error to propagate");
    } catch (error) {
      expect(error).not.toBeInstanceOf(TerminalPublicationError);
      expect((error as Error).message).toBe("gh pr list failed: rate limited");
    }

    expect(closeCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });
});

describe("executeTerminalPublication harness ready-flip evidence", () => {
  let stateDbPath: string;
  let store: StateStore;

  beforeEach(() => {
    stateDbPath = join(trackedMkdtempSync(join(tmpdir(), "terminal-publication-store-")), "state.db");
    store = openStateStore(stateDbPath);
  });

  afterEach(() => {
    setSystemTime();
    store.close();
    removeOrchestrationStore(stateDbPath);
  });

  function seedEntryRun(): string {
    return store.createRun({
      project: "test-project",
      specRef: baseInput.baseRef,
      worktreePath: baseInput.worktreePath,
      branch: baseInput.branch,
      specPath: "spec/implement.md",
    });
  }

  function publicationInput(
    runId: string,
    terminalAction: PipelineTerminalAction,
    options?: { lineage?: boolean },
  ): TerminalPublicationInput & { terminalAction: PipelineTerminalAction } {
    const lookup = options?.lineage === true ? bindHarnessReadyFlipEvidenceLookup(store, runId) : undefined;
    return {
      ...baseInput,
      terminalAction,
      recordHarnessReadyFlipEvidence: (args) => store.recordHarnessReadyFlipEvidence({ runId, ...args }),
      ...(lookup !== undefined ? { findHarnessReadyFlipEvidenceInLineage: lookup } : {}),
    };
  }

  for (const terminalAction of ["ready", "merge"] as const) {
    it(`persists ready-flip evidence after successful ${terminalAction}`, async () => {
      const runId = seedEntryRun();
      const flippedAt = terminalAction === "ready" ? 12_000 : 13_000;
      const execute = createExecuteTerminalPublication({
        runReadyGate: async () => {},
        gh: ghResolvesOpenDraft(42, baseInput.prUrl),
        ghReadyFlip: async () => {},
        ...(terminalAction === "merge" ? { ghMerge: async () => {} } : {}),
      });

      setSystemTime(new Date(flippedAt));
      await execute(publicationInput(runId, terminalAction));

      expect(store.loadRun(runId)?.harnessReadyFlipEvidence).toEqual({
        prNumber: 42,
        branch: baseInput.branch,
        baseRef: baseInput.baseRef,
        flippedAt,
      });
    });
  }

  it("persists resolved PR number, not stale persisted evidence, after re-resolution", async () => {
    const runId = seedEntryRun();
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesOpenDraft(99, "https://github.com/user/repo/pull/99"),
      ghReadyFlip: async () => {},
    });

    setSystemTime(new Date(14_000));
    await execute(publicationInput(runId, "ready"));

    expect(store.loadRun(runId)?.harnessReadyFlipEvidence).toMatchObject({ prNumber: 99, flippedAt: 14_000 });
  });

  it("leaves prior ready-flip evidence unchanged when ghReadyFlip rejects", async () => {
    const runId = seedEntryRun();
    setSystemTime(new Date(9_000));
    store.recordHarnessReadyFlipEvidence({
      runId,
      prNumber: 1,
      branch: baseInput.branch,
      baseRef: baseInput.baseRef,
    });

    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesOpenDraft(42, baseInput.prUrl),
      ghReadyFlip: async () => {
        throw ghCommandError("flip failed", "not a draft");
      },
    });

    setSystemTime(new Date(15_000));
    await expect(execute(publicationInput(runId, "ready"))).rejects.toBeInstanceOf(TerminalPublicationError);

    expect(store.loadRun(runId)?.harnessReadyFlipEvidence).toEqual({
      prNumber: 1,
      branch: baseInput.branch,
      baseRef: baseInput.baseRef,
      flippedAt: 9_000,
    });
  });

  it("accepts a sole open non-draft PR when lineage evidence matches, without calling gh pr ready", async () => {
    const runId = seedEntryRun();
    const prNumber = 42;
    setSystemTime(new Date(8_000));
    store.recordHarnessReadyFlipEvidence({
      runId,
      prNumber,
      branch: baseInput.branch,
      baseRef: baseInput.baseRef,
    });

    const flipCalls: number[] = [];
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesOpenNonDraft(prNumber),
      ghReadyFlip: async (n) => {
        if (n !== undefined) flipCalls.push(n);
      },
    });

    setSystemTime(new Date(16_000));
    const result = await execute(publicationInput(runId, "ready", { lineage: true }));

    expect(flipCalls).toHaveLength(0);
    expect(result).toEqual({ prNumber: baseInput.prNumber, prUrl: baseInput.prUrl });
    expect(store.loadRun(runId)?.harnessReadyFlipEvidence).toEqual({
      prNumber,
      branch: baseInput.branch,
      baseRef: baseInput.baseRef,
      flippedAt: 16_000,
    });
  });

  it("refuses a human-flipped non-draft PR without recording evidence", async () => {
    const runId = seedEntryRun();
    const flipCalls: number[] = [];
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesOpenNonDraft(42),
      ghReadyFlip: async (n) => {
        if (n !== undefined) flipCalls.push(n);
      },
    });

    await expect(
      execute({
        ...baseInput,
        terminalAction: "ready",
        recordHarnessReadyFlipEvidence: (args) => store.recordHarnessReadyFlipEvidence({ runId, ...args }),
        findHarnessReadyFlipEvidenceInLineage: () => false,
      }),
    ).rejects.toMatchObject({
      failure: { operation: "gh pr ready" },
    });

    expect(flipCalls).toHaveLength(0);
    expect(store.loadRun(runId)?.harnessReadyFlipEvidence).toBeNull();
  });

  it("refuses when lineage evidence names a different PR number", async () => {
    const runId = seedEntryRun();
    store.recordHarnessReadyFlipEvidence({
      runId,
      prNumber: 99,
      branch: baseInput.branch,
      baseRef: baseInput.baseRef,
    });

    const flipCalls: number[] = [];
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesOpenNonDraft(42),
      ghReadyFlip: async (n) => {
        if (n !== undefined) flipCalls.push(n);
      },
    });

    await expect(execute(publicationInput(runId, "ready", { lineage: true }))).rejects.toMatchObject({
      failure: { operation: "gh pr ready" },
    });

    expect(flipCalls).toHaveLength(0);
    expect(store.loadRun(runId)?.harnessReadyFlipEvidence?.prNumber).toBe(99);
    expect(store.loadRun(runId)?.harnessReadyFlipEvidence?.flippedAt).toBeDefined();
  });

  it("refuses when lineage evidence branch or base ref mismatches publication", async () => {
    const runId = seedEntryRun();
    store.recordHarnessReadyFlipEvidence({
      runId,
      prNumber: 42,
      branch: "other-branch",
      baseRef: baseInput.baseRef,
    });

    const flipCalls: number[] = [];
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      gh: ghResolvesOpenNonDraft(42),
      ghReadyFlip: async (n) => {
        if (n !== undefined) flipCalls.push(n);
      },
    });

    await expect(execute(publicationInput(runId, "ready", { lineage: true }))).rejects.toMatchObject({
      failure: { operation: "gh pr ready" },
    });

    expect(flipCalls).toHaveLength(0);
  });
});

describe("terminal publication gate slot", () => {
  afterEach(() => {
    expect(liveGateInvocationLeaseCount()).toBe(0);
    expect(leasedHarnessFullSuiteGateSpawnCount()).toBe(0);
  });

  it("acquires and releases the slot lease around the ready gate", async () => {
    let leaseDuringGate = -1;
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {
        leaseDuringGate = liveGateInvocationLeaseCount();
      },
      gh: ghResolvesOpenDraft(42, baseInput.prUrl),
      ghReadyFlip: async () => {},
    });

    await execute({ ...baseInput, terminalAction: "ready" });
    expect(leaseDuringGate).toBe(1);
  });

  it("releases the slot lease when the ready gate fails", async () => {
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {
        expect(liveGateInvocationLeaseCount()).toBe(1);
        throw new ReadyGateError("bun run ready", 1, "failed");
      },
    });

    await expect(execute({ ...baseInput, terminalAction: "ready" })).rejects.toBeInstanceOf(TerminalPublicationError);
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });
});

describe("executeTerminalPublication production ready gate", () => {
  for (const readyCommand of ["make ready", undefined]) {
    it(`runs the real ready gate with cwd, signal, process groups, and readyCommand=${readyCommand ?? "default"}`, async () => {
      const gateCalls: { cmd: string; cwd: string; signal: AbortSignal | undefined }[] = [];
      const recorded: number[] = [];
      const flipCalls: Array<number | undefined> = [];
      const controller = new AbortController();
      const execute = createExecuteTerminalPublication({
        asyncSubprocessRunner: {
          runAsync: async (cmd, args, cwd, options) => {
            if (cmd === "git") return "";
            gateCalls.push({ cmd: `${cmd} ${args.join(" ")}`, cwd, signal: options?.signal });
            options?.processGroup?.onGroupId?.(777);
            return "";
          },
        },
        gh: ghResolvesOpenDraft(42, baseInput.prUrl),
        ghReadyFlip: async (prNumber) => {
          flipCalls.push(prNumber);
        },
      });

      await execute({
        ...baseInput,
        terminalAction: "ready",
        signal: controller.signal,
        verifierProcessGroups: { record: (pgid) => recorded.push(pgid), clear: () => {} },
        ...(readyCommand !== undefined ? { readyCommand } : {}),
      });

      expect(gateCalls).toEqual([
        { cmd: readyCommand ?? "bun run ready", cwd: baseInput.worktreePath, signal: controller.signal },
      ]);
      expect(recorded).toEqual([777]);
      expect(flipCalls).toEqual([42]);
    });
  }
});

describe("createDefaultSupersedeGh", () => {
  it("prState returns gh state when state is a string", async () => {
    const supersede = createDefaultSupersedeGh({
      gh: async (_cwd, args) => {
        expect(args).toEqual(["pr", "view", "7", "--json", "state,mergedAt,isCrossRepository"]);
        return JSON.stringify({ state: "OPEN", mergedAt: null, isCrossRepository: false });
      },
    });
    await expect(supersede.prState("/repo", 7)).resolves.toEqual({ state: "OPEN" });
  });

  it("prState throws when gh state field is not a string", async () => {
    const supersede = createDefaultSupersedeGh({
      gh: async () => JSON.stringify({ state: 1 }),
    });
    await expect(supersede.prState("/repo", 7)).rejects.toThrow("unexpected gh pr view state for 7");
  });
});
