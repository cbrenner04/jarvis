import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import type { ExternalWorktree, WithExternalWorktreeResult } from "./external-worktree.ts";
import { openStateStore, type StateStore } from "./state-store.ts";
import { simulatedBindings } from "./testing/bindings.ts";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0, roots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createFakeWithExternalWorktree(jarvisRoot: string) {
  return async function fakeWithExternalWorktree<T>(
    args: { projectName: string; branchName: string; jarvisRoot?: string },
    run: (worktree: ExternalWorktree) => Promise<T> | T,
  ): Promise<WithExternalWorktreeResult<T>> {
    const effectiveJarvisRoot = args.jarvisRoot ?? jarvisRoot;
    const worktreePath = join(effectiveJarvisRoot, "worktrees", args.projectName, args.branchName);
    mkdirSync(worktreePath, { recursive: true });
    if (!existsSync(join(worktreePath, "spec.md"))) {
      writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
    }
    const value = await run({ path: worktreePath, reused: existsSync(join(worktreePath, ".reused")) });
    mkdirSync(join(worktreePath, ".."), { recursive: true });
    writeFileSync(join(worktreePath, ".reused"), "true\n", "utf8");
    return {
      worktree: { path: worktreePath, reused: existsSync(join(worktreePath, ".reused")) },
      lock: { kind: "acquired" },
      value,
    };
  };
}

function setupRepo(): { jarvisRoot: string; stateDbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-loop-"));
  roots.push(root);
  const jarvisRoot = join(root, "jarvis-home");
  const stateDbPath = join(jarvisRoot, "state", "v2.sqlite");
  return { jarvisRoot, stateDbPath };
}

async function runLoop(args: {
  jarvisRoot: string;
  stateDbPath: string;
  bindings: readonly InvocationBinding[];
  maxIterations?: number;
  artifactPath?: string;
  signal?: AbortSignal;
  branchName?: string;
  baseRef?: string;
  specPath?: string;
  store?: StateStore;
}) {
  const store = args.store ?? openStateStore(args.stateDbPath);
  const loopInput: WriteLoopInput = {
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: args.branchName ?? "write-run",
      baseRef: args.baseRef ?? "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: args.specPath ?? "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: args.artifactPath ?? "proof.txt",
    bindings: args.bindings,
    stateStore: store,
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
  };
  if (args.maxIterations !== undefined) {
    loopInput.maxIterations = args.maxIterations;
  }
  if (args.signal !== undefined) {
    loopInput.signal = args.signal;
  }
  try {
    return await executeWriteLoop(loopInput);
  } finally {
    store.close();
  }
}

function loadRunOnce(stateDbPath: string, runId: string) {
  const store = openStateStore(stateDbPath);
  try {
    return store.loadRun(runId);
  } finally {
    store.close();
  }
}

/** Wrap a store so the first completion boundary fails mid-transaction. */
function crashOnceMidBoundary(inner: StateStore): StateStore {
  let crashed = false;
  return {
    createRun: (args) => inner.createRun(args),
    loadRun: (runId) => inner.loadRun(runId),
    findRunByProjectBranch: (args) => inner.findRunByProjectBranch(args),
    recordAttemptStart: (runId) => inner.recordAttemptStart(runId),
    setRunStatus: (runId, status) => inner.setRunStatus(runId, status),
    close: () => inner.close(),
    commitCompletionBoundary: (args) => {
      if (crashed) return inner.commitCompletionBoundary(args);
      crashed = true;
      inner.commitCompletionBoundary({
        ...args,
        beforeRunUpdate: () => {
          throw new Error("crash mid-boundary");
        },
      });
    },
  };
}

/** Bindings that report `progress` n times, then write the artifact and report `done`. */
function progressThenDone(n: number): InvocationBinding[] {
  let calls = 0;
  return [
    {
      id: "agent",
      invoke: async ({ cwd }) => {
        calls += 1;
        if (calls <= n) return { kind: "ok", stdout: "progress", stderr: "" };
        writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" };
      },
    },
  ];
}

describe("write loop", () => {
  test("calls executeWrite repeatedly until terminal", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: progressThenDone(2) });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(3);
    expect(result.resumable).toBe(false);
  });

  test("progress loops again and artifact contract not checked mid-loop", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 3,
    });

    // Progress doesn't check contract, so we loop until budget exhausted
    expect(result.kind).toBe("budget-exhausted");
    expect(result.iterationsConsumed).toBe(3);
  });

  test("done with passing artifact contract ends loop successfully", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);
  });

  test("no-work with passing artifact contract ends loop successfully", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["no-work"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);
    expect(loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.outcomeKind).toBe("no-work");
  });

  test("done/no-work with failing contract appends blocker and stops", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: false }),
    });

    expect(result.kind).toBe("contract_miss");
    expect(result.iterationsConsumed).toBe(1);

    const spec = readFileSync(join(jarvisRoot, "worktrees", "demo", "write-run", "spec.md"), "utf8");
    expect(spec).toContain("## Blocker");
    expect(spec).toContain("artifact.exists");
  });

  test("blocked stops immediately with distinct outcome", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: simulatedBindings(["blocked"]) });

    expect(result.kind).toBe("blocked");
    expect(result.iterationsConsumed).toBe(1);
    expect(result.resumable).toBe(false);
  });

  test("budget exhausted while progress yields soft-stop outcome", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 2,
    });

    expect(result.kind).toBe("budget-exhausted");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);
  });

  test("invocation_failure is terminal", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["quota", "quota"]),
    });

    expect(result.kind).toBe("invocation_failure");
    expect(result.resumable).toBe(false);
  });

  test("max iterations per-invocation with default constant", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: simulatedBindings(["progress"]) });

    expect(result.iterationsConsumed).toBe(10); // Default max
    expect(result.kind).toBe("budget-exhausted");
  });

  test("cancellation propagates via AbortSignal", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();
    const controller = new AbortController();
    let calls = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "track",
        invoke: async () => {
          calls += 1;
          if (calls > 1) controller.abort();
          return { kind: "ok", stdout: "progress", stderr: "" };
        },
      },
    ];

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings, signal: controller.signal });

    expect(result.kind).toBe("progress");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);
  });

  test("each iteration persists through state store boundary", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: progressThenDone(2) });

    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run).not.toBeNull();
    expect(run?.attempts.length).toBe(3);
  });

  test("re-invoking an interrupted run re-runs that iteration over the dirty worktree", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();
    const dirtiedMarker = "dirty.txt";
    let firstRunCalls = 0;
    const crashBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          firstRunCalls += 1;
          writeFileSync(join(cwd, dirtiedMarker), "dirty\n", "utf8");
          throw new Error("simulated crash");
        },
      },
    ];

    await expect(runLoop({ jarvisRoot, stateDbPath, bindings: crashBindings, maxIterations: 1 })).rejects.toThrow(
      "simulated crash",
    );
    expect(firstRunCalls).toBe(1);

    let resumedCalls = 0;
    const resumeBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          resumedCalls += 1;
          expect(readFileSync(join(cwd, dirtiedMarker), "utf8")).toBe("dirty\n");
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const resumed = await runLoop({ jarvisRoot, stateDbPath, bindings: resumeBindings, maxIterations: 1 });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const run = loadRunOnce(stateDbPath, resumed.runId);
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);
    expect(run?.attempts[0]?.outcomeKind).toBe("done");
  });

  test("a budget-soft-stopped run resumes with a fresh per-invocation budget", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();
    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    expect(first.kind).toBe("budget-exhausted");

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
    });

    expect(second.kind).toBe("complete");
    expect(second.iterationsConsumed).toBe(1);

    const run = loadRunOnce(stateDbPath, second.runId);
    expect(run?.status).toBe("completed");
    expect(run?.attemptCount).toBe(2);
  });

  test("a different baseRef, specPath, and worktree on the same project and branch still resumes the same run", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();
    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    expect(first.kind).toBe("budget-exhausted");

    const run = loadRunOnce(stateDbPath, first.runId);
    if (!run) throw new Error("Run should exist");
    rmSync(run.worktreePath, { recursive: true, force: true });

    const resumed = await runLoop({
      jarvisRoot,
      stateDbPath,
      baseRef: "main",
      specPath: "renamed-spec.md",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.runId).toBe(first.runId);
  });

  test("a different branch creates a fresh run", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();
    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "other-write-run",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
    });

    expect(first.runId).not.toBe(second.runId);
  });

  test("re-running a boundary that fails mid-transaction retries the same attempt without duplicate history", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();
    let firstInvocationCalls = 0;
    const completeBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          firstInvocationCalls += 1;
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    await expect(
      runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: completeBindings,
        store: crashOnceMidBoundary(openStateStore(stateDbPath)),
        maxIterations: 1,
      }),
    ).rejects.toThrow("crash mid-boundary");
    expect(firstInvocationCalls).toBe(1);

    let resumedCalls = 0;
    const resumed = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            resumedCalls += 1;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      maxIterations: 1,
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const run = loadRunOnce(stateDbPath, resumed.runId);
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);
  });

  test("resume rebuilds a missing worktree from the branch", async () => {
    const { jarvisRoot, stateDbPath } = setupRepo();
    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    expect(first.kind).toBe("budget-exhausted");

    const worktreePath = join(jarvisRoot, "worktrees", "demo", "write-run");
    rmSync(worktreePath, { recursive: true, force: true });
    expect(existsSync(worktreePath)).toBe(false);

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
    });

    expect(second.kind).toBe("complete");
    expect(existsSync(worktreePath)).toBe(true);
  });
});
