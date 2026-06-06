import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAgent } from "../../src/agents/codex.ts";

let dir: string;
let cwd: string;
let originalHome: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-codex-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-codex-cwd-"));
  originalHome = process.env.HOME;
  process.env.HOME = dir;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function fakeBinary(opts: { exit: number; stdout?: string; stderr?: string }): string {
  const path = join(dir, "codex");
  const out = opts.stdout ?? "";
  const err = opts.stderr ?? "";
  const script = `#!/usr/bin/env bash
# Record argv (NUL-separated), stdin, and cwd so the test can inspect them.
: > "${dir}/argv"
for a in "$@"; do printf '%s\\0' "$a" >> "${dir}/argv"; done
cat > "${dir}/stdin"
pwd > "${dir}/cwd"
printf '%s' ${JSON.stringify(out)}
printf '%s' ${JSON.stringify(err)} 1>&2
exit ${opts.exit}
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

/** Bun fake that records argv/stdin/cwd and writes a correlatable Codex session JSONL. */
function bunCodexFakeWithSession(sessionPath: string, sessionDir: string): string {
  const binPath = join(dir, "codex");
  const script = `#!/usr/bin/env bun
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const dir = ${JSON.stringify(dir)};
const sessionPath = ${JSON.stringify(sessionPath)};
const sessionDir = ${JSON.stringify(sessionDir)};
const argv = process.argv.slice(2);
writeFileSync(dir + "/argv", argv.map((a) => a + "\\0").join(""));
const stdin = readFileSync(0, "utf8");
writeFileSync(dir + "/stdin", stdin);
writeFileSync(dir + "/cwd", process.cwd() + "\\n");
mkdirSync(sessionDir, { recursive: true });
const lines = [
  JSON.stringify({
    type: "event_msg",
    payload: { type: "user_message", message: stdin },
  }),
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 42,
          cached_input_tokens: 5,
          output_tokens: 9,
        },
      },
    },
  }),
];
writeFileSync(sessionPath, lines.join("\\n") + "\\n");
console.log("ok");
`;
  writeFileSync(binPath, script);
  chmodSync(binPath, 0o755);
  return binPath;
}

function expectAugmentedPrompt(stdin: string, basePrompt: string): void {
  expect(stdin.startsWith(`${basePrompt}\n`)).toBe(true);
  expect(stdin).toMatch(/<!-- jarvis-codex-invocation: [0-9a-f-]{36} -->$/);
}

describe("CodexAgent", () => {
  test("name is 'codex'", () => {
    expect(new CodexAgent().name).toBe("codex");
  });

  test("spawns `codex exec --color never` with prompt on stdin in cwd, mapping exit 0 → ok", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "hi-out", stderr: "hi-err" });
    const agent = new CodexAgent({ binary: bin });

    const result = await agent.run("the prompt", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("hi-out");
      expect(result.stderr).toBe("hi-err");
    }
    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      'exec\0--color\0never\0--sandbox\0workspace-write\0-c\0approval_policy="on-request"\0',
    );
    const stdin = readFileSync(join(dir, "stdin"), "utf8");
    expectAugmentedPrompt(stdin, "the prompt");
    const reportedCwd = readFileSync(join(dir, "cwd"), "utf8").trim();
    const resolvedReportedCwd = realpathSync(reportedCwd);
    const resolvedCwd = realpathSync(cwd);
    expect(resolvedReportedCwd).toBe(resolvedCwd);
  });

  test("includes model flag when model is configured", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new CodexAgent({ binary: bin, model: "gpt-5.4" });

    await agent.run("the prompt", { cwd });

    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      'exec\0--color\0never\0--sandbox\0workspace-write\0-c\0approval_policy="on-request"\0--model\0gpt-5.4\0',
    );
  });

  test("non-zero exit maps to error with captured stderr", async () => {
    const bin = fakeBinary({ exit: 2, stderr: "boom" });
    const agent = new CodexAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "boom" });
  });

  test("non-zero exit includes captured stdout diagnostics", async () => {
    const bin = fakeBinary({ exit: 1, stdout: "Not authenticated" });
    const agent = new CodexAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({
      kind: "error",
      exitCode: 1,
      stderr: "Not authenticated",
    });
  });

  test("quota signal maps to quota", async () => {
    const stderr = "You've reached your usage limit. Try again later.";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new CodexAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr });
  });

  test("unsupported model signal maps to model_config", async () => {
    const stderr = "error: model is not available";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new CodexAgent({ binary: bin, model: "gpt-5.4" });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("quota signal can be read from stdout", async () => {
    const stdout = "You've reached your usage limit. Try again later.";
    const bin = fakeBinary({ exit: 1, stdout });
    const agent = new CodexAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr: stdout });
  });

  test("missing binary surfaces as error result, not a thrown exception", async () => {
    const agent = new CodexAgent({ binary: join(dir, "does-not-exist") });
    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("error");
  });

  test('includes --sandbox workspace-write and approval_policy="on-request"', async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new CodexAgent({ binary: bin });

    await agent.run("p", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--sandbox");
    expect(argv).toContain("workspace-write");
    expect(argv).toContain("-c");
    expect(argv).toContain('approval_policy="on-request"');
  });

  test("appends --add-dir for each additionalReadDirs entry with existing sandbox and approval flags", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new CodexAgent({ binary: bin });

    await agent.run("p", {
      cwd,
      additionalReadDirs: ["/abs/specs/foo", "/abs/specs/bar"],
    });

    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      'exec\0--color\0never\0--sandbox\0workspace-write\0-c\0approval_policy="on-request"\0--add-dir\0/abs/specs/foo\0--add-dir\0/abs/specs/bar\0',
    );
  });

  test("omits --add-dir when additionalReadDirs is unset", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new CodexAgent({ binary: bin });

    await agent.run("p", { cwd });

    expect(readFileSync(join(dir, "argv"), "utf8")).not.toContain("--add-dir");
  });

  test("attributionLabel returns raw string for model ID", () => {
    const agent = new CodexAgent({
      binary: "fake",
      model: "gpt-4-codex",
    });
    expect(agent.attributionLabel()).toBe("gpt-4-codex");
  });

  test("attributionLabel returns default fallback when model is undefined", () => {
    const agent = new CodexAgent({ binary: "fake" });
    expect(agent.attributionLabel()).toBe("codex (default model)");
  });

  test("attaches usage and computed cost when a new session file is found and correlated", async () => {
    const sessionDir = join(dir, ".codex", "sessions", "2026", "05", "16");
    const sessionPath = join(sessionDir, "rollout-1.jsonl");
    const bin = bunCodexFakeWithSession(sessionPath, sessionDir);

    const agent = new CodexAgent({ binary: bin, model: "gpt-5.4" });
    const result = await agent.run("prompt", { cwd });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage).toEqual({
        input_tokens: 42,
        output_tokens: 9,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: null,
      });
      expect(result.cost_source).toBe("computed");
      expect(result.cost_usd).toBeCloseTo(0.000200375);
    }
  });

  test("records unavailable usage when no session file changes after invocation", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "ok" });
    const agent = new CodexAgent({ binary: bin });
    const result = await agent.run("prompt", { cwd });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage).toBeUndefined();
      expect(result.usage_source).toBe("unavailable");
      expect(result.cost_source).toBe("no-usage");
      expect(result.cost_usd).toBeNull();
      expect(result.warnings?.some((w) => w.includes("no session JSONL changed"))).toBe(true);
    }
  });

  test("concurrent unrelated session file activity does not charge usage to this invocation", async () => {
    const sessionRoot = join(dir, ".codex", "sessions");
    const sub = join(sessionRoot, "2026", "05", "16");
    mkdirSync(sub, { recursive: true });
    const otherPath = join(sub, "other.jsonl");
    writeFileSync(
      otherPath,
      `${[
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "interactive codex elsewhere",
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 999,
                cached_input_tokens: 0,
                output_tokens: 999,
              },
            },
          },
        }),
      ].join("\n")}\n`,
    );

    const sessionPath = join(sub, "jarvis.jsonl");
    const binPath = join(dir, "codex");
    const script = `#!/usr/bin/env bun
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const dir = ${JSON.stringify(dir)};
const sessionPath = ${JSON.stringify(sessionPath)};
const sessionDir = ${JSON.stringify(sub)};
const otherPath = ${JSON.stringify(otherPath)};
const argv = process.argv.slice(2);
writeFileSync(dir + "/argv", argv.map((a) => a + "\\0").join(""));
const stdin = readFileSync(0, "utf8");
writeFileSync(dir + "/stdin", stdin);
writeFileSync(dir + "/cwd", process.cwd() + "\\n");
mkdirSync(sessionDir, { recursive: true });
const lines = [
  JSON.stringify({
    type: "event_msg",
    payload: { type: "user_message", message: stdin },
  }),
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 42,
          cached_input_tokens: 5,
          output_tokens: 9,
        },
      },
    },
  }),
];
writeFileSync(sessionPath, lines.join("\\n") + "\\n");
const cur = readFileSync(otherPath, "utf8");
writeFileSync(
  otherPath,
  cur.trimEnd() + "\\n" + JSON.stringify({ type: "heartbeat" }) + "\\n",
);
console.log("ok");
`;
    writeFileSync(binPath, script);
    chmodSync(binPath, 0o755);

    const agent = new CodexAgent({ binary: binPath, model: "gpt-5.4" });
    const result = await agent.run("prompt", { cwd });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage?.input_tokens).toBe(42);
      expect(result.usage_source).toBeUndefined();
    }
  });
});
