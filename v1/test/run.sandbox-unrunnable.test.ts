// Real OS process and timing integration tests for watchdog/timeout behavior.
// These require real subprocess spawning, process group manipulation, and wall-clock timing.
// They run in sandbox-off environment only and are excluded from the sandboxed test suite.
// Scope: descendant-capture (real process termination verification), elapsed-bound (real sleep timing),
// and real process group behavior that cannot be made deterministic without actual OS interaction.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runAgent } from "../src/agents/spawn.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { registerProject, writeConfig } from "../src/config.ts";
import type { RunCommandOptions, RunIo } from "../src/modes/patch/run.ts";
import { runCommand } from "../src/modes/patch/run.ts";

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

let dir: string;
let projectRoot: string;
let cfgDir: string;
let originalPath: string | undefined;

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };

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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-run-"));
  projectRoot = join(dir, "project");
  cfgDir = join(dir, "cfg");
  originalPath = process.env.PATH;
  mkdirSync(projectRoot);
  registerProject("project", projectRoot, { dir: cfgDir });
});

afterEach(() => {
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  rmSync(dir, { recursive: true, force: true });
});

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
          git: true,
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
      const timeoutRow = rows.find(
        (row) => row.record_role !== "run_terminal" && row.exit_reason === "watchdog-iteration-timeout",
      );
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
  });

  describe("elapsed-bound: real sleep timing for output tracking", () => {
    test("watchdog timeout records last_output_age_ms from early output then stall", async () => {
      const iterationTimeoutMs = 2000;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const stallScript = join(projectRoot, "early-output-stall.sh");
      writeFileSync(
        stallScript,
        `#!/usr/bin/env bash
set -euo pipefail
sleep 1.4
echo early-output >&2
while true; do :; done
`,
      );
      chmodSync(stallScript, 0o755);

      class StallingAgent implements Agent {
        readonly name = "claude" as const;
        async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
          return runAgent(
            {
              name: this.name,
              binary: stallScript,
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
          iterationTimeoutMs,
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: new StallingAgent() },
        handleSignals: false,
        __testKillGraceMs: 200,
      });

      expect(code).toBe(8);
      expect(cap.err()).toContain("last_output_age_ms=");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const timeoutRow = rows.find(
        (row) => row.record_role !== "run_terminal" && row.exit_reason === "watchdog-iteration-timeout",
      );
      expect(timeoutRow).toBeDefined();
      expect(typeof timeoutRow?.last_output_age_ms).toBe("number");
      expect(timeoutRow?.last_output_age_ms as number).toBeLessThan(iterationTimeoutMs - 500);
    });

    test("idle watchdog timeout fires before iteration timeout when agent emits no output", async () => {
      const idleTimeoutMs = 1000;
      const iterationTimeoutMs = 5000;
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const idleScript = join(projectRoot, "idle-hang.sh");
      writeFileSync(
        idleScript,
        `#!/usr/bin/env bash
set -euo pipefail
# Hang without emitting output — will hit idle timeout before iteration timeout
while true; do :; done
`,
      );
      chmodSync(idleScript, 0o755);

      class IdleAgent implements Agent {
        readonly name = "claude" as const;
        async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
          return runAgent(
            {
              name: this.name,
              binary: idleScript,
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
          iterationTimeoutMs,
          idleOutputTimeoutMs: idleTimeoutMs,
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const startTime = Date.now();
      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: new IdleAgent() },
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
          git: true,
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

    test("idle watchdog disabled when idleOutputTimeoutMs is unset", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const idleScript = join(projectRoot, "idle-hang.sh");
      writeFileSync(
        idleScript,
        `#!/usr/bin/env bash
set -euo pipefail
sleep 1.5
# After 1.5s, emit output to show we're not aborted yet
echo "output after stall" >&2
while true; do :; done
`,
      );
      chmodSync(idleScript, 0o755);

      class IdleAgent implements Agent {
        readonly name = "claude" as const;
        async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
          return runAgent(
            {
              name: this.name,
              binary: idleScript,
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
          iterationTimeoutMs: 3000,
          // idleOutputTimeoutMs is unset
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: new IdleAgent() },
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
  });
});
