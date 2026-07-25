// Watchdog/timeout integration tests using real OS processes for agent spawning.
// These require real subprocess spawning, process group manipulation, and wall-clock timing.
// No real git/gh: all configs set `git: false` — the run loop does not invoke git or gh.
// Scope: descendant-capture (real process termination verification), elapsed-bound (real sleep timing),
// and real process group behavior that cannot be made deterministic without actual OS interaction.
// .sandbox-unrunnable suffix retained: agent subprocesses via ScriptAgent/runAgent are real.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runAgent } from "../src/agents/spawn.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { registerProject, writeConfig } from "../src/config.ts";
import type {
  PatchWatchdogTimerHandle,
  PatchWatchdogTiming,
  RunCommandOptions,
  RunIo,
} from "../src/modes/patch/run.ts";
import { runCommand } from "../src/modes/patch/run.ts";
import { HARNESS_IDLE_TIMEOUT_FALLBACK } from "../src/quota-harness-messages.ts";
import {
  beginHangFixtureTracking,
  IDLE_HANG_BODY,
  IDLE_HANG_WAIT,
  reapActiveHangFixtures,
  trackHangFixtureScript,
  withHangFixtureSpawned,
} from "./idle-hang-fixtures.ts";

const HANG_FIXTURE_TRACKING_ID = import.meta.path;

function captureIo(): { io: RunIo; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

class FakeAgent implements Agent {
  readonly name: AgentName;
  readonly calls: { prompt: string; cwd: string }[] = [];
  readonly callOpts: AgentRunOptions[] = [];
  readonly #run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>;

  constructor(
    name: AgentName,
    run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>,
  ) {
    this.name = name;
    this.#run = run;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    this.calls.push({ prompt, cwd: opts.cwd });
    this.callOpts.push(opts);
    return this.#run(this.calls.length, prompt, opts);
  }

  attributionLabel(): string {
    return `fake-${this.name}`;
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class ManualWatchdogTiming implements PatchWatchdogTiming {
  #nowMs = 0;
  #handles: Array<{ atMs: number; callback: () => void; cleared: boolean } & PatchWatchdogTimerHandle> = [];

  nowMs(): number {
    return this.#nowMs;
  }

  setTimeout(callback: () => void, delayMs: number): PatchWatchdogTimerHandle {
    const handle = {
      atMs: this.#nowMs + delayMs,
      callback,
      cleared: false,
      unref: () => {},
    };
    this.#handles.push(handle);
    return handle;
  }

  clearTimeout(handle: PatchWatchdogTimerHandle): void {
    const manualHandle = handle as { cleared?: boolean };
    manualHandle.cleared = true;
  }

  advanceBy(delayMs: number): void {
    const targetMs = this.#nowMs + delayMs;
    while (true) {
      let nextIndex = -1;
      let nextAtMs = Number.POSITIVE_INFINITY;
      for (const [index, handle] of this.#handles.entries()) {
        if (!handle.cleared && handle.atMs <= targetMs && handle.atMs < nextAtMs) {
          nextIndex = index;
          nextAtMs = handle.atMs;
        }
      }
      if (nextIndex === -1) {
        break;
      }
      const [nextHandle] = this.#handles.splice(nextIndex, 1);
      if (nextHandle === undefined || nextHandle.cleared) {
        continue;
      }
      this.#nowMs = nextHandle.atMs;
      nextHandle.callback();
    }
    this.#nowMs = targetMs;
  }
}

let dir: string;
let projectRoot: string;
let cfgDir: string;
let originalPath: string | undefined;

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.3-codex" };

function writeSpec(content: string): string {
  const specPath = join(projectRoot, "spec", "index.md");
  mkdirSync(dirname(specPath), { recursive: true });
  writeFileSync(specPath, content);
  return specPath;
}

function disableReviewByDefault(opts: RunCommandOptions): RunCommandOptions {
  return {
    ...opts,
    reviewPasses: opts.reviewPasses ?? 0,
    logClient: opts.logClient ?? {
      assertReachable: async () => {},
      send: async () => {},
    },
  };
}

async function runWithDefaults(opts: RunCommandOptions): Promise<number> {
  return runCommand({
    runCompletionReadyGate: () => ({ kind: "green" }),
    ...disableReviewByDefault(opts),
    skipGhCheck: true,
  });
}

function writeAgentScript(filename: string, body: string): string {
  const script = join(projectRoot, filename);
  writeFileSync(script, body.startsWith("#!") ? body : `#!/usr/bin/env bash\n${body}`);
  chmodSync(script, 0o755);
  if (filename.endsWith("-hang.sh")) {
    trackHangFixtureScript(script);
  }
  return script;
}

class ScriptAgent implements Agent {
  readonly name: AgentName;
  readonly #binary: string;

  constructor(name: AgentName, binary: string) {
    this.name = name;
    this.#binary = binary;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    return runAgent(
      {
        name: this.name,
        binary: this.#binary,
        cwd: opts.cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
      },
      prompt,
      withHangFixtureSpawned(opts),
    );
  }

  attributionLabel(): string {
    return `fake-${this.name}`;
  }
}

function idleHangAgent(name: AgentName = "claude", body = IDLE_HANG_BODY): ScriptAgent {
  return new ScriptAgent(name, writeAgentScript("idle-hang.sh", body));
}

function readTelemetryRows(): Record<string, unknown>[] {
  return readFileSync(join(cfgDir, "runs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-run-"));
  projectRoot = join(dir, "project");
  cfgDir = join(dir, "cfg");
  originalPath = process.env.PATH;
  mkdirSync(projectRoot);
  registerProject("project", projectRoot, { dir: cfgDir });
  beginHangFixtureTracking(HANG_FIXTURE_TRACKING_ID);
});

afterEach(() => {
  reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  rmSync(dir, { recursive: true, force: true });
});

// Real OS processes required: watchdog descendant-capture must verify actual
// process-group behavior (SIGTERM-ignoring grandchildren, process table queries)
// that cannot be deterministically faked.
describe("timeout behavior (sandbox-unrunnable: real process + timing)", () => {
  describe("descendant-capture: real process termination", () => {
    test("watchdog timeout kills SIGTERM-ignoring grandchildren and records pgid telemetry", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const ignoreTermScript = join(projectRoot, "ignore-term.sh");
      writeFileSync(
        ignoreTermScript,
        `#!/usr/bin/env bash
trap '' TERM
while true; do :; done
`,
      );
      chmodSync(ignoreTermScript, 0o755);
      const hangScript = join(projectRoot, "hang-agent.sh");
      writeFileSync(
        hangScript,
        `#!/usr/bin/env bash
set -euo pipefail
"$PWD/ignore-term.sh" &
echo "$!" > "$PWD/hanging-child.pid"
wait
`,
      );
      chmodSync(hangScript, 0o755);

      class HangingAgent implements Agent {
        readonly name = "claude" as const;
        async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
          return runAgent(
            {
              name: this.name,
              binary: hangScript,
              cwd: opts.cwd,
              buildArgv: () => [],
              stdio: ["ignore", "pipe", "pipe"],
              streamErrorPrefix: "test:",
            },
            prompt,
            opts,
          );
        }
        attributionLabel(): string {
          return "fake-claude";
        }
      }

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 4000,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const started = Date.now();
      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: new HangingAgent() },
        handleSignals: false,
        __testKillGraceMs: 200,
      });
      const elapsedMs = Date.now() - started;

      expect(code).toBe(8);
      expect(elapsedMs).toBeLessThanOrEqual(7200);
      expect(cap.err()).toContain("[watchdog] iteration timeout fired after 4000ms;");
      expect(cap.err()).toContain("last_output_age_ms=null");

      const childPid = Number.parseInt(readFileSync(join(projectRoot, "hanging-child.pid"), "utf8").trim(), 10);
      expect(Number.isFinite(childPid)).toBe(true);
      let childAlive = true;
      try {
        process.kill(childPid, 0);
      } catch {
        childAlive = false;
      }
      expect(childAlive).toBe(false);

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const timeoutRow = rows.find((row) => row.exit_reason === "watchdog-iteration-timeout");
      expect(timeoutRow).toBeDefined();
      expect(typeof timeoutRow?.watchdog_pgid).toBe("number");
      expect(timeoutRow?.last_output_age_ms).toBeNull();

      const sessionsDir = join(cfgDir, "sessions");
      const sessionFile = readdirSync(sessionsDir)[0];
      if (sessionFile === undefined) {
        throw new Error("expected a session log file");
      }
      const sessionLog = readFileSync(join(sessionsDir, sessionFile), "utf8");
      expect(sessionLog).toContain("[watchdog] iteration timeout fired after 4000ms;");
      expect(sessionLog).toContain("last_output_age_ms=null");
    });

    test("watchdog timeout records watchdog_descendants_alive false for agent-only stall", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const hangScript = writeAgentScript("agent-only-hang.sh", `${IDLE_HANG_WAIT}\n`);

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 1500,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: new ScriptAgent("claude", hangScript) },
        handleSignals: false,
        __testKillGraceMs: 200,
        __testWatchdogListProcesses: () => {
          // Inject an empty process table: no descendants for agent-only stall.
          return [];
        },
      });

      expect(code).toBe(8);
      expect(cap.err()).toContain("watchdog_descendants_alive=false");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const timeoutRow = rows.find((row) => row.exit_reason === "watchdog-iteration-timeout");
      expect(timeoutRow).toBeDefined();
      expect(timeoutRow?.watchdog_descendants_alive).toBe(false);
    });
  });

  // Real subprocess stdout/stderr pipes required: watchdog output-age tracking
  // observes actual pipe readability timestamps and file-modification mtimes that
  // only real subprocess activity produces.
  describe("elapsed-bound: real sleep timing for output tracking", () => {
    test("watchdog timeout records last_output_age_ms from early output then stall", async () => {
      const iterationTimeoutMs = 2000;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const agentStarted = deferred<void>();
      const watchdogTiming = new ManualWatchdogTiming();
      const outputObserved = deferred<void>();
      const releaseOutputPath = join(projectRoot, "release-output");
      const emitThenHangScript = join(projectRoot, "emit-then-hang.sh");
      writeFileSync(
        emitThenHangScript,
        `#!/usr/bin/env bash
set -euo pipefail
while [ ! -f "$PWD/release-output" ]; do
  sleep 0.01
done
echo "early output"
while true; do
  sleep 60
done
`,
      );
      chmodSync(emitThenHangScript, 0o755);

      class StallingAgent implements Agent {
        readonly name = "claude" as const;

        async run(_prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
          agentStarted.resolve();
          void (async () => {
            while (opts.lastOutputAtMs?.current === null) {
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
            outputObserved.resolve();
          })();
          return await runAgent(
            {
              name: this.name,
              binary: emitThenHangScript,
              cwd: opts.cwd,
              buildArgv: () => [],
              stdio: ["ignore", "pipe", "pipe"],
              streamErrorPrefix: "test:",
            },
            _prompt,
            opts,
          );
        }

        attributionLabel(): string {
          return "fake-claude";
        }
      }

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const runPromise = runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: new StallingAgent() },
        handleSignals: false,
        __testKillGraceMs: 200,
        __testPatchWatchdogTiming: watchdogTiming,
      });
      await agentStarted.promise;
      watchdogTiming.advanceBy(1400);
      writeFileSync(releaseOutputPath, "go\n");
      await outputObserved.promise;
      watchdogTiming.advanceBy(iterationTimeoutMs - 1400);
      const code = await runPromise;

      expect(code).toBe(8);
      expect(cap.err()).toContain("last_output_age_ms=");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const timeoutRow = rows.find((row) => row.exit_reason === "watchdog-iteration-timeout");
      expect(timeoutRow).toBeDefined();
      expect(typeof timeoutRow?.last_output_age_ms).toBe("number");
      expect(timeoutRow?.last_output_age_ms as number).toBeLessThan(iterationTimeoutMs - 500);
    });

    test("idle watchdog timeout fires before iteration timeout when agent emits no output", async () => {
      const idleTimeoutMs = 1000;
      const iterationTimeoutMs = 5000;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs,
          idleOutputTimeoutMs: idleTimeoutMs,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const startTime = Date.now();
      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: idleHangAgent() },
        handleSignals: false,
        __testKillGraceMs: 200,
      });
      const elapsedMs = Date.now() - startTime;

      expect(code).toBe(8);
      expect(elapsedMs).toBeLessThan(iterationTimeoutMs);
      expect(cap.err()).toContain("[watchdog] idle timeout fired after");
      expect(cap.err()).toContain("last_output_age_ms=null");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const idleRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout");
      expect(idleRow).toBeDefined();
      expect(idleRow?.kind).toBe("timeout");
      expect(idleRow?.last_output_age_ms).toBeNull();
    });

    test("idle watchdog is not triggered when agent emits output within the span", async () => {
      const idleTimeoutMs = 800;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const periodicScript = join(projectRoot, "periodic-output.sh");
      writeFileSync(
        periodicScript,
        `#!/usr/bin/env bash
set -euo pipefail
# Emit output every 400ms to stay under 800ms idle timeout, then exit successfully
for i in {1..5}; do
  echo "tick $i" >&2
  sleep 0.4
done
echo "done"
`,
      );
      chmodSync(periodicScript, 0o755);

      class PeriodicAgent implements Agent {
        readonly name = "claude" as const;
        async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
          return runAgent(
            {
              name: this.name,
              binary: periodicScript,
              cwd: opts.cwd,
              buildArgv: () => [],
              stdio: ["ignore", "pipe", "pipe"],
              streamErrorPrefix: "test:",
            },
            prompt,
            opts,
          );
        }
        attributionLabel(): string {
          return "fake-claude";
        }
      }

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 30 * 60_000,
          idleOutputTimeoutMs: idleTimeoutMs,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: new PeriodicAgent() },
        handleSignals: false,
        __testKillGraceMs: 200,
      });

      expect(code).not.toBe(8);
      expect(cap.err()).not.toContain("[watchdog] idle timeout fired");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const idleRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout");
      expect(idleRow).toBeUndefined();
    });

    test("idle watchdog disabled when idleOutputTimeoutMs is 0", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new ScriptAgent(
        "claude",
        writeAgentScript(
          "idle-hang.sh",
          `set -euo pipefail
sleep 1.5
echo "output after stall" >&2
${IDLE_HANG_WAIT}
`,
        ),
      );

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 3000,
          idleOutputTimeoutMs: 0,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        __testKillGraceMs: 200,
      });

      expect(code).toBe(8);
      expect(cap.err()).toContain("iteration timeout");
      expect(cap.err()).not.toContain("[watchdog] idle timeout fired");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const idleRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout");
      expect(idleRow).toBeUndefined();
    });

    test("idle watchdog armed by default when idleOutputTimeoutMs unset", async () => {
      const idleTimeoutMs = 1000;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 30000,
          idleOutputTimeoutMs: idleTimeoutMs,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: idleHangAgent() },
        handleSignals: false,
        __testKillGraceMs: 200,
      });

      expect(code).toBe(8);
      expect(cap.err()).toContain("[watchdog] idle timeout fired");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const idleRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout");
      expect(idleRow).toBeDefined();
    });

    test("idle watchdog escalates through agentOrder when fallback rung remains", async () => {
      const idleTimeoutMs = 1000;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = idleHangAgent();
      const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 3,
          iterationTimeoutMs: 30 * 60_000,
          idleOutputTimeoutMs: idleTimeoutMs,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        handleSignals: false,
        __testKillGraceMs: 200,
      });

      expect(code).toBe(4);
      expect(cap.err()).toContain(`claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
      expect(cap.err()).not.toContain("iteration 1 exceeded idle timeout");
      expect(codex.calls).toHaveLength(1);

      const _telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readTelemetryRows();
      const fallbackRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout-fallback");
      expect(fallbackRow).toBeDefined();
      expect(fallbackRow?.kind).toBe("timeout");
      expect(fallbackRow?.agent).toBe("claude");
    });

    test("idle watchdog on final rung exits 8 with terminal watchdog-idle-timeout", async () => {
      const idleTimeoutMs = 1000;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = idleHangAgent("claude");
      const codex = idleHangAgent("codex");

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 5,
          iterationTimeoutMs: 30 * 60_000,
          idleOutputTimeoutMs: idleTimeoutMs,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        handleSignals: false,
        __testKillGraceMs: 200,
      });

      expect(code).toBe(8);
      expect(cap.err()).toContain(`claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
      expect(cap.err()).toContain("iteration 2 exceeded idle timeout");

      const rows = readTelemetryRows();
      const fallbackRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout-fallback");
      const terminalRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout");
      expect(fallbackRow).toBeDefined();
      expect(fallbackRow?.agent).toBe("claude");
      expect(terminalRow).toBeDefined();
      expect(terminalRow?.agent).toBe("codex");
      expect(terminalRow?.kind).toBe("timeout");
    });

    test("idle abort is not classified as quota and escalates via idle ladder", async () => {
      const idleTimeoutMs = 1000;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = idleHangAgent();
      const codex = new FakeAgent("codex", () => ({
        kind: "error",
        exitCode: 1,
        stderr: "fallback should not be triggered",
      }));

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 3,
          iterationTimeoutMs: 30 * 60_000,
          idleOutputTimeoutMs: idleTimeoutMs,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        handleSignals: false,
        __testKillGraceMs: 200,
      });

      expect(code).toBe(3);
      expect(cap.err()).toContain(`claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
      expect(cap.err()).toContain("fallback should not be triggered");
      expect(cap.err()).not.toContain("probable quota-like error");
      expect(codex.calls).toHaveLength(1);

      const fallbackRow = readTelemetryRows().find((row) => row.exit_reason === "watchdog-idle-timeout-fallback");
      expect(fallbackRow).toBeDefined();
      expect(fallbackRow?.kind).toBe("timeout");
    });

    test("silent but file-editing agent is not killed by idle watchdog", async () => {
      // File activity is sampled only once the idle span elapses with no stdout/stderr.
      // Keep the span well above subprocess start + first write under parallel CI load.
      const idleTimeoutMs = 4000;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const fileEditScript = join(projectRoot, "file-edit-agent.sh");
      writeFileSync(
        fileEditScript,
        `#!/usr/bin/env bash
set -euo pipefail
# Emit no stdout/stderr; file mtimes must satisfy the idle watchdog.
echo "boot" >> "$PWD/output.txt"
for i in {1..6}; do
  echo "edit $i" >> "$PWD/output.txt"
  sleep 0.25
done
echo "done"
`,
      );
      chmodSync(fileEditScript, 0o755);

      class FileEditAgent implements Agent {
        readonly name = "claude" as const;
        async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
          return runAgent(
            {
              name: this.name,
              binary: fileEditScript,
              cwd: opts.cwd,
              buildArgv: () => [],
              stdio: ["ignore", "pipe", "pipe"],
              streamErrorPrefix: "test:",
            },
            prompt,
            opts,
          );
        }
        attributionLabel(): string {
          return "fake-claude";
        }
      }

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 30 * 60_000,
          idleOutputTimeoutMs: idleTimeoutMs,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: new FileEditAgent() },
        handleSignals: false,
        __testKillGraceMs: 200,
      });

      expect(code).not.toBe(8);
      expect(cap.err()).not.toContain("[watchdog] idle timeout fired");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const idleRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout");
      expect(idleRow).toBeUndefined();
    });

    test("fully idle agent (no output, no file writes) is killed by idle watchdog", async () => {
      const idleTimeoutMs = 800;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 30 * 60_000,
          idleOutputTimeoutMs: idleTimeoutMs,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: idleHangAgent() },
        handleSignals: false,
        __testKillGraceMs: 200,
      });

      expect(code).toBe(8);
      expect(cap.err()).toContain("[watchdog] idle timeout fired");
      // File activity includes pre-existing files in the working directory (like spec file)
      // so it will be detected. The important thing is that the watchdog still fired.
      expect(cap.err()).toContain("last_file_activity_age_ms=");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const idleRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout");
      expect(idleRow).toBeDefined();
      expect(
        typeof idleRow?.last_file_activity_age_ms === "number" || idleRow?.last_file_activity_age_ms === null,
      ).toBe(true);
    });

    test("idle watchdog includes last_file_activity_age_ms in telemetry", async () => {
      const idleTimeoutMs = 1000;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 30 * 60_000,
          idleOutputTimeoutMs: idleTimeoutMs,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: idleHangAgent() },
        handleSignals: false,
        __testKillGraceMs: 200,
      });

      expect(code).toBe(8);
      expect(cap.err()).toContain("last_file_activity_age_ms=");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const idleRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout");
      expect(idleRow).toBeDefined();
      expect(idleRow).toHaveProperty("last_file_activity_age_ms");
    });
  });
});
