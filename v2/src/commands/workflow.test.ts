import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { originTrackingRefResolvesAsync } from "../../../shared/git.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { createRunControlHandlers, WorktreeOwnershipRegistry } from "../daemon/daemon.ts";
import { withExternalWorktree } from "../execution/external-worktree.ts";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import { SurvivingMutationError } from "../execution/ready-finalize.ts";
import type { AnyWorkflowStep, ReviewDebateWorkflowStep, ReviewWorkflowStep } from "../execution/workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../execution/write-loop-input.ts";
import { connectIpcClient } from "../ipc/client.ts";
import type { RpcHandler } from "../ipc/server.ts";
import { type IpcServer, startIpcServer } from "../ipc/server.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import {
  type CliRepoFixture,
  COMPLETED_WAIT_JSON,
  COMPLETED_WAIT_RESULT,
  captureIo,
  INCOMPLETE_SPEC_CONTENT,
  cliMain as main,
  makeCliRepoFixture,
  makeIpcClient,
  makeStaleResetIpcClient,
  TEST_EXECUTABLE_DIGEST,
  withStaleResetPreflightUuids,
  withStaleResetWorkflowUuids,
  withWorkflowUuids,
  workflowFrames,
  writeMachineConfig,
} from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { makeIpcClient as makeDeferredIpcClient } from "../testing/ipc-client-fake.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { STALE_RESET_OVERRIDE_CLI_FLAG } from "./cleanup.ts";
import {
  setAttachWaitRunIdOverrideForTest,
  setForceSkipAttachClientWaitForTest,
  setInvertDetachClientWaitGuardForTest,
} from "./workflow.ts";

let fx: CliRepoFixture;

beforeAll(() => {
  fx = makeCliRepoFixture();
});

afterAll(() => {
  fx.cleanup();
});

const IMPLEMENT_ARGS = [
  "run",
  "workflow",
  "implement",
  "--branch",
  "implement-run",
  "--base",
  "HEAD",
  "--spec",
  "index.md",
] as const;

const IMPLEMENT_USAGE =
  "usage: jarvis run workflow implement --base <ref> --spec <path> [--branch <name>] [--artifact <path>] [--review-passes <n>] [--review-behavior debate|light] [--reset-despite-dirty] [--detach]\n";
const INTENT_USAGE =
  "usage: jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light] [--detach]\n";
const PLAN_USAGE =
  "usage: jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light] [--reset-despite-dirty] [--detach]\n";

function ipcFramesWithMethod(sent: readonly unknown[], method: string): unknown[] {
  return sent.filter((frame) => (frame as { method?: string }).method === method);
}

const REJECT_BASE_ARGS = {
  implement: IMPLEMENT_ARGS,
  intent: ["run", "workflow", "intent", "--seed-text", "Improve API"],
  "intent-reviewed": ["run", "workflow", "intent-reviewed", "--seed-text", "Improve API"],
  plan: ["run", "workflow", "plan", "--ready-intent", "spec/ready-intents/demo.md"],
  "plan-reviewed": ["run", "workflow", "plan-reviewed", "--ready-intent", "spec/ready-intents/demo.md"],
  "plan-reviewed-light": ["run", "workflow", "plan-reviewed-light", "--ready-intent", "spec/ready-intents/demo.md"],
} as const;

function noDaemonDeps(extra: NonNullable<Parameters<typeof main>[2]> = {}): NonNullable<Parameters<typeof main>[2]> {
  return {
    connectIpcClient: async () => {
      throw new Error("should not contact daemon");
    },
    ...extra,
  };
}

describe("run workflow dispatch", () => {
  test("run workflow implement sends start and wait IPC requests, blocks on completion, and prints run ID and wait JSON", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-888", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: `run-888\n${COMPLETED_WAIT_JSON}\n`, stderr: "" });
    expect(builtInput).toMatchObject({
      cwd: fx.repoSub,
      branchName: "implement-run",
      baseRef: "HEAD",
      specPath: "index.md",
      configPath: expect.any(String),
      projectRegistry: { "test-project": { root: fx.repoRoot } },
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: fx.fakeImplementSteps } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "run-888" } });
  });

  test.each([
    "surviving_mutation_failed",
    "ready_gate_failed",
    "completion_commit_failed",
  ])("run workflow implement admits a ticked %s lineage without rebuilding or starting a workflow", async (_outcomeKind) => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const specPath = join(fx.repoSub, "index.md");
    const original = INCOMPLETE_SPEC_CONTENT;
    let built = false;
    writeFileSync(specPath, "# Index\n\n## Acceptance criteria\n\n- [x] recovered\n", "utf8");
    try {
      const code = await withFixedUuid("00000000-0000-4000-8000-000000000111", () =>
        main([...IMPLEMENT_ARGS], cap.io, {
          cwd: () => fx.repoSub,
          readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
          workflowPresetBuilders: {
            implement: () => {
              built = true;
              return { ok: false, error: "implement.already_complete" };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                {
                  kind: "response",
                  id: "00000000-0000-4000-8000-000000000111",
                  result: { kind: "admitted", ok: true, prUrl: "https://example.test/pr/1" },
                },
              ],
              { sent },
            ),
        }),
      );
      expect(code).toBe(0);
      expect(built).toBe(false);
      expect(cap.read()).toEqual({ stdout: "https://example.test/pr/1\n", stderr: "" });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        kind: "request",
        method: "implement.recover",
        params: { project: "test-project", branch: "implement-run", specPath: "sub/index.md" },
      });
    } finally {
      writeFileSync(specPath, original, "utf8");
    }
  });

  test("run workflow implement keeps the complete-spec refusal when recovery is not admitted", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const specPath = join(fx.repoSub, "index.md");
    writeFileSync(specPath, "# Index\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
    try {
      const code = await withFixedUuid("00000000-0000-4000-8000-000000000112", () =>
        main([...IMPLEMENT_ARGS], cap.io, {
          cwd: () => fx.repoSub,
          readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
          workflowPresetBuilders: { implement: () => ({ ok: false, error: "implement.already_complete: complete" }) },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                {
                  kind: "response",
                  id: "00000000-0000-4000-8000-000000000112",
                  result: { kind: "not_admitted" },
                },
              ],
              { sent },
            ),
        }),
      );
      expect(code).toBe(1);
      expect(cap.read()).toEqual({ stdout: "", stderr: "implement.already_complete: complete\n" });
      expect(sent).toHaveLength(1);
      expect((sent[0] as { method?: string }).method).toBe("implement.recover");
    } finally {
      writeFileSync(specPath, INCOMPLETE_SPEC_CONTENT, "utf8");
    }
  });

  test("recovery uses the implement completion traversal and canonical spec identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-recovery-canonical-"));
    const rootLink = `${root}-link`;
    mkdirSync(join(root, "specs"));
    writeFileSync(join(root, "specs", "subspec.md"), "## Acceptance criteria\n\n- [x] done\n", "utf8");
    writeFileSync(join(root, "specs", "index.md"), "- [x] [subspec](./subspec.md)\n", "utf8");
    symlinkSync(root, rootLink);
    const cap = captureIo();
    const sent: unknown[] = [];
    try {
      const code = await withFixedUuid("00000000-0000-4000-8000-000000000115", () =>
        main(["run", "workflow", "implement", "--base", "HEAD", "--spec", "specs/index.md"], cap.io, {
          cwd: () => rootLink,
          readProjectRegistry: () => ({ demo: { root: rootLink } }),
          workflowPresetBuilders: { implement: () => ({ ok: false, error: "should not build" }) },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                {
                  kind: "response",
                  id: "00000000-0000-4000-8000-000000000115",
                  result: { kind: "admitted", ok: true },
                },
              ],
              { sent },
            ),
        }),
      );
      expect(code).toBe(0);
      expect(sent[0]).toMatchObject({
        method: "implement.recover",
        params: { project: "demo", branch: "specs", specPath: "specs/index.md" },
      });

      writeFileSync(join(root, "specs", "subspec.md"), "## Acceptance criteria\n\n- [ ] pending\n", "utf8");
      const incompleteCap = captureIo();
      let built = false;
      const incomplete = await main(
        ["run", "workflow", "implement", "--base", "HEAD", "--spec", "specs/index.md"],
        incompleteCap.io,
        noDaemonDeps({
          cwd: () => rootLink,
          readProjectRegistry: () => ({ demo: { root: rootLink } }),
          workflowPresetBuilders: {
            implement: () => {
              built = true;
              return { ok: false, error: "ordinary preflight" };
            },
          },
        }),
      );
      expect(incomplete).toBe(1);
      expect(built).toBe(true);
      expect(incompleteCap.read().stderr).toBe("ordinary preflight\n");
    } finally {
      rmSync(rootLink, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("run workflow implement reports the admitted recovery failure message", async () => {
    const cap = captureIo();
    const specPath = join(fx.repoSub, "index.md");
    writeFileSync(specPath, "# Index\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
    try {
      const code = await withFixedUuid("00000000-0000-4000-8000-000000000113", () =>
        main([...IMPLEMENT_ARGS], cap.io, {
          cwd: () => fx.repoSub,
          readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
          workflowPresetBuilders: { implement: () => ({ ok: false, error: "should not build" }) },
          connectIpcClient: async () =>
            makeIpcClient([
              {
                kind: "response",
                id: "00000000-0000-4000-8000-000000000113",
                result: { kind: "admitted", ok: false, message: "surviving mutation: source.ts:12" },
              },
            ]),
        }),
      );
      expect(code).toBe(1);
      expect(cap.read()).toEqual({ stdout: "", stderr: "surviving mutation: source.ts:12\n" });
    } finally {
      writeFileSync(specPath, INCOMPLETE_SPEC_CONTENT, "utf8");
    }
  });

  test("run workflow implement detaches an admitted recovery", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const specPath = join(fx.repoSub, "index.md");
    writeFileSync(specPath, "# Index\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
    try {
      const code = await withFixedUuid("00000000-0000-4000-8000-000000000114", () =>
        main([...IMPLEMENT_ARGS, "--detach"], cap.io, {
          cwd: () => fx.repoSub,
          readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
          workflowPresetBuilders: { implement: () => ({ ok: false, error: "should not build" }) },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                {
                  kind: "response",
                  id: "00000000-0000-4000-8000-000000000114",
                  result: { kind: "admitted", ok: true },
                },
              ],
              { sent },
            ),
        }),
      );
      expect(code).toBe(0);
      expect(sent[0]).toMatchObject({ method: "implement.recover", params: { detach: true } });
    } finally {
      writeFileSync(specPath, INCOMPLETE_SPEC_CONTENT, "utf8");
    }
  });

  test("run workflow dispatches once to the connected daemon without stopping or restarting it", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    let connections = 0;
    await withWorkflowUuids("start", "wait", async () => {
      const code = await main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () => {
          connections += 1;
          return makeIpcClient(workflowFrames("start", "wait", "workflow-1", COMPLETED_WAIT_RESULT), { sent });
        },
        stopDaemon: async () => {
          throw new Error("should not stop");
        },
        startDaemon: async () => {
          throw new Error("should not start");
        },
      });
      expect(code).toBe(0);
    });
    expect(connections).toBe(1);
    expect(sent.map((frame) => (frame as { method?: string }).method)).toEqual(["start", "wait"]);
  });

  test("run workflow implement rejects --no-auto-bounce as unknown before daemon contact", async () => {
    const cap = captureIo();

    const code = await main([...IMPLEMENT_ARGS, "--no-auto-bounce"], cap.io, noDaemonDeps({ cwd: () => fx.repoSub }));

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: IMPLEMENT_USAGE });
  });

  test("run workflow implement blocks on completion and exits with proper exit code when workflow fails", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-failed", { runStatus: "failed" }), { sent }),
      }),
    );

    expect(code).toBe(3);
    expect(cap.read().stdout).toContain("run-failed");
    expect(cap.read().stdout).toContain('{"runStatus":"failed"}');
    expect(sent).toHaveLength(2);
  });

  test("run workflow implement passes through daemon guard errors without local workflow logic", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000005";

    const code = await withFixedUuid(requestId, () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () =>
          makeIpcClient([
            {
              kind: "error",
              id: requestId,
              code: "run_in_progress",
              message: "A run is already in progress; at most one in-flight run globally",
            },
          ]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "run_in_progress: A run is already in progress; at most one in-flight run globally\n",
    });
  });

  test("run workflow implement exits nonzero on an invalid daemon response", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000006";

    const code = await withFixedUuid(requestId, () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () => makeIpcClient([{ kind: "response", id: requestId, result: { runId: 123 } }]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "invalid daemon response\n" });
  });

  test("run workflow implement missing required flags prints usage and exits 1 without contacting the daemon", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "implement", "--branch", "implement-run"], cap.io, noDaemonDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: IMPLEMENT_USAGE });
  });

  test("run workflow with an unrecognized preset name prints workflow usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "bogus"], cap.io, noDaemonDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "usage: jarvis run workflow <intent|plan|implement> [flags]\n" });
  });

  test("run workflow rejects inherited preset names without contacting the daemon", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "toString"], cap.io, noDaemonDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "usage: jarvis run workflow <intent|plan|implement> [flags]\n" });
  });

  test("bare run workflow prints workflow usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow"], cap.io, noDaemonDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "usage: jarvis run workflow <intent|plan|implement> [flags]\n" });
  });
});

describe("ticked implement recovery", () => {
  function createRecoveryFixture(args: {
    outcomeKind:
      | "surviving_mutation_failed"
      | "ready_gate_failed"
      | "completion_commit_failed"
      | "runtime_smoke_failed"
      | "mutation_repair_exhausted";
    specPath?: string;
    worktreePath?: string;
    branch?: string;
    claimed?: boolean;
    readyFinalizer?: () => Promise<void>;
  }) {
    const root = mkdtempSync(join(tmpdir(), "jarvis-ticked-recovery-"));
    const worktreePath = args.worktreePath ?? root;
    const branch = args.branch ?? "recover";
    const dbPath = join(root, "state.sqlite");
    const logsPath = join(root, "logs.jsonl");
    writeFileSync(join(root, "spec.md"), "# Spec\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.test"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
    if (branch !== "missing") execFileSync("git", ["branch", branch], { cwd: root });

    const store = openStateStore(dbPath);
    const snapshot = {
      invocationId: "ticked-recovery",
      creationTitle: "implement: recovery",
      steps: [
        {
          stepId: "implement",
          role: "implement",
          stepRules: "rules",
          expectedArtifactPath: "spec.md",
          agents: ["codex"],
          agentModelConfig: {},
        },
        { stepId: "implement-review", role: "", durable: true, behavior: "review" as const },
      ],
    };
    const common = {
      project: "demo",
      specRef: "HEAD",
      worktreePath,
      branch,
      specPath: args.specPath ?? "spec.md",
      workflowSnapshot: snapshot,
    };
    const writeRunId = store.createRun({ ...common, stepId: "implement" });
    const writeAttemptId = store.recordAttemptStart(writeRunId);
    store.commitCompletionBoundary({
      attemptId: writeAttemptId,
      runStatus: "completed",
      outcomeKind: "done",
      completionAgent: "codex",
    });
    const reviewRunId = store.createRun({ ...common, stepId: "implement-review" });
    const reviewAttemptId = store.recordAttemptStart(reviewRunId);
    store.commitCompletionBoundary({
      attemptId: reviewAttemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
      invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: "prior failure" },
    });
    const sink = openLogSink(logsPath);
    sink.append(reviewRunId, {
      kind: "loop_finished",
      loopOutcomeKind: args.outcomeKind,
      iterationsConsumed: 0,
      resumable: args.outcomeKind !== "mutation_repair_exhausted",
    });
    sink.close();

    let writes = 0;
    let ready = 0;
    let publishes = 0;
    const registry = new WorktreeOwnershipRegistry();
    if (args.claimed) registry.claim({ project: "demo", branch }, { runId: "other", worktreePath });
    const handlers = createRunControlHandlers({
      stateStore: store,
      logReader: openLogReader(logsPath),
      registry,
      writeLoopExecutor: async () => {
        writes += 1;
      },
      failureReporter: () => undefined,
      hasMemoryHeadroom: () => true,
      settleDelayMs: 0,
      intentFinalizationResumeDeps: {
        completionCommitter: async () => ({ commitSha: "deadbeef", filesChanged: 1 }),
        completionPublisher: async () => {
          publishes += 1;
          return { pushSha: "deadbeef", prNumber: 7, prUrl: "https://example.test/pr/7" };
        },
        readyFinalizer: async () => {
          ready += 1;
          await args.readyFinalizer?.();
        },
      },
    });
    return {
      root,
      store,
      reviewRunId,
      handlers,
      calls: () => ({ writes, ready, publishes }),
      cleanup: () => {
        handlers.close();
        store.close();
        rmSync(root, { recursive: true, force: true });
      },
    };
  }

  test.each([
    "surviving_mutation_failed",
    "ready_gate_failed",
    "completion_commit_failed",
  ] as const)("admits a retained %s lineage and finalizes without a write-step invocation", async (outcomeKind) => {
    const fixture = createRecoveryFixture({ outcomeKind });
    try {
      const frame = await fixture.handlers["implement.recover"](
        {
          kind: "request",
          id: "recover",
          method: "implement.recover",
          params: { project: "demo", branch: "recover", specPath: "spec.md" },
        },
        new AbortController().signal,
      );
      expect(frame).toMatchObject({
        kind: "response",
        result: { kind: "admitted", ok: true, prUrl: "https://example.test/pr/7" },
      });
      expect(fixture.calls()).toEqual({ writes: 0, ready: 1, publishes: 1 });
      expect(fixture.store.loadRun(fixture.reviewRunId)?.status).toBe("completed");
      expect(readFileSync(join(fixture.root, "spec.md"), "utf8")).toContain("- [x] complete");
    } finally {
      fixture.cleanup();
    }
  });

  test("refuses mismatched, excluded, missing, and claimed recovery targets without dispatch", async () => {
    const cases = [
      {
        args: { outcomeKind: "surviving_mutation_failed" as const, specPath: "other.md" },
        params: { specPath: "spec.md" },
        code: undefined,
      },
      { args: { outcomeKind: "runtime_smoke_failed" as const }, params: { specPath: "spec.md" }, code: undefined },
      { args: { outcomeKind: "mutation_repair_exhausted" as const }, params: { specPath: "spec.md" }, code: undefined },
      {
        args: {
          outcomeKind: "surviving_mutation_failed" as const,
          worktreePath: join(tmpdir(), "missing-recovery-worktree"),
        },
        params: { specPath: "spec.md" },
        code: "implement.recovery_target_missing",
      },
      {
        args: { outcomeKind: "surviving_mutation_failed" as const, branch: "missing" },
        params: { specPath: "spec.md", branch: "missing" },
        code: "implement.recovery_target_missing",
      },
      {
        args: { outcomeKind: "surviving_mutation_failed" as const, claimed: true },
        params: { specPath: "spec.md" },
        code: "worktree_claimed",
      },
    ];
    for (const testCase of cases) {
      const fixture = createRecoveryFixture(testCase.args);
      try {
        const frame = await fixture.handlers["implement.recover"](
          {
            kind: "request",
            id: "recover",
            method: "implement.recover",
            params: {
              project: "demo",
              branch: testCase.params.branch ?? "recover",
              specPath: testCase.params.specPath,
            },
          },
          new AbortController().signal,
        );
        if (testCase.code === undefined)
          expect(frame).toMatchObject({ kind: "response", result: { kind: "not_admitted" } });
        else expect(frame).toMatchObject({ kind: "error", code: testCase.code });
        expect(fixture.calls()).toEqual({ writes: 0, ready: 0, publishes: 0 });
      } finally {
        fixture.cleanup();
      }
    }
  });

  test("keeps a still-surviving mutation failed and retryable without unticking the spec", async () => {
    const fixture = createRecoveryFixture({
      outcomeKind: "surviving_mutation_failed",
      readyFinalizer: async () => {
        throw new SurvivingMutationError("flip ===", "src/guard.ts", 12);
      },
    });
    try {
      const frame = await fixture.handlers["implement.recover"](
        {
          kind: "request",
          id: "recover",
          method: "implement.recover",
          params: { project: "demo", branch: "recover", specPath: "spec.md" },
        },
        new AbortController().signal,
      );
      expect(frame).toMatchObject({ kind: "response", result: { kind: "admitted", ok: false } });
      expect(fixture.calls()).toEqual({ writes: 0, ready: 1, publishes: 1 });
      expect(fixture.store.loadRun(fixture.reviewRunId)?.status).toBe("failed");
      expect(readFileSync(join(fixture.root, "spec.md"), "utf8")).toContain("- [x] complete");
    } finally {
      fixture.cleanup();
    }
  });

  test("detached recovery remains active until its finalization settles", async () => {
    let releaseFinalizer: (() => void) | undefined;
    const fixture = createRecoveryFixture({
      outcomeKind: "surviving_mutation_failed",
      readyFinalizer: async () =>
        await new Promise<void>((resolve) => {
          releaseFinalizer = resolve;
        }),
    });
    try {
      const frame = await fixture.handlers["implement.recover"](
        {
          kind: "request",
          id: "recover",
          method: "implement.recover",
          params: { project: "demo", branch: "recover", specPath: "spec.md", detach: true },
        },
        new AbortController().signal,
      );
      expect(frame).toMatchObject({ kind: "response", result: { kind: "admitted", ok: true } });
      expect(fixture.handlers.hasActiveRuns()).toBe(true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      releaseFinalizer?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fixture.handlers.hasActiveRuns()).toBe(false);
      expect(fixture.store.loadRun(fixture.reviewRunId)?.status).toBe("completed");
    } finally {
      fixture.cleanup();
    }
  });
});

const INTENT_STAGE_DURABLE_DIR = "v2/spec/ready-intents";

function fakeIntentStageWriteSteps(repoRoot: string): AnyWorkflowStep[] {
  return [
    {
      behavior: "write",
      stepId: "intent-split",
      role: "intent",
      promptId: "intent.prompt.split",
      stepRules: DEFAULT_WRITE_STEP_RULES,
      agents: ["claude"],
      agentModelConfig: {},
      worktree: {
        projectRoot: realpathSync(repoRoot),
        projectName: "demo",
        branchName: "intent-run",
        baseRef: "HEAD",
      },
      specPath: "seed.md",
      expectedArtifactPath: ".jarvis-intent-stage",
      publishCompletion: false,
      landing: {
        kind: "intent-stage",
        output: { durableDir: INTENT_STAGE_DURABLE_DIR },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "intent-paths-test",
        baseRef: "HEAD",
      },
    },
  ];
}

describe("workflow detach after admission", () => {
  afterEach(() => {
    setInvertDetachClientWaitGuardForTest(false);
  });

  test("run workflow implement with --detach admits and exits without client wait", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS, "--detach"], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: fx.fakeImplementSteps }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-detach-1", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "run-detach-1\n", stderr: "" });
    expect(ipcFramesWithMethod(sent, "wait")).toHaveLength(0);
    expect(ipcFramesWithMethod(sent, "start").length).toBeGreaterThan(0);
  });

  test("inverting the detach client-wait guard fails run workflow implement with --detach admits and exits without client wait", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    setInvertDetachClientWaitGuardForTest(true);

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS, "--detach"], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: fx.fakeImplementSteps }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-detach-guard", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(ipcFramesWithMethod(sent, "wait")).toHaveLength(1);
    expect(cap.read().stdout).toContain(COMPLETED_WAIT_JSON);
  });

  test("run workflow implement passes through daemon guard errors without local workflow logic when --detach is set", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000005";

    const code = await withFixedUuid(requestId, () =>
      main([...IMPLEMENT_ARGS, "--detach"], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () =>
          makeIpcClient([
            {
              kind: "error",
              id: requestId,
              code: "run_in_progress",
              message: "A run is already in progress; at most one in-flight run globally",
            },
          ]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "run_in_progress: A run is already in progress; at most one in-flight run globally\n",
    });
  });

  test("run workflow intent with --detach prints intent paths stderr before run ID without client wait", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const intentSteps = fakeIntentStageWriteSteps(fx.repoRoot);
    const runId = "intent-detach-paths";

    const code = await withWorkflowUuids("start", "wait", () =>
      main(["run", "workflow", "intent", "--seed-text", "Improve API", "--detach"], cap.io, {
        cwd: () => fx.repoRoot,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          intent: () => ({ ok: true, steps: intentSteps }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", runId, COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({
      stdout: `${runId}\n`,
      stderr: `intent paths: ${INTENT_STAGE_DURABLE_DIR}\n`,
    });
    expect(ipcFramesWithMethod(sent, "wait")).toHaveLength(0);
  });

  test("run workflow intent prints intent paths stderr before run ID when attached", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const intentSteps = fakeIntentStageWriteSteps(fx.repoRoot);
    const runId = "intent-attach-paths";

    const code = await withWorkflowUuids("start", "wait", () =>
      main(["run", "workflow", "intent", "--seed-text", "Improve API"], cap.io, {
        cwd: () => fx.repoRoot,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          intent: () => ({ ok: true, steps: intentSteps }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", runId, COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    const output = cap.read();
    expect(output.stderr).toBe(`intent paths: ${INTENT_STAGE_DURABLE_DIR}\n`);
    expect(output.stdout).toContain(`${runId}\n`);
    expect(ipcFramesWithMethod(sent, "wait")).toHaveLength(1);
  });

  test.skipIf(!canUseUnixSockets())(
    "after detach the workflow reaches workflow entry terminal while the launching CLI has already exited",
    async () => {
      const runId = "run-detach-continuation";
      const fixture: DetachContinuationFixture = { entryTerminal: false, releaseEntryTerminal: () => {} };
      const { server, socketPath } = await startDetachContinuationWorkflowServer(runId, fixture);
      const machineConfigPath = writeMachineConfig({ projects: { "test-project": { root: fx.repoRoot } } });
      const childDir = mkdtempSync(join(tmpdir(), "jarvis-workflow-cli-child-"));
      const childScriptPath = join(childDir, "child.ts");

      try {
        const proc = spawnWorkflowCliChild(childScriptPath, {
          socketPath,
          cwd: fx.repoSub,
          registry: { "test-project": { root: fx.repoRoot } },
          argv: [...IMPLEMENT_ARGS, "--detach"],
          steps: fx.fakeImplementSteps,
          machineConfigPath,
        });

        const exitCode = await proc.exited;
        expect(exitCode).toBe(0);
        expect(fixture.entryTerminal).toBe(false);

        fixture.releaseEntryTerminal();
        expect(fixture.entryTerminal).toBe(true);
      } finally {
        await server.close();
        rmSync(socketPath, { force: true });
        rmSync(childDir, { recursive: true, force: true });
      }
    },
  );

  test.each([
    ["implement", [...IMPLEMENT_ARGS, "--detach"], "implement", () => fx.repoSub],
    ["intent", ["run", "workflow", "intent", "--seed-text", "Improve API", "--detach"], "intent", () => fx.repoRoot],
    [
      "intent-reviewed",
      ["run", "workflow", "intent-reviewed", "--seed-text", "Improve API", "--detach"],
      "intent",
      () => fx.repoRoot,
    ],
    [
      "plan",
      ["run", "workflow", "plan", "--ready-intent", "spec/ready-intents/demo.md", "--detach"],
      "plan",
      () => fx.repoRoot,
    ],
    [
      "plan-reviewed",
      ["run", "workflow", "plan-reviewed", "--ready-intent", "spec/ready-intents/demo.md", "--detach"],
      "plan",
      () => fx.repoRoot,
    ],
    [
      "plan-reviewed-light",
      ["run", "workflow", "plan-reviewed-light", "--ready-intent", "spec/ready-intents/demo.md", "--detach"],
      "plan",
      () => fx.repoRoot,
    ],
  ] as const)("run workflow %s accepts --detach without client wait", async (_label, args, builderKey, cwd) => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const runId = `detach-${_label}`;

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...args], cap.io, {
        cwd,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          [builderKey]: () => ({ ok: true, steps: fx.fakeImplementSteps }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", runId, COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toBe(`${runId}\n`);
    expect(ipcFramesWithMethod(sent, "wait")).toHaveLength(0);
  });
});

const ATTACHED_ENTRY_WAIT_RUN_ID = "attached-entry-wait-run";
const ATTACHED_CONSTITUENT_WAIT_RUN_ID = "attached-constituent-wait-run";
const ATTACHED_CONSTITUENT_WAIT_RESULT = {
  runStatus: "completed",
  loopOutcomeKind: "complete",
  iterationsConsumed: 1,
  resumable: false,
} as const;
const ATTACHED_HELD_ENTRY_WAIT_RESULT = {
  runStatus: "failed",
  loopOutcomeKind: "invocation_failure",
  iterationsConsumed: 2,
  resumable: false,
} as const;
const ATTACHED_HELD_ENTRY_WAIT_JSON =
  '{"runStatus":"failed","loopOutcomeKind":"invocation_failure","iterationsConsumed":2,"resumable":false}';
const ATTACHED_HELD_ENTRY_WAIT_EXIT = 2;
const ATTACHED_HELD_ENTRY_WAIT_STDOUT = `${ATTACHED_ENTRY_WAIT_RUN_ID}\n${ATTACHED_HELD_ENTRY_WAIT_JSON}\n`;

type AttachedEntryWaitFixture = {
  whenEntryWaitPending: Promise<void>;
  releaseEntryWait: () => void;
};

type DetachContinuationFixture = {
  entryTerminal: boolean;
  releaseEntryTerminal: () => void;
};

function createAttachedEntryWaitRpcHandlers(): {
  handlers: Record<string, RpcHandler>;
  fixture: AttachedEntryWaitFixture;
} {
  let releaseHeld: (() => void) | undefined;
  let notifyEntryWaitPending: (() => void) | undefined;
  const whenEntryWaitPending = new Promise<void>((resolve) => {
    notifyEntryWaitPending = resolve;
  });

  const handlers: Record<string, RpcHandler> = {
    health: () => ({ kind: "response", result: { ok: true } }),
    status: () => ({ kind: "response", result: { state: "running" } }),
    start: () => ({ kind: "response", result: { runId: ATTACHED_ENTRY_WAIT_RUN_ID } }),
    wait: async (frame) => {
      const runId = (frame.params as { runId?: string } | undefined)?.runId;
      if (runId === ATTACHED_CONSTITUENT_WAIT_RUN_ID) {
        return { kind: "response", result: ATTACHED_CONSTITUENT_WAIT_RESULT };
      }
      if (runId === ATTACHED_ENTRY_WAIT_RUN_ID) {
        notifyEntryWaitPending?.();
        notifyEntryWaitPending = undefined;
        await new Promise<void>((resolve) => {
          releaseHeld = resolve;
        });
        return { kind: "response", result: ATTACHED_HELD_ENTRY_WAIT_RESULT };
      }
      return { kind: "error", code: "unknown_run", message: `unknown run: ${String(runId)}` };
    },
  };

  return {
    handlers,
    fixture: {
      whenEntryWaitPending,
      releaseEntryWait: () => {
        releaseHeld?.();
        releaseHeld = undefined;
      },
    },
  };
}

function createDetachContinuationRpcHandlers(
  runId: string,
  fixture: DetachContinuationFixture,
): Record<string, RpcHandler> {
  let releaseHeld: (() => void) | undefined;
  fixture.releaseEntryTerminal = () => {
    releaseHeld?.();
    releaseHeld = undefined;
  };

  return {
    health: () => ({ kind: "response", result: { ok: true } }),
    status: () => ({ kind: "response", result: { state: "running" } }),
    start: () => {
      void new Promise<void>((resolve) => {
        releaseHeld = () => {
          fixture.entryTerminal = true;
          resolve();
        };
      });
      return { kind: "response", result: { runId } };
    },
  };
}

const jarvisRepoRoot = join(import.meta.dir, "../../..");

function writeWorkflowCliChildScript(scriptPath: string): void {
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(
    scriptPath,
    `import { join } from "node:path";
import { main } from ${JSON.stringify(join(jarvisRepoRoot, "v2/src/cli.ts"))};
import { createRuntimeDeps } from ${JSON.stringify(join(jarvisRepoRoot, "v2/src/cli/deps.ts"))};
import { connectIpcClient } from ${JSON.stringify(join(jarvisRepoRoot, "v2/src/ipc/client.ts"))};
import { TEST_EXECUTABLE_DIGEST } from ${JSON.stringify(join(jarvisRepoRoot, "v2/src/testing/cli-test-helpers.ts"))};

const socketPath = process.env.JARVIS_WORKFLOW_CLI_SOCKET!;
const cwd = process.env.JARVIS_WORKFLOW_CLI_CWD!;
const registry = JSON.parse(process.env.JARVIS_WORKFLOW_CLI_REGISTRY!);
const argv = JSON.parse(process.env.JARVIS_WORKFLOW_CLI_ARGV!) as string[];
const steps = JSON.parse(process.env.JARVIS_WORKFLOW_CLI_STEPS!);
const machineConfigPath = process.env.JARVIS_WORKFLOW_CLI_MACHINE_CONFIG!;
const socketDir = join(socketPath, "..");

const code = await main(argv, undefined, createRuntimeDeps({
  cwd: () => cwd,
  socketPath,
  pidPath: join(socketDir, "daemon.pid"),
  logPath: join(socketDir, "daemon.log"),
  connectIpcClient,
  startDaemon: async (sp) => ({ pid: process.pid, socketPath: sp }),
  getDaemonStatus: async () => ({
    state: "running" as const,
    loadedRevision: "test",
    currentRevision: "test",
  }),
  readProjectRegistry: () => registry,
  workflowPresetBuilders: { implement: () => ({ ok: true, steps }) },
  getExecutableDigest: async () => TEST_EXECUTABLE_DIGEST,
  machineConfigPath,
}));
process.exit(code);
`,
    "utf8",
  );
}

type WorkflowCliChildEnv = {
  socketPath: string;
  cwd: string;
  registry: Record<string, { root: string }>;
  argv: readonly string[];
  steps: AnyWorkflowStep[];
  machineConfigPath: string;
};

function spawnWorkflowCliChild(scriptPath: string, env: WorkflowCliChildEnv) {
  writeWorkflowCliChildScript(scriptPath);
  return Bun.spawn([process.execPath, scriptPath], {
    env: {
      ...process.env,
      JARVIS_WORKFLOW_CLI_SOCKET: env.socketPath,
      JARVIS_WORKFLOW_CLI_CWD: env.cwd,
      JARVIS_WORKFLOW_CLI_REGISTRY: JSON.stringify(env.registry),
      JARVIS_WORKFLOW_CLI_ARGV: JSON.stringify(env.argv),
      JARVIS_WORKFLOW_CLI_STEPS: JSON.stringify(env.steps),
      JARVIS_WORKFLOW_CLI_MACHINE_CONFIG: env.machineConfigPath,
    },
    stdout: "pipe" as const,
    stderr: "pipe" as const,
    cwd: env.cwd,
  });
}

async function startAttachedEntryWaitWorkflowServer(): Promise<{
  server: IpcServer;
  socketPath: string;
  fixture: AttachedEntryWaitFixture;
}> {
  const socketPath = join(tmpdir(), `jarvis-attached-workflow-${process.pid}-${crypto.randomUUID()}.sock`);
  rmSync(socketPath, { force: true });
  const { handlers, fixture } = createAttachedEntryWaitRpcHandlers();
  const server = await startIpcServer(socketPath, handlers);
  return { server, socketPath, fixture };
}

async function startDetachContinuationWorkflowServer(
  runId: string,
  fixture: DetachContinuationFixture,
): Promise<{ server: IpcServer; socketPath: string }> {
  const socketPath = join(tmpdir(), `jarvis-detach-continuation-${process.pid}-${crypto.randomUUID()}.sock`);
  rmSync(socketPath, { force: true });
  const handlers = createDetachContinuationRpcHandlers(runId, fixture);
  const server = await startIpcServer(socketPath, handlers);
  return { server, socketPath };
}

function attachedEntryWaitWorkflowDeps(
  socketPath: string,
  machineConfigPath: string,
  cwd: string,
  steps: AnyWorkflowStep[],
) {
  const socketDir = dirname(socketPath);
  return {
    cwd: () => cwd,
    socketPath,
    pidPath: join(socketDir, "daemon.pid"),
    logPath: join(socketDir, "daemon.log"),
    machineConfigPath,
    connectIpcClient,
    startDaemon: async (sp: string) => ({ pid: process.pid, socketPath: sp }),
    readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
    workflowPresetBuilders: { implement: () => ({ ok: true, steps }) },
    getExecutableDigest: async () => TEST_EXECUTABLE_DIGEST,
  };
}

async function assertAttachedEntryTerminalWait(): Promise<void> {
  const { server, socketPath, fixture } = await startAttachedEntryWaitWorkflowServer();
  const machineConfigPath = writeMachineConfig({ projects: { "test-project": { root: fx.repoRoot } } });
  const steps = fx.fakeImplementSteps;
  const argv = [...IMPLEMENT_ARGS];
  const childDir = mkdtempSync(join(tmpdir(), "jarvis-workflow-cli-child-"));
  const childScriptPath = join(childDir, "child.ts");

  try {
    const proc = spawnWorkflowCliChild(childScriptPath, {
      socketPath,
      cwd: fx.repoSub,
      registry: { "test-project": { root: fx.repoRoot } },
      argv,
      steps,
      machineConfigPath,
    });

    await fixture.whenEntryWaitPending;
    expect(proc.exitCode).toBeNull();
    fixture.releaseEntryWait();
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(ATTACHED_HELD_ENTRY_WAIT_EXIT);
    expect(stdout).toBe(ATTACHED_HELD_ENTRY_WAIT_STDOUT);
  } finally {
    await server.close();
    rmSync(socketPath, { force: true });
    rmSync(childDir, { recursive: true, force: true });
  }
}

async function expectAttachedWorkflowMissesEntryTerminalContract(mutate: () => void): Promise<void> {
  mutate();
  const { server, socketPath } = await startAttachedEntryWaitWorkflowServer();
  const machineConfigPath = writeMachineConfig({ projects: { "test-project": { root: fx.repoRoot } } });
  const cap = captureIo();
  try {
    const code = await main(
      [...IMPLEMENT_ARGS],
      cap.io,
      attachedEntryWaitWorkflowDeps(socketPath, machineConfigPath, fx.repoSub, fx.fakeImplementSteps) as NonNullable<
        Parameters<typeof main>[2]
      >,
    );
    const stdout = cap.read().stdout;
    expect(code === ATTACHED_HELD_ENTRY_WAIT_EXIT && stdout === ATTACHED_HELD_ENTRY_WAIT_STDOUT).toBe(false);
  } finally {
    await server.close();
    rmSync(socketPath, { force: true });
  }
}

describe("workflow attached entry-terminal wait", () => {
  const attachedSocketTest = test.skipIf(!canUseUnixSockets());

  afterEach(() => {
    setForceSkipAttachClientWaitForTest(false);
    setAttachWaitRunIdOverrideForTest(undefined);
  });

  attachedSocketTest(
    "attached run workflow waits through a multi-step workflow until the entry run is terminal",
    async () => {
      await assertAttachedEntryTerminalWait();
    },
  );

  attachedSocketTest(
    "inverting attach client-wait guard fails attached run workflow waits through a multi-step workflow until the entry run is terminal",
    async () => {
      await expectAttachedWorkflowMissesEntryTerminalContract(() => setForceSkipAttachClientWaitForTest(true));
    },
  );

  attachedSocketTest(
    "retargeting attach client wait at a constituent run ID fails attached run workflow waits through a multi-step workflow until the entry run is terminal",
    async () => {
      await expectAttachedWorkflowMissesEntryTerminalContract(() =>
        setAttachWaitRunIdOverrideForTest(ATTACHED_CONSTITUENT_WAIT_RUN_ID),
      );
    },
  );
});

describe("review-passes and review-behavior resolution", () => {
  test.each([
    ["implement", "--review-passes", "1x", IMPLEMENT_USAGE],
    ["implement", "--review-behavior", "heavy", IMPLEMENT_USAGE],
    ["intent", "--review-passes", "1x", INTENT_USAGE],
    ["intent-reviewed", "--review-passes", "invalid", INTENT_USAGE],
    ["plan", "--review-passes", "1x", PLAN_USAGE],
    ["plan-reviewed", "--review-passes", "-1", PLAN_USAGE],
    ["plan-reviewed-light", "--review-passes", "-1", PLAN_USAGE],
    ["plan-reviewed-light", "--review-passes", "1x", PLAN_USAGE],
    ["plan-reviewed-light", "--review-passes", "1.5", PLAN_USAGE],
    ["plan-reviewed-light", "--review-behavior", "heavy", PLAN_USAGE],
  ] as [
    keyof typeof REJECT_BASE_ARGS,
    string,
    string,
    string,
  ][])("run workflow %s rejects %s %s before daemon contact", async (preset, flag, value, usage) => {
    const cap = captureIo();

    const code = await main([...REJECT_BASE_ARGS[preset], flag, value], cap.io, noDaemonDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: usage });
  });

  test.each([
    [
      "reviewPasses",
      { reviewPasses: -1 },
      "projects.test-project.implement.reviewPasses must be a non-negative integer\n",
    ],
    [
      "reviewBehavior",
      { reviewBehavior: "heavy" },
      'projects.test-project.implement.reviewBehavior must be "debate" or "light"\n',
    ],
  ] as [
    string,
    Record<string, unknown>,
    string,
  ][])("run workflow implement rejects invalid project implement.%s before daemon contact", async (_key, implement, stderr) => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ projects: { "test-project": { root: fx.repoRoot, implement } } });

    const code = await main(
      [...IMPLEMENT_ARGS],
      cap.io,
      noDaemonDeps({
        cwd: () => fx.repoSub,
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe(stderr);
  });

  test.each([
    ["--review-passes with no project default", undefined, ["--review-passes", "2"], "reviewPasses", 2],
    [
      "project reviewPasses (left to the builder) when flag omitted",
      { reviewPasses: 3 },
      [],
      "reviewPasses",
      undefined,
    ],
    ["--review-passes over project reviewPasses", { reviewPasses: 3 }, ["--review-passes", "1"], "reviewPasses", 1],
    [
      "project reviewBehavior (left to the builder) when flag omitted",
      { reviewBehavior: "light" },
      [],
      "reviewBehavior",
      undefined,
    ],
    [
      "--review-behavior debate over project reviewBehavior",
      { reviewBehavior: "light" },
      ["--review-behavior", "debate"],
      "reviewBehavior",
      "debate",
    ],
  ] as [
    string,
    Record<string, unknown> | undefined,
    string[],
    string,
    unknown,
  ][])("run workflow implement resolves %s before daemon start", async (_label, implement, extraArgs, key, expected) => {
    const cap = captureIo();
    let builtInput: BuildImplementWorkflowStepsInput | undefined;
    const machineConfigDeps =
      implement === undefined
        ? {}
        : { machineConfigPath: writeMachineConfig({ projects: { "test-project": { root: fx.repoRoot, implement } } }) };

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS, ...extraArgs], cap.io, {
        cwd: () => fx.repoSub,
        ...machineConfigDeps,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-review", COMPLETED_WAIT_RESULT)),
      }),
    );

    expect(code).toBe(0);
    if (expected === undefined) {
      expect(builtInput).not.toHaveProperty(key);
    } else {
      expect(builtInput).toMatchObject({ [key]: expected });
    }
  });
});

describe("review-role timeout resolution", () => {
  function fakeReviewStep(): ReviewWorkflowStep {
    return {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "implement-run",
      agents: { critic: ["claude"], actuator: ["claude"] },
      agentModelConfig: {},
      cwd: fx.repoRoot,
      verdictPath: "verdict.md",
      maxCycles: 1,
    };
  }

  function fakeReviewDebateStep(): ReviewDebateWorkflowStep {
    return {
      behavior: "review-debate",
      stepId: "review-debate",
      project: "demo",
      branch: "implement-run",
      agents: {
        adversary: ["claude"],
        advocate: ["claude"],
        adjudicator: ["claude"],
        actuator: ["claude"],
      },
      agentModelConfig: {},
      cwd: fx.repoRoot,
      verdictPath: "verdict.md",
      maxCycles: 1,
      prompts: { adversary: "a", advocate: "b", adjudicator: "c" },
    };
  }

  async function startReviewIdleBudgetWorkflow(idleOutputTimeoutMs?: number): Promise<AnyWorkflowStep[]> {
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = writeMachineConfig(idleOutputTimeoutMs === undefined ? {} : { idleOutputTimeoutMs });
    const suffix = idleOutputTimeoutMs ?? "absent";

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({
            ok: true,
            steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewStep(), fakeReviewDebateStep()],
          }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", `run-review-idle-${suffix}`, COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    return (sent[0] as { params: { steps: AnyWorkflowStep[] } }).params.steps;
  }

  test("applies the configured idle budget to review and review-debate steps", async () => {
    const sentSteps = await startReviewIdleBudgetWorkflow(123_456);
    expect(sentSteps[1]).toMatchObject({ behavior: "review", idleOutputMs: 123_456 });
    expect(sentSteps[2]).toMatchObject({ behavior: "review-debate", idleOutputMs: 123_456 });
  });

  test("leaves review idle budgets unstamped when absent", async () => {
    const sentSteps = await startReviewIdleBudgetWorkflow();
    expect(sentSteps[1]).not.toHaveProperty("idleOutputMs");
    expect(sentSteps[2]).not.toHaveProperty("idleOutputMs");
  });

  test("applies a disabled idle budget to review and review-debate steps", async () => {
    const sentSteps = await startReviewIdleBudgetWorkflow(0);
    expect(sentSteps[1]).toMatchObject({ behavior: "review", idleOutputMs: 0 });
    expect(sentSteps[2]).toMatchObject({ behavior: "review-debate", idleOutputMs: 0 });
  });

  test("stamps the default reviewRoleTimeoutMs onto review steps when unconfigured", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewStep()] }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-review-default", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    const sentSteps = (sent[0] as { params: { steps: AnyWorkflowStep[] } }).params.steps;
    expect(sentSteps[1]).toMatchObject({ behavior: "review", roleTimeoutMs: 1_800_000 });
  });

  test("stamps a configured reviewRoleTimeoutMs onto review steps", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = writeMachineConfig({ reviewRoleTimeoutMs: 900_000 });

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewStep()] }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-review-configured", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    const sentSteps = (sent[0] as { params: { steps: AnyWorkflowStep[] } }).params.steps;
    expect(sentSteps[1]).toMatchObject({ behavior: "review", roleTimeoutMs: 900_000 });
  });

  test("stamps the default reviewRoleTimeoutMs onto review-debate steps when unconfigured", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewDebateStep()] }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-review-debate-default", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    const sentSteps = (sent[0] as { params: { steps: AnyWorkflowStep[] } }).params.steps;
    expect(sentSteps[1]).toMatchObject({ behavior: "review-debate", roleTimeoutMs: 1_800_000 });
  });

  test("stamps a configured reviewRoleTimeoutMs onto review-debate steps", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = writeMachineConfig({ reviewRoleTimeoutMs: 900_000 });

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewDebateStep()] }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-review-debate-configured", COMPLETED_WAIT_RESULT), {
            sent,
          }),
      }),
    );

    expect(code).toBe(0);
    const sentSteps = (sent[0] as { params: { steps: AnyWorkflowStep[] } }).params.steps;
    expect(sentSteps[1]).toMatchObject({ behavior: "review-debate", roleTimeoutMs: 900_000 });
  });

  test("rejects a non-positive reviewRoleTimeoutMs before daemon contact", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ reviewRoleTimeoutMs: 0 });

    const code = await main(
      [...IMPLEMENT_ARGS],
      cap.io,
      noDaemonDeps({
        cwd: () => fx.repoSub,
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewStep()] }),
        },
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe("Machine config 'reviewRoleTimeoutMs' must be a positive number\n");
  });
});

describe("implement spec and artifact validation", () => {
  test("run workflow implement derives branch from spec parent dirname when branch is omitted", async () => {
    const cap = captureIo();
    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    const code = await withWorkflowUuids("start", "wait", () =>
      main(["run", "workflow", "implement", "--base", "main", "--spec", "v2/spec/my-spec/index.md"], cap.io, {
        cwd: () => fx.repoRoot,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-derived-branch", COMPLETED_WAIT_RESULT)),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("run-derived-branch");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
    expect(builtInput).toMatchObject({
      cwd: fx.repoRoot,
      baseRef: "main",
      specPath: "v2/spec/my-spec/index.md",
      configPath: expect.any(String),
      projectRegistry: { "test-project": { root: fx.repoRoot } },
    });
  });

  test("run workflow implement requires --artifact for non-index specs and surfaces error without daemon contact", async () => {
    const cap = captureIo();

    const code = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "spec.md"],
      cap.io,
      noDaemonDeps({
        cwd: () => fx.repoRoot,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("Non-index spec requires --artifact");
  });

  test("run workflow implement rejects a missing spec before builder or daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    const cap = captureIo();
    const built = false;

    const code = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "missing.md"],
      cap.io,
      noDaemonDeps({ cwd: () => root, readProjectRegistry: () => ({ project: { root } }) }),
    );

    expect(code).toBe(1);
    expect(built).toBe(false);
    expect(cap.read().stderr).toContain(`Spec path does not exist: ${join(root, "missing.md")}`);
  });

  test("run workflow implement rejects a cwd-visible spec unavailable from the base ref before daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-base-ref-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), "local-spec/\n", "utf8");
    writeFileSync(join(root, "README.md"), "seed\n", "utf8");
    execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
    mkdirSync(join(root, "local-spec"));
    writeFileSync(join(root, "local-spec", "index.md"), "# Index\n\n## Acceptance criteria\n\n- [ ] Work\n", "utf8");
    const cap = captureIo();

    const code = await main(
      ["run", "workflow", "implement", "--base", "HEAD", "--spec", "local-spec/index.md"],
      cap.io,
      noDaemonDeps({ cwd: () => root, readProjectRegistry: () => ({ project: { root } }) }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe("Spec path unavailable in base ref HEAD: local-spec/index.md\n");
  });

  test("run workflow implement rejects a missing non-index artifact before daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    writeFileSync(join(root, "spec.md"), INCOMPLETE_SPEC_CONTENT, "utf8");
    const cap = captureIo();

    const code = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "spec.md", "--artifact", "missing.md"],
      cap.io,
      noDaemonDeps({ cwd: () => root, readProjectRegistry: () => ({ project: { root } }) }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain(`Artifact path does not exist: ${join(root, "missing.md")}`);
  });

  test("run workflow implement rejects escaping spec and artifact symlinks before builder or daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    const outside = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-outside-"));
    writeFileSync(join(outside, "outside.md"), "# Outside\n", "utf8");
    symlinkSync(join(outside, "outside.md"), join(root, "escaped.md"));
    writeFileSync(join(root, "spec.md"), INCOMPLETE_SPEC_CONTENT, "utf8");
    const specCap = captureIo();

    const specCode = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "escaped.md"],
      specCap.io,
      noDaemonDeps({ cwd: () => root, readProjectRegistry: () => ({ project: { root } }) }),
    );
    expect(specCode).toBe(1);
    expect(specCap.read().stderr).toContain("Spec path outside registered project roots");

    symlinkSync(join(outside, "outside.md"), join(root, "escaped-artifact.md"));
    const artifactCap = captureIo();
    const artifactCode = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "spec.md", "--artifact", "escaped-artifact.md"],
      artifactCap.io,
      noDaemonDeps({ cwd: () => root, readProjectRegistry: () => ({ project: { root } }) }),
    );
    expect(artifactCode).toBe(1);
    expect(artifactCap.read().stderr).toContain("Artifact path outside registered project root");
  });

  test("run workflow implement accepts contained symlinks and passes relative paths to the builder", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    mkdirSync(join(root, "specs"));
    writeFileSync(join(root, "specs", "spec.md"), INCOMPLETE_SPEC_CONTENT, "utf8");
    writeFileSync(join(root, "specs", "artifact.md"), "# Artifact\n", "utf8");
    symlinkSync(join(root, "specs", "spec.md"), join(root, "spec-link.md"));
    symlinkSync(join(root, "specs", "artifact.md"), join(root, "artifact-link.md"));
    const cap = captureIo();
    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--base", "main", "--spec", "spec-link.md", "--artifact", "artifact-link.md"],
        cap.io,
        {
          cwd: () => root,
          readProjectRegistry: () => ({ project: { root } }),
          workflowPresetBuilders: {
            implement: (input) => {
              builtInput = input;
              return { ok: true, steps: fx.fakeImplementSteps };
            },
          },
          connectIpcClient: async () => makeIpcClient(workflowFrames("start", "wait", "run-1", COMPLETED_WAIT_RESULT)),
        },
      ),
    );

    expect(code).toBe(0);
    expect(builtInput).toMatchObject({
      specPath: "spec-link.md",
      artifactPath: "artifact-link.md",
    });
  });

  test("run workflow implement ignores an unresolved registry root unrelated to the spec", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    writeFileSync(join(root, "index.md"), INCOMPLETE_SPEC_CONTENT, "utf8");
    const cap = captureIo();

    const code = await withWorkflowUuids("start", "wait", () =>
      main(["run", "workflow", "implement", "--base", "main", "--spec", "index.md"], cap.io, {
        cwd: () => root,
        readProjectRegistry: () => ({ stale: { root: join(root, "missing") }, project: { root } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () => makeIpcClient(workflowFrames("start", "wait", "run-1", COMPLETED_WAIT_RESULT)),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("run-1");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
  });

  test("run workflow implement ignores --artifact for index specs", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    writeFileSync(join(root, "index.md"), INCOMPLETE_SPEC_CONTENT, "utf8");
    const cap = captureIo();
    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--base", "main", "--spec", "index.md", "--artifact", "missing.md"],
        cap.io,
        {
          cwd: () => root,
          readProjectRegistry: () => ({ project: { root } }),
          workflowPresetBuilders: {
            implement: (input) => {
              builtInput = input;
              return { ok: true, steps: fx.fakeImplementSteps };
            },
          },
          connectIpcClient: async () => makeIpcClient(workflowFrames("start", "wait", "run-1", COMPLETED_WAIT_RESULT)),
        },
      ),
    );

    expect(code).toBe(0);
    expect(builtInput).toMatchObject({ specPath: "index.md", artifactPath: "missing.md" });
  });

  test("run workflow implement surfaces a builder error without contacting the daemon", async () => {
    const cap = captureIo();

    const code = await main(
      [...IMPLEMENT_ARGS],
      cap.io,
      noDaemonDeps({ cwd: () => fx.unregistered, readProjectRegistry: () => ({}) }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("Spec path outside registered project roots");
  });

  test("run workflow implement reports an already-complete spec without daemon contact", async () => {
    const cap = captureIo();
    const teardownCalls: string[] = [];
    const code = await main(
      [...IMPLEMENT_ARGS],
      cap.io,
      noDaemonDeps({
        cwd: () => fx.repoSub,
        subprocessRunner: {
          runAsync: async (cmd, args, cwd) => {
            if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
            if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
            return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? fx.repoRoot);
          },
        },
        workflowPresetBuilders: {
          implement: () => ({
            ok: false,
            error: "implement.already_complete: requested spec has no unchecked non-human-only acceptance criteria",
          }),
        },
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe(
      "implement.already_complete: requested spec has no unchecked non-human-only acceptance criteria\n",
    );
    expect(teardownCalls).toEqual([]);
  });
});

describe("implement preflight stale workspace reset", () => {
  let resetTmp: string;
  let resetProjectRoot: string;
  let resetJarvisRoot: string;
  const resetBranch = "implement-run";

  function resetImplementSteps(branch = resetBranch): AnyWorkflowStep[] {
    return [
      {
        behavior: "write",
        stepId: "implement",
        role: "implement",
        promptId: "patch.prompt.body",
        stepRules: DEFAULT_WRITE_STEP_RULES,
        agents: ["claude"],
        agentModelConfig: {
          claude: {
            implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
            shrink: { rungs: [{ adapterModel: "S1", priceKey: "P1" }] },
          },
        },
        worktree: {
          projectRoot: realpathSync(resetProjectRoot),
          projectName: "demo",
          branchName: branch,
          baseRef: "HEAD",
          jarvisRoot: resetJarvisRoot,
        },
        specPath: "index.md",
        expectedArtifactPath: "index.md",
        publishCompletion: false,
      },
    ];
  }

  function resetImplementDeps(overrides: NonNullable<Parameters<typeof main>[2]> = {}) {
    return {
      cwd: () => resetProjectRoot,
      jarvisRoot: resetJarvisRoot,
      readProjectRegistry: () => ({ demo: { root: resetProjectRoot } }),
      workflowPresetBuilders: {
        implement: () => ({ ok: true as const, steps: resetImplementSteps() }),
      },
      ...overrides,
    } as NonNullable<Parameters<typeof main>[2]>;
  }

  async function materializeStaleWorktree(branch = resetBranch): Promise<string> {
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], resetProjectRoot);
    const worktreePath = join(resetJarvisRoot, "worktrees", "demo", branch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], resetProjectRoot);
    return worktreePath;
  }

  async function setupOriginForResetProject(): Promise<void> {
    const originRoot = join(resetTmp, "origin.git");
    await realAsyncSubprocessRunner.runAsync("git", ["init", "--bare", originRoot], resetTmp);
    await realAsyncSubprocessRunner.runAsync("git", ["remote", "add", "origin", originRoot], resetProjectRoot);
  }

  function staleResetSubprocessRunner(
    intercept?: (cmd: string, args: string[]) => string | undefined | Promise<string | undefined>,
    closedPrs?: number[],
  ): AsyncSubprocessRunner {
    return {
      runAsync: async (cmd, args, cwd) => {
        const intercepted = intercept ? await intercept(cmd, args) : undefined;
        if (intercepted !== undefined) return intercepted;
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 55, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          if (closedPrs) closedPrs.push(Number(args[2]));
          return "";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? resetProjectRoot);
      },
    };
  }

  function workflowExecutionClient(handlers: Record<string, RpcHandler>) {
    const client = makeDeferredIpcClient([], { gated: true, deferred: true });
    return {
      ...client,
      send(frame: unknown): void {
        client.send(frame);
        const request = frame as { id?: string; method?: string; params?: unknown };
        if (typeof request.id !== "string") return;
        const requestId = request.id;
        const handler = typeof request.method === "string" ? handlers[request.method] : undefined;
        if (handler === undefined) {
          client.push({ kind: "error", id: requestId, code: "unknown_method", message: "unknown method" });
          return;
        }
        void Promise.resolve(
          handler(
            { kind: "request", id: requestId, method: request.method as string, params: request.params },
            new AbortController().signal,
          ),
        )
          .then((response) => client.push({ ...response, id: requestId }))
          .catch((error: unknown) =>
            client.push({
              kind: "error",
              id: requestId,
              code: "internal_error",
              message: error instanceof Error ? error.message : String(error),
            }),
          );
      },
    };
  }

  function connectedWorkflowHandlers() {
    const stateStore = openStateStore(join(resetTmp, `state-${crypto.randomUUID()}.sqlite`));
    const handlers = createRunControlHandlers({
      stateStore,
      writeLoopExecutor: async () => {},
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      settleDelayMs: 0,
    });
    return {
      client: workflowExecutionClient({
        start: handlers.start,
        list: handlers.list,
        check_workflow_start_claim: handlers.check_workflow_start_claim,
      }),
      waitForCompletion: async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (!handlers.hasActiveRuns()) return;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error("workflow did not settle");
      },
      close: () => {
        handlers.close();
        stateStore.close();
      },
    };
  }

  beforeEach(async () => {
    resetTmp = mkdtempSync(join(tmpdir(), "jarvis-cli-reset-"));
    resetProjectRoot = join(resetTmp, "project");
    resetJarvisRoot = join(resetTmp, "jarvis-home");
    mkdirSync(resetProjectRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["init"], resetProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "t@t.com"], resetProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "T"], resetProjectRoot);
    writeFileSync(join(resetProjectRoot, "index.md"), INCOMPLETE_SPEC_CONTENT, "utf8");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], resetProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], resetProjectRoot);
  });

  afterEach(() => {
    rmSync(resetTmp, { recursive: true, force: true });
  });

  test("run workflow implement resets a stale worktree before daemon start", async () => {
    const worktreePath = await materializeStaleWorktree();
    const cap = captureIo();
    const sent: unknown[] = [];

    const closedPrs: number[] = [];
    const subprocessRunner = staleResetSubprocessRunner(undefined, closedPrs);

    const code = await withStaleResetWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner,
          connectIpcClient: async () =>
            makeStaleResetIpcClient(workflowFrames("start", "wait", "run-reset", COMPLETED_WAIT_RESULT), { sent }),
        }),
      ),
    );

    expect(code).toBe(0);
    expect(closedPrs).toEqual([55]);
    expect(cap.read().stderr).not.toContain("Retirement destroyed artifacts:");
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).not.toContain(worktreePath);
    expect(sent).toHaveLength(4);
  });

  test("run workflow implement prints destroyed-artifact summary when retirement succeeds and dispatch fails", async () => {
    const worktreePath = await materializeStaleWorktree();
    const cap = captureIo();

    const subprocessRunner = staleResetSubprocessRunner();

    const code = await withStaleResetWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner,
          connectIpcClient: async () =>
            makeStaleResetIpcClient(workflowFrames("start", "wait", "run-reset-fail", { runStatus: "failed" })),
        }),
      ),
    );

    expect(code).toBe(3);
    const { stderr } = cap.read();
    expect(stderr).toContain("Retirement destroyed artifacts:");
    expect(stderr).toContain(`  worktree: ${worktreePath}`);
    expect(stderr).toContain(`  local branch: ${resetBranch}`);
    expect(stderr).toContain(`  remote branch: ${resetBranch}`);
    expect(stderr).toContain("  PR: #55");
  });

  test("run workflow implement prints partial destroyed-artifact summary when retirement aborts mid-sequence", async () => {
    const worktreePath = await materializeStaleWorktree();
    const cap = captureIo();

    const subprocessRunner = staleResetSubprocessRunner((cmd, args) => {
      if (cmd === "git" && args[0] === "branch" && args[1] === "-D") {
        throw new Error("branch delete failed");
      }
      return undefined;
    });

    const code = await withStaleResetPreflightUuids(() =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner,
          connectIpcClient: async () => makeStaleResetIpcClient([]),
        }),
      ),
    );

    expect(code).toBe(1);
    const { stderr } = cap.read();
    expect(stderr).toContain("Retirement destroyed artifacts:");
    expect(stderr).toContain(`  worktree: ${worktreePath}`);
    expect(stderr).not.toContain("  local branch:");
    expect(stderr).not.toContain("  remote branch:");
    expect(stderr).not.toContain("  PR: #");
  });

  test("run workflow plan resets a stale worktree before daemon start", async () => {
    const worktreePath = await materializeStaleWorktree();
    const cap = captureIo();
    const sent: unknown[] = [];

    const closedPrs: number[] = [];
    const subprocessRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 56, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          closedPrs.push(Number(args[2]));
          return "";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? resetProjectRoot);
      },
    };

    const code = await withStaleResetWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "plan", "--ready-intent", "index.md"],
        cap.io,
        resetImplementDeps({
          workflowPresetBuilders: {
            plan: () => ({ ok: true as const, steps: resetImplementSteps() }),
          },
          subprocessRunner,
          connectIpcClient: async () =>
            makeStaleResetIpcClient(workflowFrames("start", "wait", "run-reset-plan", COMPLETED_WAIT_RESULT), { sent }),
        }),
      ),
    );

    expect(code).toBe(0);
    expect(closedPrs).toEqual([56]);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).not.toContain(worktreePath);
  });

  test("incomplete implement and plan re-dispatch defer an ordinary non-Git husk to locked materialization", async () => {
    for (const workflow of ["implement", "plan"] as const) {
      for (const override of [false, true]) {
        const worktreePath = await materializeStaleWorktree();
        const initialHead = (
          await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", resetBranch], resetProjectRoot)
        ).trim();
        await realAsyncSubprocessRunner.runAsync(
          "git",
          ["worktree", "remove", "--force", worktreePath],
          resetProjectRoot,
        );
        mkdirSync(worktreePath, { recursive: true });
        const residue = join(worktreePath, "failed-materialization");
        writeFileSync(residue, "husk");

        const cap = captureIo();
        const preflightTeardownCalls: string[] = [];
        let callbackBranch: string | undefined;
        let callbackHead: string | undefined;
        let materializedPath: string | undefined;
        const subprocessRunner = staleResetSubprocessRunner((cmd, args) => {
          if (cmd === "git" && args[0] === "worktree" && args[1] === "remove")
            preflightTeardownCalls.push("worktree-remove");
          if (cmd === "git" && args[0] === "worktree" && args[1] === "prune")
            preflightTeardownCalls.push("worktree-prune");
          if (cmd === "git" && args[0] === "branch" && args[1] === "-D") preflightTeardownCalls.push("branch-delete");
          if (cmd === "git" && args[0] === "push" && args[1] === "origin" && args[2] === "--delete") {
            preflightTeardownCalls.push("remote-branch-delete");
          }
          if (cmd === "git" && args[0] === "update-ref" && args[1] === "-d") {
            preflightTeardownCalls.push("remote-tracking-ref-prune");
          }
          if (cmd === "gh" && args[0] === "pr" && args[1] === "close") preflightTeardownCalls.push("pr-close");
          return undefined;
        });
        let callbackDone: (() => void) | undefined;
        const callbackReached = new Promise<void>((resolve) => {
          callbackDone = resolve;
        });
        let callbackCount = 0;
        const steps = resetImplementSteps();
        const writeStep = steps[0];
        if (writeStep?.behavior !== "write") throw new Error("expected write step");
        writeStep.createBinding = ({ agentId, adapterModel }) => ({
          id: `${agentId}/${adapterModel}`,
          metadata: { agent: agentId, model: adapterModel },
          invoke: async ({ cwd }) => {
            try {
              if (callbackCount++ === 0) {
                materializedPath = cwd;
                callbackBranch = (
                  await realAsyncSubprocessRunner.runAsync("git", ["branch", "--show-current"], cwd)
                ).trim();
                callbackHead = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], cwd)).trim();
              }
            } finally {
              callbackDone?.();
            }
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
        });
        const connected = connectedWorkflowHandlers();
        const args =
          workflow === "implement"
            ? ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"]
            : ["run", "workflow", "plan", "--ready-intent", "index.md"];
        if (override) args.push(STALE_RESET_OVERRIDE_CLI_FLAG);
        args.push("--detach");

        let code: number;
        try {
          code = await main(
            args,
            cap.io,
            resetImplementDeps({
              workflowPresetBuilders:
                workflow === "implement"
                  ? { implement: () => ({ ok: true as const, steps }) }
                  : { plan: () => ({ ok: true as const, steps }) },
              subprocessRunner,
              connectIpcClient: async () => connected.client,
            }),
          );
          await callbackReached;
          await connected.waitForCompletion();
        } finally {
          connected.close();
        }

        expect(code).toBe(0);
        expect(preflightTeardownCalls).toEqual([]);
        expect(existsSync(residue)).toBe(false);
        expect(materializedPath).toBe(worktreePath);
        expect(callbackBranch).toBe(resetBranch);
        expect(callbackHead).toBe(initialHead);
        await realAsyncSubprocessRunner.runAsync(
          "git",
          ["worktree", "remove", "--force", worktreePath],
          resetProjectRoot,
        );
        await realAsyncSubprocessRunner.runAsync("git", ["branch", "-D", resetBranch], resetProjectRoot);
      }
    }
  });

  test("incomplete re-dispatch leaves registered and inconclusive non-Git husks for materialization safeguards", async () => {
    for (const probe of ["registered", "inconclusive"] as const) {
      const worktreePath = await materializeStaleWorktree();
      await realAsyncSubprocessRunner.runAsync(
        "git",
        ["worktree", "remove", "--force", worktreePath],
        resetProjectRoot,
      );
      mkdirSync(worktreePath, { recursive: true });
      const residue = join(worktreePath, `${probe}-residue`);
      writeFileSync(residue, "keep");
      const cap = captureIo();
      const steps = resetImplementSteps();
      const writeStep = steps[0];
      if (writeStep?.behavior !== "write") throw new Error("expected write step");
      writeStep.withExternalWorktree = (input, run) =>
        withExternalWorktree(input, run, {
          runAsync: async (cmd, args, cwd, options) => {
            if (cmd === "git" && args.join(" ") === "worktree list --porcelain") {
              if (probe === "registered") return `worktree ${worktreePath}\n`;
              throw new Error("worktree registration probe failed");
            }
            return realAsyncSubprocessRunner.runAsync(cmd, args, cwd, options);
          },
        });
      const connected = connectedWorkflowHandlers();
      let code: number;
      try {
        code = await main(
          ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md", "--detach"],
          cap.io,
          resetImplementDeps({
            workflowPresetBuilders: { implement: () => ({ ok: true as const, steps }) },
            subprocessRunner: staleResetSubprocessRunner(),
            connectIpcClient: async () => connected.client,
          }),
        );
      } finally {
        connected.close();
      }

      expect(code).toBe(1);
      expect(cap.read().stderr).toContain(
        probe === "registered" ? "existing path is registered" : "worktree registration probe failed",
      );
      expect(existsSync(residue)).toBe(true);
      rmSync(worktreePath, { recursive: true, force: true });
      await realAsyncSubprocessRunner.runAsync("git", ["branch", "-D", resetBranch], resetProjectRoot);
    }
  });

  test("run workflow implement refuses reset when the workspace is live-held", async () => {
    await materializeStaleWorktree();
    const lockPath = join(resetJarvisRoot, "worktree-locks", "demo", resetBranch, ".jarvis.lock");
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
    const cap = captureIo();

    const code = await withStaleResetPreflightUuids(() =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner: {
            runAsync: async (cmd, args) => {
              if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
                return JSON.stringify([{ number: 77, isDraft: true }]);
              }
              return realAsyncSubprocessRunner.runAsync(cmd, args, resetProjectRoot);
            },
          },
          connectIpcClient: async () => makeStaleResetIpcClient([]),
        }),
      ),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain(`Cannot re-run incomplete spec: process ${process.pid} holds worktree lock`);
  });

  test("run workflow implement refuses reset when the managed worktree is dirty", async () => {
    const worktreePath = await materializeStaleWorktree();
    const dirtyFile = "agent-leftover.txt";
    writeFileSync(join(worktreePath, dirtyFile), "uncommitted\n", "utf8");
    const cap = captureIo();
    const teardownCalls: string[] = [];

    const code = await withStaleResetPreflightUuids(() =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner: {
            runAsync: async (cmd, args, cwd) => {
              if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
                return JSON.stringify([{ number: 88, isDraft: true }]);
              }
              if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
              if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
              if (cmd === "git" && args[0] === "worktree" && args[1] === "remove")
                teardownCalls.push("worktree-remove");
              return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? resetProjectRoot);
            },
          },
          connectIpcClient: async () => makeStaleResetIpcClient([]),
        }),
      ),
    );

    expect(code).toBe(1);
    const { stderr } = cap.read();
    expect(stderr).toContain("Cannot re-run incomplete spec:");
    expect(stderr).toContain(dirtyFile);
    expect(stderr).toContain("commit");
    expect(stderr).toContain("discard");
    expect(stderr).toContain(STALE_RESET_OVERRIDE_CLI_FLAG);
    expect(stderr).toContain("jarvis cleanup --abandon");
    expect(teardownCalls).toEqual([]);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).toContain(worktreePath);
  });

  test("run workflow implement resets stale dirty worktree when override switch is set", async () => {
    const worktreePath = await materializeStaleWorktree();
    writeFileSync(join(worktreePath, "agent-leftover.txt"), "uncommitted\n", "utf8");
    const cap = captureIo();
    const sent: unknown[] = [];

    const closedPrs: number[] = [];
    const subprocessRunner = staleResetSubprocessRunner(undefined, closedPrs);

    const code = await withStaleResetWorkflowUuids("start", "wait", () =>
      main(
        [
          "run",
          "workflow",
          "implement",
          "--branch",
          resetBranch,
          "--base",
          "HEAD",
          "--spec",
          "index.md",
          STALE_RESET_OVERRIDE_CLI_FLAG,
        ],
        cap.io,
        resetImplementDeps({
          subprocessRunner,
          connectIpcClient: async () =>
            makeStaleResetIpcClient(workflowFrames("start", "wait", "run-reset-dirty", COMPLETED_WAIT_RESULT), {
              sent,
            }),
        }),
      ),
    );

    expect(code).toBe(0);
    expect(closedPrs).toEqual([55]);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).not.toContain(worktreePath);
    expect(sent).toHaveLength(4);
  });

  test("run workflow implement performs no reset teardown on a fresh run", async () => {
    const cap = captureIo();
    const teardownCalls: string[] = [];

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner: {
            runAsync: async (cmd, args, cwd) => {
              if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
              if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
              return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? resetProjectRoot);
            },
          },
          connectIpcClient: async () =>
            makeStaleResetIpcClient(workflowFrames("start", "wait", "run-fresh", COMPLETED_WAIT_RESULT)),
        }),
      ),
    );

    expect(code).toBe(0);
    expect(teardownCalls).toEqual([]);
    expect(cap.read().stderr).not.toContain("Retirement destroyed artifacts:");
  });

  test("run workflow implement refuses stale reset when worktree is claimed", async () => {
    await setupOriginForResetProject();
    const worktreePath = await materializeStaleWorktree();
    await realAsyncSubprocessRunner.runAsync("git", ["push", "-u", "origin", resetBranch], worktreePath);
    const cap = captureIo();
    const teardownCalls: string[] = [];
    const claimMessage = `Worktree already claimed for project=demo, branch=${resetBranch}`;

    const code = await withStaleResetPreflightUuids(() =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner: staleResetSubprocessRunner((cmd, args) => {
            if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
            if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") teardownCalls.push("worktree-remove");
            if (cmd === "git" && args[0] === "push" && args[1] === "origin" && args[2] === "--delete") {
              teardownCalls.push("remote-delete");
            }
            return undefined;
          }),
          connectIpcClient: async () =>
            makeStaleResetIpcClient([], {
              staleResetPreflight: {
                listRuns: [
                  { runId: "queued-1", project: "demo", branch: resetBranch, status: "queued", isLive: false },
                ],
                claim: { message: claimMessage },
              },
            }),
        }),
      ),
    );

    expect(code).toBe(1);
    const { stderr } = cap.read();
    expect(stderr).toContain(`worktree_claimed: ${claimMessage}`);
    expect(stderr).not.toContain("Retirement destroyed artifacts:");
    expect(teardownCalls).toEqual([]);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).toContain(worktreePath);
    const remoteBranches = await realAsyncSubprocessRunner.runAsync(
      "git",
      ["branch", "-r", "--list", `origin/${resetBranch}`],
      resetProjectRoot,
    );
    expect(remoteBranches.trim()).toContain(`origin/${resetBranch}`);
  });

  test("run workflow implement refuses with one pre-mutation error when claimed and dirty", async () => {
    await setupOriginForResetProject();
    const worktreePath = await materializeStaleWorktree();
    await realAsyncSubprocessRunner.runAsync("git", ["push", "-u", "origin", resetBranch], worktreePath);
    writeFileSync(join(worktreePath, "dirty.txt"), "leftover\n", "utf8");
    const cap = captureIo();
    const teardownCalls: string[] = [];
    const claimMessage = `Worktree already claimed for project=demo, branch=${resetBranch}`;

    const code = await withStaleResetPreflightUuids(() =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner: staleResetSubprocessRunner((cmd, args) => {
            if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
            if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
            return undefined;
          }),
          connectIpcClient: async () =>
            makeStaleResetIpcClient([], {
              staleResetPreflight: {
                listRuns: [],
                claim: { message: claimMessage },
              },
            }),
        }),
      ),
    );

    expect(code).toBe(1);
    const { stderr } = cap.read();
    expect(stderr).toBe(`worktree_claimed: ${claimMessage}\n`);
    expect(stderr).not.toContain("Cannot re-run incomplete spec:");
    expect(teardownCalls).toEqual([]);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).toContain(worktreePath);
    const remoteBranches = await realAsyncSubprocessRunner.runAsync(
      "git",
      ["branch", "-r", "--list", `origin/${resetBranch}`],
      resetProjectRoot,
    );
    expect(remoteBranches.trim()).toContain(`origin/${resetBranch}`);
  });

  test("run workflow implement prints no destroyed-artifact summary when dispatch is unreachable", async () => {
    const worktreePath = await materializeStaleWorktree();
    const cap = captureIo();
    let connectAttempted = false;
    const teardownCalls: string[] = [];

    const code = await main(
      ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
      cap.io,
      resetImplementDeps({
        subprocessRunner: {
          runAsync: async (cmd, args, cwd) => {
            if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
            if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
            if (cmd === "git" && args[0] === "push" && args[2] === "--delete") teardownCalls.push("remote-delete");
            return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? resetProjectRoot);
          },
        },
        connectIpcClient: async () => {
          connectAttempted = true;
          throw new Error("Failed to connect to daemon on socket mock");
        },
        startDaemon: async () => {
          throw new Error("Failed to start daemon");
        },
      }),
    );

    expect(code).toBe(1);
    expect(connectAttempted).toBe(true);
    expect(cap.read().stderr).toContain("Failed to start daemon");
    expect(cap.read().stderr).not.toContain("Retirement destroyed artifacts:");
    expect(teardownCalls).toEqual([]);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).toContain(worktreePath);
    const branchList = await realAsyncSubprocessRunner.runAsync("git", ["branch"], resetProjectRoot);
    expect(branchList).toContain(resetBranch);
  });

  test("redispatch-materializes-from-base-after-preflight-reset-stale-remote-tracking-ref", async () => {
    const cap = captureIo();
    const originRoot = join(resetTmp, "origin.git");
    await realAsyncSubprocessRunner.runAsync("git", ["init", "--bare", originRoot], resetTmp);
    await realAsyncSubprocessRunner.runAsync("git", ["remote", "add", "origin", originRoot], resetProjectRoot);
    mkdirSync(join(resetProjectRoot, "node_modules"), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["push", "-u", "origin", "HEAD"], resetProjectRoot);

    const baseHead = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], resetProjectRoot)).trim();
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", "-b", resetBranch], resetProjectRoot);
    writeFileSync(join(resetProjectRoot, "stale-advance.md"), "stale\n", "utf8");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], resetProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "stale advance"], resetProjectRoot);
    const staleTip = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], resetProjectRoot)).trim();
    expect(staleTip).not.toBe(baseHead);
    await realAsyncSubprocessRunner.runAsync("git", ["push", "-u", "origin", resetBranch], resetProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["update-ref", "-d", `refs/heads/${resetBranch}`], originRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", baseHead], resetProjectRoot);

    const worktreePath = join(resetJarvisRoot, "worktrees", "demo", resetBranch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, resetBranch], resetProjectRoot);
    expect(await originTrackingRefResolvesAsync(resetProjectRoot, resetBranch, realAsyncSubprocessRunner)).toBe(true);

    const subprocessRunner = staleResetSubprocessRunner();
    const baseStep = resetImplementSteps()[0];
    if (baseStep === undefined || baseStep.behavior !== "write") {
      throw new Error("expected implement write step");
    }
    const stepsWithBase: AnyWorkflowStep[] = [
      {
        ...baseStep,
        worktree: { ...baseStep.worktree, baseRef: baseHead },
      },
    ];

    const code = await withStaleResetWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", baseHead, "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner,
          workflowPresetBuilders: {
            implement: () => ({ ok: true as const, steps: stepsWithBase }),
          },
          connectIpcClient: async () =>
            makeStaleResetIpcClient(
              workflowFrames("start", "wait", "run-redispatch-stale-origin", COMPLETED_WAIT_RESULT),
            ),
        }),
      ),
    );

    expect(code).toBe(0);
    expect(await originTrackingRefResolvesAsync(resetProjectRoot, resetBranch, realAsyncSubprocessRunner)).toBe(false);

    await withExternalWorktree(
      {
        projectRoot: resetProjectRoot,
        projectName: "demo",
        branchName: resetBranch,
        baseRef: baseHead,
        jarvisRoot: resetJarvisRoot,
      },
      async (worktree) => {
        const branchTip = (
          await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", resetBranch], resetProjectRoot)
        ).trim();
        expect(branchTip).toBe(baseHead);
        const worktreeHead = (
          await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], worktree.path)
        ).trim();
        expect(worktreeHead).toBe(baseHead);
      },
      subprocessRunner,
    );
  });
});

describe("intent and plan presets", () => {
  test("run workflow intent builds seed text before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    let received: unknown;

    const code = await withWorkflowUuids("start", "wait", () =>
      main(["run", "workflow", "intent", "--seed-text", "Improve API"], cap.io, {
        cwd: () => fx.repoRoot,
        workflowPresetBuilders: {
          intent: (input) => {
            received = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "intent-1", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(received).toMatchObject({ cwd: fx.repoRoot, seedText: "Improve API" });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: fx.fakeImplementSteps } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "intent-1" } });
    expect(cap.read().stdout).toContain("intent-1");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
  });

  test("run workflow intent rejects invalid seed arguments before daemon contact", async () => {
    const cap = captureIo();

    const code = await main(
      ["run", "workflow", "intent", "--seed", "one", "--seed-text", "two"],
      cap.io,
      noDaemonDeps(),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: INTENT_USAGE });
  });

  test("run workflow intent-reviewed builds seed text with default review passes before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    let received: unknown;

    const code = await withWorkflowUuids("start", "wait", () =>
      main(["run", "workflow", "intent-reviewed", "--seed-text", "Improve API"], cap.io, {
        cwd: () => fx.repoRoot,
        workflowPresetBuilders: {
          "intent-reviewed": (input) => {
            received = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "intent-reviewed-1", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(received).toMatchObject({ cwd: fx.repoRoot, seedText: "Improve API" });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: fx.fakeImplementSteps } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "intent-reviewed-1" } });
    expect(cap.read().stdout).toContain("intent-reviewed-1");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
  });

  test("run workflow intent-reviewed accepts review-passes before daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000009";
    let received: unknown;

    const code = await withFixedUuid(requestId, () =>
      main(["run", "workflow", "intent-reviewed", "--seed-text", "Improve API", "--review-passes", "2"], cap.io, {
        cwd: () => fx.repoRoot,
        workflowPresetBuilders: {
          "intent-reviewed": (input) => {
            received = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(
            [
              { kind: "response", id: requestId, result: { runId: "intent-reviewed-2" } },
              { kind: "response", id: requestId, result: COMPLETED_WAIT_RESULT },
            ],
            { sent },
          ),
      }),
    );

    expect(code).toBe(0);
    expect(received).toMatchObject({ cwd: fx.repoRoot, seedText: "Improve API", reviewPasses: 2 });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: fx.fakeImplementSteps } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "intent-reviewed-2" } });
    expect(cap.read()).toEqual({
      stdout: `intent-reviewed-2\n${COMPLETED_WAIT_JSON}\n`,
      stderr: "deprecated: use intent --review-passes 1 --review-behavior light\n",
    });
  });

  test("run workflow plan-reviewed routes review passes before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000010";
    let received: unknown;

    const code = await withFixedUuid(requestId, () =>
      main(
        ["run", "workflow", "plan-reviewed", "--ready-intent", "spec/ready-intents/demo.md", "--review-passes", "2"],
        cap.io,
        {
          cwd: () => fx.repoRoot,
          workflowPresetBuilders: {
            "plan-reviewed": (input) => {
              received = input;
              return { ok: true, steps: fx.fakeImplementSteps };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                { kind: "response", id: requestId, result: { runId: "plan-reviewed-2" } },
                { kind: "response", id: requestId, result: COMPLETED_WAIT_RESULT },
              ],
              { sent },
            ),
        },
      ),
    );

    expect(code).toBe(0);
    expect(received).toMatchObject({
      cwd: fx.repoRoot,
      readyIntent: "spec/ready-intents/demo.md",
      reviewPasses: 2,
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start" });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "plan-reviewed-2" } });
    expect(cap.read()).toEqual({
      stdout: `plan-reviewed-2\n${COMPLETED_WAIT_JSON}\n`,
      stderr: "deprecated: use plan --review-passes 1 --review-behavior debate\n",
    });
  });

  test("run workflow plan-reviewed-light routes review passes before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000011";
    let received: unknown;

    const code = await withFixedUuid(requestId, () =>
      main(
        [
          "run",
          "workflow",
          "plan-reviewed-light",
          "--ready-intent",
          "spec/ready-intents/demo.md",
          "--review-passes",
          "2",
        ],
        cap.io,
        {
          cwd: () => fx.repoRoot,
          workflowPresetBuilders: {
            "plan-reviewed-light": (input) => {
              received = input;
              return { ok: true, steps: fx.fakeImplementSteps };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                { kind: "response", id: requestId, result: { runId: "plan-reviewed-light-2" } },
                { kind: "response", id: requestId, result: COMPLETED_WAIT_RESULT },
              ],
              { sent },
            ),
        },
      ),
    );

    expect(code).toBe(0);
    expect(received).toMatchObject({
      cwd: fx.repoRoot,
      readyIntent: "spec/ready-intents/demo.md",
      reviewPasses: 2,
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start" });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "plan-reviewed-light-2" } });
    expect(cap.read()).toEqual({
      stdout: `plan-reviewed-light-2\n${COMPLETED_WAIT_JSON}\n`,
      stderr: "deprecated: use plan --review-passes 1 --review-behavior light\n",
    });
  });
});
