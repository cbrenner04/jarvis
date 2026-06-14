import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "test@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Test User"], { stdio: "pipe" });
  writeFileSync(join(repoRoot, "spec.md"), "- [ ] work\n", "utf8");
  execFileSync("git", ["-C", repoRoot, "add", "spec.md"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "seed"], { stdio: "pipe" });

  return { repoRoot, jarvisRoot, stateDbPath };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function runLoop(args: {
  repoRoot: string;
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
  shrinkValidator?: WriteLoopInput["shrinkValidator"];
}) {
  const store = args.store ?? openStateStore(args.stateDbPath);
  const loopInput: WriteLoopInput = {
    worktree: {
      projectRoot: args.repoRoot,
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
    ...(args.shrinkValidator === undefined ? {} : { shrinkValidator: args.shrinkValidator }),
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

/** Bindings that report `progress` n times, then optionally write the artifact and report `done`. */
function progressThenDone(n: number, emitArtifact: boolean = true): InvocationBinding[] {
  let calls = 0;
  return [
    {
      id: "agent",
      invoke: async ({ cwd }) => {
        calls += 1;
        if (calls <= n) return { kind: "ok", stdout: "progress", stderr: "" };
        if (emitArtifact) {
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
        }
        return { kind: "ok", stdout: "done", stderr: "" };
      },
    },
  ];
}

describe("write loop", () => {
  test("calls executeWrite repeatedly until terminal", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: progressThenDone(2, false),
      artifactPath: "spec.md",
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(3);
    expect(result.resumable).toBe(false);
    expect(loadRunOnce(stateDbPath, result.runId)?.attempts.length).toBe(3);
  });

  test("complete runs one shrink step with shrink rules before returning", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const prompts: string[] = [];

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd, prompt }) => {
            prompts.push(prompt);
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            writeFileSync(join(cwd, "code.ts"), `export const value = ${prompts.length};\n`, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      shrinkValidator: () => {},
    });

    expect(result.kind).toBe("complete");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Return exactly one terminal token.");
    expect(prompts[1]).toContain("# Shrink checklist");
    expect(prompts[1]).toContain("Do not delete tests.");
  });

  test("no-work with passing artifact contract ends loop successfully", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["no-work"]),
      artifactPath: "spec.md",
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);
    expect(loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.outcomeKind).toBe("no-work");
  });

  test("done/no-work with failing contract appends blocker and stops", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      repoRoot,
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

  test("non-complete terminal outcomes never run shrink", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    let calls = 0;

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            calls += 1;
            return { kind: "ok", stdout: "blocked", stderr: "" };
          },
        },
      ],
      shrinkValidator: () => {
        throw new Error("should not validate");
      },
    });

    expect(result.kind).toBe("blocked");
    expect(result.iterationsConsumed).toBe(1);
    expect(result.resumable).toBe(false);
    expect(calls).toBe(1);
  });

  test("budget exhausted while progress yields soft-stop outcome", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      repoRoot,
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
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["quota", "quota"]),
    });

    expect(result.kind).toBe("invocation_failure");
    expect(result.resumable).toBe(false);
  });

  test("cancellation propagates via AbortSignal", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
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

    const result = await runLoop({ repoRoot, jarvisRoot, stateDbPath, bindings, signal: controller.signal });

    expect(result.kind).toBe("progress");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);
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
      runLoop({ repoRoot, jarvisRoot, stateDbPath, bindings: crashBindings, maxIterations: 1 }),
    ).rejects.toThrow("simulated crash");
    expect(firstRunCalls).toBe(1);

    let resumedCalls = 0;
    const resumeBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          resumedCalls += 1;
          expect(readFileSync(join(cwd, dirtiedMarker), "utf8")).toBe("dirty\n");
          rmSync(join(cwd, dirtiedMarker));
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
      artifactPath: "spec.md",
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const run = loadRunOnce(stateDbPath, resumed.runId);
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);
    expect(run?.attempts[0]?.outcomeKind).toBe("done");
  });

  test("keeps shrink changes on clean success", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    let calls = 0;

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            calls += 1;
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            if (calls === 1) {
              writeFileSync(join(cwd, "code.ts"), "export const value = 1;\n", "utf8");
            } else {
              writeFileSync(join(cwd, "code.ts"), "export const value = 2;\n", "utf8");
            }
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      shrinkValidator: () => {},
    });

    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    expect(result.kind).toBe("complete");
    expect(readFileSync(join(worktree, "code.ts"), "utf8")).toBe("export const value = 2;\n");
  });

  test("discarding shrink restores pre-shrink committed state and still returns complete", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    let calls = 0;

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            calls += 1;
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            if (calls === 1) {
              writeFileSync(join(cwd, "code.ts"), "export const value = 1;\n", "utf8");
            } else {
              writeFileSync(join(cwd, "code.ts"), "export const value = 999;\n", "utf8");
            }
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      shrinkValidator: () => {
        throw new Error("suite failed");
      },
    });

    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    expect(result.kind).toBe("complete");
    expect(readFileSync(join(worktree, "code.ts"), "utf8")).toBe("export const value = 1;\n");
  });

  test("completed run does not re-run shrink", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    let calls = 0;

    await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            calls += 1;
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            writeFileSync(join(cwd, "code.ts"), `export const value = ${calls};\n`, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      shrinkValidator: () => {},
    });

    const rerun = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            throw new Error("should not run");
          },
        },
      ],
      shrinkValidator: () => {
        throw new Error("should not validate");
      },
    });

    expect(rerun.kind).toBe("complete");
    expect(calls).toBe(2);
  });

  test("crash mid-shrink restores committed complete and does not re-run shrink", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    let calls = 0;

    await expect(
      runLoop({
        repoRoot,
        jarvisRoot,
        stateDbPath,
        bindings: [
          {
            id: "agent",
            invoke: async ({ cwd }) => {
              calls += 1;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              if (calls === 1) {
                writeFileSync(join(cwd, "code.ts"), "export const value = 1;\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" };
              }
              writeFileSync(join(cwd, "code.ts"), "export const value = 999;\n", "utf8");
              throw new Error("shrink crashed");
            },
          },
        ],
        shrinkValidator: () => {},
      }),
    ).rejects.toThrow("shrink crashed");

    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    expect(readFileSync(join(worktree, "code.ts"), "utf8")).toBe("export const value = 999;\n");

    const resumed = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            throw new Error("should not re-run");
          },
        },
      ],
      shrinkValidator: () => {
        throw new Error("should not validate");
      },
    });

    expect(resumed.kind).toBe("complete");
    expect(readFileSync(join(worktree, "code.ts"), "utf8")).toBe("export const value = 1;\n");
    expect(git(worktree, ["status", "--short"])).toBe("");
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
      bindings: simulatedBindings(["done"]),
      maxIterations: 1,
      artifactPath: "spec.md",
    });

    expect(second.kind).toBe("complete");
    expect(second.iterationsConsumed).toBe(1);

    const run = loadRunOnce(stateDbPath, second.runId);
    expect(run?.status).toBe("completed");
    expect(run?.attemptCount).toBe(2);
  });

  test("a different baseRef, specPath, and worktree on the same project and branch still resumes the same run", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const first = await runLoop({
      repoRoot,
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
      repoRoot,
      jarvisRoot,
      stateDbPath,
      baseRef: "main",
      specPath: "renamed-spec.md",
      bindings: simulatedBindings(["done"]),
      maxIterations: 1,
      artifactPath: "spec.md",
    });

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

    const second = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      branchName: "other-write-run",
      bindings: simulatedBindings(["done"]),
      maxIterations: 1,
      artifactPath: "spec.md",
    });

    expect(first.runId).not.toBe(second.runId);
  });

  test("re-running a boundary that fails mid-transaction retries the same attempt without duplicate history", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
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
        repoRoot,
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
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            resumedCalls += 1;
            rmSync(join(cwd, "proof.txt"));
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      maxIterations: 1,
      artifactPath: "spec.md",
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const run = loadRunOnce(stateDbPath, resumed.runId);
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
      bindings: simulatedBindings(["done"]),
      maxIterations: 1,
      artifactPath: "spec.md",
    });

    expect(second.kind).toBe("complete");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("shrink validator rejects deleted test files", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    writeFileSync(join(repoRoot, "proof.test.ts"), "test('x', () => {});\n", "utf8");
    execFileSync("git", ["-C", repoRoot, "add", "proof.test.ts"], { stdio: "pipe" });
    execFileSync("git", ["-C", repoRoot, "commit", "-m", "add test"], { stdio: "pipe" });

    let calls = 0;
    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            calls += 1;
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            if (calls > 1) {
              rmSync(join(cwd, "proof.test.ts"));
            }
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      shrinkValidator: ({ worktreePath, committedHead }) => {
        expect(git(worktreePath, ["diff", "--name-only", "--diff-filter=D", committedHead, "--"])).toBe(
          "proof.test.ts",
        );
        throw new Error("deleted test");
      },
    });

    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    expect(result.kind).toBe("complete");
    expect(existsSync(join(worktree, "proof.test.ts"))).toBe(true);
  });
});
