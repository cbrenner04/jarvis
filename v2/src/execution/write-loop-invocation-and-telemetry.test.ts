import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import type { BindingAttemptSummary, InvocationFailureKind } from "./invocation-failure.ts";
import {
  loadRunOnce,
  loadTelemetryRows,
  loopTelemetry,
  registerWriteLoopExecuteWriteMockHooks,
  runLoop,
  TestLogSink,
  writeSpecIndex,
} from "./write-loop.test-support.ts";

describe("write loop", () => {
  registerWriteLoopExecuteWriteMockHooks();

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
          { bindingId: "sim.1", resultKind: "quota", agent: "sim-agent-1", model: "sim-model-1" },
          { bindingId: "sim.2", resultKind: "quota", agent: "sim-agent-2", model: "sim-model-2" },
        ],
      },
      {
        branchName: "model-config-run",
        bindings: simulatedBindings(["quota", "model_config"]),
        failureKind: "model_config",
        bindingAttempts: [
          { bindingId: "sim.1", resultKind: "quota", agent: "sim-agent-1", model: "sim-model-1" },
          { bindingId: "sim.2", resultKind: "model_config", agent: "sim-agent-2", model: "sim-model-2" },
        ],
      },
      {
        branchName: "error-run",
        bindings: simulatedBindings(["error"]),
        failureKind: "error",
        bindingAttempts: [{ bindingId: "sim.1", resultKind: "error", agent: "sim-agent-1", model: "sim-model-1" }],
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

  test("binding-chain invocation failure omits agent/model for a binding with no metadata", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async () => ({ kind: "error", exitCode: 1, stderr: "error" }),
        },
      ],
    });

    expect(result.kind).toBe("invocation_failure");
    const detail = loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.invocationFailureDetail;
    expect(detail?.bindingAttempts).toEqual([{ bindingId: "sim.1", resultKind: "error" }]);
  });

  test("binding-chain invocation failure persists only the bounded final stderr tail", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const earlierStderr = "earlier-attempt-stderr";
    const finalStderr = `discarded-final-prefix:${"z".repeat(2048)}`;
    const expectedMessage = finalStderr.slice(-2048);
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async () => ({ kind: "quota", stderr: earlierStderr }),
        },
        {
          id: "sim.2",
          invoke: async () => ({ kind: "error", exitCode: 1, stderr: finalStderr }),
        },
      ],
    });

    expect(result.kind).toBe("invocation_failure");
    const detail = loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.invocationFailureDetail;
    expect(detail?.message).toBe(expectedMessage);
    expect(detail?.message?.length).toBe(2048);
    expect(detail?.message).not.toContain(earlierStderr);
  });

  test("binding-chain invocation failure distinguishes empty and whitespace-only stderr", async () => {
    const cases = [
      { branchName: "empty-stderr-run", stderr: "", expectedMessage: undefined },
      { branchName: "whitespace-stderr-run", stderr: " \n\t ", expectedMessage: " \n\t " },
    ] as const;

    for (const testCase of cases) {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName: testCase.branchName,
        bindings: [
          {
            id: "sim.1",
            invoke: async () => ({ kind: "error", exitCode: 1, stderr: testCase.stderr }),
          },
        ],
      });

      expect(result.kind).toBe("invocation_failure");
      const detail = loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.invocationFailureDetail;
      expect(detail?.message).toBe(testCase.expectedMessage);
      if (testCase.expectedMessage === undefined) expect(detail).not.toHaveProperty("message");
    }
  });

  test("terminal invocation failure echoing the dispatched prompt suppresses the message, marks the detail, and emits the raw diagnostic event", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const echoedStderr = "Return exactly one terminal token.";
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      logSink: sink,
      bindings: [
        {
          id: "sim.1",
          invoke: async () => ({ kind: "error", exitCode: 1, stderr: echoedStderr }),
        },
      ],
    });

    expect(result.kind).toBe("invocation_failure");
    const detail = loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.invocationFailureDetail;
    expect(detail?.echoedInput).toBe(true);
    expect(detail).not.toHaveProperty("message");

    const diagnostic = sink
      .getEventsForRun(result.runId)
      .find((event) => event.kind === "invocation_failure_diagnostic");
    expect(diagnostic).toBeDefined();
    if (diagnostic?.kind === "invocation_failure_diagnostic") {
      expect(diagnostic.stderrTail).toBe(echoedStderr);
      expect(diagnostic.echoedInput).toBe(true);
    }
  });

  test("terminal invocation failure with an ordinary real stderr tail persists it unmarked and emits the same diagnostic event shape", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const realStderr = "TypeError: cannot read property 'foo' of undefined";
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      logSink: sink,
      bindings: [
        {
          id: "sim.1",
          invoke: async () => ({ kind: "error", exitCode: 1, stderr: realStderr }),
        },
      ],
    });

    expect(result.kind).toBe("invocation_failure");
    const detail = loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.invocationFailureDetail;
    expect(detail?.message).toBe(realStderr);
    expect(detail).not.toHaveProperty("echoedInput");

    const diagnostic = sink
      .getEventsForRun(result.runId)
      .find((event) => event.kind === "invocation_failure_diagnostic");
    expect(diagnostic).toBeDefined();
    if (diagnostic?.kind === "invocation_failure_diagnostic") {
      expect(diagnostic.stderrTail).toBe(realStderr);
      expect(diagnostic.echoedInput).toBe(false);
    }
  });

  test("terminal invocation failure surfaces retained diagnostics when the classification-scoped stderr is empty", async () => {
    // opencode scopes `stderr` for classification (its result envelope lands on stdout). An
    // `error` with empty stderr must still surface the retained stdout stream via `diagnostics`,
    // otherwise the failure diagnostic and persisted message are blank (the observed regression).
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const retained = '{"type":"text","part":{"text":"opencode run ended: unexpected exit"}}';
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      logSink: sink,
      bindings: [
        {
          id: "sim.1",
          invoke: async () => ({ kind: "error", exitCode: 1, stderr: "", diagnostics: retained }),
        },
      ],
    });

    expect(result.kind).toBe("invocation_failure");
    const detail = loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.invocationFailureDetail;
    expect(detail?.message).toBe(retained);

    const diagnostic = sink
      .getEventsForRun(result.runId)
      .find((event) => event.kind === "invocation_failure_diagnostic");
    expect(diagnostic).toBeDefined();
    if (diagnostic?.kind === "invocation_failure_diagnostic") {
      expect(diagnostic.stderrTail).toBe(retained);
    }
  });

  test("terminal invocation failure with non-empty stderr keeps the classifying phrase even under a huge retained stdout stream", async () => {
    // Regression guard: the retained diagnostics stream must not evict the classification-scoped
    // stderr from the bounded (2048-code-unit) tail. A real opencode quota/model_config/transient
    // failure carries the deciding phrase on stderr while streaming tens of KB of JSON on stdout;
    // the persisted message and diagnostic tail must show the phrase, not a truncated event frame.
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const phrase = "rate limit reached";
    const hugeStdout = `{"type":"text","part":{"text":"${"x".repeat(50_000)}"}}`;
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      logSink: sink,
      bindings: [
        {
          id: "sim.1",
          invoke: async () => ({ kind: "error", exitCode: 1, stderr: phrase, diagnostics: hugeStdout }),
        },
      ],
    });

    expect(result.kind).toBe("invocation_failure");
    const detail = loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.invocationFailureDetail;
    expect(detail?.message).toBe(phrase);

    const diagnostic = sink
      .getEventsForRun(result.runId)
      .find((event) => event.kind === "invocation_failure_diagnostic");
    expect(diagnostic).toBeDefined();
    if (diagnostic?.kind === "invocation_failure_diagnostic") {
      expect(diagnostic.stderrTail).toBe(phrase);
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

  test("telemetry row records usage and cost from ok result", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const telemetryPath = join(jarvisRoot, "telemetry.jsonl");
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "claude-with-cost",
          metadata: { agent: "claude", model: "sonnet" },
          confinementPolicy: "unrestricted",
          confinementMechanism: "none",
          invoke: async ({ cwd }) => {
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            return {
              kind: "ok" as const,
              stdout: "done",
              stderr: "",
              usage_source: "agent" as const,
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 25000,
              },
              cost_usd: 0.15,
              cost_source: "agent" as const,
            };
          },
        },
      ],
      telemetry: loopTelemetry(telemetryPath),
    });

    expect(result.kind).toBe("complete");
    const rows = loadTelemetryRows(telemetryPath);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.exit_kind).toBe("ok");
    expect(row?.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 25000,
    });
    expect(row?.usage_source).toBe("agent");
    expect(row?.cost_usd).toBe(0.15);
    expect(row?.cost_source).toBe("agent");
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

  test("publishes index and spec-path titles, with named failure for unreadable indexes", async () => {
    const cases: Array<{
      branchName: string;
      specPath: string;
      index?: string | undefined;
      title?: string | undefined;
      unreadable?: boolean;
      failure?: boolean;
    }> = [
      { branchName: "index-title", specPath: "spec/index.md", index: "#  Index title  \n", title: "Index title" },
      { branchName: "sibling-title", specPath: "spec/01-write.md", index: "# Sibling title\n", title: "01-write.md" },
      { branchName: "missing-title", specPath: "spec/index.md", index: undefined, title: undefined, failure: true },
      {
        branchName: "unreadable-title",
        specPath: "spec/index.md",
        index: undefined,
        unreadable: true,
        title: undefined,
        failure: true,
      },
      { branchName: "malformed-title", specPath: "spec/index.md", index: "#\n", title: "spec" },
      { branchName: "blank-title", specPath: "spec/index.md", index: "# \n", title: "spec" },
      { branchName: "whitespace-title", specPath: "spec/index.md", index: "# \t \n", title: "spec" },
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

      expect(result.kind).toBe(testCase.failure ? "completion_commit_failed" : "complete");
      expect(titles).toEqual(testCase.failure ? [] : [testCase.title]);
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
      "iteration_commit",
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
});
