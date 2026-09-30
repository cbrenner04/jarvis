import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { IpcClient } from "../ipc/client.ts";
import * as cleanup from "./cleanup.ts";
import {
  buildResetStaleWorkspaceOptions,
  maybeResetStaleWorkspace,
  probeMaybeResetStaleWorkspace,
  STALE_RESET_WORKFLOWS,
  staleResetRunResultToCliExit,
} from "./stale-reset-workspace.ts";

const stubWriteBuild = {
  ok: true as const,
  steps: [
    {
      behavior: "write" as const,
      specPath: "spec/demo/index.md",
      worktree: {
        git: true,
        projectRoot: "/tmp/demo-root",
        projectName: "demo",
        branchName: "lane-branch",
        baseRef: "main",
      },
    },
  ],
};

const stubIo = { stdout: () => {}, stderr: () => {} };
const stubDeps = { jarvisRoot: "/tmp/jarvis-home" } as never;
const stubClient = {} as IpcClient;

afterEach(() => {
  spyOn(cleanup, "resetStaleWorkspace").mockRestore();
});

describe("stale-reset-workspace exports", () => {
  test("maybeResetStaleWorkspace and STALE_RESET_WORKFLOWS are importable", () => {
    expect(typeof maybeResetStaleWorkspace).toBe("function");
    expect(STALE_RESET_WORKFLOWS.has("intent")).toBe(true);
  });
});

describe("staleResetRunResultToCliExit", () => {
  test("maps probe refusal objects to exit code 1", () => {
    expect(staleResetRunResultToCliExit({ refused: true, message: "worktree_claimed: lane held\n" })).toBe(1);
  });

  test("passes through undefined and numeric exit codes", () => {
    expect(staleResetRunResultToCliExit(undefined)).toBeUndefined();
    expect(staleResetRunResultToCliExit(1)).toBe(1);
  });
});

describe("staleResetProbeRefusal probe guard", () => {
  test("probeMaybeResetStaleWorkspace returns structured refusal without stderr when reset is refused", async () => {
    const stderrLines: string[] = [];
    const io = { stdout: () => {}, stderr: (line: string) => stderrLines.push(line) };
    spyOn(cleanup, "resetStaleWorkspace").mockResolvedValue({
      status: "refused",
      reason: "live run still active",
    });

    const result = await probeMaybeResetStaleWorkspace(
      "implement",
      stubWriteBuild as never,
      stubDeps,
      io,
      {} as never,
      stubClient,
    );

    expect(result).toEqual({
      refused: true,
      message: "Error: Cannot re-run incomplete spec: live run still active\n",
    });
    expect(stderrLines).toEqual([]);
  });

  test("maybeResetStaleWorkspace writes refusal to stderr and returns 1 when reset is refused", async () => {
    const stderrLines: string[] = [];
    const io = { stdout: () => {}, stderr: (line: string) => stderrLines.push(line) };
    spyOn(cleanup, "resetStaleWorkspace").mockResolvedValue({
      status: "refused",
      reason: "live run still active",
    });

    const code = await maybeResetStaleWorkspace(
      "implement",
      stubWriteBuild as never,
      stubDeps,
      io,
      {} as never,
      stubClient,
    );

    expect(code).toBe(1);
    expect(stderrLines).toEqual(["Error: Cannot re-run incomplete spec: live run still active\n"]);
  });

  test("probeMaybeResetStaleWorkspace returns worktree_claimed refusal without stderr", async () => {
    const stderrLines: string[] = [];
    const io = { stdout: () => {}, stderr: (line: string) => stderrLines.push(line) };
    spyOn(cleanup, "resetStaleWorkspace").mockResolvedValue({
      status: "refused",
      code: "worktree_claimed",
      message: "lane held by run abc",
    });

    const result = await probeMaybeResetStaleWorkspace(
      "implement",
      stubWriteBuild as never,
      stubDeps,
      io,
      {} as never,
      stubClient,
    );

    expect(result).toEqual({
      refused: true,
      message: "worktree_claimed: lane held by run abc\n",
    });
    expect(stderrLines).toEqual([]);
  });

  test("maybeResetStaleWorkspace writes worktree_claimed to stderr and returns 1", async () => {
    const stderrLines: string[] = [];
    const io = { stdout: () => {}, stderr: (line: string) => stderrLines.push(line) };
    spyOn(cleanup, "resetStaleWorkspace").mockResolvedValue({
      status: "refused",
      code: "worktree_claimed",
      message: "lane held by run abc",
    });

    const code = await maybeResetStaleWorkspace(
      "implement",
      stubWriteBuild as never,
      stubDeps,
      io,
      {} as never,
      stubClient,
    );

    expect(code).toBe(1);
    expect(stderrLines).toEqual(["worktree_claimed: lane held by run abc\n"]);
  });

  test("probeMaybeResetStaleWorkspace returns structured refusal when reset throws", async () => {
    const stderrLines: string[] = [];
    const io = { stdout: () => {}, stderr: (line: string) => stderrLines.push(line) };
    spyOn(cleanup, "resetStaleWorkspace").mockRejectedValue(new Error("disk full"));

    const result = await probeMaybeResetStaleWorkspace(
      "implement",
      stubWriteBuild as never,
      stubDeps,
      io,
      {} as never,
      stubClient,
    );

    expect(result).toEqual({
      refused: true,
      message: "Error: Stale workspace reset failed: disk full\n",
    });
    expect(stderrLines).toEqual([]);
  });

  test("maybeResetStaleWorkspace writes throw to stderr and returns 1", async () => {
    const stderrLines: string[] = [];
    const io = { stdout: () => {}, stderr: (line: string) => stderrLines.push(line) };
    spyOn(cleanup, "resetStaleWorkspace").mockRejectedValue(new Error("disk full"));

    const code = await maybeResetStaleWorkspace(
      "implement",
      stubWriteBuild as never,
      stubDeps,
      io,
      {} as never,
      stubClient,
    );

    expect(code).toBe(1);
    expect(stderrLines).toEqual(["Error: Stale workspace reset failed: disk full\n"]);
  });
});

describe("runStaleResetForWorkflow probe flag", () => {
  test("probeMaybeResetStaleWorkspace passes gatesOnly and skipWorktreeClaimGate to resetStaleWorkspace", async () => {
    const capturedOptions: cleanup.ResetStaleWorkspaceOptions[] = [];
    spyOn(cleanup, "resetStaleWorkspace").mockImplementation(async (_p, _b, _r, _j, _run, _d, _io, options) => {
      capturedOptions.push(options ?? {});
      return { status: "no-op" };
    });

    await probeMaybeResetStaleWorkspace(
      "implement",
      stubWriteBuild as never,
      stubDeps,
      stubIo,
      {} as never,
      stubClient,
    );

    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0]?.gatesOnly).toBe(true);
    expect(capturedOptions[0]?.skipWorktreeClaimGate).toBe(true);
  });

  test("maybeResetStaleWorkspace omits probe-only reset flags", async () => {
    const capturedOptions: cleanup.ResetStaleWorkspaceOptions[] = [];
    spyOn(cleanup, "resetStaleWorkspace").mockImplementation(async (_p, _b, _r, _j, _run, _d, _io, options) => {
      capturedOptions.push(options ?? {});
      return { status: "no-op" };
    });

    await maybeResetStaleWorkspace("implement", stubWriteBuild as never, stubDeps, stubIo, {} as never, stubClient);

    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0]?.gatesOnly).toBeUndefined();
    expect(capturedOptions[0]?.skipWorktreeClaimGate).toBeUndefined();
  });
});

describe("resetDespiteDirty threads to skipDirtyWorktreeGate", () => {
  for (const resetDespiteDirty of [true, false]) {
    test(`resetDespiteDirty: ${resetDespiteDirty}`, async () => {
      const captured: cleanup.ResetStaleWorkspaceOptions[] = [];
      spyOn(cleanup, "resetStaleWorkspace").mockImplementation(async (_p, _b, _r, _j, _run, _d, _io, options) => {
        captured.push(options ?? {});
        return { status: "no-op" };
      });

      await maybeResetStaleWorkspace(
        "implement",
        stubWriteBuild as never,
        stubDeps,
        stubIo,
        { resetDespiteDirty } as never,
        stubClient,
      );

      expect(captured[0]?.skipDirtyWorktreeGate).toBe(resetDespiteDirty);
    });
  }
});

describe("resetDespiteLandedCriteria threads to skipLandedCriteriaGate", () => {
  for (const resetDespiteLandedCriteria of [true, false]) {
    test(`resetDespiteLandedCriteria: ${resetDespiteLandedCriteria}`, async () => {
      const captured: cleanup.ResetStaleWorkspaceOptions[] = [];
      spyOn(cleanup, "resetStaleWorkspace").mockImplementation(async (_p, _b, _r, _j, _run, _d, _io, options) => {
        captured.push(options ?? {});
        return { status: "no-op" };
      });

      await maybeResetStaleWorkspace(
        "implement",
        stubWriteBuild as never,
        stubDeps,
        stubIo,
        { resetDespiteLandedCriteria } as never,
        stubClient,
      );

      expect(captured[0]?.skipLandedCriteriaGate).toBe(resetDespiteLandedCriteria);
    });
  }
});

describe("buildResetStaleWorkspaceOptions: the real plan step shape", () => {
  /**
   * `buildPlanWorkflowSteps` names a freshly-timestamped durable spec directory
   * (`${timestamp}-${ready.name}`) on every invocation, so on a re-dispatch the `specPath` it hands
   * here refers to a directory that exists in neither tree. The CLI stale-reset cases all substitute
   * an implement fixture whose `specPath` is a stable `index.md`, which is a different shape: this
   * pins the plan one so a regression cannot hide behind that substitution.
   */
  function planWriteStep(specPath: string) {
    return { behavior: "write" as const, specPath };
  }

  test("threads a plan lane's timestamped specPath through unchanged", () => {
    const specPath = "spec/20260911T015530Z-improve-api";
    const options = buildResetStaleWorkspaceOptions({
      skipDirtyWorktreeGate: false,
      skipLandedCriteriaGate: false,
      baseRef: "main",
      writeStep: planWriteStep(specPath) as never,
      parsed: { disposableLane: true },
    });

    expect(options.specPath).toBe(specPath);
    expect(options.disposableLane).toBe(true);
    expect(options.baseRef).toBe("main");
  });

  test("omits disposableLane unless the classification set it", () => {
    // `disposableLane` is only ever true for a confirmed never-landed lane; anything else must leave
    // the key absent so the descendant and landed-criteria gates run.
    const options = buildResetStaleWorkspaceOptions({
      skipDirtyWorktreeGate: false,
      skipLandedCriteriaGate: false,
      baseRef: "main",
      writeStep: planWriteStep("spec/20260911T015530Z-improve-api") as never,
      parsed: {},
    });

    expect("disposableLane" in options).toBe(false);
  });

  test("threads resetDespiteContinuable only when the flag is true", () => {
    const base = {
      skipDirtyWorktreeGate: false,
      skipLandedCriteriaGate: false,
      baseRef: "main",
      writeStep: planWriteStep("spec/20260911T015530Z-improve-api") as never,
    };

    const withFlag = buildResetStaleWorkspaceOptions({ ...base, parsed: { resetDespiteContinuable: true } });
    const withoutFlag = buildResetStaleWorkspaceOptions({ ...base, parsed: {} });
    const falseFlag = buildResetStaleWorkspaceOptions({ ...base, parsed: { resetDespiteContinuable: false } });

    expect(withFlag.resetDespiteContinuable).toBe(true);
    expect("resetDespiteContinuable" in withoutFlag).toBe(false);
    expect("resetDespiteContinuable" in falseFlag).toBe(false);
  });

  test("drops specPath for an external plan spec, which has no in-repo criteria to compare", () => {
    const options = buildResetStaleWorkspaceOptions({
      skipDirtyWorktreeGate: false,
      skipLandedCriteriaGate: false,
      baseRef: "main",
      writeStep: { behavior: "write", specPath: "plans/improve-api", externalPlanSpec: true } as never,
      parsed: { disposableLane: true },
    });

    expect("specPath" in options).toBe(false);
    expect(options.disposableLane).toBe(true);
  });
});
