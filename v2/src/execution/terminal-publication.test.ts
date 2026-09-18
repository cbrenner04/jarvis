import { afterEach, describe, expect, it } from "bun:test";
import type { PipelineTerminalAction } from "./pipeline-definition.ts";
import { ReadyGateError } from "./ready-finalize.ts";
import {
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
function ghResolvesOpenDraft(prNumber: number, prUrl: string, baseRef = "main") {
  return async (_cwd: string, args: readonly string[]) => {
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify([{ number: prNumber, baseRefName: baseRef, isDraft: true }]);
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
      return JSON.stringify([{ number: prNumber, baseRefName: baseRef, isDraft: false }]);
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

describe("executeTerminalPublication production ready gate", () => {
  it("runs the real ready gate for a ready action when no runReadyGate seam is injected", async () => {
    const runnerCalls: string[] = [];
    const flipCalls: Array<number | undefined> = [];
    const execute = createExecuteTerminalPublication({
      asyncSubprocessRunner: {
        runAsync: async (cmd, args) => {
          runnerCalls.push(`${cmd} ${args.join(" ")}`);
          return "";
        },
      },
      gh: ghResolvesOpenDraft(42, baseInput.prUrl),
      ghReadyFlip: async (prNumber) => {
        flipCalls.push(prNumber);
      },
    });

    await execute({ ...baseInput, terminalAction: "ready" });

    expect(runnerCalls).toContain("bun run ready");
    expect(flipCalls).toEqual([42]);
  });
});
