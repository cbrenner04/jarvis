import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding, InvocationCompletedRecord } from "../../../shared/invocation/execute.ts";
import type { LogEvent, LogSink } from "../persistence/log-stream.ts";
import { type OutcomeKind, openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import type { BindingAttemptSummary, InvocationFailureKind } from "./invocation-failure.ts";
import type { WorkBoundaryRecordedRecord } from "./work-boundary-telemetry.ts";
import { executeWrite as realExecuteWrite, type WriteExecuteInput } from "./write.ts";
import { executeWriteLoop, type WriteLoopInput, type WriteLoopOutcomeKind } from "./write-loop.ts";

const { roots } = trackedTempRoots();

function loopTelemetry(sinkPath: string): NonNullable<WriteLoopInput["telemetry"]> {
  return {
    sinkPath,
    operatorSessionId: "session-1",
    workflow: "write",
    role: "implement",
  };
}

/** Test log sink that captures all events. */
class TestLogSink implements LogSink {
  events: Array<{ runId: string; event: LogEvent }> = [];
  shouldThrow = false;

  append(runId: string, event: LogEvent): void {
    if (this.shouldThrow) {
      throw new Error("Simulated append error");
    }
    this.events.push({ runId, event });
  }

  close(): void {
    // no-op
  }

  getEventsForRun(runId: string): LogEvent[] {
    return this.events.filter((e) => e.runId === runId).map((e) => e.event);
  }
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
  logSink?: LogSink;
  telemetry?: WriteLoopInput["telemetry"];
  completionCommitter?: WriteLoopInput["completionCommitter"];
  completionPublisher?: WriteLoopInput["completionPublisher"];
  readyFinalizer?: WriteLoopInput["readyFinalizer"];
}) {
  // Track the parent directory for cleanup
  roots.push(join(args.jarvisRoot, ".."));
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
    sessionsDir: join(args.jarvisRoot, "sessions"),
    ...(args.maxIterations !== undefined ? { maxIterations: args.maxIterations } : {}),
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.logSink !== undefined ? { logSink: args.logSink } : {}),
    ...(args.telemetry !== undefined ? { telemetry: args.telemetry } : {}),
    ...(args.completionCommitter !== undefined ? { completionCommitter: args.completionCommitter } : {}),
    ...(args.completionPublisher !== undefined ? { completionPublisher: args.completionPublisher } : {}),
    ...(args.readyFinalizer !== undefined ? { readyFinalizer: args.readyFinalizer } : {}),
  };
  try {
    return await executeWriteLoop(loopInput);
  } finally {
    store.close();
  }
}

function writeSpecIndex(jarvisRoot: string, branchName: string, content: string): void {
  const specDir = join(jarvisRoot, "worktrees", "demo", branchName, "spec");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "index.md"), content, "utf8");
}

async function runLoopWithPause(args: {
  jarvisRoot: string;
  stateDbPath: string;
  bindings: readonly InvocationBinding[];
  maxIterations?: number;
  pauseAfterAttempts?: number;
  logSink?: LogSink;
}) {
  // Track the parent directory for cleanup
  roots.push(join(args.jarvisRoot, ".."));
  const store = openStateStore(args.stateDbPath);
  const pauseController = new AbortController();
  let attempts = 0;
  const pausingBindings = args.bindings.map((binding) => ({
    id: binding.id,
    invoke: async (input: Parameters<typeof binding.invoke>[0]) => {
      attempts += 1;
      if (args.pauseAfterAttempts && attempts > args.pauseAfterAttempts) {
        pauseController.abort();
      }
      return binding.invoke(input);
    },
  }));

  const loopInput: WriteLoopInput = {
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: "pause-run",
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    bindings: pausingBindings,
    stateStore: store,
    pauseSignal: pauseController.signal,
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
    sessionsDir: join(args.jarvisRoot, "sessions"),
  };
  if (args.maxIterations !== undefined) {
    loopInput.maxIterations = args.maxIterations;
  }
  if (args.logSink !== undefined) {
    loopInput.logSink = args.logSink;
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

function loadTelemetryRows(path: string): InvocationCompletedRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as InvocationCompletedRecord);
}

function loadWorkBoundaryRows(path: string): WorkBoundaryRecordedRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as WorkBoundaryRecordedRecord)
    .filter((row) => row.record_kind === "work_boundary_recorded");
}

/** Wrap a store so the first completion boundary fails mid-transaction. */
function crashOnceMidBoundary(inner: StateStore): StateStore {
  let crashed = false;
  return {
    createRun: (args) => inner.createRun(args),
    loadRun: (runId) => inner.loadRun(runId),
    findRunByProjectBranch: (args) => inner.findRunByProjectBranch(args),
    findRevisionRuns: (args) => inner.findRevisionRuns(args),
    recordAttemptStart: (runId) => inner.recordAttemptStart(runId),
    setRunStatus: (runId, status) => inner.setRunStatus(runId, status),
    beginRunReconciliation: () => inner.beginRunReconciliation(),
    finishRunReconciliation: (runId) => inner.finishRunReconciliation(runId),
    listRuns: () => inner.listRuns(),
    hasQueuedRun: (args) => inner.hasQueuedRun(args),
    listQueuedRuns: () => inner.listQueuedRuns(),
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
  beforeEach(() => {
    mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
  });

  afterEach(() => {
    mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
  });

  test("calls executeWrite repeatedly until terminal", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: progressThenDone(2) });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(3);
    expect(result.resumable).toBe(false);
  });

  test("progress loops again and artifact contract not checked mid-loop", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

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
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);
  });

  test("no-work with passing artifact contract ends loop successfully", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

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
    const { jarvisRoot, stateDbPath } = createJarvisHome();

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

  test("blocked with blocker text stops immediately with distinct outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async ({ cwd }) => {
            appendFileSync(join(cwd, "spec.md"), "\n## Blocker\n\nstuck\n", "utf8");
            return { kind: "ok", stdout: "blocked", stderr: "" };
          },
        },
      ],
    });

    expect(result.kind).toBe("blocked");
    expect(result.iterationsConsumed).toBe(1);
    expect(result.resumable).toBe(false);
  });

  test("blocked without blocker text triggers blocker re-prompt then missing_blocker", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let invocations = 0;

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async () => {
            invocations += 1;
            return {
              kind: "ok",
              stdout: invocations === 1 ? "blocked" : "still no blocker file",
              stderr: "",
            };
          },
        },
      ],
      logSink: sink,
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("invocation_failure");
    expect(result.resumable).toBe(true);
    expect(result.runStatus).toBe("paused");
    expect(result.outcomeKind).toBe("missing_blocker");
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(events).toContain("blocker_reprompt");
    expect(events).not.toContain("token_reprompt");
    expect(events).toContain("missing_blocker_detail");
    const detail = sink.getEventsForRun(result.runId).find((event) => event.kind === "missing_blocker_detail");
    expect(detail).toMatchObject({
      kind: "missing_blocker_detail",
      responseText: "still no blocker file",
    });
  });

  test("blocked reprompt that writes blocker text terminates as blocked", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    let invocations = 0;

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async ({ cwd }) => {
            invocations += 1;
            if (invocations === 1) {
              return { kind: "ok", stdout: "blocked", stderr: "" };
            }
            appendFileSync(join(cwd, "spec.md"), "\n## Blocker\n\nexplained\n", "utf8");
            return { kind: "ok", stdout: "wrote blocker", stderr: "" };
          },
        },
      ],
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("blocked");
    expect(result.runStatus).toBe("blocked");
    expect(result.outcomeKind).toBe("blocked");
  });

  test("blocked with pre-existing harness blocker and no new text is rejected", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "stale-blocker-run");
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n\n## Blocker\n\nfrom contract_miss\n", "utf8");
    let invocations = 0;

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "stale-blocker-run",
      bindings: [
        {
          id: "sim.1",
          invoke: async () => {
            invocations += 1;
            return { kind: "ok", stdout: "blocked", stderr: "" };
          },
        },
      ],
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("invocation_failure");
    expect(result.outcomeKind).toBe("missing_blocker");
  });

  test("budget exhausted while progress yields soft-stop outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

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

  test("binding-chain invocation failures report failureKind and bindingAttempts", async () => {
    const cases: Array<{
      branchName: string;
      bindings: readonly InvocationBinding[];
      failureKind: InvocationFailureKind;
      bindingAttempts: BindingAttemptSummary[];
    }> = [
      {
        branchName: "quota-run",
        bindings: simulatedBindings(["quota", "quota"]),
        failureKind: "quota",
        bindingAttempts: [
          { bindingId: "sim.1", resultKind: "quota" },
          { bindingId: "sim.2", resultKind: "quota" },
        ],
      },
      {
        branchName: "model-config-run",
        bindings: simulatedBindings(["quota", "model_config"]),
        failureKind: "model_config",
        bindingAttempts: [
          { bindingId: "sim.1", resultKind: "quota" },
          { bindingId: "sim.2", resultKind: "model_config" },
        ],
      },
      {
        branchName: "error-run",
        bindings: simulatedBindings(["error"]),
        failureKind: "error",
        bindingAttempts: [{ bindingId: "sim.1", resultKind: "error" }],
      },
      {
        branchName: "no-binding-run",
        bindings: [] as InvocationBinding[],
        failureKind: "no_binding" as const,
        bindingAttempts: [],
      },
    ];

    for (const testCase of cases) {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName: testCase.branchName,
        bindings: testCase.bindings,
      });

      expect(result.kind).toBe("invocation_failure");
      expect(result.resumable).toBe(false);
      expect(result.failureKind).toBe(testCase.failureKind);
      expect(result.bindingAttempts).toEqual(testCase.bindingAttempts);
    }
  });

  const invalidTokenBindings: InvocationBinding[] = [
    {
      id: "agent",
      invoke: async () => ({ kind: "ok", stdout: "not a terminal token", stderr: "" }),
    },
  ];

  test("invalid_token omits failureKind and bindingAttempts", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: invalidTokenBindings });

    expect(result.kind).toBe("invocation_failure");
    expect(result.resumable).toBe(true);
    expect(result.failureKind).toBeUndefined();
    expect(result.bindingAttempts).toBeUndefined();
    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run?.status).toBe("paused");
    expect(run?.attempts[0]?.outcomeKind).toBe("invalid_token");
  });

  test("invalid_token appends invalid_token_detail to the observability log", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: invalidTokenBindings, logSink: sink });
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(events).toContain("invalid_token_detail");
    const detail = sink.getEventsForRun(result.runId).find((event) => event.kind === "invalid_token_detail");
    expect(detail).toMatchObject({
      kind: "invalid_token_detail",
      tokenText: "not a terminal token",
    });
  });

  test("token_reprompt precedes invalid_token_detail on a second miss", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: invalidTokenBindings, logSink: sink });
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    const repromptIndex = events.indexOf("token_reprompt");
    const detailIndex = events.indexOf("invalid_token_detail");
    expect(repromptIndex).toBeGreaterThanOrEqual(0);
    expect(detailIndex).toBeGreaterThan(repromptIndex);

    const reprompt = sink.getEventsForRun(result.runId).find((event) => event.kind === "token_reprompt");
    expect(reprompt).toMatchObject({
      kind: "token_reprompt",
      responseText: "not a terminal token",
    });
  });

  test("no token_reprompt event when the first response carries a token", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      logSink: sink,
    });

    expect(result.kind).toBe("complete");
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(events).not.toContain("token_reprompt");
  });

  test("write-loop telemetry appends one row per binding attempt with shared run and attempt context", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const telemetryPath = join(jarvisRoot, "telemetry.jsonl");
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["quota", "done"], { artifactPath: "proof.txt", emitArtifact: true }),
      telemetry: loopTelemetry(telemetryPath),
    });

    expect(result.kind).toBe("complete");
    const rows = loadTelemetryRows(telemetryPath);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.run_id))).toEqual(new Set([result.runId]));
    expect(new Set(rows.map((row) => row.attempt_id)).size).toBe(1);
    expect(rows.map((row) => row.invocation_id)).toHaveLength(2);
    expect(new Set(rows.map((row) => row.invocation_id)).size).toBe(2);
    expect(rows.map((row) => row.exit_kind)).toEqual(["quota", "ok"]);
    expect(rows.every((row) => row.step_id === null)).toBe(true);
  });

  test("operator-session-only telemetry (no sinkPath/workflow/role) completes a real run without emitting telemetry", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      telemetry: { operatorSessionId: "session-only" },
    });

    expect(result.kind).toBe("complete");
  });

  describe("work_boundary_recorded telemetry", () => {
    const completionHooks = {
      completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 2 }),
      completionPublisher: async () => ({}),
      readyFinalizer: async () => {},
    };

    test("appends one row when a completion commit succeeds", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        ...completionHooks,
      });

      expect(result.kind).toBe("complete");
      expect(result.commitSha).toBe("commit-abc");
      const rows = loadWorkBoundaryRows(telemetryPath);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        schema_version: 1,
        record_kind: "work_boundary_recorded",
        run_id: result.runId,
        attempt_id: result.attemptId,
        outcome_kind: "done",
        run_status: "completed",
        commit_sha: "commit-abc",
        files_changed: 2,
      });
      expect(rows[0]).not.toHaveProperty("invocation_id");
    });

    test("appends none when no telemetry block is attached", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        ...completionHooks,
      });

      expect(loadWorkBoundaryRows(telemetryPath)).toHaveLength(0);
    });

    test("appends none when the completion commit produces no sha", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        completionCommitter: async () => ({}),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(loadWorkBoundaryRows(telemetryPath)).toHaveLength(0);
    });

    test("resume-republish appends a row with the same join keys and files_changed", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      const branchName = "resume-boundary";
      const publish = { commitSha: "commit-1", filesChanged: 3 };

      const first = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        completionCommitter: async () => publish,
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(first.kind).toBe("complete");
      mkdirSync(join(jarvisRoot, "worktrees", "demo", branchName, ".git"), { recursive: true });

      const retry = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: [],
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        completionCommitter: async () => publish,
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(retry.kind).toBe("complete");

      const rows = loadWorkBoundaryRows(telemetryPath);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0]?.attempt_id).toBe(rows[1]?.attempt_id);
      expect(rows[0]?.outcome_kind).toBe(rows[1]?.outcome_kind);
      expect(rows[0]?.run_status).toBe(rows[1]?.run_status);
      expect(rows[0]?.files_changed).toBe(rows[1]?.files_changed);
    });

    test("append failure leaves boundary control flow and persistence unchanged", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryDir = join(jarvisRoot, "boundary-telemetry-dir");
      mkdirSync(telemetryDir, { recursive: true });
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryDir, operatorSessionId: "session-1" },
        ...completionHooks,
      });

      expect(result.kind).toBe("complete");
      expect(result.commitSha).toBe("commit-abc");
      expect(result.boundaryTelemetryFailure).toBeDefined();
      const run = loadRunOnce(stateDbPath, result.runId);
      expect(run?.status).toBe("completed");
      expect(run?.attempts[0]?.outcomeKind).toBe("done");
    });
  });

  describe("ready finalization", () => {
    const completionHooks = {
      completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
      completionPublisher: async () => ({}),
    };

    test("runs ready finalization only after publication succeeds", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const calls: string[] = [];
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: completionHooks.completionCommitter,
        completionPublisher: async () => {
          calls.push("publish");
          return {};
        },
        readyFinalizer: async () => {
          calls.push("finalize");
        },
      });

      expect(result.kind).toBe("complete");
      expect(calls).toEqual(["publish", "finalize"]);
    });

    test("returns retryable ready_finalize_failed when the gate fails and does not call the flip", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        ...completionHooks,
        readyFinalizer: async () => {
          throw new Error("ready gate failed (exit 1): tests failed");
        },
      });

      expect(result.kind).toBe("ready_finalize_failed");
      expect(result.resumable).toBe(true);
      expect(result.readyFinalizeError).toContain("ready gate failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "ready_finalize_failed",
        resumable: true,
      });
    });

    test("returns retryable ready_finalize_failed when publication succeeded but flip fails", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        ...completionHooks,
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });

      expect(result.kind).toBe("ready_finalize_failed");
      expect(result.readyFinalizeError).toContain("gh pr ready failed");
    });

    test("completed-run resume replays publication after a prior publication failure", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const branchName = "resume-publication";
      const publish = { commitSha: "commit-1", filesChanged: 2 };
      let publishCalls = 0;

      const first = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => publish,
        completionPublisher: async () => {
          publishCalls += 1;
          throw new Error("push failed");
        },
        readyFinalizer: async () => {
          throw new Error("should not finalize before publication succeeds");
        },
      });
      expect(first.kind).toBe("completion_commit_failed");
      expect(first.resumable).toBe(true);
      expect(publishCalls).toBe(1);

      mkdirSync(join(jarvisRoot, "worktrees", "demo", branchName, ".git"), { recursive: true });

      const retry = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: [],
        completionCommitter: async () => publish,
        completionPublisher: async () => {
          publishCalls += 1;
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retry.kind).toBe("complete");
      expect(retry.runId).toBe(first.runId);
      expect(publishCalls).toBe(2);
    });
  });

  test("publishes index and sibling-index titles, with fallback for unusable indexes", async () => {
    const cases = [
      { branchName: "index-title", specPath: "spec/index.md", index: "#  Index title  \n", title: "Index title" },
      { branchName: "sibling-title", specPath: "spec/01-write.md", index: "# Sibling title\n", title: "Sibling title" },
      { branchName: "missing-title", specPath: "spec/index.md", index: undefined, title: undefined },
      {
        branchName: "unreadable-title",
        specPath: "spec/index.md",
        index: undefined,
        unreadable: true,
        title: undefined,
      },
      { branchName: "malformed-title", specPath: "spec/index.md", index: "#\n", title: undefined },
      { branchName: "blank-title", specPath: "spec/index.md", index: "# \n", title: undefined },
      { branchName: "whitespace-title", specPath: "spec/index.md", index: "# \t \n", title: undefined },
    ];

    for (const testCase of cases) {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      if (testCase.index !== undefined) writeSpecIndex(jarvisRoot, testCase.branchName, testCase.index);
      if (testCase.unreadable)
        mkdirSync(join(jarvisRoot, "worktrees", "demo", testCase.branchName, "spec", "index.md"), { recursive: true });
      const titles: unknown[] = [];
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName: testCase.branchName,
        specPath: testCase.specPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(titles).toEqual([testCase.title]);
    }
  });

  test("retains a resolved direct-write title when completed publication retries", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const branchName = "write-title-retry";
    writeSpecIndex(jarvisRoot, branchName, "# Durable title\n");

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      specPath: "spec/index.md",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      completionCommitter: async () => ({ commitSha: "commit-1" }),
      completionPublisher: async () => {
        throw new Error("publish failed");
      },
    });
    expect(first.kind).toBe("completion_commit_failed");

    rmSync(join(jarvisRoot, "worktrees", "demo", branchName, "spec", "index.md"));
    mkdirSync(join(jarvisRoot, "worktrees", "demo", branchName, ".git"), { recursive: true });
    const titles: unknown[] = [];
    const retried = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      specPath: "spec/index.md",
      bindings: [],
      completionCommitter: async () => ({ commitSha: "commit-1" }),
      completionPublisher: async (input) => {
        titles.push(input.creationTitle);
        return {};
      },
      readyFinalizer: async () => {},
    });

    expect(retried.kind).toBe("complete");
    expect(titles).toEqual(["Durable title"]);
  });

  test("persists the final completion binding for a completed-run retry", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["quota", "done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(first.completionAgent).toBe("sim-agent-2");
    expect(loadRunOnce(stateDbPath, first.runId)?.attempts.at(-1)?.completionAgent).toBe("sim-agent-2");

    const retry = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [],
    });
    expect(retry.completionAgent).toBe("sim-agent-2");
  });

  test("telemetry append failure leaves state-store and log contracts unchanged while surfacing failure detail", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const logSink = new TestLogSink();
    const telemetryDir = join(jarvisRoot, "telemetry-dir");
    mkdirSync(telemetryDir, { recursive: true });
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      logSink,
      telemetry: loopTelemetry(telemetryDir),
    });

    expect(result.kind).toBe("complete");
    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run?.status).toBe("completed");
    expect(logSink.getEventsForRun(result.runId).map((event) => event.kind)).toEqual([
      "iteration_started",
      "boundary_committed",
      "loop_finished",
    ]);
    if (run?.attempts[0]) {
      expect(run.attempts[0].outcomeKind).toBe("done");
    }
  });

  test("complete, blocked, contract_miss, and budget-exhausted omit failure detail", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const complete = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });
    expect(complete.failureKind).toBeUndefined();

    const blocked = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "blocked-run",
      bindings: simulatedBindings(["blocked"], { emitBlocker: true }),
    });
    expect(blocked.failureKind).toBeUndefined();

    const contractMiss = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "contract-miss-run",
      bindings: simulatedBindings(["done"]),
    });
    expect(contractMiss.failureKind).toBeUndefined();

    const budget = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "budget-run",
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });
    expect(budget.failureKind).toBeUndefined();
  });

  test("re-invoking binding-chain invocation_failure returns persisted detail without a new attempt", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["quota", "model_config"]),
    });

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(second.kind).toBe("invocation_failure");
    expect(second.runId).toBe(first.runId);
    expect(second.failureKind).toBe("model_config");
    expect(second.bindingAttempts).toEqual(first.bindingAttempts);
    expect(loadRunOnce(stateDbPath, first.runId)?.attemptCount).toBe(1);
  });

  test("pre-migration failed run resumes invocation_failure without failure detail", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const store = openStateStore(stateDbPath);
    const runId = store.createRun({
      project: "demo",
      specRef: "HEAD",
      worktreePath: join(jarvisRoot, "worktrees", "demo", "legacy-run"),
      branch: "legacy-run",
      specPath: "spec.md",
    });
    const attemptId = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
    });
    store.close();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "legacy-run",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(result.kind).toBe("invocation_failure");
    expect(result.failureKind).toBeUndefined();
    expect(result.bindingAttempts).toBeUndefined();
  });

  test("invalid_token resume starts a fresh attempt over the existing worktree", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: invalidTokenBindings,
      branchName: "invalid-token-run",
    });
    expect(first.resumable).toBe(true);

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "invalid-token-run",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(second.kind).toBe("complete");
    expect(second.resumable).toBe(false);
    expect(second.runId).toBe(first.runId);
    expect(loadRunOnce(stateDbPath, second.runId)?.attempts).toHaveLength(2);
  });

  test("max iterations per-invocation with default constant", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: simulatedBindings(["progress"]) });

    expect(result.iterationsConsumed).toBe(10); // Default max
    expect(result.kind).toBe("budget-exhausted");
  });

  test("each iteration persists through state store boundary", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: progressThenDone(2) });

    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run).not.toBeNull();
    expect(run?.attempts.length).toBe(3);
  });

  test("re-invoking an interrupted run re-runs that iteration over the dirty worktree, emitting a fresh iteration_started for the interrupted attempt", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const dirtiedMarker = "dirty.txt";
    const controller = new AbortController();
    const interruptBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd, signal }) => {
          writeFileSync(join(cwd, dirtiedMarker), "dirty\n", "utf8");
          while (!signal?.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          return { kind: "ok", stdout: "progress", stderr: "" };
        },
      },
    ];

    const abortTimer = setTimeout(() => controller.abort(), 20);
    const interrupted = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: interruptBindings,
      maxIterations: 1,
      signal: controller.signal,
      logSink: sink,
    });
    clearTimeout(abortTimer);
    expect(interrupted.kind).toBe("progress");
    expect(interrupted.iterationsConsumed).toBe(1);
    expect(interrupted.resumable).toBe(true);

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
      jarvisRoot,
      stateDbPath,
      bindings: resumeBindings,
      maxIterations: 1,
      logSink: sink,
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const run = loadRunOnce(stateDbPath, resumed.runId);
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);
    expect(run?.attempts[0]?.outcomeKind).toBe("done");

    const events = sink.getEventsForRun(resumed.runId);
    expect(events.length).toBe(5);
    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("loop_finished");
    expect(events[2]?.kind).toBe("iteration_started");
    expect(events[3]?.kind).toBe("boundary_committed");
    expect(events[4]?.kind).toBe("loop_finished");

    const firstAttemptId = events[0]?.kind === "iteration_started" ? events[0].attemptId : undefined;
    const resumedAttemptId = events[2]?.kind === "iteration_started" ? events[2].attemptId : undefined;
    expect(firstAttemptId).toBeDefined();
    expect(resumedAttemptId).toBeDefined();
    expect(resumedAttemptId).toBe(firstAttemptId);
  });

  test("a budget-soft-stopped run resumes with a fresh per-invocation budget", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
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
    const { jarvisRoot, stateDbPath } = createJarvisHome();
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
    const { jarvisRoot, stateDbPath } = createJarvisHome();
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

  test("re-running a boundary that fails mid-transaction retries the same attempt without duplicate history, emitting matching events", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
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
        logSink: sink,
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
      logSink: sink,
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const run = loadRunOnce(stateDbPath, resumed.runId);
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);

    const events = sink.getEventsForRun(resumed.runId);
    // Should have: iteration_started (failed), iteration_started (retry with same attemptId), boundary_committed (success), loop_finished
    expect(events.length).toBe(4);
    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("iteration_started");
    expect(events[2]?.kind).toBe("boundary_committed");
    expect(events[3]?.kind).toBe("loop_finished");

    const firstAttemptId = events[0]?.kind === "iteration_started" ? events[0].attemptId : undefined;
    const retryAttemptId = events[1]?.kind === "iteration_started" ? events[1].attemptId : undefined;
    expect(firstAttemptId).toBeDefined();
    expect(retryAttemptId).toBeDefined();
    expect(retryAttemptId).toBe(firstAttemptId);
  });

  test("resume rebuilds a missing worktree from the branch", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
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

  test("multi-iteration loop run produces iteration_started and boundary_committed pairs, ending with loop_finished", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: progressThenDone(2),
      logSink: sink,
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(3);

    const events = sink.getEventsForRun(result.runId);
    expect(events.length).toBe(7); // 3 iteration_started, 3 boundary_committed, 1 loop_finished

    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("boundary_committed");
    expect(events[2]?.kind).toBe("iteration_started");
    expect(events[3]?.kind).toBe("boundary_committed");
    expect(events[4]?.kind).toBe("iteration_started");
    expect(events[5]?.kind).toBe("boundary_committed");
    expect(events[6]?.kind).toBe("loop_finished");
    expect(events[6]?.kind === "loop_finished" && events[6].loopOutcomeKind).toBe("complete");
    expect(events[6]?.kind === "loop_finished" && events[6].iterationsConsumed).toBe(3);
  });

  test("terminal boundary_committed and loop_finished payloads match terminalMapping for each outcome", async () => {
    const cases: Array<{
      label: string;
      bindings: readonly InvocationBinding[];
      expectedResultKind: WriteLoopOutcomeKind;
      expectedBoundaryOutcomeKind: OutcomeKind;
      expectedBoundaryRunStatus?: RunStatus;
      expectedFinishedOutcomeKind: WriteLoopOutcomeKind;
    }> = [
      {
        label: "blocked",
        bindings: simulatedBindings(["blocked"], { emitBlocker: true }),
        expectedResultKind: "blocked",
        expectedBoundaryOutcomeKind: "blocked",
        expectedBoundaryRunStatus: "blocked",
        expectedFinishedOutcomeKind: "blocked",
      },
      {
        label: "contract_miss",
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: false }),
        expectedResultKind: "contract_miss",
        expectedBoundaryOutcomeKind: "contract_miss",
        expectedBoundaryRunStatus: "blocked",
        expectedFinishedOutcomeKind: "contract_miss",
      },
      {
        label: "invocation_failure",
        bindings: simulatedBindings(["quota", "quota"]),
        expectedResultKind: "invocation_failure",
        expectedBoundaryOutcomeKind: "invocation_failure",
        expectedBoundaryRunStatus: "failed",
        expectedFinishedOutcomeKind: "invocation_failure",
      },
      {
        label: "no-work",
        bindings: simulatedBindings(["no-work"], { artifactPath: "proof.txt", emitArtifact: true }),
        expectedResultKind: "complete",
        expectedBoundaryOutcomeKind: "no-work",
        expectedFinishedOutcomeKind: "complete",
      },
    ];

    for (const testCase of cases) {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const sink = new TestLogSink();

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: testCase.bindings,
        logSink: sink,
      });

      expect(result.kind).toBe(testCase.expectedResultKind);

      const events = sink.getEventsForRun(result.runId);
      const boundaryEvent = events[1];
      expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.outcomeKind).toBe(
        testCase.expectedBoundaryOutcomeKind,
      );
      if (testCase.expectedBoundaryRunStatus) {
        expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.runStatus).toBe(
          testCase.expectedBoundaryRunStatus,
        );
      }

      const finishedEvent = events[2];
      expect(finishedEvent?.kind === "loop_finished" && finishedEvent.loopOutcomeKind).toBe(
        testCase.expectedFinishedOutcomeKind,
      );
    }
  });

  test("budget soft-stop emits no terminal boundary_committed; last boundary has progress outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 2,
      logSink: sink,
    });

    expect(result.kind).toBe("budget-exhausted");

    const events = sink.getEventsForRun(result.runId);
    // Should be: iteration_started, boundary_committed (progress), iteration_started, boundary_committed (progress), loop_finished
    expect(events.length).toBe(5);

    const lastBoundary = events[3];
    expect(lastBoundary?.kind === "boundary_committed" && lastBoundary.outcomeKind).toBe("progress");
    expect(lastBoundary?.kind === "boundary_committed" && lastBoundary.runStatus).toBe("in-progress");

    const finished = events[4];
    expect(finished?.kind === "loop_finished" && finished.loopOutcomeKind).toBe("budget-exhausted");
    expect(finished?.kind === "loop_finished" && finished.resumable).toBe(true);
    expect(finished?.kind === "loop_finished" && finished.iterationsConsumed).toBe(2);
  });

  test("a second invocation on a budget-soft-stopped run appends new events to the existing stream", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
      logSink: sink,
    });

    expect(first.kind).toBe("budget-exhausted");
    const firstEventCount = sink.getEventsForRun(first.runId).length;
    expect(firstEventCount).toBe(3); // iteration_started, boundary_committed, loop_finished

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
      logSink: sink,
    });

    expect(second.kind).toBe("complete");
    expect(second.runId).toBe(first.runId);

    const allEvents = sink.getEventsForRun(second.runId);
    expect(allEvents.length).toBeGreaterThan(firstEventCount);
    // Should have: first run's 3 events + second run's 3 events = 6 total
    expect(allEvents.length).toBe(6);
  });

  test("abort/cancellation stops the loop without committing the in-flight boundary, emitting matching events and state", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
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

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings,
      signal: controller.signal,
      logSink: sink,
    });

    expect(result.kind).toBe("progress");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);

    const events = sink.getEventsForRun(result.runId);
    // Should have: iteration_started, boundary_committed (completed), iteration_started (aborted, no boundary), loop_finished
    expect(events.length).toBe(4);
    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("boundary_committed");
    expect(events[2]?.kind).toBe("iteration_started");
    expect(events[3]?.kind).toBe("loop_finished");
    expect(events[3]?.kind === "loop_finished" && events[3].loopOutcomeKind).toBe("progress");
    expect(events[3]?.kind === "loop_finished" && events[3].iterationsConsumed).toBe(2);

    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run?.attempts).toHaveLength(2);
    expect(run?.attempts[0]?.status).toBe("completed");
    expect(run?.attempts[1]?.status).toBe("in-progress");
  });

  test("re-invoking a run whose terminal boundary is already committed returns prior outcome without appending log events", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      logSink: sink,
    });

    expect(first.kind).toBe("complete");
    const _firstEventCount = sink.getEventsForRun(first.runId).length;

    const sink2 = new TestLogSink();
    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      logSink: sink2,
    });

    expect(second.kind).toBe("complete");
    expect(second.runId).toBe(first.runId);

    const secondRunEvents = sink2.getEventsForRun(second.runId);
    expect(secondRunEvents.length).toBe(0); // No events appended on idempotent re-entry
  });

  test("a throwing log sink causes executeWriteLoop to reject", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    sink.shouldThrow = true;

    await expect(
      runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["progress"]),
        logSink: sink,
      }),
    ).rejects.toThrow("Simulated append error");
  });

  test("pause at iteration boundary lets the in-flight step finish and commit its boundary", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const dirtiedMarker = "paused.txt";
    let attempts = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          attempts += 1;
          writeFileSync(join(cwd, dirtiedMarker), `attempt-${attempts}\n`, "utf8");
          return { kind: "ok", stdout: "progress", stderr: "" };
        },
      },
    ];

    const result = await runLoopWithPause({
      jarvisRoot,
      stateDbPath,
      bindings,
      pauseAfterAttempts: 2,
      maxIterations: 10,
    });

    expect(result.kind).toBe("paused");
    expect(result.iterationsConsumed).toBe(3);
    expect(result.resumable).toBe(true);

    // Verify the second attempt completed and persisted
    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run?.status).toBe("paused");
    expect(run?.attemptCount).toBe(3); // Three completed attempts
    const lastAttempt = run?.attempts[run.attempts.length - 1];
    expect(lastAttempt?.status).toBe("completed");
    expect(lastAttempt?.outcomeKind).toBe("progress");

    // Verify the marker was written
    const markerPath = join(jarvisRoot, "worktrees", "demo", "pause-run", dirtiedMarker);
    expect(existsSync(markerPath)).toBe(true);
    expect(readFileSync(markerPath, "utf8")).toBe("attempt-3\n");
  });

  test("paused run outcome kind is distinct from budget-exhausted", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoopWithPause({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      pauseAfterAttempts: 1,
      maxIterations: 10,
      logSink: sink,
    });

    expect(result.kind).toBe("paused");

    const events = sink.getEventsForRun(result.runId);
    const finishedEvent = events[events.length - 1];
    expect(finishedEvent?.kind === "loop_finished" && finishedEvent.loopOutcomeKind).toBe("paused");
    expect(finishedEvent?.kind === "loop_finished" && finishedEvent.resumable).toBe(true);
  });

  test("resuming a paused run starts a fresh attempt and continues", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    // First run: pause after 1 attempt
    const pauseResult = await runLoopWithPause({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      pauseAfterAttempts: 1,
      maxIterations: 10,
    });

    expect(pauseResult.kind).toBe("paused");
    expect(pauseResult.iterationsConsumed).toBe(2);

    // Verify paused status
    let run = loadRunOnce(stateDbPath, pauseResult.runId);
    expect(run?.status).toBe("paused");
    expect(run?.attemptCount).toBe(2);
    expect(run?.branch).toBe("pause-run");

    // Resume the run with a completing binding on the same branch
    const resumeResult = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "pause-run",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
    });

    expect(resumeResult.kind).toBe("complete");
    expect(resumeResult.iterationsConsumed).toBe(1); // Fresh attempt
    expect(resumeResult.runId).toBe(pauseResult.runId);

    // Verify a new attempt was created
    run = loadRunOnce(stateDbPath, pauseResult.runId);
    expect(run?.status).toBe("completed");
    expect(run?.attemptCount).toBe(3); // Two paused + one new
    expect(run?.attempts).toHaveLength(3);
    expect(run?.attempts[2]?.outcomeKind).toBe("done");
  });

  test("executeWrite throw terminates as invocation_failure with run_execution_failed", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    const throwMessage = "ENOENT: spec-guidance missing";
    mock.module("./write.ts", () => ({
      executeWrite: async () => {
        throw new Error(throwMessage);
      },
    }));

    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "throw-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        logSink: sink,
      });

      expect(result).toMatchObject({
        kind: "invocation_failure",
        failureKind: "error",
        bindingAttempts: [],
        resumable: false,
        iterationsConsumed: 1,
      });

      const run = loadRunOnce(stateDbPath, result.runId);
      expect(run?.status).toBe("failed");
      expect(run?.attempts).toHaveLength(1);
      expect(run?.attempts[0]?.status).toBe("completed");
      expect(run?.attempts[0]?.outcomeKind).toBe("invocation_failure");
      expect(run?.attempts[0]?.invocationFailureDetail).toEqual({ failureKind: "error", bindingAttempts: [] });

      const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
      expect(events).toEqual(["iteration_started", "boundary_committed", "run_execution_failed"]);
      const failed = sink.getEventsForRun(result.runId).find((event) => event.kind === "run_execution_failed");
      expect(failed).toMatchObject({ kind: "run_execution_failed", message: throwMessage });
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("stalled executeWrite terminates the started attempt as iteration_timeout", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    mock.module("./write.ts", () => ({ executeWrite: () => new Promise<never>(() => undefined) }));

    try {
      const result = await executeWriteLoop({
        worktree: { projectRoot: "/fake", projectName: "demo", branchName: "timeout-run", baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        logSink: sink,
        iterationTimeoutMs: 10,
      });

      expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: false });
      const run = loadRunOnce(stateDbPath, result.runId);
      expect(run?.status).toBe("failed");
      expect(run?.attempts[0]?.outcomeKind).toBe("iteration_timeout");
      expect(sink.getEventsForRun(result.runId).map((event) => event.kind)).toEqual([
        "iteration_started",
        "boundary_committed",
        "loop_finished",
      ]);
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("timeout fences a delayed worktree callback before it can run", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    let callbackRan = false;

    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "fenced-timeout",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        sessionsDir: join(jarvisRoot, "sessions"),
        iterationTimeoutMs: 5,
        withExternalWorktree: async (_worktree, run) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          callbackRan = true;
          return {
            worktree: { path: "/fake", reused: true },
            lock: { kind: "acquired" },
            value: await run({ path: "/fake", reused: true }),
          };
        },
      });

      expect(result.kind).toBe("iteration_timeout");
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(callbackRan).toBe(false);
    } finally {
      store.close();
    }
  });

  test("gives each iteration a fresh timeout and ignores a late execution failure", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    let calls = 0;
    let rejectLate!: (error: Error) => void;
    mock.module("./write.ts", () => ({
      executeWrite: (input: WriteExecuteInput) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            worktreePath: input.worktree.projectRoot,
            worktreeReused: false,
            lock: { kind: "acquired" as const },
            result: {
              kind: "progress" as const,
              token: "progress" as const,
              invocation: { attempts: [], final: null, telemetryFailures: [] },
            },
          });
        }
        return new Promise<never>((_resolve, reject) => {
          rejectLate = reject;
        });
      },
    }));

    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "fresh-timeout",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["progress"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        logSink: sink,
        iterationTimeoutMs: 25,
      });

      expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 2, resumable: false });
      expect(calls).toBe(2);
      rejectLate(new Error("late failure"));
      await Promise.resolve();
      expect(sink.getEventsForRun(result.runId).filter((event) => event.kind === "loop_finished")).toHaveLength(1);
      expect(loadRunOnce(stateDbPath, result.runId)?.attempts.map((attempt) => attempt.outcomeKind)).toEqual([
        "progress",
        "iteration_timeout",
      ]);
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("lets an observed abort win before the watchdog, but not after it", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    mock.module("./write.ts", () => ({ executeWrite: () => new Promise<never>(() => undefined) }));

    try {
      const earlyAbort = new AbortController();
      setTimeout(() => earlyAbort.abort(), 5);
      const early = await executeWriteLoop({
        worktree: { projectRoot: "/fake", projectName: "demo", branchName: "abort-first", baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        signal: earlyAbort.signal,
        iterationTimeoutMs: 40,
      });
      expect(early).toMatchObject({ kind: "progress", resumable: true });

      const lateAbort = new AbortController();
      setTimeout(() => lateAbort.abort(), 40);
      const late = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "timeout-first",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        signal: lateAbort.signal,
        iterationTimeoutMs: 5,
      });
      expect(late).toMatchObject({ kind: "iteration_timeout", resumable: false });
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("executeWrite throw while aborted terminates as progress", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const controller = new AbortController();
    mock.module("./write.ts", () => ({
      executeWrite: async () => {
        controller.abort();
        throw new Error("pre-spawn failure");
      },
    }));

    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "throw-abort-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["progress"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        signal: controller.signal,
      });

      expect(result).toMatchObject({ kind: "progress", resumable: true, iterationsConsumed: 0 });
      expect(loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.status).toBe("in-progress");
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("promptId and promptPlaceholders forward through to executeWrite", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const captured: WriteExecuteInput[] = [];
    const stubResult: Awaited<ReturnType<typeof realExecuteWrite>> = {
      worktreePath: join(jarvisRoot, "worktrees", "demo", "prompt-id-run"),
      worktreeReused: false,
      lock: { kind: "acquired" },
      result: {
        kind: "complete",
        token: "done",
        invocation: { attempts: [], final: null, telemetryFailures: [] },
      },
    };
    mock.module("./write.ts", () => ({
      executeWrite: async (input: WriteExecuteInput) => {
        captured.push(input);
        return stubResult;
      },
    }));

    try {
      const loopInput: WriteLoopInput = {
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "prompt-id-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        promptId: "custom.prompt",
        promptPlaceholders: { FOO: "bar" },
      };

      const result = await executeWriteLoop(loopInput);

      expect(result.kind).toBe("complete");
      expect(captured).toHaveLength(1);
      expect(captured[0]?.promptId).toBe("custom.prompt");
      expect(captured[0]?.promptPlaceholders).toEqual({ FOO: "bar" });
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });
});
