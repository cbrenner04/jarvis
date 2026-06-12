import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path"; // Used in bindings closure
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import { openStateStore, type StateStore } from "./state-store.ts";
import { simulatedBindings } from "./testing/bindings.ts";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0, roots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function setupRepo(): { repoRoot: string; jarvisRoot: string; stateDbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-loop-"));
  roots.push(root);
  const repoRoot = join(root, "repo");
  const jarvisRoot = join(root, "jarvis-home");
  const stateDbPath = join(jarvisRoot, "state", "v2.sqlite");

  execFileSync("git", ["init", repoRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "test@example.com"], {
    stdio: "pipe",
  });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Test User"], {
    stdio: "pipe",
  });
  writeFileSync(join(repoRoot, "spec.md"), "- [ ] work\n", "utf8");
  execFileSync("git", ["-C", repoRoot, "add", "spec.md"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "seed"], {
    stdio: "pipe",
  });

  return { repoRoot, jarvisRoot, stateDbPath };
}

async function runLoop(args: {
  repoRoot: string;
  jarvisRoot: string;
  stateDbPath: string;
  bindings: readonly InvocationBinding[];
  maxIterations?: number;
  artifactPath?: string;
  signal?: AbortSignal;
}) {
  const store = openStateStore(args.stateDbPath);
  const loopInput: WriteLoopInput = {
    worktree: {
      projectRoot: args.repoRoot,
      projectName: "demo",
      branchName: "write-run",
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    projectId: "demo",
    specRef: "HEAD",
    branch: "write-run",
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: args.artifactPath ?? "proof.txt",
    bindings: args.bindings,
    stateStore: store,
  };
  if (args.maxIterations !== undefined) {
    loopInput.maxIterations = args.maxIterations;
  }
  if (args.signal !== undefined) {
    loopInput.signal = args.signal;
  }
  const result = await executeWriteLoop(loopInput);
  store.close();
  return result;
}

class ThrowMidBoundaryStore implements StateStore {
  private threw = false;

  constructor(private readonly inner: StateStore) {}

  createRun(args: Parameters<StateStore["createRun"]>[0]): string {
    return this.inner.createRun(args);
  }

  loadRun(runId: string) {
    return this.inner.loadRun(runId);
  }

  findRunByProjectBranch(args: Parameters<StateStore["findRunByProjectBranch"]>[0]) {
    return this.inner.findRunByProjectBranch(args);
  }

  recordAttemptStart(runId: string): string {
    return this.inner.recordAttemptStart(runId);
  }

  commitCompletionBoundary(args: Parameters<StateStore["commitCompletionBoundary"]>[0]): void {
    const beforeRunUpdate = this.threw
      ? args.beforeRunUpdate
      : () => {
          this.threw = true;
          throw new Error("crash mid-boundary");
        };

    if (beforeRunUpdate) {
      this.inner.commitCompletionBoundary({ ...args, beforeRunUpdate });
      return;
    }

    this.inner.commitCompletionBoundary(args);
  }

  setRunStatus(runId: string, status: Parameters<StateStore["setRunStatus"]>[1]): void {
    this.inner.setRunStatus(runId, status);
  }

  close(): void {
    this.inner.close();
  }
}

describe("write loop", () => {
  test("loop module exists and calls executeWrite repeatedly until terminal", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    let callCount = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          callCount += 1;
          if (callCount <= 2) {
            return { kind: "ok", stdout: "progress", stderr: "" };
          }
          // Write artifact to the worktree cwd
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(3);
    expect(result.resumable).toBe(false);
  });

  test("progress loops again and artifact contract not checked mid-loop", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async () => {
          return { kind: "ok", stdout: "progress", stderr: "" };
        },
      },
    ];

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
      maxIterations: 3,
    });

    // Progress doesn't check contract, so we loop until budget exhausted
    expect(result.kind).toBe("budget-exhausted");
    expect(result.iterationsConsumed).toBe(3);
  });

  test("done with passing artifact contract ends loop successfully", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["done"], {
      artifactPath: "proof.txt",
      emitArtifact: true,
    });

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);
  });

  test("no-work with passing artifact contract ends loop successfully", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["no-work"], {
      artifactPath: "proof.txt",
      emitArtifact: true,
    });

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);

    const store = openStateStore(stateDbPath);
    const run = store.loadRun(result.runId);
    store.close();
    expect(run?.attempts[0]?.outcomeKind).toBe("no-work");
  });

  test("done/no-work with failing contract appends blocker and stops", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["done"], {
      artifactPath: "proof.txt",
      emitArtifact: false, // No artifact, contract will fail
    });

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("contract_miss");
    expect(result.iterationsConsumed).toBe(1);

    // Blocker should be appended to spec in the worktree
    const worktreeSpecPath = join(jarvisRoot, "worktrees", "demo", "write-run", "spec.md");
    const spec = readFileSync(worktreeSpecPath, "utf8");
    expect(spec).toContain("## Blocker");
    expect(spec).toContain("artifact.exists");
  });

  test("blocked stops immediately with distinct outcome", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["blocked"]);

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("blocked");
    expect(result.iterationsConsumed).toBe(1);
    expect(result.resumable).toBe(false);
  });

  test("budget exhausted while progress yields soft-stop outcome", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["progress", "progress", "progress"]);

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
      maxIterations: 2,
    });

    expect(result.kind).toBe("budget-exhausted");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);
  });

  test("invocation_failure is terminal", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["quota", "quota"]);

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("invocation_failure");
    expect(result.resumable).toBe(false);
  });

  test("max iterations per-invocation with default constant", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings([
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "done",
    ]);

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.iterationsConsumed).toBe(10); // Default max
    expect(result.kind).toBe("budget-exhausted");
  });

  test("cancellation propagates via AbortSignal", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const controller = new AbortController();
    const callCounts: number[] = [];
    const bindings: InvocationBinding[] = [
      {
        id: "track",
        invoke: async () => {
          callCounts.push(1);
          if (callCounts.length > 1) {
            controller.abort();
          }
          return { kind: "ok", stdout: "progress", stderr: "" };
        },
      },
    ];

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
      signal: controller.signal,
    });

    expect(result.kind).toBe("progress");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);
  });

  test("each iteration persists through state store boundary", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    let callCount = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          callCount += 1;
          if (callCount <= 2) {
            return { kind: "ok", stdout: "progress", stderr: "" };
          }
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    const store = openStateStore(stateDbPath);
    const run = store.loadRun(result.runId);
    store.close();

    expect(run).not.toBeNull();
    expect(run?.attempts.length).toBe(3);
  });

  test("re-invoking an interrupted run re-runs that iteration over the dirty worktree", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
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

    await expect(
      runLoop({
        repoRoot,
        jarvisRoot,
        stateDbPath,
        bindings: crashBindings,
        maxIterations: 1,
      }),
    ).rejects.toThrow("simulated crash");
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

    const resumed = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: resumeBindings,
      maxIterations: 1,
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const store = openStateStore(stateDbPath);
    const run = store.loadRun(resumed.runId);
    store.close();
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);
    expect(run?.attempts[0]?.outcomeKind).toBe("done");
  });

  test("a budget-soft-stopped run resumes with a fresh per-invocation budget", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const first = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    expect(first.kind).toBe("budget-exhausted");

    const second = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], {
        artifactPath: "proof.txt",
        emitArtifact: true,
      }),
      maxIterations: 1,
    });

    expect(second.kind).toBe("complete");
    expect(second.iterationsConsumed).toBe(1);

    const store = openStateStore(stateDbPath);
    const run = store.loadRun(second.runId);
    store.close();
    expect(run?.status).toBe("completed");
    expect(run?.attemptCount).toBe(2);
  });

  test("a different specRef and worktree on the same project and branch still resumes the same run", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const first = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    expect(first.kind).toBe("budget-exhausted");

    const store = openStateStore(stateDbPath);
    const run = store.loadRun(first.runId);
    store.close();
    if (!run) throw new Error("Run should exist");

    rmSync(run.worktreePath, { recursive: true, force: true });

    const secondStore = openStateStore(stateDbPath);
    const resumed = await executeWriteLoop({
      worktree: {
        projectRoot: repoRoot,
        projectName: "demo",
        branchName: "write-run",
        baseRef: "main",
        jarvisRoot,
      },
      projectId: "demo",
      specRef: "different-ref",
      branch: "write-run",
      specPath: "renamed-spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: "proof.txt",
      bindings: simulatedBindings(["done"], {
        artifactPath: "proof.txt",
        emitArtifact: true,
      }),
      stateStore: secondStore,
      maxIterations: 1,
    });
    secondStore.close();

    expect(resumed.kind).toBe("complete");
    expect(resumed.runId).toBe(first.runId);
  });

  test("a different branch creates a fresh run", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const first = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    const secondStore = openStateStore(stateDbPath);
    const second = await executeWriteLoop({
      worktree: {
        projectRoot: repoRoot,
        projectName: "demo",
        branchName: "other-write-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      projectId: "demo",
      specRef: "HEAD",
      branch: "other-write-run",
      specPath: "spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: "proof.txt",
      bindings: simulatedBindings(["done"], {
        artifactPath: "proof.txt",
        emitArtifact: true,
      }),
      stateStore: secondStore,
      maxIterations: 1,
    });
    secondStore.close();

    expect(first.runId).not.toBe(second.runId);
  });

  test("re-running a boundary that fails mid-transaction retries the same attempt without duplicate history", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const innerStore = openStateStore(stateDbPath);
    const crashingStore = new ThrowMidBoundaryStore(innerStore);
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
      executeWriteLoop({
        worktree: {
          projectRoot: repoRoot,
          projectName: "demo",
          branchName: "write-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        projectId: "demo",
        specRef: "HEAD",
        branch: "write-run",
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: completeBindings,
        stateStore: crashingStore,
        maxIterations: 1,
      }),
    ).rejects.toThrow("crash mid-boundary");
    crashingStore.close();
    expect(firstInvocationCalls).toBe(1);

    let resumedCalls = 0;
    const resumed = await runLoop({
      repoRoot,
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

    const store = openStateStore(stateDbPath);
    const run = store.loadRun(resumed.runId);
    store.close();
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);
  });

  test("resume rebuilds a missing worktree from the branch", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const first = await runLoop({
      repoRoot,
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
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], {
        artifactPath: "proof.txt",
        emitArtifact: true,
      }),
      maxIterations: 1,
    });

    expect(second.kind).toBe("complete");
    expect(existsSync(worktreePath)).toBe(true);
  });
});
