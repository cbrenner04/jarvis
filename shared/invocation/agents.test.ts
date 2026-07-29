import { describe, expect, test } from "bun:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createResolvedAgentBinding } from "./agents.ts";
import { executeWithQuotaFallback, type InvocationCompletedRecord } from "./execute.ts";

type FakeOutcome =
  | { kind: "settle"; code: number; stdout?: string; stderr?: string }
  | { kind: "hang" }
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
    ]);
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

  test("idle output expiry kills a silent child and settles stall", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    let expiry: (() => void) | undefined;
    const binding = createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      {
        spawn: fake.spawn,
        setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
          expiry = callback;
          return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout,
        clearTimeout: (() => {}) as typeof clearTimeout,
      },
    );

    const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 });
    expiry?.();

    await expect(promise).resolves.toEqual({ kind: "stall", stderr: "" });
    expect(fake.calls[0]?.child?.killedWith).toContain("SIGTERM");
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
      telemetry: {
        sink: {
          append(record) {
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
      },
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

  test("codex binding classifies quota (ASCII and U+2019), model config, and generic errors", async () => {
    const quota = fakeSpawn([{ kind: "settle", code: 1, stderr: "You've reached your usage limit" }]);
    const hitLimit = fakeSpawn([{ kind: "settle", code: 1, stderr: "you’ve hit your usage limit" }]);
    const reachedLimit = fakeSpawn([{ kind: "settle", code: 1, stderr: "you’ve reached your usage limit" }]);
    const authQuota = fakeSpawn([{ kind: "settle", code: 1, stderr: "please log out and sign in" }]);
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
      telemetry: {
        sink: {
          append(record) {
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
      },
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

    expect(result).toEqual({ kind: "ok", stdout: "done", stderr: "" });
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
    ).resolves.toEqual({ kind: "ok", stdout: "completed successfully", stderr: "" });
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
      telemetry: {
        sink: {
          append(record) {
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
      },
    });

    expect(rows[0]?.agent).toBe("cursor");
    expect(rows[0]?.model).toBe("GPT-5.4");
    expect(rows[0]?.binding_id).toBe("cursor/GPT-5.4/priced-cursor");
  });

  test("cursor binding unwraps stream-json result event text as stdout", async () => {
    const streamJson = JSON.stringify({ type: "result", result: "implementation complete\n" });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: streamJson, stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "composer" },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({ kind: "ok", stdout: "implementation complete", stderr: "" });
  });

  test("cursor binding concatenates text-delta frames when no terminal result event", async () => {
    const frames = [
      JSON.stringify({ type: "text_delta", text: "part " }),
      JSON.stringify({ type: "text_delta", text: "one\n" }),
    ].join("\n");
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: frames, stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "composer" },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({ kind: "ok", stdout: "part one", stderr: "" });
  });

  test("cursor binding falls back to verbatim stdout when unparseable", async () => {
    const unparseable = "not json at all\nand more text\n";
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: unparseable, stderr: "" }]);
    const binding = createResolvedAgentBinding(
      { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "composer" },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({ kind: "ok", stdout: unparseable, stderr: "" });
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
    const binding = createResolvedAgentBinding(
      { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "composer" },
      {
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
      },
    );

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
    expect(fake.calls[0]?.child?.killedWith).toContain("SIGTERM");
  });

  test("cursor binding classifies quota phrases in stream-json frames", async () => {
    const frameWithQuota = JSON.stringify({ type: "text_delta", text: "you've hit your usage limit" });
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: frameWithQuota, stderr: "" }]);

    const result = await createResolvedAgentBinding(
      { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "composer" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result.kind).toBe("quota");
  });

  test("cursor binding passes non-ok results through unnormalized", async () => {
    const fake = fakeSpawn([{ kind: "settle", code: 1, stderr: "boom" }]);

    const result = await createResolvedAgentBinding(
      { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "composer" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result).toEqual({ kind: "error", exitCode: 1, stderr: "boom" });
  });

  test("cursor binding still stalls on output-silent invocation past idleOutputMs", async () => {
    const fake = fakeSpawn([{ kind: "hang" }]);
    let expiry: (() => void) | undefined;
    const binding = createResolvedAgentBinding(
      { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "composer" },
      {
        spawn: fake.spawn,
        setTimeout: ((callback: Parameters<typeof setTimeout>[0]) => {
          expiry = callback;
          return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout,
        clearTimeout: (() => {}) as typeof clearTimeout,
      },
    );

    const promise = binding.invoke({ prompt: "p", cwd: "/repo", idleOutputMs: 100 });
    expiry?.();

    await expect(promise).resolves.toEqual({ kind: "stall", stderr: "" });
    expect(fake.calls[0]?.child?.killedWith).toContain("SIGTERM");
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
    expect(fake.calls[0]?.argv).toEqual(["run", "--dir", "/repo", "--model", "gpt-5", "--format", "json", "implement it"]);
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
  test("wired bindings forward output progress notifications from stdout and stderr", async () => {
    const wired = [
      { agentId: "claude", adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" },
      { agentId: "codex", adapterModel: "gpt-5", priceKey: "gpt-5" },
      { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "Composer 2.5" },
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
