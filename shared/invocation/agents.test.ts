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
    const fake = fakeSpawn([{ kind: "settle", code: 0, stdout: '{"result":"done"}\n', stderr: "warn" }]);
    const binding = createResolvedAgentBinding(
      {
        agentId: "claude",
        adapterModel: "claude-sonnet-4-6",
        priceKey: "claude-sonnet-4-6",
      },
      { spawn: fake.spawn },
    );

    const result = await binding.invoke({ prompt: "implement it", cwd: "/repo" });

    expect(result).toEqual({ kind: "ok", stdout: '{"result":"done"}\n', stderr: "warn" });
    expect(fake.calls[0]?.binary).toBe("claude");
    expect(fake.calls[0]?.argv).toEqual([
      "-p",
      "--permission-mode",
      "acceptEdits",
      "--model",
      "claude-sonnet-4-6",
      "--output-format",
      "json",
    ]);
    expect(fake.calls[0]?.opts.cwd).toBe("/repo");
    expect(fake.calls[0]?.opts.detached).toBe(true);
    expect(fake.calls[0]?.opts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(fake.calls[0]?.child?.stdinChunks.join("")).toBe("implement it");
  });

  test("claude binding classifies quota, model config, and generic errors", async () => {
    const quota = fakeSpawn([{ kind: "settle", code: 1, stderr: "You've hit your weekly limit" }]);
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
        stdout: JSON.stringify({ is_error: true, api_error_status: 429, result: "quota exceeded" }),
      },
    ]);

    const result = await createResolvedAgentBinding(
      { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
      { spawn: fake.spawn },
    ).invoke({ prompt: "p", cwd: "/repo" });

    expect(result.kind).toBe("quota");
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

  test("codex binding classifies quota, model config, and generic errors", async () => {
    const quota = fakeSpawn([{ kind: "settle", code: 1, stderr: "You've reached your usage limit" }]);
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

  test("unrecognized resolved agents keep unwired terminal error metadata", async () => {
    const binding = createResolvedAgentBinding({
      agentId: "cursor",
      adapterModel: "gpt-5",
      priceKey: "gpt-5",
    });

    await expect(binding.invoke({ prompt: "p", cwd: "/repo" })).resolves.toEqual({
      kind: "error",
      exitCode: 127,
      stderr: "agent 'cursor' model 'gpt-5' price 'gpt-5' invocation is not wired yet",
    });
    expect(binding.id).toBe("cursor/gpt-5/gpt-5");
    expect(binding.metadata).toEqual({ agent: "cursor", model: "gpt-5" });
  });
});
