import { describe, expect, test } from "bun:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { computeCost } from "../prices/cost.ts";
import { loadPrices } from "../prices/load.ts";
import { createResolvedAgentBinding, isIgnoredWorktreeActivityPath } from "./agents.ts";
import { parseCursorJsonOutput } from "./cursor-json.ts";
import { executeWithQuotaFallback, type InvocationCompletedRecord } from "./execute.ts";

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
    // @mutate shared/invocation/agents.ts "--include-partial-messages" -> ""
    expect(fake.calls[0]?.opts.cwd).toBe("/repo");
    expect(fake.calls[0]?.opts.detached).toBe(true);
    expect(fake.calls[0]?.opts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(fake.calls[0]?.child?.stdinChunks.join("")).toBe("implement it");
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
    const result = await promise;

    expect(result).toEqual({ kind: "error", exitCode: -1, stderr: "aborted: idle-timeout" });
    expect(fake.calls[0]?.child?.killedWith).toContain("SIGTERM");
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
        codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")),
        randomUUID: () => "marker-id",
      },
    ).invoke({ prompt: "implement it", cwd: "/repo", signal: controller.signal });

    controller.abort("operator");
    const result = await promise;

    expect(result).toEqual({ kind: "error", exitCode: -1, stderr: "aborted: operator" });
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

  test("Codex sandbox argv retains approval policy only when sandboxed", async () => {
    // @mutate shared/invocation/agents.ts "args.sandboxMode !== \"danger-full-access\"" -> "args.sandboxMode === \"danger-full-access\""
    const fake = fakeSpawn([
      { kind: "settle", code: 1, stderr: "stop" },
      { kind: "settle", code: 1, stderr: "stop" },
    ]);
    const sessionsDir = mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));

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
        { spawn: quota.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "You've reached your usage limit" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: hitLimit.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "you’ve hit your usage limit" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: reachedLimit.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "you’ve reached your usage limit" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: authQuota.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "please log out and sign in", authFailure: true });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: trustedDir.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: CODEX_TRUSTED_DIRECTORY_REFUSAL, authFailure: true });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "bad", priceKey: "bad" },
        { spawn: model.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "model_config", stderr: "unknown model: nope" });
    await expect(
      createResolvedAgentBinding(
        { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
        { spawn: generic.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "error", exitCode: 2, stderr: "boom" });
  });

  test("codex trusted-directory refusal advances fallback", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
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
      { spawn: fake.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({
      kind: "quota",
      stderr: `${stderr}${stdout}`,
      authFailure: true,
    });
  });

  test("codex zero-exit auth phrase in stdout only settles ok", async () => {
    const stdout = "please log out and sign in to continue";
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout, stderr: "" }]);

    const result = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toMatchObject({ kind: "ok", stdout, stderr: "" });
  });

  test("codex zero-exit productive stdout with auth stderr settles quota", async () => {
    const stdout = "completed implementation\n";
    const stderr = "please log out and sign in again";
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout, stderr }]);

    const result = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({
      kind: "quota",
      stderr: `${stderr}${stdout}`,
      authFailure: true,
    });
  });

  test("codex zero-exit credential-auth advances fallback order", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
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
        { spawn: quotaZeroExit.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "You've hit your usage limit" });

    const result2 = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: normalZeroExit.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result2).toMatchObject({ kind: "ok", stdout: "completed successfully", stderr: "" });

    const result3 = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: blockerZeroExit.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
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
      { spawn: fake.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({ kind: "error", exitCode: -1, stderr: "Error: ENOENT" });
  });

  test("codex session usage unavailable remains ok with warning metadata", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: "done", stderr: "warn" }]);

    const result = await createResolvedAgentBinding(
      { agentId: "codex", adapterModel: "gpt-5.4", priceKey: "gpt-5.4" },
      { spawn: fake.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
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
    const sessionsDir = mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
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
    // @mutate shared/invocation/agents.ts "return finalizeCodexInvocationResult(result, resolved.sessionFile, args.priceKey);" -> "return result;"

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
    // @mutate shared/invocation/agents.ts "Math.max(0, input - cachedInput)" -> "input"
  });

  test("codex binding with matched rollout whose token_count info is all null keeps unavailable no-usage", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
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
    // @mutate shared/invocation/agents.ts "if (selected === \"all-info-null\") {" -> "if (false) {"
  });

  test("codex binding uses last non-null token_count event, not max total", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
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
    const sessionsDir = mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
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
    const sessionsDir = mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-"));
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
          { spawn: fake.spawn, codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-codex-sessions-")) },
        ),
      ],
      telemetry: telemetryForRows(rows),
    });

    expect(rows[0]?.agent).toBe("codex");
    expect(rows[0]?.model).toBe("gpt-5.4");
    expect(rows[0]?.binding_id).toBe("codex/gpt-5.4/priced-codex");
  });

  test("cursor binding invokes the CLI shape with mapped model, cwd, ignored stdin, and abort signal", async () => {
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
    const result = await promise;

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
      "implement it",
    ]);
    expect(fake.calls[0]?.opts.cwd).toBe("/repo");
    expect(fake.calls[0]?.opts.detached).toBe(true);
    expect(fake.calls[0]?.opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(fake.calls[0]?.child?.stdinChunks.join("")).toBe("");
    expect(fake.calls[0]?.child?.killedWith).toContain("SIGTERM");
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
    const quotaZeroExit = fakeSpawn([
      { kind: "settle", code: 0, stdout: "monthly cursor usage limit reached", stderr: "" },
    ]);
    const normalZeroExit = fakeSpawn([{ kind: "settle", code: 0, stdout: "completed successfully", stderr: "" }]);

    await expect(
      createResolvedAgentBinding(
        { agentId: "cursor", adapterModel: "GPT-5.4", priceKey: "GPT-5.4" },
        { spawn: quotaZeroExit.spawn },
      ).invoke({ prompt: "p", cwd: "/repo" }),
    ).resolves.toEqual({ kind: "quota", stderr: "monthly cursor usage limit reached" });

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
    const frameWithQuota = JSON.stringify({ type: "text_delta", text: "you've hit your usage limit" });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: frameWithQuota, stderr: "" }]);

    const result = await createResolvedAgentBinding(COMPOSER_CURSOR_BINDING, { spawn: fake.spawn }).invoke({
      prompt: "p",
      cwd: "/repo",
    });

    expect(result.kind).toBe("quota");
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
