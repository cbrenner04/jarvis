import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpencodeAgent, parseOpencodeJsonStream } from "../../src/agents/opencode.ts";

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-opencode-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-opencode-cwd-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function fakeBinary(opts: { exit: number; stdout?: string; stderr?: string }): string {
  const path = join(dir, "opencode");
  const stdoutFile = join(dir, "stdout.txt");
  const stderrFile = join(dir, "stderr.txt");
  writeFileSync(stdoutFile, opts.stdout ?? "");
  writeFileSync(stderrFile, opts.stderr ?? "");
  const script = `#!/usr/bin/env bash
# Record argv (NUL-separated) and cwd so the test can inspect them.
: > "${dir}/argv"
for a in "$@"; do printf '%s\\0' "$a" >> "${dir}/argv"; done
pwd > "${dir}/cwd"
cat "${stdoutFile}"
cat "${stderrFile}" 1>&2
exit ${opts.exit}
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("OpencodeAgent", () => {
  test("name is 'opencode'", () => {
    expect(String(new OpencodeAgent({ model: "AirProxy/test" }).name)).toBe("opencode");
  });

  test("spawns `opencode run` with --dir, model, format, and prompt positional in cwd", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "hi-out", stderr: "hi-err" });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("the prompt", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("hi-out");
      expect(result.stderr).toBe("hi-err");
      expect(result.usage_source).toBe("estimated");
      expect(result.usage).toBeDefined();
      expect(result.usage?.input_tokens).toBeGreaterThan(0);
      expect(result.usage?.output_tokens).toBeGreaterThan(0);
      expect(result.usage?.cache_read_input_tokens).toBe(0);
      expect(result.usage?.cache_creation_input_tokens).toBe(0);
    }
    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--dir");
    expect(argv).toContain(cwd);
    expect(argv).toContain("--model");
    expect(argv).toContain("AirProxy/test");
    expect(argv).toContain("--format");
    expect(argv).toContain("json");
    expect(argv).not.toContain("default");
    expect(argv).toContain("the prompt");
    const reportedCwd = readFileSync(join(dir, "cwd"), "utf8").trim();
    const resolvedReportedCwd = realpathSync(reportedCwd);
    const resolvedCwd = realpathSync(cwd);
    expect(resolvedReportedCwd).toBe(resolvedCwd);
  });

  test("does not pass a permissions bypass flag", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    await agent.run("the prompt", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(argv).toContain("--dir");
  });

  test("non-zero exit maps to error with captured diagnostics", async () => {
    const bin = fakeBinary({ exit: 2, stdout: "out", stderr: "err" });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "errout" });
  });

  test("quota signal maps to quota", async () => {
    const stderr = "error: rate limit reached";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr });
  });

  test("successful output with quota text stays ok", async () => {
    const stdout = "rate limit reached is example text";
    const bin = fakeBinary({ exit: 0, stdout });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe(stdout);
      expect(result.stderr).toBe("");
      expect(result.usage_source).toBe("estimated");
      expect(result.usage).toBeDefined();
      expect(result.usage?.input_tokens).toBeGreaterThan(0);
      expect(result.usage?.output_tokens).toBeGreaterThan(0);
      expect(result.usage?.cache_read_input_tokens).toBe(0);
      expect(result.usage?.cache_creation_input_tokens).toBe(0);
    }
  });

  test("successful invocations estimate usage from prompt + stdout", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "ok" });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("estimated");
      expect(result.cost_source).toBeUndefined();
      expect(result.usage).toBeDefined();
      expect(result.usage?.input_tokens).toBeGreaterThan(0);
      expect(result.usage?.output_tokens).toBeGreaterThan(0);
      expect(result.usage?.cache_read_input_tokens).toBe(0);
      expect(result.usage?.cache_creation_input_tokens).toBe(0);
    }
  });

  test("estimator failure falls back to unavailable usage with one warning", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "ok" });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
      estimateUsage: () => null,
    });

    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("unavailable");
      expect(result.cost_source).toBe("no-usage");
      expect(result.warnings).toEqual(["opencode: token estimator unavailable; usage recorded as unavailable."]);
    }
  });

  test("unsupported model signal maps to model_config", async () => {
    const stderr = "error: model not found";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("missing binary surfaces as error result, not a thrown exception", async () => {
    const agent = new OpencodeAgent({
      binary: join(dir, "does-not-exist"),
      model: "AirProxy/test",
    });
    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("error");
  });

  test("attributionLabel returns raw string for model ID", () => {
    const agent = new OpencodeAgent({
      binary: "fake",
      model: "AirProxy/test",
    });
    expect(agent.attributionLabel()).toBe("AirProxy/test");
  });

  test("accepts additionalReadDirs without breaking --dir", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    await agent.run("p", {
      cwd,
      additionalReadDirs: ["/abs/specs/foo", "/abs/specs/bar"],
    });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--dir");
    expect(argv).toContain(cwd);
    expect(argv).not.toContain("--dangerously-skip-permissions");
  });

  test("uses --format json instead of --format default", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "ok" });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    await agent.run("p", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--format");
    expect(argv).toContain("json");
    expect(argv).not.toContain("default");
  });

  test("parses step_finish events with non-zero tokens and cost", async () => {
    const jsonStream = [
      '{"type":"step_start","timestamp":"2026-05-21T19:02:15Z","sessionID":"ses_123"}',
      '{"type":"text","timestamp":"2026-05-21T19:02:15Z","part":{"text":"Hello world"}}',
      '{"type":"step_finish","timestamp":"2026-05-21T19:02:17Z","part":{"tokens":{"total":100,"input":10,"output":20,"reasoning":0,"cache":{"write":70,"read":0}},"cost":0.05}}',
      '{"type":"step_finish","timestamp":"2026-05-21T19:02:18Z","part":{"tokens":{"total":200,"input":30,"output":40,"reasoning":0,"cache":{"write":130,"read":0}},"cost":0.10}}',
    ].join("\n");

    const bin = fakeBinary({ exit: 0, stdout: jsonStream });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("agent");
      expect(result.cost_source).toBe("agent");
      expect(result.usage?.input_tokens).toBe(40);
      expect(result.usage?.output_tokens).toBe(60);
      expect(result.usage?.cache_read_input_tokens).toBe(0);
      expect(result.usage?.cache_creation_input_tokens).toBe(200);
      expect(result.cost_usd).toBeCloseTo(0.15);
      expect(result.stdout).toBe("Hello world");
    }
  });

  test("handles cost: 0 (github-copilot path)", async () => {
    const jsonStream =
      '{"type":"step_finish","part":{"tokens":{"total":100,"input":10,"output":20,"reasoning":0,"cache":{"write":70,"read":0}},"cost":0}}';

    const bin = fakeBinary({ exit: 0, stdout: jsonStream });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "github-copilot/claude-haiku-4.5",
    });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("agent");
      expect(result.cost_source).toBe("agent");
      expect(result.cost_usd).toBe(0);
    }
  });

  test("no step_finish events falls back to token estimation with warning", async () => {
    const jsonStream = ['{"type":"step_start"}', '{"type":"text","part":{"text":"Some output"}}'].join("\n");

    const bin = fakeBinary({ exit: 0, stdout: jsonStream });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("estimated");
      expect(result.cost_source).toBeUndefined();
      expect(result.cost_usd).toBeUndefined();
      expect(result.warnings).toContain(
        "opencode: no step_finish events in --format json stream; falling back to token estimation.",
      );
      expect(result.stdout).toBe("Some output");
    }
  });

  test("estimator unavailable returns unavailable usage with warning", async () => {
    const jsonStream = `{"type":"text","timestamp":"2026-05-21T19:02:15Z","part":{"text":"output"}}`;

    const bin = fakeBinary({ exit: 0, stdout: jsonStream });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
      estimateUsage: () => null,
    });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("unavailable");
      expect(result.cost_source).toBe("no-usage");
      expect(result.warnings).toContain("opencode: token estimator unavailable; usage recorded as unavailable.");
    }
  });

  test("mixed JSON and non-JSON lines renders correctly", async () => {
    const jsonStream = [
      "banner text line",
      '{"type":"text","part":{"text":"Hello "}}',
      "another banner",
      '{"type":"text","part":{"text":"world"}}',
      '{"type":"step_finish","part":{"tokens":{"total":100,"input":10,"output":20,"reasoning":0,"cache":{"write":70,"read":0}},"cost":0}}',
    ].join("\n");

    const bin = fakeBinary({ exit: 0, stdout: jsonStream });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      // Non-JSON lines and text parts should be in rendered output
      expect(result.stdout).toContain("banner text line");
      expect(result.stdout).toContain("another banner");
      expect(result.stdout).toContain("Hello ");
      expect(result.stdout).toContain("world");
      // Raw JSON event lines should not appear verbatim (they're parsed and consumed)
      expect(result.stdout).not.toContain('"type":"step_finish"');
    }
  });

  test("malformed step_finish is skipped but clean ones are accumulated", async () => {
    const jsonStream = [
      '{"type":"step_finish","part":{"tokens":{"total":100,"input":10,"output":20,"reasoning":0,"cache":{"write":70,"read":0}},"cost":0.05}}',
      '{"type":"step_finish","part":{"tokens":{"input":5,"output":10}}}',
      '{"type":"step_finish","part":{"tokens":{"total":50,"input":5,"output":10,"reasoning":0,"cache":{"write":35,"read":0}},"cost":0.02}}',
    ].join("\n");

    const bin = fakeBinary({ exit: 0, stdout: jsonStream });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("agent");
      // Should accumulate only the clean step_finish events (1st and 3rd)
      expect(result.usage?.input_tokens).toBe(15); // 10 + 5
      expect(result.usage?.output_tokens).toBe(30); // 20 + 10
      expect(result.cost_usd).toBeCloseTo(0.07); // 0.05 + 0.02
    }
  });

  test("all malformed step_finish events falls back to estimator", async () => {
    const jsonStream = `{"type":"step_finish","timestamp":"2026-05-21T19:02:17Z","part":{"type":"step-finish","tokens":{"input":10}}}
{"type":"text","timestamp":"2026-05-21T19:02:16Z","part":{"text":"output"}}`;

    const bin = fakeBinary({ exit: 0, stdout: jsonStream });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("estimated");
      expect(result.warnings).toContain(
        "opencode: no step_finish events in --format json stream; falling back to token estimation.",
      );
    }
  });

  test("no cost field sets cost_source to no-price", async () => {
    const jsonStream = `{"type":"step_finish","timestamp":"2026-05-21T19:02:17Z","part":{"type":"step-finish","tokens":{"total":100,"input":10,"output":20,"reasoning":0,"cache":{"write":70,"read":0}}}}`;

    const bin = fakeBinary({ exit: 0, stdout: jsonStream });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("agent");
      expect(result.cost_source).toBe("no-price");
      expect(result.cost_usd).toBe(null);
    }
  });
});

describe("parseOpencodeJsonStream", () => {
  test("parses two step_finish events with non-zero tokens and cost", () => {
    const stream = `{"type":"step_finish","part":{"tokens":{"input":10,"output":20,"cache":{"read":5,"write":65}},"cost":0.05}}
{"type":"step_finish","part":{"tokens":{"input":30,"output":40,"cache":{"read":10,"write":130}},"cost":0.10}}`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.sawStepFinish).toBe(true);
    expect(result.usage.input_tokens).toBe(40);
    expect(result.usage.output_tokens).toBe(60);
    expect(result.usage.cache_read_input_tokens).toBe(15);
    expect(result.usage.cache_creation_input_tokens).toBe(195);
    expect(result.costUsd).toBeCloseTo(0.15);
    expect(result.sawAnyCostField).toBe(true);
  });

  test("handles cost: 0 (github-copilot path)", () => {
    const stream = `{"type":"step_finish","part":{"tokens":{"input":10,"output":20,"cache":{"read":0,"write":70}},"cost":0}}`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.sawStepFinish).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(result.sawAnyCostField).toBe(true);
  });

  test("renders text parts without dedup", () => {
    const stream = `{"type":"text","part":{"text":"Hello "}}
{"type":"text","part":{"text":"world"}}`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.renderedText).toBe("Hello world");
  });

  test("includes non-JSON and non-event lines as pass-through", () => {
    const stream = `banner line
{"type":"text","part":{"text":"content"}}
another banner`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.renderedText).toContain("banner line");
    expect(result.renderedText).toContain("content");
    expect(result.renderedText).toContain("another banner");
  });

  test("skips arrays, numbers, strings, null at top level", () => {
    const stream = `["array"]
123
"string"
null
{"type":"text","part":{"text":"real event"}}`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.renderedText).toContain("real event");
  });

  test("skips malformed step_finish but accumulates clean ones", () => {
    const stream = `{"type":"step_finish","part":{"tokens":{"input":10,"output":20,"cache":{"read":0,"write":70}},"cost":0.05}}
{"type":"step_finish","part":{"tokens":{"input":5}}}
{"type":"step_finish","part":{"tokens":{"input":5,"output":10,"cache":{"read":1,"write":40}},"cost":0.02}}`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.sawStepFinish).toBe(true);
    expect(result.usage.input_tokens).toBe(15); // 10 + 5 (skips middle)
    expect(result.usage.output_tokens).toBe(30); // 20 + 10
    expect(result.costUsd).toBe(0.07); // 0.05 + 0.02
  });

  test("all malformed step_finish returns sawStepFinish false", () => {
    const stream = `{"type":"step_finish","part":{"tokens":{"input":10}}}
{"type":"step_finish","part":{"tokens":{"output":20}}}`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.sawStepFinish).toBe(false);
    expect(result.usage.input_tokens).toBe(0);
    expect(result.costUsd).toBe(0);
  });

  test("no cost field on any step_finish sets sawAnyCostField false", () => {
    const stream = `{"type":"step_finish","part":{"tokens":{"input":10,"output":20,"cache":{"read":0,"write":70}}}}
{"type":"step_finish","part":{"tokens":{"input":5,"output":10,"cache":{"read":1,"write":40}}}}`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.sawStepFinish).toBe(true);
    expect(result.sawAnyCostField).toBe(false);
    expect(result.costUsd).toBe(0);
  });

  test("other event types are ignored", () => {
    const stream = `{"type":"step_start","part":{"id":"prt_1"}}
{"type":"tool_call","part":{"text":"ignored"}}
{"type":"unknown","part":{"tokens":{"input":999}}}
{"type":"text","part":{"text":"visible"}}`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.renderedText).toBe("visible");
    expect(result.sawStepFinish).toBe(false);
  });

  test("empty lines are skipped without pass-through", () => {
    const stream = `{"type":"text","part":{"text":"a"}}

{"type":"text","part":{"text":"b"}}`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.renderedText).toBe("ab");
  });

  test("json parse errors are treated as pass-through", () => {
    const stream = `not json at all
{"type":"text","part":{"text":"valid"}}
{broken json}`;

    const result = parseOpencodeJsonStream(stream);

    expect(result.renderedText).toContain("not json at all");
    expect(result.renderedText).toContain("valid");
    expect(result.renderedText).toContain("{broken json}");
  });

  test("returns warnings array (empty for now)", () => {
    const stream = `{"type":"text","part":{"text":"ok"}}`;

    const result = parseOpencodeJsonStream(stream);

    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.length).toBe(0);
  });
});
