import { afterEach, describe, expect, it } from "bun:test";
import type { PipelineTerminalAction } from "./pipeline-definition.ts";
import { ReadyGateError } from "./ready-finalize.ts";
import {
  createExecuteTerminalPublication,
  setInvertFailurePreservationGuardForTest,
  setInvertLeaveDraftNoMutationGuardForTest,
  setInvertRedGateBeforeFlipGuardForTest,
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

afterEach(() => {
  setInvertLeaveDraftNoMutationGuardForTest(false);
  setInvertRedGateBeforeFlipGuardForTest(false);
  setInvertFailurePreservationGuardForTest(false);
});

describe("executeTerminalPublication", () => {
  it("executes each terminal action type once against fake publication", async () => {
    const gateCalls: string[] = [];
    const flipCalls: string[] = [];
    const mergeCalls: string[] = [];

    const execute = createExecuteTerminalPublication({
      runReadyGate: async (worktreePath, baseRef) => {
        gateCalls.push(`${worktreePath}:${baseRef}`);
      },
      ghReadyFlip: async (branch, worktreePath) => {
        flipCalls.push(`${branch}:${worktreePath}`);
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
    expect(flipCalls).toEqual(["feature-branch:/tmp/worktree"]);
    expect(mergeCalls).toHaveLength(0);

    gateCalls.length = 0;
    flipCalls.length = 0;
    mergeCalls.length = 0;

    const merge = await execute({ ...baseInput, terminalAction: "merge" });
    expect(merge).toEqual({ prNumber: 42, prUrl: "https://github.com/user/repo/pull/42" });
    expect(gateCalls).toEqual(["/tmp/worktree:main"]);
    expect(flipCalls).toEqual(["feature-branch:/tmp/worktree"]);
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

  it("retains PR evidence on terminal mutation failure", async () => {
    const closeCalls: string[] = [];
    const deleteCalls: string[] = [];
    const preservation = trackPreservationSeams(closeCalls, deleteCalls);

    const executeReady = createExecuteTerminalPublication({
      runReadyGate: async () => {},
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
});

describe("terminal publication guard inversion", () => {
  it("fails when leave-draft no-mutation guard is inverted", async () => {
    setInvertLeaveDraftNoMutationGuardForTest(true);

    const flipCalls: string[] = [];
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {},
      ghReadyFlip: async (branch, worktreePath) => {
        flipCalls.push(`${branch}:${worktreePath}`);
      },
    });

    await execute({ ...baseInput, terminalAction: "leave-draft" });
    expect(flipCalls).toEqual(["feature-branch:/tmp/worktree"]);
  });

  it("fails when red-gate-before-flip guard is inverted", async () => {
    setInvertRedGateBeforeFlipGuardForTest(true);

    const flipCalls: string[] = [];
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {
        throw new ReadyGateError("bun run ready", 1, "red\n");
      },
      ghReadyFlip: async () => {
        flipCalls.push("flip");
      },
    });

    await execute({ ...baseInput, terminalAction: "ready" });
    expect(flipCalls).toEqual(["flip"]);
  });

  it("fails when failure-preservation guard is inverted", async () => {
    setInvertFailurePreservationGuardForTest(true);

    const closeCalls: string[] = [];
    const deleteCalls: string[] = [];
    const execute = createExecuteTerminalPublication({
      runReadyGate: async () => {
        throw new ReadyGateError("bun run ready", 1, "red\n");
      },
      ...trackPreservationSeams(closeCalls, deleteCalls),
    });

    await expect(execute({ ...baseInput, terminalAction: "ready" })).rejects.toBeInstanceOf(TerminalPublicationError);
    expect(closeCalls).toEqual(["feature-branch:/tmp/worktree"]);
    expect(deleteCalls).toEqual(["feature-branch:/tmp/worktree"]);
  });
});
