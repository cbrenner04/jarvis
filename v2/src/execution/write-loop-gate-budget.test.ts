import { afterEach, describe, expect, test } from "bun:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { TEST_STEP_BUDGET_MS } from "../../../scripts/ready.ts";
import { createResolvedAgentBinding } from "../shared/invocation/agents.ts";
import type { InvocationBinding } from "../shared/invocation/execute.ts";
import type { LogEvent, LogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import type { ExternalWorktree, withExternalWorktree } from "./external-worktree.ts";
import { createStubMarkdownlintRunner } from "./workflow-runner.test-support.ts";
import {
  executeWriteLoop,
  findGateBudgetRepromptFromLog,
  liveGateInvocationLeaseCount,
  MAX_AGENT_GATE_INVOCATIONS_PER_ITERATION,
} from "./write-loop.ts";

const { roots } = trackedTempRoots();
const GATE_COMMAND = "bun run test:v2";

class TestLogSink implements LogSink {
  events: Array<{ runId: string; event: LogEvent }> = [];

  append(runId: string, event: LogEvent): void {
    this.events.push({ runId, event });
  }

  close(): void {}

  getEventsForRun(runId: string): LogEvent[] {
    return this.events.filter((entry) => entry.runId === runId).map((entry) => entry.event);
  }
}

class GateShellFrameChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 424_242;

  start(frames: string[]) {
    queueMicrotask(async () => {
      for (const frame of frames) {
        this.stdout.write(`${frame}\n`);
        const parsed = JSON.parse(frame) as { type?: string; subtype?: string };
        if (parsed.type === "tool_call" && parsed.subtype === "started") {
          await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
        }
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

function shellToolFrames(command: string, callId: string): [string, string] {
  const started = JSON.stringify({
    type: "tool_call",
    subtype: "started",
    call_id: callId,
    tool_call: { shellToolCall: { args: { command } } },
  });
  const completed = JSON.stringify({
    type: "tool_call",
    subtype: "completed",
    call_id: callId,
    tool_call: { shellToolCall: { result: { success: { exitCode: 0 } } } },
  });
  return [started, completed];
}

function cursorGateShellBinding(commands: readonly string[]) {
  const frames: string[] = [];
  commands.forEach((command, index) => {
    const [started, completed] = shellToolFrames(command, `call-gate-${index}`);
    frames.push(started, completed);
  });
  frames.push(JSON.stringify({ type: "result", result: "progress" }));
  const spawn = (_binary: string, _argv: readonly string[], _opts: SpawnOptions): ChildProcess => {
    const child = new GateShellFrameChild();
    child.start(frames);
    return child as unknown as ChildProcess;
  };
  return createResolvedAgentBinding(
    { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "composer" },
    { spawn },
  );
}

function seedGitBaseline(worktreePath: string): void {
  if (existsSync(join(worktreePath, ".git"))) return;
  execFileSync("git", ["init", "-q"], { cwd: worktreePath });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: worktreePath });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: worktreePath });
  execFileSync("git", ["add", "-A"], { cwd: worktreePath });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: worktreePath });
}

function createGitAwareFakeWithExternalWorktree(jarvisRoot: string): typeof withExternalWorktree {
  const base = createFakeWithExternalWorktree(jarvisRoot);
  return async (args, run, _runner?, _signal?) => {
    return base(args, async (worktree: ExternalWorktree) => {
      seedGitBaseline(worktree.path);
      return run(worktree);
    });
  };
}

function gitIn(worktreePath: string, gitArgs: string[]): string {
  return execFileSync("git", ["-C", worktreePath, ...gitArgs], { encoding: "utf8" }).trim();
}

async function runGateBudgetLoop(args: {
  jarvisRoot: string;
  stateDbPath: string;
  branchName: string;
  bindings: readonly InvocationBinding[];
  maxIterations?: number;
  logSink?: LogSink;
  promptId?: string;
}) {
  roots.push(join(args.jarvisRoot, ".."));
  const store = openStateStore(args.stateDbPath);
  try {
    return await executeWriteLoop({
      stagedMarkdownLintRunner: createStubMarkdownlintRunner(),
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: args.branchName,
        baseRef: "HEAD",
        jarvisRoot: args.jarvisRoot,
      },
      specPath: "spec.md",
      stepRules: "Return progress.",
      expectedArtifactPath: "proof.txt",
      bindings: args.bindings,
      stateStore: store,
      withExternalWorktree: createGitAwareFakeWithExternalWorktree(args.jarvisRoot),
      sessionsDir: join(args.jarvisRoot, "sessions"),
      completionCommitter: createCompletionCommitter(),
      iterationCeilingMs: TEST_STEP_BUDGET_MS + 60_000,
      clock: () => new Date("2026-09-08T06:00:00.000Z"),
      ...(args.maxIterations !== undefined ? { maxIterations: args.maxIterations } : {}),
      ...(args.logSink !== undefined ? { logSink: args.logSink } : {}),
      ...(args.promptId !== undefined ? { promptId: args.promptId } : {}),
    });
  } finally {
    store.close();
  }
}

async function emitClassifiedGateCommands(
  input: {
    onAgentShellCommand?: (command: string) => void | Promise<void>;
    onAgentShellCommandComplete?: () => void | Promise<void>;
  },
  commands: readonly string[],
): Promise<void> {
  for (const command of commands) {
    await input.onAgentShellCommand?.(command);
    if (/^bun run test(?::|$)/.test(command)) {
      await input.onAgentShellCommandComplete?.();
    }
  }
}

async function invokeWithBudgetRefusal(
  input: Parameters<NonNullable<InvocationBinding["invoke"]>>[0],
  commands: readonly string[],
): Promise<{ kind: "ok"; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    input.signal?.addEventListener(
      "abort",
      () => {
        setTimeout(() => resolve({ kind: "ok", stdout: "progress", stderr: "" }), 5);
      },
      { once: true },
    );
    void emitClassifiedGateCommands(input, commands);
  });
}

describe.serial("per-iteration gate invocation budget", () => {
  afterEach(() => {
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });

  test("refuses a third serial classified gate command with iteration_gate_budget", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const result = await runGateBudgetLoop({
      jarvisRoot,
      stateDbPath,
      branchName: `gate-budget-refuse-${Date.now()}`,
      maxIterations: 1,
      logSink: sink,
      bindings: [cursorGateShellBinding([GATE_COMMAND, GATE_COMMAND, GATE_COMMAND])],
    });

    expect(result.kind).not.toBe("gate_invocation_refused");
    expect(result.iterationsConsumed).toBe(1);
    const refused = sink.getEventsForRun(result.runId).find((event) => event.kind === "gate_invocation_budget_refused");
    expect(refused).toMatchObject({
      kind: "gate_invocation_budget_refused",
      command: GATE_COMMAND,
      admittedCount: MAX_AGENT_GATE_INVOCATIONS_PER_ITERATION,
    });
    // Mutation checkpoint: dropping the per-iteration admitted-count guard must turn this test RED.
  });

  test("does not count interleaved bun test file commands toward the budget", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const result = await runGateBudgetLoop({
      jarvisRoot,
      stateDbPath,
      branchName: `gate-budget-interleave-${Date.now()}`,
      maxIterations: 1,
      logSink: sink,
      bindings: [cursorGateShellBinding([GATE_COMMAND, GATE_COMMAND, "bun test foo.test.ts", GATE_COMMAND])],
    });

    expect(result.kind).not.toBe("gate_invocation_refused");
    const refused = sink.getEventsForRun(result.runId).find((event) => event.kind === "gate_invocation_budget_refused");
    expect(refused).toMatchObject({ command: GATE_COMMAND, admittedCount: MAX_AGENT_GATE_INVOCATIONS_PER_ITERATION });
  });

  test("checkpoints settled edits and reprompts on the next iteration without terminal gate_invocation_refused", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const prompts: string[] = [];
    let invocations = 0;
    let worktreePath = "";
    const branchName = `gate-budget-reprompt-${Date.now()}`;

    const binding: InvocationBinding = {
      id: "gate-budget",
      metadata: { agent: "test-agent", model: "test" },
      invoke: async (input) => {
        invocations += 1;
        worktreePath = input.cwd;
        prompts.push(input.prompt);
        if (invocations === 1) {
          writeFileSync(join(input.cwd, "budget-proof.txt"), "budget-work\n", "utf8");
          return invokeWithBudgetRefusal(input, [GATE_COMMAND, GATE_COMMAND, GATE_COMMAND]);
        }
        return { kind: "ok", stdout: "progress", stderr: "" };
      },
    };

    const result = await runGateBudgetLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      maxIterations: 2,
      logSink: sink,
      bindings: [binding],
      promptId: "implement.prompt.body",
    });

    expect(result.kind).not.toBe("gate_invocation_refused");
    expect(invocations).toBe(2);
    expect(prompts[1]).toContain(GATE_COMMAND);
    expect(prompts[1]).toContain("bun test <file>");
    expect(prompts[1]).toContain("Read the spec at");
    expect(prompts[1]).toContain("Return progress.");
    expect(gitIn(worktreePath, ["show", "HEAD:budget-proof.txt"])).toContain("budget-work");
    expect(
      sink
        .getEventsForRun(result.runId)
        .some((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "gate_invocation_refused"),
    ).toBe(false);
  });

  test("resets the per-iteration budget on the next iteration", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let invocations = 0;
    let secondIterationGateStarts = 0;

    const binding: InvocationBinding = {
      id: "gate-budget-reset",
      metadata: { agent: "test-agent", model: "test" },
      invoke: async (input) => {
        invocations += 1;
        if (invocations === 1) {
          return invokeWithBudgetRefusal(input, [GATE_COMMAND, GATE_COMMAND, GATE_COMMAND]);
        } else if (invocations === 2) {
          await emitClassifiedGateCommands(input, [GATE_COMMAND, GATE_COMMAND]);
          secondIterationGateStarts = 2;
        }
        return { kind: "ok", stdout: "progress", stderr: "" };
      },
    };

    const result = await runGateBudgetLoop({
      jarvisRoot,
      stateDbPath,
      branchName: `gate-budget-reset-${Date.now()}`,
      maxIterations: 3,
      logSink: sink,
      bindings: [binding],
    });

    expect(result.kind).not.toBe("gate_invocation_refused");
    expect(invocations).toBeGreaterThanOrEqual(2);
    expect(secondIterationGateStarts).toBe(MAX_AGENT_GATE_INVOCATIONS_PER_ITERATION);
    expect(
      sink.getEventsForRun(result.runId).filter((event) => event.kind === "gate_invocation_budget_refused"),
    ).toHaveLength(1);
  });
});

test("findGateBudgetRepromptFromLog returns the latest gate-budget refusal and ignores other events", () => {
  const rec = (seq: number, event: Record<string, unknown>) => ({ runId: "r", seq, ts: "t", event }) as never;
  expect(findGateBudgetRepromptFromLog(undefined)).toBeUndefined();
  expect(
    findGateBudgetRepromptFromLog([rec(1, { kind: "iteration_started", command: "bun run test:v2" })]),
  ).toBeUndefined();
  expect(
    findGateBudgetRepromptFromLog([
      rec(1, { kind: "gate_invocation_budget_refused", command: "bun run test:v2", admittedCount: 2 }),
      rec(2, { kind: "iteration_started", command: "not-a-refusal" }),
    ]),
  ).toEqual({ refusedCommand: "bun run test:v2" });
});

test("findGateBudgetRepromptFromLog drops a refusal consumed by a later completed iteration", () => {
  const rec = (seq: number, event: Record<string, unknown>) => ({ runId: "r", seq, ts: "t", event }) as never;
  const refusal = {
    kind: "gate_invocation_budget_refused",
    attemptId: "a1",
    command: "bun run test:v2",
    admittedCount: 2,
  };
  const refusedBoundary = {
    kind: "boundary_committed",
    attemptId: "a1",
    outcomeKind: "progress",
    runStatus: "in-progress",
  };
  const consumerStart = { kind: "iteration_started", attemptId: "a2" };
  const consumerBoundary = {
    kind: "boundary_committed",
    attemptId: "a2",
    outcomeKind: "progress",
    runStatus: "in-progress",
  };
  // The refused iteration's own boundary does not consume the reprompt.
  expect(findGateBudgetRepromptFromLog([rec(1, refusal), rec(2, refusedBoundary)])).toEqual({
    refusedCommand: "bun run test:v2",
  });
  // An iteration that started after the refusal but never committed (paused) still needs the reprompt.
  expect(findGateBudgetRepromptFromLog([rec(1, refusal), rec(2, refusedBoundary), rec(3, consumerStart)])).toEqual({
    refusedCommand: "bun run test:v2",
  });
  expect(
    findGateBudgetRepromptFromLog([
      rec(1, refusal),
      rec(2, refusedBoundary),
      rec(3, consumerStart),
      rec(4, consumerBoundary),
    ]),
  ).toBeUndefined();
  // A newer refusal after a consumed one is replayed.
  expect(
    findGateBudgetRepromptFromLog([
      rec(1, refusal),
      rec(2, consumerStart),
      rec(3, consumerBoundary),
      rec(4, { ...refusal, attemptId: "a3", command: "bun run test:shared" }),
    ]),
  ).toEqual({ refusedCommand: "bun run test:shared" });
});
