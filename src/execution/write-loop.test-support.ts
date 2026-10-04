import { afterEach, beforeEach, expect, mock } from "bun:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { LogEvent, LogSink, PersistedRecord } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createResolvedAgentBinding } from "../shared/invocation/agents.ts";
import type { InvocationBinding, InvocationCompletedRecord } from "../shared/invocation/execute.ts";
import type { AsyncSubprocessRunner } from "../shared/subprocess.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, trackedTempRoots } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import { gateFailureOutput, lintMdOnlyGateFailureOutput } from "./ready-finalize.test-support.ts";
import { deriveGateAllowedPaths, ReadyGateError, SurvivingMutationError } from "./ready-finalize.ts";
import type { WorkBoundaryRecordedRecord } from "./work-boundary-telemetry.ts";
import { executeWrite as realExecuteWrite } from "./write.ts";
import {
  executeWriteLoop,
  publishWithReadyRepair,
  type WallSegmentSchedule,
  type WriteLoopInput,
  type WriteLoopResult,
} from "./write-loop.ts";

export async function deriveAllowedOrUndefined(
  ...args: Parameters<typeof deriveGateAllowedPaths>
): Promise<Set<string> | undefined> {
  const derived = await deriveGateAllowedPaths(...args);
  return "allowed" in derived ? derived.allowed : undefined;
}

export const { roots } = trackedTempRoots();

export function fastCeilingSchedule(delayMs = 50): WallSegmentSchedule {
  return (fire, _delayMs) => {
    const timer = setTimeout(fire, delayMs);
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  };
}

export class GateShellFrameChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 424_242;

  start(frames: string[]) {
    queueMicrotask(() => {
      for (const frame of frames) {
        this.stdout.write(`${frame}\n`);
      }
      this.stdout.end();
      this.stderr.end();
      setImmediate(() => {
        this.emit("exit", 0);
        this.emit("close", 0);
      });
    });
  }

  kill() {
    return true;
  }
}

export class HoldingGateShellFrameChild extends GateShellFrameChild {
  constructor(private readonly holdUntil?: Promise<void>) {
    super();
  }

  override start(frames: string[]) {
    queueMicrotask(async () => {
      for (const frame of frames) {
        if (this.holdUntil !== undefined) {
          const parsed = JSON.parse(frame) as { type?: string; subtype?: string };
          if (parsed.type === "tool_call" && parsed.subtype === "started") {
            await this.holdUntil;
          }
        }
        this.stdout.write(`${frame}\n`);
      }
      this.stdout.end();
      this.stderr.end();
      setImmediate(() => {
        this.emit("exit", 0);
        this.emit("close", 0);
      });
    });
  }
}

export function gateShellFrames(gateCommand: string) {
  const startedFrame = JSON.stringify({
    type: "tool_call",
    subtype: "started",
    call_id: "call-gate",
    tool_call: { shellToolCall: { args: { command: gateCommand } } },
  });
  const completedFrame = JSON.stringify({
    type: "tool_call",
    subtype: "completed",
    call_id: "call-gate",
    tool_call: { shellToolCall: { result: { success: { exitCode: 0 } } } },
  });
  const resultFrame = JSON.stringify({ type: "result", result: "progress" });
  return { startedFrame, completedFrame, resultFrame };
}

export function cursorGateShellBinding(frames: string[], holdUntil?: Promise<void>) {
  const spawn = (_binary: string, _argv: readonly string[], _opts: SpawnOptions): ChildProcess => {
    const child = holdUntil !== undefined ? new HoldingGateShellFrameChild(holdUntil) : new GateShellFrameChild();
    child.start(frames);
    return child as unknown as ChildProcess;
  };
  return createResolvedAgentBinding(
    { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "composer" },
    { spawn },
  );
}

export function claudeGateShellFrames(gateCommand: string, toolUseId = "toolu_gate") {
  const assistantStart = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: toolUseId, name: "Bash", input: { command: gateCommand } }],
    },
  });
  const toolResult = JSON.stringify({ type: "tool_result", tool_use_id: toolUseId, content: "ok" });
  const resultFrame = JSON.stringify({ type: "result", result: "progress" });
  return { assistantStart, toolResult, resultFrame };
}

export function claudeStreamGateShellFrames(gateCommand: string, toolUseId = "toolu_stream_gate") {
  const streamStart = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: toolUseId, name: "Bash", input: {} },
    },
  });
  const streamDelta = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: gateCommand }) },
    },
  });
  const streamStop = JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_stop", index: 0 },
  });
  const toolResult = JSON.stringify({ type: "tool_result", tool_use_id: toolUseId, content: "ok" });
  const resultFrame = JSON.stringify({ type: "result", result: "progress" });
  return { streamStart, streamDelta, streamStop, toolResult, resultFrame };
}

export function claudeGateShellBinding(frames: string[]) {
  const spawn = (_binary: string, _argv: readonly string[], _opts: SpawnOptions): ChildProcess => {
    const child = new GateShellFrameChild();
    child.start(frames);
    return child as unknown as ChildProcess;
  };
  return createResolvedAgentBinding({ agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" }, { spawn });
}

export const PLAN_DRAFT_INTENT_SEED = "---\nname: test\n---\n\n## Prerequisites\n\nnone\n";
export const PLAN_DRAFT_SPEC_PATH = "spec/2099-01-01T00-00-00Z-plan-draft";
/** Dispatches a plan.prompt.draft run whose agent appends a genuine `## Blocker` section to
 * staged intent.md, tripping the plan.draft.blocker prerequisite contract. */
export function runPlanDraftAgentBlocker(
  jarvisRoot: string,
  stateDbPath: string,
  branchName: string,
  logSink: TestLogSink,
): Promise<WriteLoopResult> {
  return runLoop({
    jarvisRoot,
    stateDbPath,
    branchName,
    artifactPath: ".jarvis-plan-stage",
    specPath: PLAN_DRAFT_SPEC_PATH,
    promptId: "plan.prompt.draft",
    intentSeed: PLAN_DRAFT_INTENT_SEED,
    logSink,
    bindings: [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          writeFileSync(
            join(cwd, ".jarvis-plan-stage", "intent.md"),
            `${PLAN_DRAFT_INTENT_SEED}\n## Blocker\n\nAgent got stuck.\n`,
            "utf8",
          );
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ],
  });
}

export function writePlanDraftStage(stagePath: string, subspecFile = "00-one.md"): void {
  mkdirSync(stagePath, { recursive: true });
  writeFileSync(join(stagePath, "intent.md"), "---\nname: test\n---\n", "utf8");
  writeFileSync(join(stagePath, "index.md"), `# Index\n\n- [ ] [00 - One](./${subspecFile})\n`, "utf8");
  writeFileSync(join(stagePath, subspecFile), "# One\n\n## Acceptance criteria\n\n- [ ] Valid criterion.\n", "utf8");
}

export function writeBrokenIndexPlanDraftStage(stagePath: string, subspecFile = "00-one.md"): void {
  writePlanDraftStage(stagePath, subspecFile);
  writeFileSync(join(stagePath, "index.md"), "# Index\n\n- [ ] [Wrong](./01-wrong.md)\n", "utf8");
}

export function writeLintCleanPlanDraftStage(stagePath: string, subspecFile = "00-one.md"): void {
  writePlanDraftStage(stagePath, subspecFile);
  writeFileSync(join(stagePath, "intent.md"), "---\nname: test\n---\n\n# Test\n\n## Prerequisites\n\nNone.\n", "utf8");
}

export function loopTelemetry(sinkPath: string): NonNullable<WriteLoopInput["telemetry"]> {
  return {
    sinkPath,
    operatorSessionId: "session-1",
    workflow: "write",
    role: "implement",
  };
}

/** Test log sink that captures all events. */
export class TestLogSink implements LogSink {
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

  tail(runId: string): PersistedRecord[] {
    return this.getEventsForRun(runId).map((event, index) => ({
      runId,
      seq: index + 1,
      ts: new Date(index).toISOString(),
      event,
    }));
  }
}

/**
 * A `schedule` seam that never auto-fires; the test drives `fire()` explicitly. Tracks every
 * registration so repeated `bumpWallSegment` cancel/reschedule calls (not just the first
 * registration) are each independently cancellable and observable.
 */
export function createManualWallSchedule(): {
  schedule: WallSegmentSchedule;
  waitForSchedule: () => Promise<void>;
  fire: () => void;
  registrationCount: () => number;
  cancelledCount: () => number;
} {
  type Registration = { fire: () => void; cancelled: boolean };
  const registrations: Registration[] = [];
  let notifyRegistered: (() => void) | undefined;

  const schedule: WallSegmentSchedule = (fire) => {
    const registration: Registration = { fire, cancelled: false };
    registrations.push(registration);
    notifyRegistered?.();
    return { cancel: () => (registration.cancelled = true) };
  };

  const waitForSchedule = () =>
    registrations.length > 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          notifyRegistered = resolve;
        });

  return {
    schedule,
    waitForSchedule,
    fire: () => {
      const latest = registrations[registrations.length - 1];
      if (latest !== undefined && !latest.cancelled) latest.fire();
    },
    registrationCount: () => registrations.length,
    cancelledCount: () => registrations.filter((r) => r.cancelled).length,
  };
}

export const UNREF_CALLED = Symbol("unref-called");

type TimeoutHandle = ReturnType<typeof setTimeout>;

let setTimeoutCaptureLock: Promise<void> = Promise.resolve();

export async function withSetTimeoutCapture<T>(
  expectedDelayMs: number,
  run: () => Promise<T>,
): Promise<{ result: T; captured: TimeoutHandle[] }> {
  const captured: TimeoutHandle[] = [];
  let releaseLock!: () => void;
  const priorLock = setTimeoutCaptureLock;
  setTimeoutCaptureLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  await priorLock;

  const original = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]) => {
    const handle = original(callback, delay, ...args);
    if (delay === expectedDelayMs) {
      const timer = handle as NodeJS.Timeout & { [UNREF_CALLED]?: boolean };
      const realUnref = timer.unref?.bind(timer);
      timer.unref = () => {
        timer[UNREF_CALLED] = true;
        realUnref?.();
        return timer;
      };
      captured.push(handle);
    }
    return handle;
  }) as typeof setTimeout;

  try {
    const result = await run();
    return { result, captured };
  } finally {
    globalThis.setTimeout = original;
    releaseLock();
  }
}

/**
 * `clearTimeout` alone drives Bun's `hasRef()` to false, so asserting it after the fenced work
 * settles passes whether or not production ever called `.unref?.()`. Record the call instead.
 */
export function expectCapturedTimersUnrefd(handles: readonly TimeoutHandle[]): void {
  expect(handles.length).toBeGreaterThan(0);
  for (const handle of handles) {
    expect((handle as NodeJS.Timeout & { [UNREF_CALLED]?: boolean })[UNREF_CALLED] ?? false).toBe(true);
  }
}

export function createHeldInvocation() {
  let signal: AbortSignal | undefined;
  let resolveStarted: (() => void) | undefined;
  let releaseProcess: (() => void) | undefined;
  let processSettled = false;
  let invocationSettled = false;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const process = new Promise<void>((resolve) => {
    releaseProcess = resolve;
  });

  return {
    started,
    invoke(invocationSignal: AbortSignal | undefined) {
      signal = invocationSignal;
      resolveStarted?.();
      return process
        .then(() => {
          processSettled = true;
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        })
        .finally(() => {
          invocationSettled = true;
        });
    },
    release: () => releaseProcess?.(),
    get signal() {
      return signal;
    },
    get processSettled() {
      return processSettled;
    },
    get invocationSettled() {
      return invocationSettled;
    },
  };
}

/**
 * Drives one iteration to settlement via the injected schedule seam: no bare setTimeout races the
 * watchdog. "abort-first" calls abort(), flushes its microtask settlement, then fires the watchdog
 * synchronously. "watchdog-first" fires the watchdog synchronously, then calls abort().
 */
export async function runAbortWatchdogOrdering(args: {
  jarvisRoot: string;
  stateStore: StateStore;
  order: "abort-first" | "watchdog-first";
  branchName: string;
}) {
  const controller = new AbortController();
  const manual = createManualWallSchedule();
  const resultPromise = executeWriteLoop({
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: args.branchName,
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    bindings: simulatedBindings(["done"]),
    stateStore: args.stateStore,
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
    sessionsDir: join(args.jarvisRoot, "sessions"),
    signal: controller.signal,
    iterationTimeoutMs: 1_000_000,
    schedule: manual.schedule,
  });
  await manual.waitForSchedule();
  if (args.order === "abort-first") {
    controller.abort();
    // Abort settles via a single `queueMicrotask` hop (write-loop.ts `resolveAbort`); two
    // microtask flushes guarantee that settlement is observable before the watchdog fires.
    await Promise.resolve();
    await Promise.resolve();
    manual.fire();
  } else {
    manual.fire();
    controller.abort();
  }
  return resultPromise;
}

/** Stub markdownlint: reports no violations, so plan-draft tests never spawn the real binary. */
export const CLEAN_MARKDOWNLINT_RUNNER: AsyncSubprocessRunner = { runAsync: async () => "" };

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test helper mirrors write-loop call surface
export async function runLoop(args: {
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
  persistedRepairFenceEnforcer?: WriteLoopInput["persistedRepairFenceEnforcer"];
  stepId?: string;
  workflowSnapshot?: WriteLoopInput["workflowSnapshot"];
  promptId?: WriteLoopInput["promptId"];
  landing?: WriteLoopInput["landing"];
  intentSeed?: WriteLoopInput["intentSeed"];
  promptPlaceholders?: WriteLoopInput["promptPlaceholders"];
  publishCompletion?: boolean;
  freshDispatch?: boolean;
  fixCommand?: WriteLoopInput["fixCommand"];
  readyCommand?: WriteLoopInput["readyCommand"];
  runFixCommand?: WriteLoopInput["runFixCommand"];
  runBuiltInReadyGateAutofixBiome?: WriteLoopInput["runBuiltInReadyGateAutofixBiome"];
  runAutofixTypecheck?: WriteLoopInput["runAutofixTypecheck"];
  iterationTimeoutMs?: number;
  readyGateScopeSeams?: WriteLoopInput["readyGateScopeSeams"];
  verifyDiffDerivedMutations?: WriteLoopInput["verifyDiffDerivedMutations"];
  bindingResolution?: WriteLoopInput["bindingResolution"];
  preShrinkHead?: WriteLoopInput["preShrinkHead"];
  externalPlanSpec?: WriteLoopInput["externalPlanSpec"];
  specReadRoot?: WriteLoopInput["specReadRoot"];
  completionValidator?: WriteLoopInput["completionValidator"];
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
    ...(args.persistedRepairFenceEnforcer !== undefined
      ? { persistedRepairFenceEnforcer: args.persistedRepairFenceEnforcer }
      : {}),
    ...(args.stepId !== undefined ? { stepId: args.stepId } : {}),
    ...(args.workflowSnapshot !== undefined ? { workflowSnapshot: args.workflowSnapshot } : {}),
    ...(args.promptId !== undefined ? { promptId: args.promptId } : {}),
    ...(args.landing !== undefined ? { landing: args.landing } : {}),
    ...(args.intentSeed !== undefined ? { intentSeed: args.intentSeed } : {}),
    ...(args.promptPlaceholders !== undefined ? { promptPlaceholders: args.promptPlaceholders } : {}),
    ...(args.publishCompletion !== undefined ? { publishCompletion: args.publishCompletion } : {}),
    ...(args.freshDispatch === true ? { freshDispatch: true } : {}),
    ...(args.fixCommand !== undefined ? { fixCommand: args.fixCommand } : {}),
    ...(args.readyCommand !== undefined ? { readyCommand: args.readyCommand } : {}),
    ...(args.runFixCommand !== undefined ? { runFixCommand: args.runFixCommand } : {}),
    ...(args.runBuiltInReadyGateAutofixBiome !== undefined
      ? { runBuiltInReadyGateAutofixBiome: args.runBuiltInReadyGateAutofixBiome }
      : {}),
    ...(args.runAutofixTypecheck !== undefined ? { runAutofixTypecheck: args.runAutofixTypecheck } : {}),
    ...(args.iterationTimeoutMs !== undefined ? { iterationTimeoutMs: args.iterationTimeoutMs } : {}),
    ...(args.readyGateScopeSeams !== undefined ? { readyGateScopeSeams: args.readyGateScopeSeams } : {}),
    ...(args.verifyDiffDerivedMutations !== undefined
      ? { verifyDiffDerivedMutations: args.verifyDiffDerivedMutations }
      : {}),
    ...(args.bindingResolution !== undefined ? { bindingResolution: args.bindingResolution } : {}),
    ...(args.preShrinkHead !== undefined ? { preShrinkHead: args.preShrinkHead } : {}),
    ...(args.externalPlanSpec === true ? { externalPlanSpec: true as const } : {}),
    ...(args.specReadRoot !== undefined ? { specReadRoot: args.specReadRoot } : {}),
    ...(args.completionValidator !== undefined ? { completionValidator: args.completionValidator } : {}),
  };
  try {
    return await executeWriteLoop({ ...loopInput, stagedMarkdownLintRunner: CLEAN_MARKDOWNLINT_RUNNER });
  } finally {
    store.close();
  }
}

export const mockVerifyPass = async () => ({
  kind: "pass" as const,
  runBase: "HEAD",
  inspectedPaths: [],
  candidateCount: 0,
  acceptedSites: [],
  skippedCandidates: [],
});

export function publicationSurvivor(): SurvivingMutationError {
  return new SurvivingMutationError(
    "operator-flip: === → !==",
    "src/test.ts",
    42,
    ["src/test.test.ts"],
    "passed-unconfirmed",
  );
}

/** `write.mutation-repair` attempt numbers recorded in this run's harness session logs, ascending. */
export function mutationRepairSessionAttempts(sessionsDir: string, runId: string): number[] {
  if (!existsSync(sessionsDir)) return [];
  const attempts: number[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (lstatSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      const content = readFileSync(path, "utf8");
      if (!content.includes(`run=${runId}`)) continue;
      const match = /mutation-repair=(\d+)/.exec(content);
      if (match?.[1] !== undefined) attempts.push(Number(match[1]));
    }
  };
  walk(sessionsDir);
  return attempts.sort((a, b) => a - b);
}

export function iterationStartsBeforeLoopFinished(events: readonly LogEvent[]): number {
  const finished = events.findIndex((event) => event.kind === "loop_finished");
  return events.slice(0, finished).filter((event) => event.kind === "iteration_started").length;
}

export function loopOutcomeKinds(events: readonly LogEvent[]): string[] {
  return events.flatMap((event) => (event.kind === "loop_finished" ? [event.loopOutcomeKind] : []));
}

export function gitIn(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

export function initMutationRepairGitWorktree(
  jarvisRoot: string,
  branchName: string,
): { worktreePath: string; head: string } {
  const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
  mkdirSync(join(worktreePath, "src"), { recursive: true });
  writeFileSync(join(worktreePath, ".gitignore"), ".reused\n", "utf8");
  writeFileSync(join(worktreePath, "spec.md"), "- [x] work\n", "utf8");
  writeFileSync(join(worktreePath, "src", "guard.ts"), "export const guard = () => true;\n", "utf8");
  gitIn(worktreePath, ["init", "-q"]);
  gitIn(worktreePath, ["config", "user.email", "test@example.com"]);
  gitIn(worktreePath, ["config", "user.name", "Test User"]);
  gitIn(worktreePath, ["config", "commit.gpgsign", "false"]);
  gitIn(worktreePath, ["add", "-A"]);
  gitIn(worktreePath, ["commit", "-qm", "seed"]);
  return { worktreePath, head: gitIn(worktreePath, ["rev-parse", "HEAD"]) };
}

export function worktreeHeadOrUndefined(worktreePath: string): string | undefined {
  try {
    return gitIn(worktreePath, ["rev-parse", "HEAD"]);
  } catch {
    return undefined;
  }
}

/** Publish once through `publishWithReadyRepair` with a ready finalizer that always reports a survivor. */
export async function publishSurvivingMutation(options: {
  jarvisRoot: string;
  store: StateStore;
  runId: string;
  branchName: string;
  worktreePath: string;
  bindings: readonly InvocationBinding[];
  logSink?: LogSink;
  iterationTimeoutMs?: number;
  /** Tip the fake publisher reports; defaults to the worktree HEAD (as the real publisher does). */
  publisherPushSha?: () => string | undefined;
}) {
  const pushSha = options.publisherPushSha ?? (() => worktreeHeadOrUndefined(options.worktreePath));
  return publishWithReadyRepair(
    {
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: options.branchName,
        baseRef: "HEAD",
        jarvisRoot: options.jarvisRoot,
      },
      specPath: "spec.md",
      stepRules: "repair",
      expectedArtifactPath: "proof.txt",
      bindings: options.bindings,
      stateStore: options.store,
      withExternalWorktree: createFakeWithExternalWorktree(options.jarvisRoot),
      sessionsDir: join(options.jarvisRoot, "sessions"),
      verifyDiffDerivedMutations: mockVerifyPass,
      completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
      completionPublisher: async () => {
        const sha = pushSha();
        return sha === undefined ? {} : { pushSha: sha, prNumber: 7, prUrl: "https://example.test/pr/7" };
      },
      readyFinalizer: async () => {
        throw publicationSurvivor();
      },
      ...(options.logSink !== undefined ? { logSink: options.logSink } : {}),
      ...(options.iterationTimeoutMs !== undefined
        ? { iterationTimeoutMs: options.iterationTimeoutMs, quiescenceTimeoutMs: options.iterationTimeoutMs }
        : {}),
    },
    options.store,
    { kind: "complete", runId: options.runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
    0,
    { worktreePath: options.worktreePath, baseRef: "HEAD", specPath: "spec.md", branch: options.branchName },
  );
}

export const IN_LOOP_SURVIVING_MUTATION = "operator-flip: === → !==";
export const IN_LOOP_SURVIVING_SOURCE_FILE = "src/execution/guard.ts";
export const IN_LOOP_SURVIVING_SOURCE_LINE = 17;
export const IN_LOOP_NON_TERMINATING_MUTATION = "guard-flip: while (true) → while (false)";
export const IN_LOOP_NON_TERMINATING_SOURCE_FILE = "src/daemon/daemon-run-control-handler-guard.ts";
export const IN_LOOP_NON_TERMINATING_SOURCE_LINE = 42;

export const SHRINK_LOOP_TEST_PLACEHOLDERS = {
  SPEC_TREE: "# Spec\n",
  ALLOWLIST: "- proof.txt",
  BRANCH_DIFF: "(no changes)",
  RUN_SCOPED_DIFF: "(no changes)",
} as const;

export function writeSpecIndex(jarvisRoot: string, branchName: string, content: string): void {
  const specDir = join(jarvisRoot, "worktrees", "demo", branchName, "spec");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "index.md"), content, "utf8");
}

export function loadRunOnce(stateDbPath: string, runId: string) {
  const store = openStateStore(stateDbPath);
  try {
    return store.loadRun(runId);
  } finally {
    store.close();
  }
}

export function loadTelemetryRows(path: string): InvocationCompletedRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as InvocationCompletedRecord);
}

export function loadWorkBoundaryRows(path: string): WorkBoundaryRecordedRecord[] {
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
export function crashOnceMidBoundary(inner: StateStore): StateStore {
  let crashed = false;
  return {
    currentOwnerIdentity: () => inner.currentOwnerIdentity(),
    createRun: (args) => inner.createRun(args),
    setCreationTitle: (runId, title) => inner.setCreationTitle(runId, title),
    setInvocationLeaseFromSha: (invocationId, leases) => inner.setInvocationLeaseFromSha(invocationId, leases),
    setRunSpecPath: (runId, specPath) => inner.setRunSpecPath(runId, specPath),
    setRunDownstreamInputs: (runId, downstreamInputs) => inner.setRunDownstreamInputs(runId, downstreamInputs),
    clearRunDownstreamInputs: (runId) => inner.clearRunDownstreamInputs(runId),
    setPrEvidence: (runId, prNumber, prUrl) => inner.setPrEvidence(runId, prNumber, prUrl),
    setReadyGatePgid: (runId, pgid) => inner.setReadyGatePgid(runId, pgid),
    readRunBudgetConsumedMs: (budgetKey) => inner.readRunBudgetConsumedMs(budgetKey),
    writeRunBudgetConsumedMs: (budgetKey, consumedMs) => inner.writeRunBudgetConsumedMs(budgetKey, consumedMs),
    readMutationRepairAttempts: (runId) => inner.readMutationRepairAttempts(runId),
    recordMutationRepairAttempts: (runId, consumed) => inner.recordMutationRepairAttempts(runId, consumed),
    readWorkflowInvocationSettledMarker: (entryRunId) => inner.readWorkflowInvocationSettledMarker(entryRunId),
    writeWorkflowInvocationSettledMarker: (entryRunId, cause, settledAt) =>
      inner.writeWorkflowInvocationSettledMarker(entryRunId, cause, settledAt),
    recordVerifierProcessGroup: (runId, pgid) => inner.recordVerifierProcessGroup(runId, pgid),
    verifierProcessGroups: (runId) => inner.verifierProcessGroups(runId),
    clearVerifierProcessGroup: (runId, pgid) => inner.clearVerifierProcessGroup(runId, pgid),
    clearVerifierProcessGroups: (runId) => inner.clearVerifierProcessGroups(runId),
    listReadyGateSweepCandidates: () => inner.listReadyGateSweepCandidates(),
    setReadyGateRepairFence: (runId, fence) => inner.setReadyGateRepairFence(runId, fence),
    setRetainedFinalizationCheckpoint: (runId, checkpoint) =>
      inner.setRetainedFinalizationCheckpoint(runId, checkpoint),
    recordHarnessReadyFlipEvidence: (args) => inner.recordHarnessReadyFlipEvidence(args),
    findNewestHarnessReadyFlipEvidenceInLineage: (args) => inner.findNewestHarnessReadyFlipEvidenceInLineage(args),
    loadRun: (runId) => inner.loadRun(runId),
    findRunByProjectBranch: (args) => inner.findRunByProjectBranch(args),
    findReviewMutationLineageRows: (args) => inner.findReviewMutationLineageRows(args),
    findRunsByInvocationId: (invocationId) => inner.findRunsByInvocationId(invocationId),
    findRunsByInvocationIds: (invocationIds) => inner.findRunsByInvocationIds(invocationIds),
    findWorkflowRunsOnLane: (args) => inner.findWorkflowRunsOnLane(args),
    loadRunsByIds: (runIds) => inner.loadRunsByIds(runIds),
    createPipeline: (args) => inner.createPipeline(args),
    createPipelineStageBranch: (args) => inner.createPipelineStageBranch(args),
    loadPipeline: (pipelineId) => inner.loadPipeline(pipelineId),
    listPipelines: () => inner.listPipelines(),
    updateStage: (args) => inner.updateStage(args),
    commitTerminalStageOperatorFailureRecord: (args) => inner.commitTerminalStageOperatorFailureRecord(args),
    loadTerminalStageOperatorFailureRecord: (args) => inner.loadTerminalStageOperatorFailureRecord(args),
    settleLinkedStagesFromEntryRun: (entryRunId) => inner.settleLinkedStagesFromEntryRun(entryRunId),
    commitApprovalBoundary: (args) => inner.commitApprovalBoundary(args),
    commitApprovalDecision: (args) => inner.commitApprovalDecision(args),
    claimPipelineContinuation: (args) => inner.claimPipelineContinuation(args),
    adoptOrphanedPipeline: (pipelineId) => inner.adoptOrphanedPipeline(pipelineId),
    pipelineOwnerIsDead: (pipelineId) => inner.pipelineOwnerIsDead(pipelineId),
    claimPipelineStageAdmission: (args) => inner.claimPipelineStageAdmission(args),
    releasePipelineStageAdmission: (args) => inner.releasePipelineStageAdmission(args),
    loadPipelineStageAdmission: (args) => inner.loadPipelineStageAdmission(args),
    reopenFailedPipeline: (args) => inner.reopenFailedPipeline(args),
    reopenInterruptedPipeline: (args) => inner.reopenInterruptedPipeline(args),
    reopenProvisionalSkippedStages: (args) => inner.reopenProvisionalSkippedStages(args),
    reopenFailedStagesForResume: (entryRunId) => inner.reopenFailedStagesForResume(entryRunId),
    restoreReopenedFailedStages: (reopened) => inner.restoreReopenedFailedStages(reopened),
    commitTerminalPublicationFailure: (args) => inner.commitTerminalPublicationFailure(args),
    commitTerminalPublicationSuccess: (args) => inner.commitTerminalPublicationSuccess(args),
    appendSupersedeFailures: (args) => inner.appendSupersedeFailures(args),
    dismissPipeline: (args) => inner.dismissPipeline(args),
    undismissPipeline: (args) => inner.undismissPipeline(args),
    recordAttemptStart: (runId) => inner.recordAttemptStart(runId),
    setRunStatus: (runId, status) => inner.setRunStatus(runId, status),
    admitRunForResume: (runId) => inner.admitRunForResume(runId),
    incrementSlotRedriveCount: (runId) => inner.incrementSlotRedriveCount(runId),
    commitGuardedKill: (runId) => inner.commitGuardedKill(runId),
    commitTerminalRunSettlement: (args) => inner.commitTerminalRunSettlement(args),
    dismissRun: (runId) => inner.dismissRun(runId),
    undismissRun: (runId) => inner.undismissRun(runId),
    dismissTerminalRunsForProject: (args) => inner.dismissTerminalRunsForProject(args),
    forceKillOwnerAdmits: (runId) => inner.forceKillOwnerAdmits(runId),
    beginRunReconciliation: () => inner.beginRunReconciliation(),
    finishRunReconciliation: (runId) => inner.finishRunReconciliation(runId),
    reconcilePipelines: () => inner.reconcilePipelines(),
    listRuns: () => inner.listRuns(),
    listIncidentCandidateRuns: (args) => inner.listIncidentCandidateRuns(args),
    listIncidentCandidatePipelines: (args) => inner.listIncidentCandidatePipelines(args),
    hasQueuedRun: (args) => inner.hasQueuedRun(args),
    listQueuedRuns: () => inner.listQueuedRuns(),
    hasNotificationDelivery: (args) => inner.hasNotificationDelivery(args),
    listNotificationDeliveriesForIncidentIds: (incidentIds) =>
      inner.listNotificationDeliveriesForIncidentIds(incidentIds),
    listDeliveredNotificationIncidents: (args) => inner.listDeliveredNotificationIncidents(args),
    loadDeliveredNotificationIncident: (args) => inner.loadDeliveredNotificationIncident(args),
    tryRecordNotificationDelivery: (args) => inner.tryRecordNotificationDelivery(args),
    releaseNotificationDelivery: (args) => inner.releaseNotificationDelivery(args),
    loadNotificationKeyFormatVersion: () => inner.loadNotificationKeyFormatVersion(),
    recordNotificationKeyFormatVersion: (version) => inner.recordNotificationKeyFormatVersion(version),
    isClosed: () => inner.isClosed(),
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

export type CompletedWriteObservation = {
  prNumber?: number | null;
  prUrl?: string | null;
  terminalCause?: string | null;
  finishedAt?: number | null;
};

/** Wrap a store to record fields present on each terminal completed settlement. */
export function storeObservingCompletedWrites(inner: StateStore): {
  store: StateStore;
  completedWrites: CompletedWriteObservation[];
} {
  const completedWrites: CompletedWriteObservation[] = [];
  const recordCompletedSettlement = (runId: string) => {
    const row = inner.loadRun(runId);
    if (row?.status !== "completed") return;
    completedWrites.push({
      ...(row.prNumber !== undefined ? { prNumber: row.prNumber } : {}),
      ...(row.prUrl !== undefined ? { prUrl: row.prUrl } : {}),
      ...(row.terminalCause !== undefined ? { terminalCause: row.terminalCause } : {}),
      ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}),
    });
  };
  const store: StateStore = {
    currentOwnerIdentity: () => inner.currentOwnerIdentity(),
    createRun: (args) => inner.createRun(args),
    setCreationTitle: (runId, title) => inner.setCreationTitle(runId, title),
    setInvocationLeaseFromSha: (invocationId, leases) => inner.setInvocationLeaseFromSha(invocationId, leases),
    setRunSpecPath: (runId, specPath) => inner.setRunSpecPath(runId, specPath),
    setRunDownstreamInputs: (runId, downstreamInputs) => inner.setRunDownstreamInputs(runId, downstreamInputs),
    clearRunDownstreamInputs: (runId) => inner.clearRunDownstreamInputs(runId),
    setPrEvidence: (runId, prNumber, prUrl) => inner.setPrEvidence(runId, prNumber, prUrl),
    setReadyGatePgid: (runId, pgid) => inner.setReadyGatePgid(runId, pgid),
    readRunBudgetConsumedMs: (budgetKey) => inner.readRunBudgetConsumedMs(budgetKey),
    writeRunBudgetConsumedMs: (budgetKey, consumedMs) => inner.writeRunBudgetConsumedMs(budgetKey, consumedMs),
    readMutationRepairAttempts: (runId) => inner.readMutationRepairAttempts(runId),
    recordMutationRepairAttempts: (runId, consumed) => inner.recordMutationRepairAttempts(runId, consumed),
    readWorkflowInvocationSettledMarker: (entryRunId) => inner.readWorkflowInvocationSettledMarker(entryRunId),
    writeWorkflowInvocationSettledMarker: (entryRunId, cause, settledAt) =>
      inner.writeWorkflowInvocationSettledMarker(entryRunId, cause, settledAt),
    recordVerifierProcessGroup: (runId, pgid) => inner.recordVerifierProcessGroup(runId, pgid),
    verifierProcessGroups: (runId) => inner.verifierProcessGroups(runId),
    clearVerifierProcessGroup: (runId, pgid) => inner.clearVerifierProcessGroup(runId, pgid),
    clearVerifierProcessGroups: (runId) => inner.clearVerifierProcessGroups(runId),
    listReadyGateSweepCandidates: () => inner.listReadyGateSweepCandidates(),
    setReadyGateRepairFence: (runId, fence) => inner.setReadyGateRepairFence(runId, fence),
    setRetainedFinalizationCheckpoint: (runId, checkpoint) =>
      inner.setRetainedFinalizationCheckpoint(runId, checkpoint),
    recordHarnessReadyFlipEvidence: (args) => inner.recordHarnessReadyFlipEvidence(args),
    findNewestHarnessReadyFlipEvidenceInLineage: (args) => inner.findNewestHarnessReadyFlipEvidenceInLineage(args),
    loadRun: (runId) => inner.loadRun(runId),
    findRunByProjectBranch: (args) => inner.findRunByProjectBranch(args),
    findReviewMutationLineageRows: (args) => inner.findReviewMutationLineageRows(args),
    findRunsByInvocationId: (invocationId) => inner.findRunsByInvocationId(invocationId),
    findRunsByInvocationIds: (invocationIds) => inner.findRunsByInvocationIds(invocationIds),
    findWorkflowRunsOnLane: (args) => inner.findWorkflowRunsOnLane(args),
    loadRunsByIds: (runIds) => inner.loadRunsByIds(runIds),
    createPipeline: (args) => inner.createPipeline(args),
    createPipelineStageBranch: (args) => inner.createPipelineStageBranch(args),
    loadPipeline: (pipelineId) => inner.loadPipeline(pipelineId),
    listPipelines: () => inner.listPipelines(),
    updateStage: (args) => inner.updateStage(args),
    commitTerminalStageOperatorFailureRecord: (args) => inner.commitTerminalStageOperatorFailureRecord(args),
    loadTerminalStageOperatorFailureRecord: (args) => inner.loadTerminalStageOperatorFailureRecord(args),
    settleLinkedStagesFromEntryRun: (entryRunId) => inner.settleLinkedStagesFromEntryRun(entryRunId),
    commitApprovalBoundary: (args) => inner.commitApprovalBoundary(args),
    commitApprovalDecision: (args) => inner.commitApprovalDecision(args),
    claimPipelineContinuation: (args) => inner.claimPipelineContinuation(args),
    adoptOrphanedPipeline: (pipelineId) => inner.adoptOrphanedPipeline(pipelineId),
    pipelineOwnerIsDead: (pipelineId) => inner.pipelineOwnerIsDead(pipelineId),
    claimPipelineStageAdmission: (args) => inner.claimPipelineStageAdmission(args),
    releasePipelineStageAdmission: (args) => inner.releasePipelineStageAdmission(args),
    loadPipelineStageAdmission: (args) => inner.loadPipelineStageAdmission(args),
    reopenFailedPipeline: (args) => inner.reopenFailedPipeline(args),
    reopenInterruptedPipeline: (args) => inner.reopenInterruptedPipeline(args),
    reopenProvisionalSkippedStages: (args) => inner.reopenProvisionalSkippedStages(args),
    reopenFailedStagesForResume: (entryRunId) => inner.reopenFailedStagesForResume(entryRunId),
    restoreReopenedFailedStages: (reopened) => inner.restoreReopenedFailedStages(reopened),
    commitTerminalPublicationFailure: (args) => inner.commitTerminalPublicationFailure(args),
    commitTerminalPublicationSuccess: (args) => inner.commitTerminalPublicationSuccess(args),
    appendSupersedeFailures: (args) => inner.appendSupersedeFailures(args),
    dismissPipeline: (args) => inner.dismissPipeline(args),
    undismissPipeline: (args) => inner.undismissPipeline(args),
    recordAttemptStart: (runId) => inner.recordAttemptStart(runId),
    setRunStatus: (runId, status) => inner.setRunStatus(runId, status),
    admitRunForResume: (runId) => inner.admitRunForResume(runId),
    incrementSlotRedriveCount: (runId) => inner.incrementSlotRedriveCount(runId),
    commitGuardedKill: (runId) => inner.commitGuardedKill(runId),
    commitTerminalRunSettlement: (args) => {
      const outcome = inner.commitTerminalRunSettlement(args);
      if (args.status === "completed") recordCompletedSettlement(args.runId);
      return outcome;
    },
    dismissRun: (runId) => inner.dismissRun(runId),
    undismissRun: (runId) => inner.undismissRun(runId),
    dismissTerminalRunsForProject: (args) => inner.dismissTerminalRunsForProject(args),
    forceKillOwnerAdmits: (runId) => inner.forceKillOwnerAdmits(runId),
    beginRunReconciliation: () => inner.beginRunReconciliation(),
    finishRunReconciliation: (runId) => inner.finishRunReconciliation(runId),
    reconcilePipelines: () => inner.reconcilePipelines(),
    listRuns: () => inner.listRuns(),
    listIncidentCandidateRuns: (args) => inner.listIncidentCandidateRuns(args),
    listIncidentCandidatePipelines: (args) => inner.listIncidentCandidatePipelines(args),
    hasQueuedRun: (args) => inner.hasQueuedRun(args),
    listQueuedRuns: () => inner.listQueuedRuns(),
    hasNotificationDelivery: (args) => inner.hasNotificationDelivery(args),
    listNotificationDeliveriesForIncidentIds: (incidentIds) =>
      inner.listNotificationDeliveriesForIncidentIds(incidentIds),
    listDeliveredNotificationIncidents: (args) => inner.listDeliveredNotificationIncidents(args),
    loadDeliveredNotificationIncident: (args) => inner.loadDeliveredNotificationIncident(args),
    tryRecordNotificationDelivery: (args) => inner.tryRecordNotificationDelivery(args),
    releaseNotificationDelivery: (args) => inner.releaseNotificationDelivery(args),
    loadNotificationKeyFormatVersion: () => inner.loadNotificationKeyFormatVersion(),
    recordNotificationKeyFormatVersion: (version) => inner.recordNotificationKeyFormatVersion(version),
    isClosed: () => inner.isClosed(),
    close: () => inner.close(),
    commitCompletionBoundary: (args) => inner.commitCompletionBoundary(args),
  };
  return { store, completedWrites };
}

function initGitRepairFenceGitWorktree(jarvisRoot: string, branchName: string): string {
  const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
  execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
  return worktreePath;
}
const REPAIR_FENCE_SEED_TEST_SLICE = `export const SANDBOX_SUFFIX = ".sandbox-unrunnable.test.ts";

export const LOAD_SENSITIVE_FILES: readonly string[] = [
  "src/existing.test.ts",
];

export function isLoadSensitive(file: string): boolean {
  return file.endsWith(SANDBOX_SUFFIX) || LOAD_SENSITIVE_FILES.includes(file);
}
`;

export function initRepairFenceWorktree(
  jarvisRoot: string,
  branchName: string,
  options?: {
    harnessSidecars?: boolean;
    loadSensitiveSlice?: boolean;
    touchUntouchedInIteration?: boolean;
  },
): { worktreePath: string; baseRef: string } {
  const worktreePath = initGitRepairFenceGitWorktree(jarvisRoot, branchName);
  if (options?.loadSensitiveSlice === true) {
    mkdirSync(join(worktreePath, "scripts"), { recursive: true });
  }
  mkdirSync(join(worktreePath, "src"), { recursive: true });
  writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
  writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
  if (options?.loadSensitiveSlice === true) {
    writeFileSync(join(worktreePath, "scripts/test-slice.ts"), REPAIR_FENCE_SEED_TEST_SLICE, "utf8");
  }
  if (options?.harnessSidecars !== true) {
    writeFileSync(join(worktreePath, "src/untouched.test.ts"), "export {}\n", "utf8");
    writeFileSync(join(worktreePath, ".gitignore"), ".reused\n", "utf8");
  }
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
  const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
  if (options?.harnessSidecars === true) {
    writeFileSync(join(worktreePath, ".jarvis-intent-review-verdict.md"), "verdict\n", "utf8");
    writeFileSync(join(worktreePath, ".jarvis-intent-review-verdict.md.owner"), "owner\n", "utf8");
    execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  } else if (options?.loadSensitiveSlice === true) {
    writeFileSync(
      join(worktreePath, "scripts/test-slice.ts"),
      REPAIR_FENCE_SEED_TEST_SLICE.replace(
        '"src/existing.test.ts",',
        '"src/existing.test.ts",\n  "src/implement-grown.test.ts",',
      ).replace("export const LOAD_SENSITIVE_FILES", "// touched in run diff\nexport const LOAD_SENSITIVE_FILES"),
      "utf8",
    );
    execFileSync("git", ["-C", worktreePath, "add", "proof.txt", "scripts/test-slice.ts"], { stdio: "pipe" });
  } else if (options?.touchUntouchedInIteration === true) {
    writeFileSync(join(worktreePath, "src/untouched.test.ts"), "iteration\n", "utf8");
    execFileSync("git", ["-C", worktreePath, "add", "proof.txt", "src/untouched.test.ts"], {
      stdio: "pipe",
    });
  } else {
    execFileSync("git", ["-C", worktreePath, "add", "proof.txt"], { stdio: "pipe" });
  }
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "iteration"], { stdio: "pipe" });
  return { worktreePath, baseRef };
}

export function editLoadSensitiveSliceRepair(cwd: string, edit: (content: string) => string) {
  writeFileSync(join(cwd, "proof.txt"), "fixed\n", "utf8");
  const slicePath = join(cwd, "scripts/test-slice.ts");
  writeFileSync(slicePath, edit(readFileSync(slicePath, "utf8")), "utf8");
}

export async function runRepairFenceLoop(args: {
  jarvisRoot: string;
  stateDbPath: string;
  branchName: string;
  baseRef: string;
  repairEdit: (cwd: string, invocations: number) => void;
  stepId?: string;
  workflowSnapshot?: WriteLoopInput["workflowSnapshot"];
  promptId?: WriteLoopInput["promptId"];
  landing?: WriteLoopInput["landing"];
  expectedArtifactPath?: string;
  specPath?: string;
  gateFailurePath?: string;
  promptPlaceholders?: WriteLoopInput["promptPlaceholders"];
  intentSeed?: WriteLoopInput["intentSeed"];
  logSink?: LogSink;
  readyGateScopeSeams?: WriteLoopInput["readyGateScopeSeams"];
  lintMdOnly?: boolean;
  onGateFailure?: (cwd: string) => void;
  runFixCommand?: WriteLoopInput["runFixCommand"];
  runAutofixTypecheck?: WriteLoopInput["runAutofixTypecheck"];
}) {
  const artifactPath = args.expectedArtifactPath ?? "proof.txt";
  const specPath = args.specPath ?? "spec.md";
  const gateFailurePath = args.gateFailurePath ?? artifactPath;
  let gateCalls = 0;
  let invocations = 0;
  let publishCalls = 0;
  const result = await runLoop({
    jarvisRoot: args.jarvisRoot,
    stateDbPath: args.stateDbPath,
    branchName: args.branchName,
    baseRef: args.baseRef,
    specPath,
    artifactPath,
    bindings: [
      {
        id: "sim.1",
        metadata: { agent: "sim-agent-1", model: "sim-model-1" },
        invoke: async ({ cwd }) => {
          invocations += 1;
          if (invocations === 1) {
            mkdirSync(join(cwd, artifactPath, ".."), { recursive: true });
            writeFileSync(join(cwd, artifactPath), "ok\n", "utf8");
          } else {
            args.repairEdit(cwd, invocations);
          }
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        },
      },
    ],
    completionCommitter: createCompletionCommitter(),
    completionPublisher: async () => {
      publishCalls += 1;
      return {};
    },
    runFixCommand: args.runFixCommand ?? (async () => {}),
    ...(args.runAutofixTypecheck !== undefined ? { runAutofixTypecheck: args.runAutofixTypecheck } : {}),
    readyFinalizer: async ({ worktreePath: cwd }) => {
      gateCalls += 1;
      if (invocations === 1) {
        if (gateCalls === 1) args.onGateFailure?.(cwd);
        const output = args.lintMdOnly
          ? lintMdOnlyGateFailureOutput(gateFailurePath)
          : gateFailureOutput(gateFailurePath);
        throw new ReadyGateError("bun run ready", 1, output);
      }
    },
    ...(args.stepId !== undefined ? { stepId: args.stepId } : {}),
    ...(args.workflowSnapshot !== undefined ? { workflowSnapshot: args.workflowSnapshot } : {}),
    ...(args.promptId !== undefined ? { promptId: args.promptId } : {}),
    ...(args.landing !== undefined ? { landing: args.landing } : {}),
    ...(args.promptPlaceholders !== undefined ? { promptPlaceholders: args.promptPlaceholders } : {}),
    ...(args.intentSeed !== undefined ? { intentSeed: args.intentSeed } : {}),
    ...(args.logSink !== undefined ? { logSink: args.logSink } : {}),
    ...(args.readyGateScopeSeams !== undefined ? { readyGateScopeSeams: args.readyGateScopeSeams } : {}),
  });
  return { result, gateCalls, invocations, publishCalls };
}

export function initIntentRepairFenceWorktree(
  jarvisRoot: string,
  branchName: string,
): { worktreePath: string; baseRef: string } {
  const worktreePath = initGitRepairFenceGitWorktree(jarvisRoot, branchName);
  mkdirSync(join(worktreePath, "src"), { recursive: true });
  mkdirSync(join(worktreePath, "scripts"), { recursive: true });
  mkdirSync(join(worktreePath, "v1", "test"), { recursive: true });
  mkdirSync(join(worktreePath, "ready-intents"), { recursive: true });
  mkdirSync(join(worktreePath, ".jarvis-intent-stage"), { recursive: true });
  writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
  writeFileSync(join(worktreePath, "ready-intents", "seed.md"), "# seed\n", "utf8");
  writeFileSync(join(worktreePath, "ready-intents", "index.md"), "# Ready Intents\n", "utf8");
  writeFileSync(join(worktreePath, ".jarvis-intent-stage", "draft.md"), "# draft\n", "utf8");
  writeFileSync(join(worktreePath, "src/untouched.test.ts"), "export {}\n", "utf8");
  writeFileSync(join(worktreePath, "scripts", "helper.ts"), "export {}\n", "utf8");
  writeFileSync(join(worktreePath, "v1/test/sample.test.ts"), "export {}\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
  const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  writeFileSync(join(worktreePath, "ready-intents", "seed.md"), "ok\n", "utf8");
  writeFileSync(join(worktreePath, "src/untouched.test.ts"), "iteration\n", "utf8");
  writeFileSync(join(worktreePath, "scripts", "helper.ts"), "iteration\n", "utf8");
  writeFileSync(join(worktreePath, "v1/test/sample.test.ts"), "iteration\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "iteration"], { stdio: "pipe" });
  return { worktreePath, baseRef };
}

export function initPlanMarkdownOnlyRepairFenceWorktree(
  jarvisRoot: string,
  branchName: string,
): { worktreePath: string; baseRef: string } {
  const worktreePath = initGitRepairFenceGitWorktree(jarvisRoot, branchName);
  mkdirSync(join(worktreePath, "src"), { recursive: true });
  mkdirSync(join(worktreePath, PLAN_DRAFT_SPEC_PATH), { recursive: true });
  writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
  writeFileSync(join(worktreePath, PLAN_DRAFT_SPEC_PATH, "index.md"), "# index\n", "utf8");
  writeFileSync(join(worktreePath, "src/untouched.test.ts"), "export {}\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
  const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  writePlanDraftStage(join(worktreePath, ".jarvis-plan-stage"));
  writeFileSync(join(worktreePath, PLAN_DRAFT_SPEC_PATH, "index.md"), "# Plan Index\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "iteration"], { stdio: "pipe" });
  return { worktreePath, baseRef };
}

export function initIntentMarkdownOnlyRepairFenceWorktree(
  jarvisRoot: string,
  branchName: string,
): { worktreePath: string; baseRef: string } {
  const worktreePath = initGitRepairFenceGitWorktree(jarvisRoot, branchName);
  mkdirSync(join(worktreePath, "src"), { recursive: true });
  mkdirSync(join(worktreePath, "scripts"), { recursive: true });
  mkdirSync(join(worktreePath, "v1", "test"), { recursive: true });
  mkdirSync(join(worktreePath, "ready-intents"), { recursive: true });
  mkdirSync(join(worktreePath, ".jarvis-intent-stage"), { recursive: true });
  writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
  writeFileSync(join(worktreePath, "ready-intents", "seed.md"), "# seed\n", "utf8");
  writeFileSync(join(worktreePath, "ready-intents", "index.md"), "# Ready Intents\n", "utf8");
  writeFileSync(join(worktreePath, ".jarvis-intent-stage", "draft.md"), "# draft\n", "utf8");
  writeFileSync(join(worktreePath, "src/untouched.test.ts"), "export {}\n", "utf8");
  writeFileSync(join(worktreePath, "scripts", "helper.ts"), "export {}\n", "utf8");
  writeFileSync(join(worktreePath, "v1/test/sample.test.ts"), "export {}\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
  const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  writeFileSync(join(worktreePath, "ready-intents", "seed.md"), "ok\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "ready-intents/seed.md"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "iteration"], { stdio: "pipe" });
  return { worktreePath, baseRef };
}

export function initPlanRepairFenceWorktree(
  jarvisRoot: string,
  branchName: string,
): { worktreePath: string; baseRef: string } {
  const worktreePath = initGitRepairFenceGitWorktree(jarvisRoot, branchName);
  mkdirSync(join(worktreePath, "src"), { recursive: true });
  mkdirSync(join(worktreePath, PLAN_DRAFT_SPEC_PATH), { recursive: true });
  writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
  writeFileSync(join(worktreePath, PLAN_DRAFT_SPEC_PATH, "index.md"), "# index\n", "utf8");
  writeFileSync(join(worktreePath, "src/untouched.test.ts"), "export {}\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
  const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  writePlanDraftStage(join(worktreePath, ".jarvis-plan-stage"));
  writeFileSync(join(worktreePath, PLAN_DRAFT_SPEC_PATH, "index.md"), "# Plan Index\n", "utf8");
  writeFileSync(join(worktreePath, "src/untouched.test.ts"), "iteration\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "iteration"], { stdio: "pipe" });
  return { worktreePath, baseRef };
}

export const intentRepairLoopDefaults = {
  expectedArtifactPath: "ready-intents/seed.md",
  specPath: "ready-intents",
  gateFailurePath: "ready-intents/seed.md",
  landing: {
    kind: "intent-stage" as const,
    output: { durableDir: "ready-intents" },
    stagingDir: ".jarvis-intent-stage",
    invocationId: "repair-fence-intent",
    baseRef: "HEAD",
  },
};

export const planRepairLoopDefaults = {
  expectedArtifactPath: `${PLAN_DRAFT_SPEC_PATH}/index.md`,
  specPath: PLAN_DRAFT_SPEC_PATH,
  gateFailurePath: `${PLAN_DRAFT_SPEC_PATH}/index.md`,
  landing: {
    kind: "plan-tree" as const,
    stagingDir: ".jarvis-plan-stage",
    durablePath: PLAN_DRAFT_SPEC_PATH,
  },
};

export function touchUntouchedRepairEdit(cwd: string) {
  writeFileSync(join(cwd, "src/untouched.test.ts"), "changed\n", "utf8");
}

/**
 * Defaults to the implement shape so the inherited run-diff-fence recovery regressions keep
 * staging a path outside the run diff — with an intent-shaped worktree the staged path is
 * inside the diff and only the markdown layer rejects it, leaving the allowset layer
 * unguarded on every recovery path. Pass `intentShaped` for markdown-only coverage.
 */
export async function seedFailedRepairFence(args: {
  jarvisRoot: string;
  stateDbPath: string;
  branchName: string;
  stepId?: string;
  workflowSnapshot?: WriteLoopInput["workflowSnapshot"];
  intentShaped?: boolean;
}) {
  const { intentShaped, ...loopArgs } = args;
  const { baseRef, worktreePath } = intentShaped
    ? initIntentRepairFenceWorktree(args.jarvisRoot, args.branchName)
    : initRepairFenceWorktree(args.jarvisRoot, args.branchName);
  const first = await runRepairFenceLoop({
    ...loopArgs,
    ...(intentShaped ? intentRepairLoopDefaults : {}),
    baseRef,
    repairEdit: touchUntouchedRepairEdit,
  });
  expect(first.result.kind).toBe("completion_commit_failed");
  return { baseRef, worktreePath, first };
}

/** Bindings that report `progress` n times, then write the artifact and report `done`. */
export function progressThenDone(n: number): InvocationBinding[] {
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

/** Applies the describe("write loop") beforeEach/afterEach ./write.ts mock contract. */
export function registerWriteLoopExecuteWriteMockHooks(): void {
  beforeEach(() => {
    mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
  });
  afterEach(() => {
    mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
  });
}
