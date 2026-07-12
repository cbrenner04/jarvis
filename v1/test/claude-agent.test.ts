import { describe, expect, test } from "bun:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable, Writable } from "node:stream";
import { ClaudeAgent } from "../src/agents/claude.ts";
import { createFakeSpawnWithOutput } from "./agents/fake-spawn.ts";

const fixturesDir = join(import.meta.dir, "fixtures", "claude");

const STREAM_JSON_ARGV = ["--output-format", "stream-json", "--verbose"] as const;

class StreamingFakeChildProcess extends EventEmitter implements ChildProcess {
  readonly pid = 12345;
  readonly killed = false;
  readonly exitCode: number | null = null;
  readonly signalDescription: string | null = null;
  readonly spawnargs: string[] = [];
  readonly spawnfile = "";
  readonly connected = false;
  readonly signalCode: NodeJS.Signals | null = null;

  stdin: Writable | null;
  stdout: PassThrough;
  stderr: PassThrough;
  stdio: [
    Writable | null,
    PassThrough,
    PassThrough,
    Writable | Readable | null | undefined,
    Writable | Readable | null | undefined,
  ];

  constructor(chunks: readonly string[], exitCode: number) {
    super();
    this.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdio = [this.stdin, this.stdout, this.stderr, null, null];

    let index = 0;
    const emitChunk = () => {
      const chunk = chunks[index];
      if (chunk === undefined) {
        this.stdout.end();
        this.stderr.end();
        setImmediate(() => {
          this.emit("exit", exitCode);
          this.emit("close", exitCode);
        });
        return;
      }
      index += 1;
      this.stdout.write(chunk);
      setImmediate(emitChunk);
    };
    setImmediate(emitChunk);
  }

  kill(_signal?: NodeJS.Signals | number): boolean {
    return true;
  }

  send(
    _message: unknown,
    _sendHandle?: unknown,
    _options?: unknown,
    _callback?: (error: Error | null) => void,
  ): boolean {
    return false;
  }

  disconnect(): void {}

  unref(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  [Symbol.dispose](): void {}
}

function createStreamingFakeSpawn(chunks: readonly string[], exitCode = 0) {
  return (binary: string, argv: readonly string[], opts: SpawnOptions): ChildProcess => {
    void binary;
    void argv;
    void opts;
    return new StreamingFakeChildProcess(chunks, exitCode);
  };
}

describe("ClaudeAgent", () => {
  test("constructs with a configured model", () => {
    const agent = new ClaudeAgent({ model: "haiku" });
    expect(agent).toBeTruthy();
  });

  test("attribution label includes model", () => {
    const agent = new ClaudeAgent({ model: "claude-opus-4-8" });
    const label = agent.attributionLabel();
    expect(label).toContain("Claude Opus 4.8");
  });

  test("attribution label works with default model", () => {
    const agent = new ClaudeAgent();
    const label = agent.attributionLabel();
    expect(label).toContain("claude");
    expect(label).toContain("default model");
  });

  test("spawns stream-json with verbose", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      claude: {
        exit: 0,
        stdout: readFileSync(join(fixturesDir, "2.1.142-simple-prose-stream.ndjson"), "utf8"),
        stderr: "",
      },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    await agent.run("the prompt", { cwd });

    expect(recorder.only().argv).toEqual(["-p", "--permission-mode", "acceptEdits", ...STREAM_JSON_ARGV]);
  });

  test("parses streamed transcript into final text, usage, and cost", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const stdout = readFileSync(join(fixturesDir, "2.1.142-simple-prose-stream.ndjson"), "utf8");
    const agent = new ClaudeAgent({
      spawn: createStreamingFakeSpawn(stdout.split(/(?<=\n)/)),
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({
      kind: "ok",
      stdout: "hello",
      stderr: "",
      usage: {
        input_tokens: 6,
        output_tokens: 6,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 27349,
      },
      cost_usd: 0.17160725,
      cost_source: "agent",
    });
  });

  test("classifies streamed quota envelope", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const stdout = readFileSync(join(fixturesDir, "2.1.142-monthly-spend-limit-stream.ndjson"), "utf8");
    const agent = new ClaudeAgent({
      spawn: createStreamingFakeSpawn(stdout.split(/(?<=\n)/)),
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr: stdout });
  });

  test("streamed stdout advances lastOutputAtMs on each chunk", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const stdout = readFileSync(join(fixturesDir, "2.1.142-simple-prose-stream.ndjson"), "utf8");
    const lastOutputAtMs = { current: null as number | null };
    const outputTimestamps: number[] = [];
    let clock = 1000;
    const agent = new ClaudeAgent({
      spawn: createStreamingFakeSpawn(stdout.split(/(?<=\n)/)),
    });

    await agent.run("p", {
      cwd,
      lastOutputAtMs,
      lastOutputNowMs: () => {
        clock += 100;
        outputTimestamps.push(clock);
        return clock;
      },
    });

    expect(outputTimestamps.length).toBeGreaterThan(1);
    expect(lastOutputAtMs.current).toBe(outputTimestamps.at(-1) ?? null);
  });
});
