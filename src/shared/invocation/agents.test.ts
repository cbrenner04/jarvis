import { describe, expect, test } from "bun:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { computeCost } from "../prices/cost.ts";
import { loadPrices } from "../prices/load.ts";
import { trackedMkdtempSync } from "../tracked-temp-dir.test-support.ts";
import {
  createResolvedAgentBinding,
  createRoutingAgentBinding,
  isIgnoredWorktreeActivityPath,
  parseShellToolFrameLine,
  signalProcessGroupOrLeader,
} from "./agents.ts";
import { ConfinementRefusalError } from "./confinement-policy.ts";
import { parseCursorJsonOutput } from "./cursor-json.ts";
import { executeWithQuotaFallback, type InvocationCompletedRecord } from "./execute.ts";
import { RoutingRefusalError, routingFailureOf } from "./routing.ts";

type FakeOutcome =
  | { kind: "settle"; code: number; stdout?: string; stderr?: string }
  | { kind: "hang"; closeOnKill?: boolean }
  | { kind: "throw"; error: Error };

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 999_999;
  readonly stdinChunks: string[] = [];
  killedWith: string[] = [];

  constructor(readonly outcome: FakeOutcome) {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      this.stdinChunks.push(chunk.toString("utf8"));
    });
  }

  start() {
    if (this.outcome.kind !== "settle") {
      return;
    }
    const outcome = this.outcome;
    queueMicrotask(() => {
      this.stdout.end(outcome.stdout ?? "");
      this.stderr.end(outcome.stderr ?? "");
      setImmediate(() => {
        this.emit("exit", outcome.code);
        this.emit("close", outcome.code);
      });
    });
  }

  kill(signal?: NodeJS.Signals | number) {
    this.killedWith.push(signal === undefined ? "SIGTERM" : String(signal));
    if (this.outcome.kind === "hang" && this.outcome.closeOnKill === false) {
      return true;
    }
    queueMicrotask(() => {
      this.stdout.end();
      this.stderr.end();
      setImmediate(() => {
        this.emit("close", null);
      });
    });
    return true;
  }
}

function fakeSpawn(outcomes: FakeOutcome[]) {
  const calls: {
    binary: string;
    argv: readonly string[];
    opts: SpawnOptions;
    child?: FakeChild;
  }[] = [];
  const spawn = (binary: string, argv: readonly string[], opts: SpawnOptions): ChildProcess => {
    const outcome = outcomes.shift();
    if (outcome === undefined) {
      throw new Error("unexpected spawn");
    }
    if (outcome.kind === "throw") {
      throw outcome.error;
    }
    const child = new FakeChild(outcome);
    calls.push({ binary, argv, opts, child });
    child.start();
    return child as unknown as ChildProcess;
  };
  return { spawn, calls };
}

/** Abort tests must not hang when the leader kill path regresses; fail inside a bounded wait instead. */
function settlesWithin<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`invocation did not settle within ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function hangWithControllableIdle(
  bindingSpec: Parameters<typeof createResolvedAgentBinding>[0],
  opts: Parameters<typeof createResolvedAgentBinding>[1] & { closeOnKill?: boolean } = {},
) {
  const { closeOnKill, ...bindingOpts } = opts;
  const fake = fakeSpawn([closeOnKill === undefined ? { kind: "hang" } : { kind: "hang", closeOnKill }]);
  let fireIdle: (() => void) | undefined;
  const binding = createResolvedAgentBinding(bindingSpec, {
    spawn: fake.spawn,
    setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
      fireIdle = callback;
      return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: (() => {}) as typeof clearTimeout,
    ...bindingOpts,
  });
  return { fake, binding, fireIdle: () => fireIdle?.() };
}

const STALL_TEST_STDERR = "stderr diagnostic\n";
const STALL_TEST_STDOUT = "stdout stream\n";
const STALL_TEST_DIAGNOSTICS = `${STALL_TEST_STDERR}${STALL_TEST_STDOUT}`;

const COMPOSER_CURSOR_BINDING = {
  agentId: "cursor" as const,
  adapterModel: "Composer 2.5",
  priceKey: "composer",
};

const CURSOR_AGENT_USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 10,
  cache_creation_input_tokens: 0,
};

/** Token counts from a real cursor terminal frame; declared here, not imported from cost.test.ts. */
const COMPOSER_25_TERMINAL_USAGE = {
  inputTokens: 4023,
  outputTokens: 27,
  cacheReadTokens: 8851,
  cacheWriteTokens: 0,
};

function cursorOkNoUsage(stdout: string, stderr = "") {
  return {
    kind: "ok" as const,
    stdout,
    stderr,
    usage_source: "unavailable" as const,
    cost_usd: null,
    cost_source: "no-usage" as const,
  };
}

function cursorResultLine(result: string, success: boolean): string {
  return success
    ? JSON.stringify({ type: "result", subtype: "success", is_error: false, result })
    : JSON.stringify({ type: "result", is_error: true, result });
}

function cursorStdoutWithSuccess(frames: Record<string, unknown>[], result: string): string {
  return [...frames.map((frame) => JSON.stringify(frame)), cursorResultLine(result, true)].join("\n");
}

async function invokeComposerCursor(
  spawn: (binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess,
) {
  return createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn }).invoke({ prompt: "p", cwd: "/repo" });
}

function telemetryForRows(rows: InvocationCompletedRecord[]) {
  return {
    sink: {
      append(record: InvocationCompletedRecord) {
        rows.push(record);
      },
    },
    operatorSessionId: "session",
    runId: "run",
    attemptId: "attempt",
    project: "jarvis",
    workflow: "write",
    stepId: "implement",
    role: "implement",
    worktreePath: "/repo",
    branch: "branch",
    specRef: "spec",
    invocationIds: ["invocation"],
  };
}

const CODEX_FIXTURE_MARKER_ID = "fixture-marker";
const CODEX_FIXTURE_MARKER = `<!-- jarvis-codex-invocation: ${CODEX_FIXTURE_MARKER_ID} -->`;
const CODEX_TRUSTED_DIRECTORY_REFUSAL = "Not inside a trusted directory and --skip-git-repo-check was not specified.";

function codexUserMessageLine(marker = CODEX_FIXTURE_MARKER): string {
  return JSON.stringify({
    type: "event_msg",
    payload: { type: "user_message", message: `prompt\n${marker}` },
  });
}

function codexTokenCountLine(opts: { input: number; cached: number; output: number; info?: unknown }): string {
  return JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info:
        opts.info === undefined
          ? {
              total_token_usage: {
                input_tokens: opts.input,
                cached_input_tokens: opts.cached,
                output_tokens: opts.output,
              },
            }
          : opts.info,
    },
  });
}

function spawnWritingCodexRollout(sessionsDir: string, lines: string[], outcomes: FakeOutcome[]) {
  const inner = fakeSpawn(outcomes);
  const spawn = (binary: string, argv: readonly string[], opts: SpawnOptions): ChildProcess => {
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "session.jsonl"), `${lines.join("\n")}\n`);
    return inner.spawn(binary, argv, opts);
  };
  return { spawn, calls: inner.calls };
}

const CODEX_NO_SESSION_JSONL_WARNING = "codex usage unavailable: no session JSONL changed after this invocation";

const CODEX_SESSION_MISS_SETTLEMENT = {
  usage_source: "unavailable" as const,
  cost_usd: null,
  cost_source: "no-usage" as const,
  warnings: [CODEX_NO_SESSION_JSONL_WARNING],
};

function codexBindingOpts(
  sessionsDir: string,
  spawn: (binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess,
) {
  return {
    spawn,
    codexSessionsDir: sessionsDir,
    randomUUID: () => CODEX_FIXTURE_MARKER_ID,
  };
}

describe("parseShellToolFrameLine", () => {
  test("parses claude assistant Shell tool_use starts", () => {
    const start = parseShellToolFrameLine(
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_shell", name: "Shell", input: { command: "bun run test:shared" } }],
        },
      }),
      "claude",
    );
    expect(start).toEqual({ phase: "start", command: "bun run test:shared", toolUseId: "toolu_shell" });
  });

  test("parses top-level claude tool_use Bash starts and ignores non-shell tool_use", () => {
    const start = parseShellToolFrameLine(
      JSON.stringify({
        type: "tool_use",
        id: "toolu_top",
        name: "Bash",
        input: { command: "bun run test:shared" },
      }),
      "claude",
    );
    expect(start).toEqual({ phase: "start", command: "bun run test:shared", toolUseId: "toolu_top" });
    expect(
      parseShellToolFrameLine(
        JSON.stringify({
          type: "tool_use",
          id: "toolu_read",
          name: "Read",
          input: { file_path: "x.ts" },
        }),
        "claude",
      ),
    ).toBeNull();
  });

  test("ignores non-shell claude tool_use blocks even with a command-shaped input", () => {
    const result = parseShellToolFrameLine(
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_grep", name: "Grep", input: { command: "bun run test:agent" } }],
        },
      }),
      "claude",
    );
    expect(result).toBeNull();
  });

  test("parses claude assistant Bash tool_use starts and tool_result completions", () => {
    const start = parseShellToolFrameLine(
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "bun run test:agent" } }],
        },
      }),
      "claude",
    );
    expect(start).toEqual({ phase: "start", command: "bun run test:agent", toolUseId: "toolu_1" });
    expect(parseShellToolFrameLine(JSON.stringify({ type: "tool_result", tool_use_id: "toolu_1" }), "claude")).toEqual({
      phase: "complete",
      toolUseId: "toolu_1",
    });
    expect(
      parseShellToolFrameLine(
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "x.ts" } }],
          },
        }),
        "claude",
      ),
    ).toBeNull();
  });

  test("parses cursor shellToolCall started and completed frames", () => {
    const start = parseShellToolFrameLine(
      JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "call-1",
        tool_call: { shellToolCall: { args: { command: "bun run test:shared" } } },
      }),
      "cursor",
    );
    expect(start).toEqual({ phase: "start", command: "bun run test:shared" });
    expect(
      parseShellToolFrameLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "call-1",
          tool_call: { shellToolCall: { result: { success: { exitCode: 0 } } } },
        }),
        "cursor",
      ),
    ).toEqual({ phase: "complete" });
    expect(
      parseShellToolFrameLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          call_id: "call-2",
          tool_call: { readToolCall: { args: { path: "x.ts" } } },
        }),
        "cursor",
      ),
    ).toBeNull();
  });

  test("claude binding invokes onAgentShellCommand for streamed shell frames", async () => {
    const frames = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "bun run test:agent" } }],
        },
      }),
      JSON.stringify({ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }),
      JSON.stringify({ type: "result", result: "progress" }),
    ].join("\n");
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: `${frames}\n`, stderr: "" }]);
    const commands: string[] = [];
    let completions = 0;
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: fake.spawn },
    );

    await binding.invoke({
      prompt: "p",
      cwd: "/repo",
      onAgentShellCommand: (command) => {
        commands.push(command);
      },
      onAgentShellCommandComplete: () => {
        completions += 1;
      },
    });

    expect(commands).toEqual(["bun run test:agent"]);
    expect(completions).toBe(1);
  });

  test("claude binding invokes onAgentShellCommand for streamed partial shell input_json_delta", async () => {
    const frames = [
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_stream", name: "Bash", input: {} },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"command":"bun run test' },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: ':shared"}' },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      }),
      JSON.stringify({ type: "tool_result", tool_use_id: "toolu_stream", content: "ok" }),
      JSON.stringify({ type: "result", result: "progress" }),
    ].join("\n");
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: `${frames}\n`, stderr: "" }]);
    const commands: string[] = [];
    let completions = 0;
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: fake.spawn },
    );

    await binding.invoke({
      prompt: "p",
      cwd: "/repo",
      onAgentShellCommand: (command) => {
        commands.push(command);
      },
      onAgentShellCommandComplete: () => {
        completions += 1;
      },
    });

    expect(commands).toContain("bun run test:shared");
    expect(completions).toBe(1);
  });

  test("claude binding ignores content_block_stop and uncorrelated tool_result for shell completion", async () => {
    const frames = [
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_gate", name: "Bash", input: { command: "bun run test:agent" } },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      }),
      JSON.stringify({ type: "tool_result", tool_use_id: "toolu_read", content: "file contents" }),
      JSON.stringify({ type: "tool_result", tool_use_id: "toolu_gate", content: "ok" }),
      JSON.stringify({ type: "result", result: "progress" }),
    ].join("\n");
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: `${frames}\n`, stderr: "" }]);
    let completions = 0;
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: fake.spawn },
    );

    await binding.invoke({
      prompt: "p",
      cwd: "/repo",
      onAgentShellCommandComplete: () => {
        completions += 1;
      },
    });

    expect(completions).toBe(1);
  });
});

describe("isIgnoredWorktreeActivityPath", () => {
  test("ignores harness metadata sidecars and verdict basenames", () => {
    expect(isIgnoredWorktreeActivityPath("nested/.jarvis-state.json")).toBe(true);
    expect(isIgnoredWorktreeActivityPath(".jarvis-intent-review-verdict.md")).toBe(true);
    expect(isIgnoredWorktreeActivityPath("review/verdict-adjudicator.md")).toBe(true);
  });

  test("does not ignore workflow staging directories or ordinary paths", () => {
    expect(isIgnoredWorktreeActivityPath(".jarvis-plan-stage/index.md")).toBe(false);
    expect(isIgnoredWorktreeActivityPath(".jarvis-intent-stage/my-feature.md")).toBe(false);
    expect(isIgnoredWorktreeActivityPath("src/nested/edited.ts")).toBe(false);
    expect(isIgnoredWorktreeActivityPath("edited.ts")).toBe(false);
  });
});

describe("createResolvedAgentBinding", () => {
  test("binding id distinguishes rungs that differ only by price key", () => {
    const cheap = createResolvedAgentBinding({
      agentId: "claude",
      adapterModel: "sonnet",
      priceKey: "sonnet-input",
    });
    const premium = createResolvedAgentBinding({
      agentId: "claude",
      adapterModel: "sonnet",
      priceKey: "sonnet-output",
    });

    expect(cheap.id).toBe("claude/sonnet/sonnet-input");
    expect(premium.id).toBe("claude/sonnet/sonnet-output");
    expect(cheap.id).not.toBe(premium.id);
  });

  test("claude binding invokes the CLI shape with cwd and stdin prompt", async () => {
    const fake = fakeSpawn([
      { kind: "settle", code: 0, stdout: '{"type":"result","result":"done"}\n', stderr: "warn" },
    ]);
    const binding = createResolvedAgentBinding(
      {
        agentId: "claude",
        adapterModel: "claude-sonnet-4-6",
        priceKey: "claude-sonnet-4-6",
      },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "implement it", cwd: "/repo" });

    expect(result).toEqual({ kind: "ok", stdout: "done", stderr: "warn" });
    expect(fake.calls[0]?.binary).toBe("claude");
    expect(fake.calls[0]?.argv).toEqual([
      "-p",
      "--permission-mode",
      "acceptEdits",
      "--model",
      "claude-sonnet-4-6",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ]);
    expect(fake.calls[0]?.opts.cwd).toBe("/repo");
    expect(fake.calls[0]?.opts.detached).toBe(true);
    expect(fake.calls[0]?.opts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(fake.calls[0]?.child?.stdinChunks.join("")).toBe("implement it");
  });

  test("claude binding settles on exit when the child's stdin pipe errors (EPIPE)", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: '{"type":"result","result":"done"}\n', stderr: "" }]);
    const spawn = (binary: string, argv: readonly string[], opts: SpawnOptions): ChildProcess => {
      const child = fake.spawn(binary, argv, opts);
      const stdin = child.stdin as PassThrough;
      stdin.write = () => {
        queueMicrotask(() => stdin.emit("error", Object.assign(new Error("EPIPE: broken pipe"), { code: "EPIPE" })));
        return false;
      };
      return child;
    };
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" },
      { spawn },
    );

    const result = await binding.invoke({ prompt: "implement it", cwd: "/repo" });

    expect(result).toEqual({ kind: "ok", stdout: "done", stderr: "" });
  });

  test("claude binding appends --add-dir for each additionalReadDirs entry", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: '{"type":"result","result":"done"}\n', stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" },
      { spawn: fake.spawn },
    );

    await binding.invoke({
      prompt: "implement it",
      cwd: "/repo",
      additionalReadDirs: ["/abs/specs/foo", "/abs/specs/bar"],
    });

    expect(fake.calls[0]?.argv).toEqual([
      "-p",
      "--permission-mode",
      "acceptEdits",
      "--add-dir",
      "/abs/specs/foo",
      "--add-dir",
      "/abs/specs/bar",
      "--model",
      "claude-sonnet-4-6",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ]);
  });

  test("claude binding omits --add-dir when additionalReadDirs is unset", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: '{"type":"result","result":"done"}\n', stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" },
      { spawn: fake.spawn },
    );

    await binding.invoke({ prompt: "implement it", cwd: "/repo" });

    expect(fake.calls[0]?.argv).not.toContain("--add-dir");
  });

  test("claude binding unwraps JSON stdout into display text with usage and cost", async () => {
    const envelope = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Split the seed into four intents.\n\ndone",
      total_cost_usd: 0.12,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 100,
      },
    });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: envelope, stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({
      kind: "ok",
      stdout: "Split the seed into four intents.\n\ndone",
      stderr: "",
      usage_source: "agent",
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 100,
      },
      cost_usd: 0.12,
      cost_source: "agent",
    });
  });

  test("claude binding classifies quota (ASCII and U+2019), model config, and generic errors", async () => {
    const quota = fakeSpawn([{ kind: "settle", code: 1, stderr: "You've hit your weekly limit" }]);
    const sessionLimit = fakeSpawn([{ kind: "settle", code: 1, stderr: "you’ve hit your session limit" }]);
    const spendLimit = fakeSpawn([{ kind: "settle", code: 1, stderr: "you’ve hit your monthly spend limit" }]);
    const orgLimit = fakeSpawn([{ kind: "settle", code: 1, stderr: "you’ve hit your org’s monthly usage limit" }]);
    const model = fakeSpawn([{ kind: "settle", code: 1, stderr: "unknown model: nope" }]);
    const generic = fakeSpawn([{ kind: "settle", code: 2, stderr: "boom" }]);

    await expect(
      createResolvedAgentBinding(
        { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
        { spawn: quota.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "You've hit your weekly limit" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
        { spawn: sessionLimit.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "you’ve hit your session limit" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
        { spawn: spendLimit.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "you’ve hit your monthly spend limit" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
        { spawn: orgLimit.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "you’ve hit your org’s monthly usage limit" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "claude", adapterModel: "bad", priceKey: "bad" },
        { spawn: model.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "model_config", stderr: "unknown model: nope" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
        { spawn: generic.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "error", exitCode: 2, stderr: "boom" });
  });

  test("claude zero-exit quota envelope returns quota", async () => {
    const fake = fakeSpawn([
      {
        kind: "settle",
        code: 0,
        stdout: JSON.stringify({ type: "result", is_error: true, api_error_status: 429, result: "quota exceeded" }),
      },
    ]);

    const result = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result.kind).toBe("quota");
  });

  test("claude zero-exit normal output and text with quota phrases are not text-matched", async () => {
    const normalOutput = fakeSpawn([
      {
        kind: "settle",
        code: 0,
        stdout: JSON.stringify({ type: "result", result: "normal response" }),
      },
    ]);
    const textWithPhrase = fakeSpawn([
      {
        kind: "settle",
        code: 0,
        stdout: JSON.stringify({
          type: "result",
          result: "note: you've hit your monthly spend limit on the free tier",
        }),
      },
    ]);

    const result1 = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: normalOutput.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result1.kind).toBe("ok");
    if (result1.kind === "ok") {
      expect(result1.stdout).toBe("normal response");
    }

    const result2 = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: textWithPhrase.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result2.kind).toBe("ok");
    if (result2.kind === "ok") {
      expect(result2.stdout).toContain("you've hit your monthly spend limit");
    }
  });

  test("claude abort returns terminal error and kills the child", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    const controller = new AbortController();
    const promise = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo", signal: controller.signal });

    controller.abort("idle-timeout");
    const result = await settlesWithin(promise);

    expect(result).toEqual({ kind: "error", exitCode: -1, stderr: "aborted: idle-timeout" });
    expect(fake.calls[0]?.child?.killedWith).toContain("SIGTERM");
  });

  const AGENT_PGID = 999_999;
  const FOREIGN_DESCENDANT_PGID = 888_888;

  function descendantGroupKillBinding(
    fake: ReturnType<typeof fakeSpawn>,
    extra: Parameters<typeof createResolvedAgentBinding>[1] = {},
  ) {
    const groupSignals: { pgid: number; signal: string }[] = [];
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      {
        spawn: fake.spawn,
        probeAgentDescendantProcessGroups: async () => new Set([AGENT_PGID, FOREIGN_DESCENDANT_PGID]),
        signalProcessGroup: (pgid, signal) => {
          groupSignals.push({ pgid, signal });
        },
        ...extra,
      },
    );
    return { binding, groupSignals };
  }

  function closeFakeChild(fake: ReturnType<typeof fakeSpawn>) {
    const child = fake.calls[0]?.child;
    child?.stdout.end();
    child?.stderr.end();
    child?.emit("close", null);
  }

  test("abort SIGTERMs every snapshotted descendant process group", async () => {
    const fake = fakeSpawn([{ kind: "hang", closeOnKill: false }]);
    const { binding, groupSignals } = descendantGroupKillBinding(fake);
    const controller = new AbortController();
    const promise = binding.invoke({ prompt: "p", cwd: "/repo", signal: controller.signal });
    controller.abort("operator-kill");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(groupSignals.filter((entry) => entry.signal === "SIGTERM")).toEqual([
      { pgid: FOREIGN_DESCENDANT_PGID, signal: "SIGTERM" },
      { pgid: AGENT_PGID, signal: "SIGTERM" },
    ]);
    closeFakeChild(fake);
    await promise;
  });

  test("iteration timeout SIGTERMs every snapshotted descendant process group", async () => {
    const fake = fakeSpawn([{ kind: "hang", closeOnKill: false }]);
    const { binding, groupSignals } = descendantGroupKillBinding(fake);
    const controller = new AbortController();
    const promise = binding.invoke({ prompt: "p", cwd: "/repo", signal: controller.signal });
    controller.abort("iteration-timeout");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(groupSignals.filter((entry) => entry.signal === "SIGTERM")).toEqual([
      { pgid: FOREIGN_DESCENDANT_PGID, signal: "SIGTERM" },
      { pgid: AGENT_PGID, signal: "SIGTERM" },
    ]);
    closeFakeChild(fake);
    await promise;
  });

  test("SIGKILL escalation survives leader settlement for remaining descendant groups", async () => {
    const fake = fakeSpawn([{ kind: "hang", closeOnKill: false }]);
    const graceMs = 25;
    const groupSignals: { pgid: number; signal: string }[] = [];
    const escalationCallbacks: Array<() => void> = [];
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      {
        spawn: fake.spawn,
        abortKillGraceMs: graceMs,
        probeAgentDescendantProcessGroups: async () => new Set([AGENT_PGID, FOREIGN_DESCENDANT_PGID]),
        signalProcessGroup: (pgid, signal) => {
          groupSignals.push({ pgid, signal });
        },
        setTimeout: ((callback: Parameters<typeof setTimeout>[0], delay?: number) => {
          if (delay === graceMs) {
            escalationCallbacks.push(callback as () => void);
            return callback as unknown as ReturnType<typeof setTimeout>;
          }
          return setTimeout(callback, delay);
        }) as typeof setTimeout,
      },
    );
    const controller = new AbortController();
    const promise = binding.invoke({ prompt: "p", cwd: "/repo", signal: controller.signal });
    controller.abort("operator-kill");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(escalationCallbacks).toHaveLength(2);
    closeFakeChild(fake);
    await promise;
    for (const runEscalation of escalationCallbacks) {
      runEscalation();
    }
    expect(
      groupSignals
        .filter((entry) => entry.signal === "SIGKILL")
        .map((entry) => entry.pgid)
        .sort(),
    ).toEqual([AGENT_PGID, FOREIGN_DESCENDANT_PGID].sort());
  });

  test("idle stall with joinProcessOnIdleStall SIGTERMs descendant process groups", async () => {
    const fake = fakeSpawn([{ kind: "hang", closeOnKill: false }]);
    const groupSignals: { pgid: number; signal: string }[] = [];
    let fireIdle: (() => void) | undefined;
    const bindingWithIdle = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      {
        spawn: fake.spawn,
        probeAgentDescendantProcessGroups: async () => new Set([AGENT_PGID, FOREIGN_DESCENDANT_PGID]),
        signalProcessGroup: (pgid, signal) => {
          groupSignals.push({ pgid, signal });
        },
        setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
          fireIdle = callback;
          return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout,
        clearTimeout: (() => {}) as typeof clearTimeout,
      },
    );
    const promise = bindingWithIdle.invoke({
      prompt: "p",
      cwd: "/repo",
      idleOutputMs: 100,
      joinProcessOnIdleStall: true,
    });
    fireIdle?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(groupSignals.filter((entry) => entry.signal === "SIGTERM")).toEqual([
      { pgid: FOREIGN_DESCENDANT_PGID, signal: "SIGTERM" },
      { pgid: AGENT_PGID, signal: "SIGTERM" },
    ]);
    const child = fake.calls[0]?.child;
    child?.stdout.end();
    child?.stderr.end();
    child?.emit("close", null);
    await promise;
  });

  test("process group kill skips own harness ids when snapshot lists them", async () => {
    const fake = fakeSpawn([{ kind: "hang", closeOnKill: false }]);
    const groupSignals: { pgid: number; signal: string }[] = [];
    const graceMs = 25;
    const escalationCallbacks: Array<() => void> = [];
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      {
        spawn: fake.spawn,
        probeAgentDescendantProcessGroups: async () => new Set([AGENT_PGID, process.pid]),
        signalProcessGroup: (pgid, signal) => {
          groupSignals.push({ pgid, signal });
        },
        abortKillGraceMs: graceMs,
        setTimeout: ((callback: Parameters<typeof setTimeout>[0], delay?: number) => {
          if (delay === graceMs) {
            escalationCallbacks.push(callback as () => void);
            return callback as unknown as ReturnType<typeof setTimeout>;
          }
          return setTimeout(callback, delay);
        }) as typeof setTimeout,
      },
    );
    const controller = new AbortController();
    const promise = binding.invoke({ prompt: "p", cwd: "/repo", signal: controller.signal });
    controller.abort("operator-kill");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(groupSignals.filter((entry) => entry.signal === "SIGTERM")).toEqual([
      { pgid: AGENT_PGID, signal: "SIGTERM" },
    ]);
    closeFakeChild(fake);
    await promise;
    for (const runEscalation of escalationCallbacks) {
      runEscalation();
    }
    expect(groupSignals.filter((entry) => entry.signal === "SIGKILL")).toEqual([
      { pgid: AGENT_PGID, signal: "SIGKILL" },
    ]);
  });

  test("aborting a settled invocation does not signal its former child", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: '{"type":"result","result":"done"}\n' }]);
    const controller = new AbortController();
    const result = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo", signal: controller.signal });

    expect(result.kind).toBe("ok");
    controller.abort();
    expect(fake.calls[0]?.child?.killedWith).toEqual([]);
  });

  test("idle output expiry settles stall without joining a silent child", async () => {
    const { fake, binding, fireIdle } = hangWithControllableIdle(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { watchWorktreeActivity: () => {} },
    );

    const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 });
    fake.calls[0]?.child?.stderr.write(STALL_TEST_STDERR);
    fake.calls[0]?.child?.stdout.write(STALL_TEST_STDOUT);
    fireIdle();

    await expect(promise).resolves.toEqual({ kind: "stall", stderr: STALL_TEST_DIAGNOSTICS });
    expect(fake.calls[0]?.child?.killedWith).toEqual([]);
  });

  test("worktree activity re-arms the idle timer for a silent child", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    const expiries: (() => void)[] = [];
    const active = new Set<() => void>();
    let onActivity: ((path: string) => void) | undefined;
    let watchedCwd: string | undefined;
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      {
        spawn: fake.spawn,
        setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
          const wrapped = () => {
            if (active.has(wrapped)) callback();
          };
          active.add(wrapped);
          expiries.push(wrapped);
          return wrapped as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout,
        clearTimeout: ((timer) => active.delete(timer as unknown as () => void)) as typeof clearTimeout,
        watchWorktreeActivity: (args) => {
          watchedCwd = args.cwd;
          onActivity = args.onActivity;
        },
      },
    );
    let settled = false;
    const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 }).finally(() => {
      settled = true;
    });

    expect(watchedCwd).toBe("/repo");
    onActivity?.("edited.ts");
    expect(expiries).toHaveLength(2);
    expiries[0]?.();
    await Promise.resolve();
    expect(settled).toBe(false);

    expiries[1]?.();
    await expect(promise).resolves.toEqual({ kind: "stall", stderr: "" });
  });

  test("nested non-sidecar worktree activity re-arms the idle timer", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    const expiries: (() => void)[] = [];
    const active = new Set<() => void>();
    let onActivity: ((path: string) => void) | undefined;
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      {
        spawn: fake.spawn,
        setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
          const wrapped = () => {
            if (active.has(wrapped)) callback();
          };
          active.add(wrapped);
          expiries.push(wrapped);
          return wrapped as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout,
        clearTimeout: ((timer) => active.delete(timer as unknown as () => void)) as typeof clearTimeout,
        watchWorktreeActivity: (args) => {
          onActivity = args.onActivity;
        },
      },
    );
    let settled = false;
    const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 }).finally(() => {
      settled = true;
    });

    onActivity?.("src/nested/edited.ts");
    expect(expiries).toHaveLength(2);
    expiries[0]?.();
    await Promise.resolve();
    expect(settled).toBe(false);

    expiries[1]?.();
    await expect(promise).resolves.toEqual({ kind: "stall", stderr: "" });
  });

  test("workflow staging directory activity re-arms the idle timer", async () => {
    for (const path of [".jarvis-plan-stage/index.md", ".jarvis-intent-stage/my-feature.md"]) {
      const fake = fakeSpawn([{ kind: "hang" }]);
      const expiries: (() => void)[] = [];
      const active = new Set<() => void>();
      let onActivity: ((activityPath: string) => void) | undefined;
      const binding = createResolvedAgentBinding(
        { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
        {
          spawn: fake.spawn,
          setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
            const wrapped = () => {
              if (active.has(wrapped)) callback();
            };
            active.add(wrapped);
            expiries.push(wrapped);
            return wrapped as unknown as ReturnType<typeof setTimeout>;
          }) as typeof setTimeout,
          clearTimeout: ((timer) => active.delete(timer as unknown as () => void)) as typeof clearTimeout,
          watchWorktreeActivity: (args) => {
            onActivity = args.onActivity;
          },
        },
      );
      let settled = false;
      const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 }).finally(() => {
        settled = true;
      });

      onActivity?.(path);
      expect(expiries).toHaveLength(2);
      expiries[0]?.();
      await Promise.resolve();
      expect(settled).toBe(false);

      expiries[1]?.();
      await expect(promise).resolves.toEqual({ kind: "stall", stderr: "" });
    }
  });

  test("sidecar-only worktree activity does not re-arm the idle timer", async () => {
    for (const path of [
      "nested/.jarvis-state.json",
      "review/verdict-adjudicator.md",
      ".jarvis-intent-review-verdict.md",
    ]) {
      const fake = fakeSpawn([{ kind: "hang" }]);
      const expiries: (() => void)[] = [];
      let onActivity: ((activityPath: string) => void) | undefined;
      const binding = createResolvedAgentBinding(
        { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
        {
          spawn: fake.spawn,
          setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
            expiries.push(callback);
            return callback as unknown as ReturnType<typeof setTimeout>;
          }) as typeof setTimeout,
          clearTimeout: (() => {}) as typeof clearTimeout,
          watchWorktreeActivity: (args) => {
            onActivity = args.onActivity;
          },
        },
      );

      const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 });
      onActivity?.(path);
      expect(expiries).toHaveLength(1);
      expiries[0]?.();
      await expect(promise).resolves.toEqual({ kind: "stall", stderr: "" });
    }
  });

  test("settlement disposes the worktree watcher", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: '{"type":"result","result":"done"}\n' }]);
    let disposed = false;
    let watcherSignal: AbortSignal | undefined;
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      {
        spawn: fake.spawn,
        watchWorktreeActivity: ({ signal }) => {
          watcherSignal = signal;
          return () => {
            disposed = true;
          };
        },
      },
    );

    await expect(binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 })).resolves.toMatchObject({
      kind: "ok",
    });
    expect(disposed).toBe(true);
    expect(watcherSignal?.aborted).toBe(true);
  });

  test("idle output expiry joins the child before settling stall", async () => {
    const { fake, binding, fireIdle } = hangWithControllableIdle(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { closeOnKill: false },
    );
    let invocationSettled = false;
    const promise = binding
      .invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100, joinProcessOnIdleStall: true })
      .finally(() => {
        invocationSettled = true;
      });

    fake.calls[0]?.child?.stderr.write(STALL_TEST_STDERR);
    fake.calls[0]?.child?.stdout.write(STALL_TEST_STDOUT);
    fireIdle();
    await Promise.resolve();
    expect(invocationSettled).toBe(false);

    const child = fake.calls[0]?.child;
    child?.stdout.end();
    child?.stderr.end();
    child?.emit("close", null);
    await expect(promise).resolves.toEqual({ kind: "stall", stderr: STALL_TEST_DIAGNOSTICS });
  });

  test("actual idle stalls log combined diagnostics and preserve real silence", async () => {
    const inbound: { tag: string; text: string }[] = [];
    const sessionLog = {
      append(tag: string, text: string) {
        if (text) inbound.push({ tag, text });
      },
      close() {},
    };
    const stallCursor = (stdout: string, stderr: string) => {
      const { fake, binding, fireIdle } = hangWithControllableIdle(COMPOSER_CURSOR_BINDING);
      const execution = executeWithQuotaFallback({
        prompt: "p",
        cwd: "/repo",
        bindings: [binding],
        idleOutputMs: 100,
        sessionLog,
      });
      fake.calls[0]?.child?.stderr.write(stderr);
      fake.calls[0]?.child?.stdout.write(stdout);
      fireIdle();
      return execution;
    };
    const stdout = `${JSON.stringify({ type: "text_delta", text: "working" })}\n`;
    const stderr = "warning\n";
    const combined = `${stderr}${stdout}`;

    const streamed = await stallCursor(stdout, stderr);
    expect(streamed.final?.result).toEqual({ kind: "stall", stderr: combined });
    expect(inbound.filter((line) => line.tag === "inbound_stdout")).toEqual([]);
    expect(inbound.filter((line) => line.tag === "inbound_stderr")).toEqual([
      { tag: "inbound_stderr", text: combined },
    ]);

    inbound.length = 0;
    const silent = await stallCursor("", "");
    expect(silent.final?.result).toEqual({ kind: "stall", stderr: "" });
    expect(inbound.filter((line) => line.tag.startsWith("inbound_"))).toEqual([]);
  });

  test("output clears the previous idle expiry", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "done" }]);
    const expiries: (() => void)[] = [];
    const active = new Set<() => void>();
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      {
        spawn: fake.spawn,
        setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
          const wrapped = () => {
            if (active.has(wrapped)) callback();
          };
          active.add(wrapped);
          expiries.push(wrapped);
          return wrapped as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout,
        clearTimeout: ((timer) => active.delete(timer as unknown as () => void)) as typeof clearTimeout,
      },
    );

    const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 });
    fake.calls[0]?.child?.stdout.write("progress");
    expiries[0]?.();

    await expect(promise).resolves.toMatchObject({ kind: "ok" });
    expect(expiries.length).toBeGreaterThan(1);
  });

  test("claude spawn failure returns terminal error", async () => {
    const fake = fakeSpawn([{ kind: "throw", error: new Error("ENOENT") }]);

    const result = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({ kind: "error", exitCode: -1, stderr: "Error: ENOENT" });
  });

  // The idle watchdog itself is agent-agnostic — it arms off generic stdout data — so this
  // is a threading guard, not a regression guard for --include-partial-messages: it proves the
  // claude wrapper still hands `idleOutputMs`/`setTimeout`/`clearTimeout` to `runAgent`, and that
  // a stdout chunk (e.g. a streamed partial-message frame) re-arms the timer so the superseded
  // expiry is inert.
  test("claude binding threads idleOutputMs through and re-arms the idle timer on stdout", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    const armedDelays: (number | undefined)[] = [];
    const expiries: (() => void)[] = [];
    const cleared = new Set<() => void>();
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      {
        spawn: fake.spawn,
        setTimeout: ((callback: () => void, delayMs?: number) => {
          armedDelays.push(delayMs);
          const wrapped = () => {
            if (!cleared.has(wrapped)) callback();
          };
          expiries.push(wrapped);
          return wrapped as unknown as ReturnType<typeof setTimeout>;
        }) as unknown as typeof setTimeout,
        clearTimeout: ((timer) => {
          cleared.add(timer as unknown as () => void);
        }) as typeof clearTimeout,
      },
    );

    const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 });

    // Armed once at spawn, with the caller's budget — the wrapper threads it through.
    expect(armedDelays).toEqual([100]);

    fake.calls[0]?.child?.stdout.write(
      JSON.stringify({ type: "stream_event", event: { type: "content_block_delta" } }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    // The stdout chunk cleared the first timer and armed a fresh one for the same budget.
    expect(armedDelays).toEqual([100, 100]);
    expect(cleared.has(expiries[0] as () => void)).toBe(true);

    // Firing the superseded expiry must not kill the child or settle the invocation.
    expiries[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(fake.calls[0]?.child?.killedWith).toEqual([]);

    // The live timer still stalls when its budget really does elapse.
    expiries[1]?.();
    await expect(promise).resolves.toMatchObject({ kind: "stall" });
    expect(fake.calls[0]?.child?.killedWith).toEqual([]);
  });

  test("claude telemetry uses resolved binding metadata", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "done" }]);
    const rows: InvocationCompletedRecord[] = [];
    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding(
          {
            agentId: "claude",
            adapterModel: "claude-sonnet-4-6",
            priceKey: "priced-sonnet",
          },
          { spawn: fake.spawn },
        ),
      ],
      telemetry: telemetryForRows(rows),
    });

    expect(rows[0]?.agent).toBe("claude");
    expect(rows[0]?.model).toBe("claude-sonnet-4-6");
    expect(rows[0]?.binding_id).toBe("claude/claude-sonnet-4-6/priced-sonnet");
  });

  test("codex binding invokes the CLI shape with cwd, stdin prompt marker, and abort signal", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    const controller = new AbortController();
    const promise = createResolvedAgentBinding(
      {
        agentId: "codex",
        adapterModel: "gpt-5.4",
        priceKey: "gpt-5.4",
      },
      {
        spawn: fake.spawn,
        codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")),
        randomUUID: () => "marker-id",
      },
    ).invoke({ prompt: "implement it", cwd: "/repo", signal: controller.signal });

    controller.abort("operator");
    const result = await settlesWithin(promise);

    expect(result).toEqual({
      kind: "error",
      exitCode: -1,
      stderr: "aborted: operator",
      ...CODEX_SESSION_MISS_SETTLEMENT,
    });
    expect(fake.calls[0]?.binary).toBe("codex");
    expect(fake.calls[0]?.argv).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "workspace-write",
      "-c",
      'approval_policy="on-request"',
      "--model",
      "gpt-5.4",
    ]);
    expect(fake.calls[0]?.opts.cwd).toBe("/repo");
    expect(fake.calls[0]?.opts.detached).toBe(true);
    expect(fake.calls[0]?.opts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(fake.calls[0]?.child?.stdinChunks.join("")).toBe(
      "implement it\n<!-- jarvis-codex-invocation: marker-id -->",
    );
    expect(fake.calls[0]?.child?.killedWith).toContain("SIGTERM");
  });

  test("codex binding appends --add-dir for each additionalReadDirs entry", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "ok", stderr: "" }]);
    await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      {
        spawn: fake.spawn,
        codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")),
        randomUUID: () => "marker-id",
      },
    ).invoke({
      prompt: "implement it",
      cwd: "/repo",
      additionalReadDirs: ["/abs/specs/foo", "/abs/specs/bar"],
    });

    expect(fake.calls[0]?.argv).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "workspace-write",
      "-c",
      'approval_policy="on-request"',
      "--add-dir",
      "/abs/specs/foo",
      "--add-dir",
      "/abs/specs/bar",
      "--model",
      "gpt-5.4",
    ]);
  });

  test("codex binding omits --add-dir when additionalReadDirs is unset", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "ok", stderr: "" }]);
    await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      {
        spawn: fake.spawn,
        codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")),
        randomUUID: () => "marker-id",
      },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(fake.calls[0]?.argv).not.toContain("--add-dir");
  });

  test("Codex sandbox argv retains approval policy only when sandboxed", async () => {
    const fake = fakeSpawn([
      { kind: "settle", code: 1, stderr: "stop" },
      { kind: "settle", code: 1, stderr: "stop" },
    ]);
    const sessionsDir = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));

    await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: sessionsDir, codexSandboxMode: "danger-full-access" },
    ).invoke({ prompt: "p", cwd: "/repo" });
    await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: sessionsDir, codexSandboxMode: "read-only" },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(fake.calls[0]?.argv).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "danger-full-access",
      "--model",
      "gpt-5.4",
    ]);
    expect(fake.calls[1]?.argv).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      "-c",
      'approval_policy="on-request"',
      "--model",
      "gpt-5.4",
    ]);
  });

  test("codex binding classifies quota (ASCII and U+2019), model config, and generic errors", async () => {
    const quota = fakeSpawn([{ kind: "settle", code: 1, stderr: "You've reached your usage limit" }]);
    const hitLimit = fakeSpawn([{ kind: "settle", code: 1, stderr: "you’ve hit your usage limit" }]);
    const reachedLimit = fakeSpawn([{ kind: "settle", code: 1, stderr: "you’ve reached your usage limit" }]);
    const authQuota = fakeSpawn([{ kind: "settle", code: 1, stderr: "please log out and sign in" }]);
    const trustedDir = fakeSpawn([{ kind: "settle", code: 1, stderr: CODEX_TRUSTED_DIRECTORY_REFUSAL }]);
    const model = fakeSpawn([{ kind: "settle", code: 1, stderr: "unknown model: nope" }]);
    const generic = fakeSpawn([{ kind: "settle", code: 2, stderr: "boom" }]);

    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: quota.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "You've reached your usage limit", ...CODEX_SESSION_MISS_SETTLEMENT });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: hitLimit.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "you’ve hit your usage limit", ...CODEX_SESSION_MISS_SETTLEMENT });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: reachedLimit.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "you’ve reached your usage limit", ...CODEX_SESSION_MISS_SETTLEMENT });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: authQuota.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({
      kind: "quota",
      stderr: "please log out and sign in",
      authFailure: true,
      ...CODEX_SESSION_MISS_SETTLEMENT,
    });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: trustedDir.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({
      kind: "quota",
      stderr: CODEX_TRUSTED_DIRECTORY_REFUSAL,
      authFailure: true,
      ...CODEX_SESSION_MISS_SETTLEMENT,
    });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "bad", priceKey: "bad" },
        { spawn: model.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "model_config", stderr: "unknown model: nope", ...CODEX_SESSION_MISS_SETTLEMENT });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: generic.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "error", exitCode: 2, stderr: "boom", ...CODEX_SESSION_MISS_SETTLEMENT });
  });

  test("codex trusted-directory refusal advances fallback", async () => {
    const sessionsDir = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const fake = fakeSpawn([{ kind: "settle", code: 1, stderr: CODEX_TRUSTED_DIRECTORY_REFUSAL }]);
    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding(
          { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
          codexBindingOpts(sessionsDir, fake.spawn),
        ),
        { id: "next", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) },
      ],
    });

    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.result).toEqual({
      kind: "quota",
      stderr: CODEX_TRUSTED_DIRECTORY_REFUSAL,
      authFailure: true,
      ...CODEX_SESSION_MISS_SETTLEMENT,
    });
    expect(result.attempts[1]?.binding.id).toBe("next");
    expect(result.final?.result).toEqual({ kind: "ok", stdout: "done", stderr: "" });
  });

  test("codex zero-exit credential-auth on stderr settles quota with authFailure", async () => {
    const stderr = "401 Unauthorized\nFailed to refresh token: abc123. Please log out and sign in again";
    const stdout = "codex banner text\n";
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout, stderr }]);

    const result = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({
      kind: "quota",
      stderr: `${stderr}${stdout}`,
      authFailure: true,
      ...CODEX_SESSION_MISS_SETTLEMENT,
    });
  });

  test("codex zero-exit auth phrase in stdout only settles ok", async () => {
    const stdout = "please log out and sign in to continue";
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout, stderr: "" }]);

    const result = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toMatchObject({ kind: "ok", stdout, stderr: "" });
  });

  test("codex zero-exit productive stdout with auth stderr settles quota", async () => {
    const stdout = "completed implementation\n";
    const stderr = "please log out and sign in again";
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout, stderr }]);

    const result = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({
      kind: "quota",
      stderr: `${stderr}${stdout}`,
      authFailure: true,
      ...CODEX_SESSION_MISS_SETTLEMENT,
    });
  });

  test("codex zero-exit credential-auth advances fallback order", async () => {
    const sessionsDir = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const stderr = "Failed to refresh token. Please log out and sign in again";
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "banner", stderr }]);
    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding(
          { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
          codexBindingOpts(sessionsDir, fake.spawn),
        ),
        { id: "next", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) },
      ],
    });

    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.result).toEqual({
      kind: "quota",
      stderr: `${stderr}banner`,
      authFailure: true,
      ...CODEX_SESSION_MISS_SETTLEMENT,
    });
    expect(result.attempts[1]?.binding.id).toBe("next");
    expect(result.final?.result).toEqual({ kind: "ok", stdout: "done", stderr: "" });
  });

  test("cursor zero-exit auth-shaped stderr settles ok", async () => {
    const stderr = "please log out and sign in again";
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "done", stderr }]);

    const result = await createResolvedAgentBinding(
      { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual(cursorOkNoUsage("done", stderr));
  });

  test("codex binding classifies zero-exit quota patterns", async () => {
    const quotaZeroExit = fakeSpawn([{ kind: "settle", code: 0, stdout: "You've hit your usage limit", stderr: "" }]);
    const normalZeroExit = fakeSpawn([{ kind: "settle", code: 0, stdout: "completed successfully", stderr: "" }]);
    const blockerZeroExit = fakeSpawn([
      {
        kind: "settle",
        code: 0,
        stdout:
          "## Blocker\nthe environment rejected validation with its usage limit before the required v2 gates could run",
        stderr: "",
      },
    ]);

    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: quotaZeroExit.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "You've hit your usage limit", ...CODEX_SESSION_MISS_SETTLEMENT });

    const result2 = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: normalZeroExit.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result2).toMatchObject({ kind: "ok", stdout: "completed successfully", stderr: "" });

    const result3 = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: blockerZeroExit.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result3).toMatchObject({
      kind: "ok",
      stdout:
        "## Blocker\nthe environment rejected validation with its usage limit before the required v2 gates could run",
      stderr: "",
    });
  });

  test("codex spawn failure returns terminal error", async () => {
    const fake = fakeSpawn([{ kind: "throw", error: new Error("ENOENT") }]);

    const result = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({ kind: "error", exitCode: -1, stderr: "Error: ENOENT", ...CODEX_SESSION_MISS_SETTLEMENT });
  });

  test("codex session usage unavailable remains ok with warning metadata", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "done", stderr: "warn" }]);

    const result = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({
      kind: "ok",
      stdout: "done",
      stderr: "warn",
      usage_source: "unavailable",
      cost_usd: null,
      cost_source: "no-usage",
      warnings: ["codex usage unavailable: no session JSONL changed after this invocation"],
    });
  });

  test("codex binding with matched rollout settles priced session usage and computed list-price cost", async () => {
    const sessionsDir = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const pricedUsage = {
      input_tokens: 24372,
      output_tokens: 282,
      cache_read_input_tokens: 11008,
      cache_creation_input_tokens: null,
    };
    const pricedBinding = {
      agentId: "codex" as const,
      adapterModel: "gpt-5.6-sol",
      priceKey: "gpt-5.6-sol",
    };
    const rolloutLines = [codexUserMessageLine(), codexTokenCountLine({ input: 35380, cached: 11008, output: 282 })];
    const fake = spawnWritingCodexRollout(sessionsDir, rolloutLines, [
      { kind: "settle", code: 0, stdout: "done", stderr: "" },
      { kind: "settle", code: 0, stdout: "done", stderr: "" },
    ]);
    const binding = createResolvedAgentBinding(pricedBinding, codexBindingOpts(sessionsDir, fake.spawn));

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toMatchObject({
      kind: "ok",
      stdout: "done",
      stderr: "",
      usage: pricedUsage,
      usage_source: "agent",
      cost_source: "computed",
    });
    const expectedCost = computeCost(pricedUsage, "gpt-5.6-sol", loadPrices()).cost_usd;
    expect(result.kind === "ok" && result.cost_usd).toBeCloseTo(expectedCost ?? 0, 10);
    expect(result.kind === "ok" && result.cost_usd).toBeCloseTo(0.135824, 10);

    const rows: InvocationCompletedRecord[] = [];
    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [createResolvedAgentBinding(pricedBinding, codexBindingOpts(sessionsDir, fake.spawn))],
      telemetry: telemetryForRows(rows),
    });

    expect(rows[0]).toMatchObject({
      usage: pricedUsage,
      usage_source: "agent",
      cost_source: "computed",
    });
    expect(rows[0]?.cost_usd).toBeCloseTo(0.135824, 10);
  });

  test("codex binding with matched rollout whose token_count info is all null keeps unavailable no-usage", async () => {
    const sessionsDir = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const fake = spawnWritingCodexRollout(
      sessionsDir,
      [codexUserMessageLine(), codexTokenCountLine({ input: 0, cached: 0, output: 0, info: null })],
      [{ kind: "settle", code: 0, stdout: "done", stderr: "" }],
    );
    const binding = createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      codexBindingOpts(sessionsDir, fake.spawn),
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toMatchObject({
      kind: "ok",
      usage_source: "unavailable",
      cost_usd: null,
      cost_source: "no-usage",
    });
    // The null-info branch and the unextractable-usage fallthrough both settle unavailable/no-usage,
    // so only the warning text distinguishes them. Assert it, or the guard below is unprovable.
    expect(result.kind === "ok" && result.warnings).toEqual([
      "codex usage unavailable: matched session has token_count events with null info only",
    ]);
  });

  test("codex binding uses last non-null token_count event, not max total", async () => {
    const sessionsDir = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const fake = spawnWritingCodexRollout(
      sessionsDir,
      [
        codexUserMessageLine(),
        codexTokenCountLine({ input: 50000, cached: 40000, output: 500 }),
        codexTokenCountLine({ input: 20000, cached: 8000, output: 100 }),
        codexTokenCountLine({ input: 0, cached: 0, output: 0, info: null }),
      ],
      [{ kind: "settle", code: 0, stdout: "done", stderr: "" }],
    );
    const binding = createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      codexBindingOpts(sessionsDir, fake.spawn),
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toMatchObject({
      kind: "ok",
      usage: {
        input_tokens: 12000,
        output_tokens: 100,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: null,
      },
      usage_source: "agent",
    });
  });

  test("codex binding with priced usage and unknown priceKey keeps no-price", async () => {
    const sessionsDir = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const fake = spawnWritingCodexRollout(
      sessionsDir,
      [codexUserMessageLine(), codexTokenCountLine({ input: 35380, cached: 11008, output: 282 })],
      [{ kind: "settle", code: 0, stdout: "done", stderr: "" }],
    );
    const binding = createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.6-sol", priceKey: "unknown-price-key" },
      codexBindingOpts(sessionsDir, fake.spawn),
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toMatchObject({
      kind: "ok",
      usage_source: "agent",
      cost_usd: null,
      cost_source: "no-price",
    });
  });

  test("codex binding with non-object total_token_usage keeps unavailable no-usage", async () => {
    const sessionsDir = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const fake = spawnWritingCodexRollout(
      sessionsDir,
      [
        codexUserMessageLine(),
        codexTokenCountLine({
          input: 0,
          cached: 0,
          output: 0,
          info: { total_token_usage: "bad" },
        }),
      ],
      [{ kind: "settle", code: 0, stdout: "done", stderr: "" }],
    );
    const binding = createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      codexBindingOpts(sessionsDir, fake.spawn),
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toMatchObject({
      kind: "ok",
      usage_source: "unavailable",
      cost_usd: null,
      cost_source: "no-usage",
    });
    expect(result.kind === "ok" && result.warnings?.length).toBeGreaterThan(0);
  });

  test("codex telemetry uses resolved binding metadata", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "done" }]);
    const rows: InvocationCompletedRecord[] = [];
    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding(
          {
            agentId: "codex",
            adapterModel: "gpt-5.4",
            priceKey: "priced-codex",
          },
          { spawn: fake.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
        ),
      ],
      telemetry: telemetryForRows(rows),
    });

    expect(rows[0]?.agent).toBe("codex");
    expect(rows[0]?.model).toBe("gpt-5.4");
    expect(rows[0]?.binding_id).toBe("codex/gpt-5.4/priced-codex");
  });

  test("cursor binding invokes the CLI shape with mapped model, cwd, stdin prompt, and abort signal", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    const controller = new AbortController();
    const promise = createResolvedAgentBinding(
      {
        agentId: "cursor",
        adapterModel: "Composer 2.5 Fast",
        priceKey: "Composer 2.5 Fast",
      },
      { spawn: fake.spawn },
    ).invoke({ prompt: "implement it", cwd: "/repo", signal: controller.signal });

    controller.abort("operator");
    const result = await settlesWithin(promise);

    expect(result).toEqual({ kind: "error", exitCode: -1, stderr: "aborted: operator" });
    expect(fake.calls[0]?.binary).toBe("cursor");
    expect(fake.calls[0]?.argv).toEqual([
      "agent",
      "-p",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--model",
      "composer-2.5-fast",
      "--force",
      "--workspace",
      "/repo",
    ]);
    expect(fake.calls[0]?.opts.cwd).toBe("/repo");
    expect(fake.calls[0]?.opts.detached).toBe(true);
    expect(fake.calls[0]?.opts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(fake.calls[0]?.child?.stdinChunks.join("")).toBe("implement it");
    expect(fake.calls[0]?.child?.killedWith).toContain("SIGTERM");
  });

  test("cursor binding spawns with bounded argv and delivers a multi-megabyte prompt on stdin", async () => {
    const hugePrompt = `${"x".repeat(2 * 1024 * 1024)}tail-marker`;
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: cursorResultLine("done", true), stderr: "" }]);
    const binding = createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: fake.spawn });

    const result = await binding.invoke({ prompt: hugePrompt, cwd: "/repo" });

    expect(result).toEqual(cursorOkNoUsage("done"));
    expect(fake.calls[0]?.argv).not.toContain(hugePrompt);
    expect(fake.calls[0]?.argv?.every((token) => token.length < 512)).toBe(true);
    expect(fake.calls[0]?.child?.stdinChunks.join("")).toBe(hugePrompt);
  });

  test("cursor binding passes unmapped model strings through unchanged", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "done", stderr: "" }]);

    const result = await createResolvedAgentBinding(
      { agentId: "cursor", adapterModel: "custom-cursor-model", priceKey: "custom" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual(cursorOkNoUsage("done"));
    expect(fake.calls[0]?.argv).toContain("custom-cursor-model");
  });

  test("cursor binding classifies the live out-of-usage banner as quota", async () => {
    // Verbatim stderr from sudoku run 880b2201 (2026-09-08), which classified `error` and
    // stopped the fallback chain one rung short of an available claude.
    const banner =
      "ActionRequiredError: Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.";
    const outOfUsage = fakeSpawn([{ kind: "settle", code: 1, stderr: banner }]);
    const precededByNoise = fakeSpawn([
      {
        kind: "settle",
        code: 1,
        stderr: `ERROR codex_core::shell_snapshot: Snapshot command exited with status 2\n${banner}`,
      },
    ]);

    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
        { spawn: outOfUsage.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toMatchObject({ kind: "quota" });

    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
        { spawn: precededByNoise.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toMatchObject({ kind: "quota" });
  });

  test("cursor binding classifies quota (ASCII and U+2019), model config, and generic errors", async () => {
    const quota = fakeSpawn([{ kind: "settle", code: 1, stderr: "monthly cursor usage limit reached" }]);
    const usageLimit = fakeSpawn([{ kind: "settle", code: 1, stderr: "you’ve hit your usage limit" }]);
    const freeLimit = fakeSpawn([{ kind: "settle", code: 1, stderr: "you’ve hit your free requests limit" }]);
    const model = fakeSpawn([{ kind: "settle", code: 1, stderr: "unknown model: nope" }]);
    const generic = fakeSpawn([{ kind: "settle", code: 2, stderr: "boom" }]);

    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
        { spawn: quota.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "monthly cursor usage limit reached" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
        { spawn: usageLimit.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "you’ve hit your usage limit" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
        { spawn: freeLimit.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "you’ve hit your free requests limit" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "bad", priceKey: "bad" },
        { spawn: model.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "model_config", stderr: "unknown model: nope" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
        { spawn: generic.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "error", exitCode: 2, stderr: "boom" });
  });

  test("cursor binding classifies zero-exit quota patterns", async () => {
    const quotaZeroExitStderr = fakeSpawn([
      { kind: "settle", code: 0, stdout: "", stderr: "monthly cursor usage limit reached" },
    ]);
    const quotaResultStdout = cursorResultLine("monthly cursor usage limit reached", false);
    const quotaZeroExitResult = fakeSpawn([{ kind: "settle", code: 0, stdout: quotaResultStdout, stderr: "" }]);
    const normalZeroExit = fakeSpawn([
      { kind: "settle", code: 0, stdout: cursorResultLine("completed successfully", true), stderr: "" },
    ]);

    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
        { spawn: quotaZeroExitStderr.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "monthly cursor usage limit reached" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
        { spawn: quotaZeroExitResult.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({
      kind: "quota",
      stderr: "monthly cursor usage limit reached",
      diagnostics: quotaResultStdout,
    });

    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
        { spawn: normalZeroExit.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual(cursorOkNoUsage("completed successfully"));
  });

  test("cursor spawn failure returns terminal error", async () => {
    const fake = fakeSpawn([{ kind: "throw", error: new Error("ENOENT") }]);

    const result = await createResolvedAgentBinding(
      { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({ kind: "error", exitCode: -1, stderr: "Error: ENOENT" });
  });

  test("cursor telemetry uses resolved binding metadata", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "done" }]);
    const rows: InvocationCompletedRecord[] = [];
    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding(
          {
            agentId: "cursor",
            adapterModel: "GPT-5.4",
            priceKey: "priced-cursor",
          },
          { spawn: fake.spawn },
        ),
      ],
      telemetry: telemetryForRows(rows),
    });

    expect(rows[0]?.agent).toBe("cursor");
    expect(rows[0]?.model).toBe("GPT-5.4");
    expect(rows[0]?.binding_id).toBe("cursor/GPT-5.4/priced-cursor");
  });

  test("cursor binding unwraps stream-json result event text as stdout", async () => {
    const streamJson = JSON.stringify({ type: "result", result: "implementation complete\n" });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: streamJson, stderr: "" }]);
    const binding = createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: fake.spawn });

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual(cursorOkNoUsage("implementation complete"));
  });

  test("cursor binding concatenates text-delta frames when no terminal result event", async () => {
    const frames = [
      JSON.stringify({ type: "text_delta", text: "part " }),
      JSON.stringify({ type: "text_delta", text: "one\n" }),
    ].join("\n");
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: frames, stderr: "" }]);
    const binding = createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: fake.spawn });

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual(cursorOkNoUsage("part one"));
    expect(result.kind === "ok" && "warnings" in result ? result.warnings : undefined).toBeUndefined();
    // Guard inversion: omitting cost_source: "no-usage" on the no-usage finalize path turns this test RED.
  });

  test("cursor binding falls back to verbatim stdout when unparseable", async () => {
    const unparseable = "not json at all\nand more text\n";
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: unparseable, stderr: "" }]);
    const binding = createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: fake.spawn });

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual(cursorOkNoUsage(unparseable));
  });

  test("cursor binding with terminal result usage settles ok agent-usage no-price", async () => {
    const streamJson = JSON.stringify({
      type: "result",
      result: "implementation complete\n",
      usage: {
        inputTokens: CURSOR_AGENT_USAGE.input_tokens,
        outputTokens: CURSOR_AGENT_USAGE.output_tokens,
        cacheReadTokens: CURSOR_AGENT_USAGE.cache_read_input_tokens,
        cacheWriteTokens: CURSOR_AGENT_USAGE.cache_creation_input_tokens,
      },
    });
    const fake = fakeSpawn([
      { kind: "settle", code: 0, stdout: streamJson, stderr: "" },
      { kind: "settle", code: 0, stdout: streamJson, stderr: "" },
    ]);
    const binding = createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: fake.spawn });

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({
      kind: "ok",
      stdout: "implementation complete",
      stderr: "",
      usage: CURSOR_AGENT_USAGE,
      usage_source: "agent",
      cost_usd: null,
      cost_source: "no-price",
    });
    // Guard inversion: restoring the pre-fix stdout-only finalize rebuild (dropping parsed usage onto InvocationOk) turns this test RED.
    // Guard inversion: omitting cost_source: "no-price" on the with-usage finalize path turns this test RED.

    const rows: InvocationCompletedRecord[] = [];
    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: fake.spawn })],
      telemetry: telemetryForRows(rows),
    });

    expect(rows[0]).toMatchObject({
      usage: CURSOR_AGENT_USAGE,
      usage_source: "agent",
      cost_usd: null,
      cost_source: "no-price",
    });
  });

  test("cursor binding with terminal usage and priced priceKey settles computed list-price cost", async () => {
    const streamJson = JSON.stringify({
      type: "result",
      result: "implementation complete\n",
      usage: COMPOSER_25_TERMINAL_USAGE,
    });
    const parsedUsage = parseCursorJsonOutput(streamJson).usage;
    const pricedBinding = { ...COMPOSER_CURSOR_BINDING, priceKey: "Composer 2.5" };
    const fake = fakeSpawn([
      { kind: "settle", code: 0, stdout: streamJson, stderr: "" },
      { kind: "settle", code: 0, stdout: streamJson, stderr: "" },
    ]);
    const binding = createResolvedAgentBinding(pricedBinding, { spawn: fake.spawn });

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toMatchObject({
      kind: "ok",
      stdout: "implementation complete",
      stderr: "",
      usage: parsedUsage,
      usage_source: "agent",
      cost_source: "computed",
    });
    expect(result.kind === "ok" && result.cost_usd).toBeCloseTo(0.0038492, 10);
    // Guard inversion: routing the no-usage path through computeCost, or omitting the priceKey thread into finalizeCursorInvocationResult, turns this test RED.

    const rows: InvocationCompletedRecord[] = [];
    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [createResolvedAgentBinding(pricedBinding, { spawn: fake.spawn })],
      telemetry: telemetryForRows(rows),
    });

    expect(rows[0]).toMatchObject({
      usage: parsedUsage,
      usage_source: "agent",
      cost_source: "computed",
    });
    expect(rows[0]?.cost_usd).toBeCloseTo(0.0038492, 10);
  });

  test("cursor binding with terminal usage and unknown priceKey keeps no-price", async () => {
    const streamJson = JSON.stringify({
      type: "result",
      result: "done\n",
      usage: COMPOSER_25_TERMINAL_USAGE,
    });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: streamJson, stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { ...COMPOSER_CURSOR_BINDING, priceKey: "unknown-price-key" },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toMatchObject({
      kind: "ok",
      usage_source: "agent",
      cost_usd: null,
      cost_source: "no-price",
    });
  });

  test("cursor binding with no terminal usage and unpriced priceKey keeps no-usage", async () => {
    const streamJson = JSON.stringify({ type: "result", result: "implementation complete\n" });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: streamJson, stderr: "" }]);
    const binding = createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: fake.spawn });

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual(cursorOkNoUsage("implementation complete"));
    // Guard inversion: routing the no-usage path through computeCost turns this test RED.
  });

  // The idle watchdog itself is agent-agnostic — it arms off generic stdout data — so this
  // is a threading guard, not a regression guard for the stream-json flag: it proves the
  // cursor wrapper still hands `idleOutputMs`/`setTimeout`/`clearTimeout` to `runAgent`,
  // and that a stdout chunk re-arms the timer so the superseded expiry is inert.
  test("cursor binding threads idleOutputMs through and re-arms the idle timer on stdout", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    const armedDelays: (number | undefined)[] = [];
    const expiries: (() => void)[] = [];
    const cleared = new Set<() => void>();
    const binding = createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, {
      spawn: fake.spawn,
      setTimeout: ((callback: () => void, delayMs?: number) => {
        armedDelays.push(delayMs);
        // Honour cancellation the way a real timer does, so firing a superseded
        // expiry only does something if production code failed to clear it.
        const wrapped = () => {
          if (!cleared.has(wrapped)) callback();
        };
        expiries.push(wrapped);
        return wrapped as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: ((timer) => {
        cleared.add(timer as unknown as () => void);
      }) as typeof clearTimeout,
    });

    const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 });

    // Armed once at spawn, with the caller's budget — the wrapper threads it through.
    expect(armedDelays).toEqual([100]);

    fake.calls[0]?.child?.stdout.write(JSON.stringify({ type: "text_delta", text: "chunk" }));
    await new Promise((resolve) => setImmediate(resolve));

    // The stdout chunk cleared the first timer and armed a fresh one for the same budget.
    expect(armedDelays).toEqual([100, 100]);
    expect(cleared.has(expiries[0] as () => void)).toBe(true);

    // Firing the superseded expiry must not kill the child or settle the invocation.
    expiries[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(fake.calls[0]?.child?.killedWith).toEqual([]);

    // The live timer still stalls when its budget really does elapse.
    expiries[1]?.();
    await expect(promise).resolves.toMatchObject({ kind: "stall" });
    expect(fake.calls[0]?.child?.killedWith).toEqual([]);
  });

  test("cursor binding classifies quota phrases in stream-json frames", async () => {
    const stdout = cursorStdoutWithSuccess([{ type: "text_delta", text: "you've hit your usage limit" }], "done");
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout, stderr: "" }]);
    expect(await invokeComposerCursor(fake.spawn)).toEqual(cursorOkNoUsage("done"));
  });

  test("cursor classifier diagnostics scope stream-json assistant text and retain excluded stdout", async () => {
    const cursorQuotaPhrases = [
      "you've hit your usage limit",
      "You're out of usage",
      "increase your limit",
      "you've hit your free requests limit",
      "total usage limit reached",
      "monthly cursor usage limit reached",
      "on-demand spending limit",
      "spend limit",
      "resource_exhausted",
      "insufficient_quota",
      "quota exceeded",
    ];
    for (const phrase of cursorQuotaPhrases) {
      const stdout = cursorStdoutWithSuccess([{ type: "assistant", text: phrase }], "implementation complete");
      const fake = fakeSpawn([{ kind: "settle", code: 0, stdout, stderr: "" }]);
      expect(await invokeComposerCursor(fake.spawn)).toEqual(cursorOkNoUsage("implementation complete"));
    }

    const noResultStdout = fakeSpawn([
      { kind: "settle", code: 0, stdout: JSON.stringify({ type: "text_delta", text: "quota exceeded" }), stderr: "" },
    ]);
    await expect(invokeComposerCursor(noResultStdout.spawn)).resolves.toEqual(cursorOkNoUsage("quota exceeded"));

    const plainStdoutQuota = fakeSpawn([{ kind: "settle", code: 0, stdout: "quota exceeded\n", stderr: "" }]);
    await expect(invokeComposerCursor(plainStdoutQuota.spawn)).resolves.toEqual({
      kind: "quota",
      stderr: "quota exceeded",
      diagnostics: "quota exceeded\n",
    });

    const stderrQuotaWithSuccess = cursorResultLine("done", true);
    const stderrQuota = fakeSpawn([
      { kind: "settle", code: 0, stdout: stderrQuotaWithSuccess, stderr: "you've hit your usage limit" },
    ]);
    await expect(invokeComposerCursor(stderrQuota.spawn)).resolves.toEqual({
      kind: "quota",
      stderr: "you've hit your usage limit",
      diagnostics: stderrQuotaWithSuccess,
    });

    const quotaResultStdout = cursorResultLine("you've hit your usage limit", false);
    const errorResultQuota = fakeSpawn([{ kind: "settle", code: 0, stdout: quotaResultStdout, stderr: "" }]);
    await expect(invokeComposerCursor(errorResultQuota.spawn)).resolves.toEqual({
      kind: "quota",
      stderr: "you've hit your usage limit",
      diagnostics: quotaResultStdout,
    });

    const errorStdout = cursorResultLine("boom", false);
    const errorResultGeneric = fakeSpawn([{ kind: "settle", code: 1, stdout: errorStdout, stderr: "" }]);
    expect(await invokeComposerCursor(errorResultGeneric.spawn)).toEqual({
      kind: "error",
      exitCode: 1,
      stderr: "boom",
      diagnostics: errorStdout,
    });

    const stderrModel = fakeSpawn([{ kind: "settle", code: 1, stderr: "unknown model: nope", stdout: "" }]);
    await expect(
      createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: stderrModel.spawn }).invoke({
        prompt: "p",
        cwd: "/repo",
      }),
    ).resolves.toEqual({ kind: "model_config", stderr: "unknown model: nope" });

    const resultModel = fakeSpawn([
      { kind: "settle", code: 1, stdout: cursorResultLine("unknown model: nope", false), stderr: "" },
    ]);
    expect(await invokeComposerCursor(resultModel.spawn)).toMatchObject({
      kind: "model_config",
      stderr: "unknown model: nope",
    });

    const transientRetries = Array.from({ length: 4 }, () => ({
      kind: "settle" as const,
      code: 1,
      stderr: "connection reset",
      stdout: "",
    }));
    const stderrTransient = fakeSpawn(transientRetries);
    await expect(
      createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: stderrTransient.spawn }).invoke({
        prompt: "p",
        cwd: "/repo",
      }),
    ).resolves.toMatchObject({ kind: "error", exitCode: 1, stderr: "connection reset" });

    const resultTransientStdout = cursorResultLine("connection reset", false);
    const resultTransient = fakeSpawn(
      Array.from({ length: 4 }, () => ({
        kind: "settle" as const,
        code: 1,
        stdout: resultTransientStdout,
        stderr: "",
      })),
    );
    await expect(invokeComposerCursor(resultTransient.spawn)).resolves.toMatchObject({
      kind: "error",
      exitCode: 1,
      stderr: "connection reset",
      diagnostics: resultTransientStdout,
    });
  });

  test("cursor binding passes non-ok results through unnormalized", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 1, stderr: "boom" }]);

    const result = await createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: fake.spawn }).invoke({
      prompt: "p",
      cwd: "/repo",
    });

    expect(result).toEqual({ kind: "error", exitCode: 1, stderr: "boom" });
  });

  test("cursor binding still stalls on output-silent invocation past idleOutputMs", async () => {
    const { fake, binding, fireIdle } = hangWithControllableIdle(COMPOSER_CURSOR_BINDING);

    const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 });
    fireIdle();

    await expect(promise).resolves.toEqual({ kind: "stall", stderr: "" });
    expect(fake.calls[0]?.child?.killedWith).toEqual([]);
  });

  test("cursor quota advances fallback but model config and generic error stop", async () => {
    const quota = fakeSpawn([{ kind: "settle", code: 1, stderr: "You've hit your usage limit" }]);
    const model = fakeSpawn([{ kind: "settle", code: 1, stderr: "unknown model: nope" }]);
    const generic = fakeSpawn([{ kind: "settle", code: 2, stderr: "boom" }]);

    const quotaResult = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding(
          { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
          { spawn: quota.spawn },
        ),
        {
          id: "next",
          invoke: async () => ({ kind: "ok", stdout: "next", stderr: "" }),
        },
      ],
    });
    const modelResult = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding({ agentId: "cursor", adapterModel: "bad", priceKey: "bad" }, { spawn: model.spawn }),
        {
          id: "next",
          invoke: async () => ({ kind: "ok", stdout: "should-not-run", stderr: "" }),
        },
      ],
    });
    const genericResult = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding(
          { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
          { spawn: generic.spawn },
        ),
        {
          id: "next",
          invoke: async () => ({ kind: "ok", stdout: "should-not-run", stderr: "" }),
        },
      ],
    });

    expect(quotaResult.attempts.map((attempt) => attempt.binding.id)).toEqual(["cursor/GPT-5.4/GPT-5.4", "next"]);
    expect(quotaResult.final?.result).toEqual({ kind: "ok", stdout: "next", stderr: "" });
    expect(modelResult.attempts.map((attempt) => attempt.binding.id)).toEqual(["cursor/bad/bad"]);
    expect(modelResult.final?.result.kind).toBe("model_config");
    expect(genericResult.attempts.map((attempt) => attempt.binding.id)).toEqual(["cursor/GPT-5.4/GPT-5.4"]);
    expect(genericResult.final?.result.kind).toBe("error");
  });

  test("opencode binding invokes the CLI shape with dir, model, and ignored stdin", async () => {
    const stepFinish = JSON.stringify({
      type: "step_finish",
      part: { tokens: { input: 10, output: 20, cache: { read: 3, write: 5 } }, cost: 0.04 },
    });
    const textFrame = JSON.stringify({ type: "text", part: { text: "implementation complete\n" } });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: `${textFrame}\n${stepFinish}`, stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "implement it", cwd: "/repo" });

    expect(result).toEqual({
      kind: "ok",
      stdout: "implementation complete",
      stderr: "",
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 5,
      },
      usage_source: "agent",
      cost_usd: 0.04,
      cost_source: "agent",
    });
    expect(binding.id).toBe("opencode/gpt-5/gpt-5");
    expect(binding.metadata).toEqual({ agent: "opencode", model: "gpt-5" });
    expect(fake.calls[0]?.binary).toBe("opencode");
    expect(fake.calls[0]?.argv).toEqual([
      "run",
      "--dir",
      "/repo",
      "--model",
      "gpt-5",
      "--format",
      "json",
      "implement it",
    ]);
    expect(fake.calls[0]?.opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(fake.calls[0]?.child?.stdinChunks.join("")).toBe("");
  });

  test("opencode binding with no step_finish settles ok unavailable with warning", async () => {
    const textOnly = JSON.stringify({ type: "text", part: { text: "done" } });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: textOnly, stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({
      kind: "ok",
      stdout: "done",
      stderr: "",
      usage_source: "unavailable",
      cost_usd: null,
      cost_source: "no-usage",
      warnings: ["opencode: no step_finish events in --format json stream; usage recorded as unavailable."],
    });
  });

  test("opencode step_finish-only stream renders empty display text, not raw NDJSON", async () => {
    const stepFinish = JSON.stringify({
      type: "step_finish",
      part: { tokens: { input: 10, output: 20, cache: { read: 3, write: 5 } }, cost: 0.04 },
    });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: stepFinish, stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({
      kind: "ok",
      stdout: "",
      stderr: "",
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 5,
      },
      usage_source: "agent",
      cost_usd: 0.04,
      cost_source: "agent",
    });
  });

  test("opencode step_finish without part.cost settles ok agent-usage no-price", async () => {
    const stepFinish = JSON.stringify({
      type: "step_finish",
      part: { tokens: { input: 10, output: 20, cache: { read: 3, write: 5 } } },
    });
    const textFrame = JSON.stringify({ type: "text", part: { text: "done" } });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: `${textFrame}\n${stepFinish}`, stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({
      kind: "ok",
      stdout: "done",
      stderr: "",
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 5,
      },
      usage_source: "agent",
      cost_usd: null,
      cost_source: "no-price",
    });
  });
  test("opencode binding classifies quota, model config, and transient via its own classifier", async () => {
    const rateLimit = fakeSpawn([{ kind: "settle", code: 1, stderr: "rate limit reached" }]);
    const quotaExceeded = fakeSpawn([{ kind: "settle", code: 1, stderr: "quota exceeded" }]);
    const insufficient = fakeSpawn([{ kind: "settle", code: 1, stderr: "insufficient_quota" }]);
    const guarded429 = fakeSpawn([{ kind: "settle", code: 1, stderr: "http status 429" }]);
    const exceeded = fakeSpawn([{ kind: "settle", code: 1, stderr: "you have exceeded your plan" }]);
    const modelConfig = fakeSpawn([{ kind: "settle", code: 1, stderr: "no provider configured for gpt-5" }]);

    await expect(
      createResolvedAgentBinding(
        { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
        { spawn: rateLimit.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "rate limit reached" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
        { spawn: quotaExceeded.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "quota exceeded" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
        { spawn: insufficient.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "insufficient_quota" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
        { spawn: guarded429.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "http status 429" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
        { spawn: exceeded.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "you have exceeded your plan" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
        { spawn: modelConfig.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "model_config", stderr: "no provider configured for gpt-5" });
  });

  test("a codex exit whose diagnostics carry a transient marker before the usage-limit banner classifies quota", async () => {
    // #3372 tail shape: a shell-snapshot noise line with a transport-looking phrase, then the banner.
    const stderr =
      "ERROR codex_core::shell_snapshot: Snapshot command exited: connection reset by peer\n" +
      "ERROR: You've hit your usage limit. Upgrade to Pro or try again at Sep 6th, 2026 9:54 PM.\n";
    const fake = fakeSpawn([{ kind: "settle", code: 1, stderr }]);
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: fake.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr, ...CODEX_SESSION_MISS_SETTLEMENT });
    // Quota is not retried: exactly one spawn, no transient backoff.
    expect(fake.calls.length).toBe(1);
  });

  test("a codex credential/auth line alongside a transient marker still classifies quota with authFailure", async () => {
    const stderr = "stream closed unexpectedly\nplease log out and sign in\n";
    const fake = fakeSpawn([{ kind: "settle", code: 1, stderr }]);
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: fake.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr, authFailure: true, ...CODEX_SESSION_MISS_SETTLEMENT });
    expect(fake.calls.length).toBe(1);
  });

  test("a transient-only codex exit is still retried on the same binding", async () => {
    const fake = fakeSpawn([
      { kind: "settle", code: 1, stderr: "connection reset" },
      { kind: "settle", code: 0, stdout: "done", stderr: "" },
    ]);
    const result = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(fake.calls.length).toBe(2);
    expect(result.kind).toBe("ok");
  });

  test("opencode guarded HTTP 500 (UnknownError) is transient and retried", async () => {
    const fake = fakeSpawn([
      { kind: "settle", code: 1, stderr: "UnknownError: http status 500" },
      { kind: "settle", code: 0, stdout: "done", stderr: "" },
    ]);
    const result = await createResolvedAgentBinding(
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(fake.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.kind).toBe("ok");
  });

  test("opencode does not classify quota from agent content on stdout (non-zero exit)", async () => {
    // opencode's --format json stdout carries the full contents of files the agent read/grepped.
    // Here the agent merely read jarvis's own quota-handling code: stdout has `429` next to `Error`
    // plus `rate limit`/`quota exceeded`, but stderr is clean. This is not a quota exhaustion.
    const pollutedStdout = JSON.stringify({
      type: "text",
      part: { text: "grep hit: Line 429: throw new Error('rate limit'); // quota exceeded" },
    });
    const fake = fakeSpawn([{ kind: "settle", code: 1, stdout: pollutedStdout, stderr: "" }]);
    const result = await createResolvedAgentBinding(
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    // Fails against the pre-fix classifier that scanned errBuf+outBuf and settled `quota`.
    expect(result.kind).toBe("error");
    expect(fake.calls.length).toBe(1);
  });

  test("opencode error retains the JSON stdout stream as observability diagnostics", async () => {
    // Regression: opencode surfaces its result envelope on `--format json` stdout, which is
    // excluded from classification. An `error` with clean stderr must not leave operators blind:
    // `stderr` stays scoped (empty) while `diagnostics` retains the full stdout stream for the
    // session log / invocation_failure_diagnostic. The retained stream must NOT be reclassified.
    const envelope = JSON.stringify({ type: "text", part: { text: "read code: http status 429 rate limit" } });
    const fake = fakeSpawn([{ kind: "settle", code: 1, stdout: envelope, stderr: "" }]);
    const result = await createResolvedAgentBinding(
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      // Classification-scoped stderr stays empty (the polluting stdout is never folded in) …
      expect(result.stderr).toBe("");
      // … but the stream is retained for diagnosis so the failure is not silent.
      expect(result.diagnostics).toBe(envelope);
    }
  });

  test("opencode does not classify quota from agent content on stdout (zero exit)", async () => {
    const pollutedStdout = JSON.stringify({
      type: "text",
      part: { text: "read code: rate limit / quota exceeded / http status 429 error handling" },
    });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: pollutedStdout, stderr: "" }]);
    const result = await createResolvedAgentBinding(
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    // Fails against the pre-fix zero-exit path that scanned errBuf+outBuf and reclassified to `quota`.
    expect(result.kind).toBe("ok");
  });

  test("opencode still classifies a real stderr quota signal alongside unrelated stdout content", async () => {
    const benignStdout = '{"type":"text","part":{"text":"benign content"}}';
    const fake = fakeSpawn([
      {
        kind: "settle",
        code: 1,
        stdout: benignStdout,
        stderr: "rate limit reached",
      },
    ]);
    const result = await createResolvedAgentBinding(
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(result.kind).toBe("quota");
    // Diagnostics are scoped to stderr, so the JSON content stream is not folded into the result.
    if (result.kind === "quota") {
      expect(result.stderr).toBe("rate limit reached");
      // The excluded stdout stream is retained verbatim and separately, never for classification.
      expect(result.diagnostics).toBe(benignStdout);
    }
  });

  function claudeUsageResultLine(
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    },
    costUsd?: number,
  ): string {
    return JSON.stringify({
      type: "result",
      subtype: "success",
      result: "done",
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      },
      ...(costUsd !== undefined ? { total_cost_usd: costUsd } : {}),
    });
  }

  function cursorUsageResultLine(usage: typeof CURSOR_AGENT_USAGE): string {
    return JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens,
        cacheWriteTokens: usage.cache_creation_input_tokens,
      },
    });
  }

  test("stream-binding recovery on non-ok settlement", async () => {
    const claudeUsage = {
      input_tokens: 11,
      output_tokens: 7,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 0,
    };
    const claudeStream = claudeUsageResultLine(claudeUsage, 0.42);
    const claudeQuotaEnvelope = JSON.stringify({
      type: "result",
      is_error: true,
      api_error_status: 429,
      result: "You've hit your weekly limit",
      usage: {
        input_tokens: claudeUsage.input_tokens,
        output_tokens: claudeUsage.output_tokens,
        cache_read_input_tokens: claudeUsage.cache_read_input_tokens,
        cache_creation_input_tokens: claudeUsage.cache_creation_input_tokens,
      },
      total_cost_usd: 0.42,
    });
    const claudeQuota = fakeSpawn([{ kind: "settle", code: 0, stdout: claudeQuotaEnvelope, stderr: "" }]);
    const claudeQuotaResult = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: claudeQuota.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(claudeQuotaResult).toMatchObject({
      kind: "quota",
      usage: claudeUsage,
      usage_source: "agent",
      cost_usd: 0.42,
      cost_source: "agent",
    });

    const claudeError = fakeSpawn([{ kind: "settle", code: 2, stdout: claudeStream, stderr: "hard fail" }]);
    const claudeErrorResult = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: claudeError.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(claudeErrorResult).toMatchObject({
      kind: "error",
      exitCode: 2,
      usage: claudeUsage,
      usage_source: "agent",
    });

    const cursorStream = cursorUsageResultLine(CURSOR_AGENT_USAGE);
    const cursorQuota = fakeSpawn([
      { kind: "settle", code: 1, stdout: cursorStream, stderr: "You've hit your usage limit" },
    ]);
    const cursorQuotaResult = await createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, {
      spawn: cursorQuota.spawn,
    }).invoke({ prompt: "p", cwd: "/repo" });
    expect(cursorQuotaResult).toMatchObject({
      kind: "quota",
      usage: CURSOR_AGENT_USAGE,
      usage_source: "agent",
      cost_usd: null,
      cost_source: "no-price",
      diagnostics: cursorStream,
    });

    const pricedCursorStream = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      usage: COMPOSER_25_TERMINAL_USAGE,
    });
    const pricedCursorQuota = fakeSpawn([
      {
        kind: "settle",
        code: 1,
        stdout: pricedCursorStream,
        stderr: "You've hit your usage limit",
      },
    ]);
    const pricedBinding = { ...COMPOSER_CURSOR_BINDING, priceKey: "Composer 2.5" };
    const pricedCursorQuotaResult = await createResolvedAgentBinding(pricedBinding, {
      spawn: pricedCursorQuota.spawn,
    }).invoke({ prompt: "p", cwd: "/repo" });
    expect(pricedCursorQuotaResult).toMatchObject({
      kind: "quota",
      usage_source: "agent",
      cost_source: "computed",
      diagnostics: pricedCursorStream,
    });
    expect(pricedCursorQuotaResult.kind === "quota" && pricedCursorQuotaResult.cost_usd).toBeCloseTo(0.0038492, 10);
    // Guard inversion: flipping `value === null` to `!==` in recoveredCursorSettlement allNull turns this test RED.

    const stepFinish = JSON.stringify({
      type: "step_finish",
      part: { tokens: { input: 3, output: 4, cache: { read: 1, write: 0 } }, cost: 0.01 },
    });
    const opencodeStdout = `${stepFinish}\n`;
    const opencodeQuota = fakeSpawn([
      { kind: "settle", code: 1, stdout: opencodeStdout, stderr: "rate limit reached" },
    ]);
    const opencodeQuotaResult = await createResolvedAgentBinding(
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { spawn: opencodeQuota.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(opencodeQuotaResult).toMatchObject({
      kind: "quota",
      usage: {
        input_tokens: 3,
        output_tokens: 4,
        cache_read_input_tokens: 1,
        cache_creation_input_tokens: 0,
      },
      usage_source: "agent",
      diagnostics: opencodeStdout,
    });

    const stallHarness = hangWithControllableIdle(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { watchWorktreeActivity: () => {} },
    );
    const stallRun = stallHarness.binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 50 });
    await new Promise((resolve) => setImmediate(resolve));
    stallHarness.fake.calls[0]?.child?.stdout.write(`${claudeStream}\n`);
    stallHarness.fireIdle();
    const stallResult = await stallRun;
    expect(stallResult).toMatchObject({ kind: "stall", usage: claudeUsage, usage_source: "agent" });

    const cursorStallHarness = hangWithControllableIdle(COMPOSER_CURSOR_BINDING, { watchWorktreeActivity: () => {} });
    const cursorStallRun = cursorStallHarness.binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 50 });
    await new Promise((resolve) => setImmediate(resolve));
    cursorStallHarness.fake.calls[0]?.child?.stderr.write(`${cursorStream}\n`);
    cursorStallHarness.fireIdle();
    const cursorStallResult = await cursorStallRun;
    expect(cursorStallResult).toMatchObject({
      kind: "stall",
      usage: CURSOR_AGENT_USAGE,
      usage_source: "agent",
    });

    const abortHarness = hangWithControllableIdle(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { watchWorktreeActivity: () => {} },
    );
    const controller = new AbortController();
    const abortRun = abortHarness.binding.invoke({ prompt: "p", cwd: "/repo", signal: controller.signal });
    await new Promise((resolve) => setImmediate(resolve));
    abortHarness.fake.calls[0]?.child?.stdout.write(`${claudeStream}\n`);
    controller.abort("operator");
    const abortResult = await abortRun;
    expect(abortResult).toMatchObject({
      kind: "error",
      exitCode: -1,
      stderr: "aborted: operator",
      diagnostics: `${claudeStream}\n`,
      usage: claudeUsage,
      usage_source: "agent",
    });

    const cumulativeStream = `${claudeUsageResultLine({ input_tokens: 1, output_tokens: 1 })}\n${claudeUsageResultLine({ input_tokens: 99, output_tokens: 88 })}\n`;
    const cumulative = fakeSpawn([{ kind: "settle", code: 1, stdout: cumulativeStream, stderr: "boom" }]);
    const cumulativeResult = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: cumulative.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(cumulativeResult).toMatchObject({
      kind: "error",
      usage: { input_tokens: 99, output_tokens: 88 },
    });

    const firstUsage = claudeUsageResultLine({ input_tokens: 5, output_tokens: 6 });
    const secondUsage = claudeUsageResultLine({ input_tokens: 50, output_tokens: 60 });
    const rows: InvocationCompletedRecord[] = [];
    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding(
          { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
          {
            spawn: fakeSpawn([{ kind: "settle", code: 1, stdout: firstUsage, stderr: "You've hit your weekly limit" }])
              .spawn,
          },
        ),
        createResolvedAgentBinding(
          { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
          { spawn: fakeSpawn([{ kind: "settle", code: 0, stdout: secondUsage, stderr: "" }]).spawn },
        ),
      ],
      telemetry: {
        ...telemetryForRows(rows),
        invocationIds: ["inv-1", "inv-2"],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.usage.input_tokens).toBe(5);
    expect(rows[1]?.usage.input_tokens).toBe(50);

    const stderrOnlyUsage = fakeSpawn([{ kind: "settle", code: 1, stdout: "", stderr: `${cursorStream}\nboom` }]);
    const stderrOnlyResult = await createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, {
      spawn: stderrOnlyUsage.spawn,
    }).invoke({ prompt: "p", cwd: "/repo" });
    expect(stderrOnlyResult).toEqual({
      kind: "error",
      exitCode: 1,
      stderr: `${cursorStream}\nboom`,
    });

    const missingCounters = fakeSpawn([{ kind: "settle", code: 1, stderr: "boom" }]);
    const missingResult = await createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, {
      spawn: missingCounters.spawn,
    }).invoke({ prompt: "p", cwd: "/repo" });
    expect(missingResult).toEqual({ kind: "error", exitCode: 1, stderr: "boom" });

    const spawnFailure = fakeSpawn([{ kind: "throw", error: new Error("ENOENT") }]);
    const spawnFailureResult = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: spawnFailure.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(spawnFailureResult).toEqual({ kind: "error", exitCode: -1, stderr: "Error: ENOENT" });

    const warningStream = '{"type":"system"}\n';
    const warningFake = fakeSpawn([{ kind: "settle", code: 1, stdout: warningStream, stderr: "err" }]);
    const warningResult = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: warningFake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(warningResult).toMatchObject({
      kind: "error",
      exitCode: 1,
      warnings: ["no terminal result event found"],
    });

    const modelConfigStream = claudeUsageResultLine({ input_tokens: 8, output_tokens: 9 });
    const modelConfig = fakeSpawn([
      { kind: "settle", code: 1, stdout: modelConfigStream, stderr: "unknown model: nope" },
    ]);
    const modelConfigResult = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: modelConfig.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(modelConfigResult).toMatchObject({
      kind: "model_config",
      usage: { input_tokens: 8, output_tokens: 9 },
      usage_source: "agent",
    });
  });

  test("codex session recovery on non-ok settlement", async () => {
    const pricedUsage = {
      input_tokens: 24372,
      output_tokens: 282,
      cache_read_input_tokens: 11008,
      cache_creation_input_tokens: null,
    };
    const rolloutLines = [codexUserMessageLine(), codexTokenCountLine({ input: 35380, cached: 11008, output: 282 })];
    const codexBinding = { agentId: "codex" as const, adapterModel: "gpt-5.4", priceKey: "gpt-5.4" };

    const quotaSessions = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const quotaFake = spawnWritingCodexRollout(quotaSessions, rolloutLines, [
      { kind: "settle", code: 1, stderr: "You've reached your usage limit" },
    ]);
    const quotaResult = await createResolvedAgentBinding(
      codexBinding,
      codexBindingOpts(quotaSessions, quotaFake.spawn),
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(quotaResult).toMatchObject({
      kind: "quota",
      stderr: "You've reached your usage limit",
      usage: pricedUsage,
      usage_source: "agent",
      cost_source: "computed",
    });

    const errorSessions = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const errorFake = spawnWritingCodexRollout(errorSessions, rolloutLines, [
      { kind: "settle", code: 2, stderr: "boom" },
    ]);
    const errorResult = await createResolvedAgentBinding(
      codexBinding,
      codexBindingOpts(errorSessions, errorFake.spawn),
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(errorResult).toMatchObject({
      kind: "error",
      exitCode: 2,
      stderr: "boom",
      usage: pricedUsage,
      usage_source: "agent",
    });

    const modelConfigSessions = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const modelConfigFake = spawnWritingCodexRollout(modelConfigSessions, rolloutLines, [
      { kind: "settle", code: 1, stderr: "unknown model: nope" },
    ]);
    const modelConfigResult = await createResolvedAgentBinding(
      codexBinding,
      codexBindingOpts(modelConfigSessions, modelConfigFake.spawn),
    ).invoke({ prompt: "p", cwd: "/repo" });
    expect(modelConfigResult).toMatchObject({
      kind: "model_config",
      stderr: "unknown model: nope",
      usage: pricedUsage,
      usage_source: "agent",
    });

    const stallUsage = {
      input_tokens: 12000,
      output_tokens: 100,
      cache_read_input_tokens: 8000,
      cache_creation_input_tokens: null,
    };
    const stallRollout = [codexUserMessageLine(), codexTokenCountLine({ input: 20000, cached: 8000, output: 100 })];
    const stallSessions = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const stallWriter = spawnWritingCodexRollout(stallSessions, stallRollout, [{ kind: "hang" }]);
    let stallFireIdle: (() => void) | undefined;
    const stallBinding = createResolvedAgentBinding(codexBinding, {
      ...codexBindingOpts(stallSessions, stallWriter.spawn),
      setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
        stallFireIdle = callback;
        return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: (() => {}) as typeof clearTimeout,
    });
    const stallRun = stallBinding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 50 });
    await new Promise((resolve) => setImmediate(resolve));
    stallFireIdle?.();
    const stallResult = await stallRun;
    expect(stallResult).toMatchObject({ kind: "stall", usage: stallUsage, usage_source: "agent" });

    const idleStallSessions = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    const idleStallWriter = spawnWritingCodexRollout(idleStallSessions, stallRollout, [{ kind: "hang" }]);
    let idleFireIdle: (() => void) | undefined;
    const idleStallBinding = createResolvedAgentBinding(codexBinding, {
      ...codexBindingOpts(idleStallSessions, idleStallWriter.spawn),
      setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
        idleFireIdle = callback;
        return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: (() => {}) as typeof clearTimeout,
    });
    let idleStallSettled = false;
    const idleStallRun = idleStallBinding
      .invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 50, joinProcessOnIdleStall: true })
      .finally(() => {
        idleStallSettled = true;
      });
    idleStallWriter.calls[0]?.child?.stderr.write(STALL_TEST_STDERR);
    idleStallWriter.calls[0]?.child?.stdout.write(STALL_TEST_STDOUT);
    idleFireIdle?.();
    await Promise.resolve();
    expect(idleStallSettled).toBe(false);
    const idleChild = idleStallWriter.calls[0]?.child;
    idleChild?.stdout.end();
    idleChild?.stderr.end();
    idleChild?.emit("close", null);
    const idleStallResult = await idleStallRun;
    expect(idleStallResult).toMatchObject({
      kind: "stall",
      stderr: STALL_TEST_DIAGNOSTICS,
      usage: stallUsage,
      usage_source: "agent",
    });

    const firstRollout = [codexUserMessageLine(), codexTokenCountLine({ input: 5000, cached: 1000, output: 50 })];
    const secondRollout = [codexUserMessageLine(), codexTokenCountLine({ input: 50000, cached: 10000, output: 500 })];
    const fallbackSessions = trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
    let fallbackSpawnIndex = 0;
    const fallbackInner = fakeSpawn([
      { kind: "settle", code: 1, stderr: "You've reached your usage limit" },
      { kind: "settle", code: 0, stdout: "done", stderr: "" },
    ]);
    const fallbackSpawn = (binary: string, argv: readonly string[], opts: SpawnOptions): ChildProcess => {
      mkdirSync(fallbackSessions, { recursive: true });
      const lines = fallbackSpawnIndex === 0 ? firstRollout : secondRollout;
      fallbackSpawnIndex += 1;
      writeFileSync(join(fallbackSessions, "session.jsonl"), `${lines.join("\n")}\n`);
      return fallbackInner.spawn(binary, argv, opts);
    };
    const fallbackRows: InvocationCompletedRecord[] = [];
    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding(codexBinding, codexBindingOpts(fallbackSessions, fallbackSpawn)),
        createResolvedAgentBinding(codexBinding, codexBindingOpts(fallbackSessions, fallbackSpawn)),
      ],
      telemetry: {
        ...telemetryForRows(fallbackRows),
        invocationIds: ["inv-codex-1", "inv-codex-2"],
      },
    });
    expect(fallbackRows).toHaveLength(2);
    expect(fallbackRows[0]?.usage.input_tokens).toBe(4000);
    expect(fallbackRows[1]?.usage.input_tokens).toBe(40000);

    const missingFake = fakeSpawn([{ kind: "settle", code: 2, stderr: "boom" }]);
    const missingResult = await createResolvedAgentBinding(codexBinding, {
      spawn: missingFake.spawn,
      codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")),
    }).invoke({ prompt: "p", cwd: "/repo" });
    expect(missingResult).toMatchObject({
      kind: "error",
      exitCode: 2,
      stderr: "boom",
      ...CODEX_SESSION_MISS_SETTLEMENT,
    });
  });

  test("wired bindings forward output progress notifications from stdout and stderr", async () => {
    const wired = [
      { agentId: "claude", adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" },
      { agentId: "codex", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "Composer 2.5" },
      { agentId: "opencode", adapterModel: "gpt-5", priceKey: "gpt-5" },
    ] as const;

    for (const args of wired) {
      const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "chunk", stderr: "warn" }]);
      let progressCalls = 0;
      const binding = createResolvedAgentBinding(args, { spawn: fake.spawn });

      await binding.invoke({
        prompt: "p",
        cwd: "/repo",
        onOutputProgress: () => {
          progressCalls += 1;
        },
      });

      expect(progressCalls).toBeGreaterThan(0);
    }
  });
});

describe("signalProcessGroupOrLeader", () => {
  const LEADER_PID = 4242;

  function leader() {
    const signals: string[] = [];
    return { pid: LEADER_PID, signals, kill: (signal: NodeJS.Signals) => signals.push(signal) };
  }

  const throwingKill = () => {
    throw new Error("ESRCH");
  };

  test("signals the negated group id and leaves the leader alone when the group signal succeeds", () => {
    const target = leader();
    const groupCalls: { pid: number; signal: string }[] = [];
    signalProcessGroupOrLeader(LEADER_PID, "SIGTERM", target, (pid, signal) => groupCalls.push({ pid, signal }));
    expect(groupCalls).toEqual([{ pid: -LEADER_PID, signal: "SIGTERM" }]);
    expect(target.signals).toEqual([]);
  });

  test("falls back to signalling the leader when its own group signal fails", () => {
    const target = leader();
    signalProcessGroupOrLeader(LEADER_PID, "SIGKILL", target, throwingKill);
    expect(target.signals).toEqual(["SIGKILL"]);
  });

  test("does not signal the leader when a descendant group signal fails", () => {
    const target = leader();
    signalProcessGroupOrLeader(LEADER_PID + 1, "SIGTERM", target, throwingKill);
    expect(target.signals).toEqual([]);
  });
});

describe("createRoutingAgentBinding", () => {
  const ROUTING_JSON = '{"action":"run.log","runId":"r1"}';
  const CLAUDE_ROUTING = { agentId: "claude", adapterModel: "haiku", priceKey: "haiku" };
  const CODEX_ROUTING = { agentId: "codex", adapterModel: "gpt-cheap", priceKey: "gpt-cheap" };

  function claudeStream(frames: Record<string, unknown>[], result: string): string {
    return [...frames, { type: "result", subtype: "success", is_error: false, result }]
      .map((frame) => JSON.stringify(frame))
      .join("\n");
  }

  function codexStream(items: Record<string, unknown>[]): string {
    return [
      ...items.map((item) => ({ type: "item.completed", item })),
      { type: "turn.completed", usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 5 } },
    ]
      .map((frame) => JSON.stringify(frame))
      .join("\n");
  }

  function assistantToolUse(name: string) {
    return { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name, input: {} }] } };
  }

  test("claude argv disables every tool, settings MCP, and prompts; grants no read dir", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: claudeStream([], ROUTING_JSON) }]);
    const result = await createRoutingAgentBinding(CLAUDE_ROUTING, { spawn: fake.spawn }).invoke({
      prompt: "route me",
      cwd: "/repo",
      additionalReadDirs: ["/elsewhere"],
    });

    const call = fake.calls[0];
    expect(call?.binary).toBe("claude");
    const argv = [...(call?.argv ?? [])];
    expect(argv.slice(0, 4)).toEqual(["-p", "--tools", "", "--restricted"]);
    expect(argv).toContain("--strict-mcp-config");
    expect(argv.slice(argv.indexOf("--permission-prompts"), argv.indexOf("--permission-prompts") + 2)).toEqual([
      "--permission-prompts",
      "none",
    ]);
    expect(argv).toContain("haiku");
    expect(argv).not.toContain("--add-dir");
    expect(argv).not.toContain("--permission-mode");
    expect(argv).not.toContain("/elsewhere");
    expect(call?.opts.cwd).toBe("/repo");
    expect(call?.child?.stdinChunks.join("")).toBe("route me");
    expect(result).toMatchObject({ kind: "ok", stdout: ROUTING_JSON });
    expect(routingFailureOf(result)).toBeNull();
  });

  test("codex argv runs read-only with escalation denied and no workspace grant", async () => {
    const fake = fakeSpawn([
      { kind: "settle", code: 0, stdout: codexStream([{ type: "agent_message", text: ROUTING_JSON }]) },
    ]);
    const result = await createRoutingAgentBinding(CODEX_ROUTING, { spawn: fake.spawn }).invoke({
      prompt: "route me",
      cwd: "/repo",
      additionalReadDirs: ["/elsewhere"],
    });

    const call = fake.calls[0];
    expect(call?.binary).toBe("codex");
    const argv = [...(call?.argv ?? [])];
    expect(argv[0]).toBe("exec");
    expect(argv.slice(argv.indexOf("--sandbox"), argv.indexOf("--sandbox") + 2)).toEqual(["--sandbox", "read-only"]);
    expect(argv).toContain('approval_policy="never"');
    expect(argv).toContain("--json");
    expect(argv).not.toContain("--add-dir");
    expect(argv).not.toContain("workspace-write");
    expect(argv).not.toContain("danger-full-access");
    expect(call?.child?.stdinChunks.join("")).toBe("route me");
    expect(result).toMatchObject({
      kind: "ok",
      stdout: ROUTING_JSON,
      usage: { input_tokens: 40, output_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: null },
      usage_source: "agent",
    });
  });

  test.each(["cursor", "opencode", "unknown"])("%s is refused by name before any spawn", (agentId) => {
    const fake = fakeSpawn([]);
    let thrown: unknown;
    try {
      createRoutingAgentBinding({ agentId, adapterModel: "m", priceKey: "p" }, { spawn: fake.spawn });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RoutingRefusalError);
    expect((thrown as RoutingRefusalError).agentId).toBe(agentId);
    expect((thrown as Error).message).toContain(`agent '${agentId}' refuses the routing role`);
    expect(fake.calls).toHaveLength(0);
  });

  test("a claude tool call in the transcript is a named failure", async () => {
    const fake = fakeSpawn([
      { kind: "settle", code: 0, stdout: claudeStream([assistantToolUse("Bash")], ROUTING_JSON) },
    ]);
    const result = await createRoutingAgentBinding(CLAUDE_ROUTING, { spawn: fake.spawn }).invoke({
      prompt: "p",
      cwd: "/repo",
    });

    expect(routingFailureOf(result)).toBe("tool_call");
    expect(result).toMatchObject({ kind: "error", exitCode: -1, stderr: expect.stringContaining("'Bash'") });
  });

  test("a codex tool item in the transcript is a named failure", async () => {
    const fake = fakeSpawn([
      {
        kind: "settle",
        code: 0,
        stdout: codexStream([
          { type: "command_execution", command: "cat spec.md" },
          { type: "agent_message", text: ROUTING_JSON },
        ]),
      },
    ]);
    const result = await createRoutingAgentBinding(CODEX_ROUTING, { spawn: fake.spawn }).invoke({
      prompt: "p",
      cwd: "/repo",
    });

    expect(routingFailureOf(result)).toBe("tool_call");
    expect(result).toMatchObject({ stderr: expect.stringContaining("'command_execution'"), usage_source: "agent" });
  });

  test("a codex non-ok result keeps usage and cost from its event stream", async () => {
    const stream = codexStream([{ type: "agent_message", text: "partial" }]);
    const fake = fakeSpawn([{ kind: "settle", code: 2, stdout: stream, stderr: "boom\n" }]);
    const result = await createRoutingAgentBinding(CODEX_ROUTING, { spawn: fake.spawn }).invoke({
      prompt: "p",
      cwd: "/repo",
    });

    expect(result).toMatchObject({
      kind: "error",
      exitCode: 2,
      usage: { input_tokens: 40, output_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: null },
      usage_source: "agent",
    });
    expect(routingFailureOf(result)).toBeNull();
  });

  test("a codex turn.failed event is surfaced as the failure text", async () => {
    const stdout = JSON.stringify({ type: "turn.failed", error: { message: "model overloaded" } });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout }]);
    const result = await createRoutingAgentBinding(CODEX_ROUTING, { spawn: fake.spawn }).invoke({
      prompt: "p",
      cwd: "/repo",
    });

    expect(result).toMatchObject({ kind: "error", stderr: "codex: model overloaded" });
    expect(routingFailureOf(result)).toBeNull();
  });

  test("non-JSON output is a named failure, not a retry", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: claudeStream([], "Sure! Run `jarvis run log r1`.") }]);
    const result = await createRoutingAgentBinding(CLAUDE_ROUTING, { spawn: fake.spawn }).invoke({
      prompt: "p",
      cwd: "/repo",
    });

    expect(routingFailureOf(result)).toBe("malformed_output");
    expect(fake.calls).toHaveLength(1);
  });

  test("a transient-looking failure is not retried", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 1, stderr: "connection reset" }]);
    const result = await createRoutingAgentBinding(CLAUDE_ROUTING, { spawn: fake.spawn }).invoke({
      prompt: "p",
      cwd: "/repo",
    });

    expect(result).toMatchObject({ kind: "error", exitCode: 1 });
    expect(fake.calls).toHaveLength(1);
  });

  test("overrunning the routing clock aborts the child, names the timeout, and keeps partial output", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    const timers: (() => void)[] = [];
    const promise = createRoutingAgentBinding(CLAUDE_ROUTING, {
      spawn: fake.spawn,
      timeoutMs: 1234,
      setTimeout: ((callback: () => void) => {
        timers.push(callback);
        return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: (() => {}) as typeof clearTimeout,
    }).invoke({ prompt: "p", cwd: "/repo" });

    fake.calls[0]?.child?.stdout.write('{"type":"system","subtype":"init"}\n');
    timers[0]?.();
    const result = await settlesWithin(promise);

    expect(routingFailureOf(result)).toBe("timeout");
    expect(result).toMatchObject({
      kind: "error",
      exitCode: -1,
      stderr: "routing: no result within 1234ms",
      diagnostics: '{"type":"system","subtype":"init"}\n',
    });
    expect(fake.calls[0]?.child?.killedWith).toContain("SIGTERM");
  });

  test("a caller abort settles as an ordinary abort, not a routing failure", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    const controller = new AbortController();
    const promise = createRoutingAgentBinding(CLAUDE_ROUTING, { spawn: fake.spawn }).invoke({
      prompt: "p",
      cwd: "/repo",
      signal: controller.signal,
    });

    controller.abort("operator-kill");
    const result = await settlesWithin(promise);

    expect(result).toEqual({ kind: "error", exitCode: -1, stderr: "aborted: operator-kill" });
    expect(routingFailureOf(result)).toBeNull();
  });
});

describe("confinement policy translation", () => {
  // Today's argv per adapter, snapshotted literally so any drift in the default translation fails here.
  const CLAUDE_DEFAULT_ARGV = [
    "-p",
    "--permission-mode",
    "acceptEdits",
    "--model",
    "claude-sonnet-4-6",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
  const CODEX_DEFAULT_ARGV = [
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "-c",
    'approval_policy="on-request"',
    "--model",
    "gpt-5.4",
  ];
  const CURSOR_DEFAULT_ARGV = [
    "agent",
    "-p",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--model",
    "composer-2.5",
    "--force",
    "--workspace",
    "/repo",
  ];
  const CLAUDE = { agentId: "claude", adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" };
  const CODEX = { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" };

  async function argvFor(
    spec: Parameters<typeof createResolvedAgentBinding>[0],
    opts: Parameters<typeof createResolvedAgentBinding>[1],
  ) {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: cursorResultLine("done", true), stderr: "" }]);
    const binding = createResolvedAgentBinding(spec, {
      ...opts,
      spawn: fake.spawn,
      codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")),
    });
    await binding.invoke({ prompt: "p", cwd: "/repo" });
    return {
      argv: fake.calls[0]?.argv,
      mechanism: binding.confinementMechanism,
      stdin: fake.calls[0]?.child?.stdinChunks.join(""),
    };
  }

  test("createResolvedAgentBinding stamps confinementPolicy with confinementMechanism for codex sandbox and claude unrestricted", () => {
    const codexBinding = createResolvedAgentBinding(CODEX, { confinementPolicy: "sandbox" });
    expect(codexBinding.confinementPolicy).toBe("sandbox");
    expect(codexBinding.confinementMechanism).toBe("codex-workspace-write");

    const claudeBinding = createResolvedAgentBinding(CLAUDE, { confinementPolicy: "unrestricted" });
    expect(claudeBinding.confinementPolicy).toBe("unrestricted");
    expect(claudeBinding.confinementMechanism).toBe("none");
  });

  test("default and explicit unrestricted policy yield today's argv for claude, codex, and cursor", async () => {
    for (const opts of [{}, { confinementPolicy: "unrestricted" as const }]) {
      expect(await argvFor(CLAUDE, opts)).toEqual({ argv: CLAUDE_DEFAULT_ARGV, mechanism: "none", stdin: "p" });
      expect(await argvFor(CODEX, opts)).toEqual({
        argv: CODEX_DEFAULT_ARGV,
        mechanism: "none",
        stdin: expect.stringContaining("p\n<!-- jarvis-codex-invocation:"),
      });
      expect(await argvFor(COMPOSER_CURSOR_BINDING, opts)).toEqual({
        argv: CURSOR_DEFAULT_ARGV,
        mechanism: "none",
        stdin: "p",
      });
    }
  });

  test("unrestricted policy keeps composing with codexSandboxMode", async () => {
    const { argv } = await argvFor(CODEX, { codexSandboxMode: "danger-full-access" });
    expect(argv).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "danger-full-access",
      "--model",
      "gpt-5.4",
    ]);
  });

  test("sandbox policy pins codex to --sandbox workspace-write over a looser codexSandboxMode", async () => {
    const translated = await argvFor(CODEX, { confinementPolicy: "sandbox", codexSandboxMode: "danger-full-access" });
    expect(translated).toMatchObject({ argv: CODEX_DEFAULT_ARGV, mechanism: "codex-workspace-write" });
  });

  test("sandbox policy never loosens a configured codex read-only sandbox", async () => {
    const translated = await argvFor(CODEX, { confinementPolicy: "sandbox", codexSandboxMode: "read-only" });
    expect(translated).toMatchObject({
      argv: CODEX_DEFAULT_ARGV.map((flag) => (flag === "workspace-write" ? "read-only" : flag)),
      mechanism: "codex-read-only",
    });
  });

  test("an unwired agent under sandbox stays unwired rather than reporting a confinement refusal", async () => {
    const binding = createResolvedAgentBinding(
      { agentId: "mystery", adapterModel: "m", priceKey: "m" },
      { confinementPolicy: "sandbox" },
    );
    expect(binding.confinementMechanism).toBe("none");
    expect(binding.confinementPolicy).toBe("unrestricted");
    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });
    expect(result.kind).toBe("error");
    expect(result.stderr).toContain("is not wired yet");
  });

  test("sandbox policy refuses claude and cursor by throwing before any spawn", async () => {
    for (const spec of [CLAUDE, COMPOSER_CURSOR_BINDING]) {
      const fake = fakeSpawn([]);
      const binding = createResolvedAgentBinding(spec, { spawn: fake.spawn, confinementPolicy: "sandbox" });
      expect(binding.confinementMechanism).toBe("refused");
      const invocation = binding.invoke({ prompt: "p", cwd: "/repo" });
      await expect(invocation).rejects.toBeInstanceOf(ConfinementRefusalError);
      await expect(invocation).rejects.toMatchObject({
        name: "ConfinementRefusalError",
        vendor: spec.agentId,
        policy: "sandbox",
      });
      expect(fake.calls).toHaveLength(0);
    }
  });

  test("a refusal settles as model_config and advances fallback to the next binding", async () => {
    const fake = fakeSpawn([]);
    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/repo",
      bindings: [
        createResolvedAgentBinding(CLAUDE, { spawn: fake.spawn, confinementPolicy: "sandbox" }),
        { id: "next", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) },
      ],
    });

    expect(fake.calls).toHaveLength(0);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.result).toMatchObject({ kind: "model_config" });
    expect(result.attempts[0]?.result.stderr).toContain("confinement refusal: agent 'claude'");
    expect(result.attempts[0]?.result.stderr).toContain("confinementPolicy 'sandbox'");
    expect(result.final?.binding.id).toBe("next");
  });
});

describe("confinement fields on non-spawning bindings", () => {
  test("an unwired agent binding and a routing binding both carry confinement fields for telemetry", () => {
    const unwired = createResolvedAgentBinding({ agentId: "claud", adapterModel: "m", priceKey: "m" });
    expect(unwired.confinementPolicy).toBe("unrestricted");
    expect(unwired.confinementMechanism).toBe("none");
    const routing = createRoutingAgentBinding({ agentId: "claude", adapterModel: "m", priceKey: "m" });
    expect(routing.confinementPolicy).toBe("unrestricted");
    expect(routing.confinementMechanism).toBe("none");
  });
});
