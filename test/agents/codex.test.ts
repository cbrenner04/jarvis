import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

function fakeBinary(opts: {
  exit: number;
  stdout?: string;
  stderr?: string;
}): string {
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
    expect(readFileSync(join(dir, "stdin"), "utf8")).toBe("the prompt");
    const reportedCwd = readFileSync(join(dir, "cwd"), "utf8").trim();
    const resolvedReportedCwd = realpathSync(reportedCwd);
    const resolvedCwd = realpathSync(cwd);
    expect(resolvedReportedCwd).toBe(resolvedCwd);
  });

  test("includes model flag when model is configured", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new CodexAgent({ binary: bin, model: "gpt-5.3-codex" });

    await agent.run("the prompt", { cwd });

    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      'exec\0--color\0never\0--sandbox\0workspace-write\0-c\0approval_policy="on-request"\0--model\0gpt-5.3-codex\0',
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
    const agent = new CodexAgent({ binary: bin, model: "gpt-5.3-codex" });

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

  test("attaches usage and computed cost when a new session file is found", async () => {
    const bin = fakeBinary({
      exit: 0,
      stdout: "ok",
    });
    const sessionDir = join(dir, ".codex", "sessions", "2026", "05", "16");
    mkdirSync(sessionDir, { recursive: true });
    const sessionPath = join(sessionDir, "rollout-1.jsonl");
    writeFileSync(
      bin,
      `#!/usr/bin/env bash
: > "${dir}/argv"
for a in "$@"; do printf '%s\\0' "$a" >> "${dir}/argv"; done
cat > "${dir}/stdin"
pwd > "${dir}/cwd"
mkdir -p "${sessionDir}"
cat > "${sessionPath}" <<'JSONL'
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":42,"cached_input_tokens":5,"output_tokens":9}}}}
JSONL
printf '%s' "ok"
exit 0
`,
    );
    chmodSync(bin, 0o755);

    const agent = new CodexAgent({ binary: bin, model: "gpt-5.3-codex" });
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

  test("omits usage and returns warning when no new session file exists", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "ok" });
    const agent = new CodexAgent({ binary: bin });
    const result = await agent.run("prompt", { cwd });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage).toBeUndefined();
      expect(
        result.warnings?.some((w) => w.includes("session file not found")),
      ).toBe(true);
    }
  });
});
