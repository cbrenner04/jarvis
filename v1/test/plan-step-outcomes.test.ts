import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import type { Config } from "../src/config.ts";
import { runIntentDraftTurn } from "../src/modes/plan/intent-draft.ts";
import { createPlanTelemetryWriter } from "../src/modes/plan/plan-telemetry.ts";
import { REFINE_HEADING, REFINE_SKIP_HEADING, runRefineTurn } from "../src/modes/plan/refine.ts";
import { planSummary } from "../src/run-summary.ts";
import type { PlanStepOutcome, TelemetryRecord } from "../src/telemetry.ts";

class FakeAgent implements Agent {
  readonly name: AgentName;
  readonly #run: (prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>;

  constructor(name: AgentName, run: (prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>) {
    this.name = name;
    this.#run = run;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    return this.#run(prompt, opts);
  }

  attributionLabel(): string {
    return `fake-${this.name}`;
  }
}

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.3-codex" };

const testConfig: Config = {
  version: 2,
  modes: {
    patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
    plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
    prompt: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
    review: { passes: 2 },
  },
  quotaFallback: "strict",
  weakQuotaExitCodes: [],
  maxIterations: 10,
  iterationTimeoutMs: 30 * 60_000,
  git: true,
  projects: {},
};

function readTelemetry(path: string): TelemetryRecord[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as TelemetryRecord);
}

function initGitRepo(dir: string): void {
  execSync("git init -b main", { cwd: dir });
  execSync("git config user.email 'test@example.com'", { cwd: dir });
  execSync("git config user.name 'Test User'", { cwd: dir });
}

describe("plan step outcomes", () => {
  test("intent-draft failures write intent phase rows without outcome", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-outcome-intent-fail-"));
    const telemetryPath = join(dir, "runs.jsonl");
    try {
      initGitRepo(dir);
      const writer = createPlanTelemetryWriter({ telemetryPath, namespace: "plan:proj:tmp" });
      const claude = new FakeAgent("claude", () => ({
        kind: "quota",
        stderr: "quota",
      }));
      const codex = new FakeAgent("codex", () => ({
        kind: "error",
        exitCode: 1,
        stderr: "boom",
      }));

      const { result } = await runIntentDraftTurn({
        agentCwd: dir,
        worktreePath: dir,
        intentPath: join(dir, "intent.md"),
        seededIntent: "seed",
        config: testConfig,
        planTelemetry: writer,
        createAgent: (name) => (name === "claude" ? claude : codex),
      });

      expect(result.kind).toBe("error");
      const rows = readTelemetry(telemetryPath);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.mode).toBe("plan");
        expect(row.plan_phase).toBe("intent");
        expect(row.outcome).toBeUndefined();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("intent success records plan_phase intent with outcome success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-outcome-intent-ok-"));
    const telemetryPath = join(dir, "runs.jsonl");
    try {
      initGitRepo(dir);
      const writer = createPlanTelemetryWriter({ telemetryPath, namespace: "plan:proj:tmp" });
      const agent = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "ok",
        stderr: "",
        usage_source: "agent",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.01,
        cost_source: "computed",
      }));

      const draft = await runIntentDraftTurn({
        agentCwd: dir,
        worktreePath: dir,
        intentPath: join(dir, "intent.md"),
        seededIntent: "seed",
        config: testConfig,
        planTelemetry: writer,
        createAgent: () => agent,
      });

      expect(draft.successAttempt).toBeDefined();
      writer.recordAgentAttempt({
        phase: "intent",
        agentCli: draft.successAttempt!.agentCli,
        configuredModel: draft.successAttempt!.configuredModel,
        durationMs: draft.successAttempt!.durationMs,
        result: draft.result,
        outcome: "success",
      });

      const row = readTelemetry(telemetryPath)[0]!;
      expect(row.mode).toBe("plan");
      expect(row.plan_phase).toBe("intent");
      expect(row.outcome).toBe("success");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refine records refined, skip, and blocker outcomes", async () => {
    const cases: Array<{ label: string; after: string; outcome: PlanStepOutcome }> = [
      {
        label: "refined",
        after: `seed\n\n${REFINE_HEADING}\n\n- consolidated\n`,
        outcome: "refined",
      },
      {
        label: "skip",
        after: `seed\n\n${REFINE_SKIP_HEADING}\n\nNo further refinement.\n`,
        outcome: "skip",
      },
      {
        label: "blocker",
        after: "seed\n\n## Blocker\n\nNeed clarification.\n",
        outcome: "blocker",
      },
    ];

    for (const testCase of cases) {
      const dir = mkdtempSync(join(tmpdir(), `jarvis-plan-outcome-refine-${testCase.label}-`));
      const telemetryPath = join(dir, "runs.jsonl");
      try {
        initGitRepo(dir);
        const specDir = join(dir, "spec", "my-plan");
        mkdirSync(specDir, { recursive: true });
        const intentPath = join(specDir, "intent.md");
        writeFileSync(intentPath, "seed\n", "utf8");

        const writer = createPlanTelemetryWriter({ telemetryPath, namespace: "plan:proj:tmp" });
        const agent = new FakeAgent("claude", (_prompt, opts) => {
          writeFileSync(intentPath, testCase.after, "utf8");
          return { kind: "ok", stdout: "", stderr: "" };
        });

        await runRefineTurn({
          worktreePath: dir,
          name: "my-plan",
          config: testConfig,
          turnNumber: 1,
          totalTurns: 1,
          planTelemetry: writer,
          createAgent: () => agent,
        });

        const row = readTelemetry(telemetryPath)[0]!;
        expect(row.mode).toBe("plan");
        expect(row.plan_phase).toBe("refine");
        expect(row.outcome).toBe(testCase.outcome);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("refine validation failure omits outcome", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-outcome-refine-fail-"));
    const telemetryPath = join(dir, "runs.jsonl");
    try {
      initGitRepo(dir);
      const specDir = join(dir, "spec", "my-plan");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "seed\n", "utf8");

      const writer = createPlanTelemetryWriter({ telemetryPath, namespace: "plan:proj:tmp" });
      const agent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const turn = await runRefineTurn({
        worktreePath: dir,
        name: "my-plan",
        config: testConfig,
        turnNumber: 1,
        totalTurns: 1,
        planTelemetry: writer,
        createAgent: () => agent,
      });

      expect(turn.result.kind).toBe("error");
      const row = readTelemetry(telemetryPath)[0]!;
      expect(row.plan_phase).toBe("refine");
      expect(row.kind).toBe("error");
      expect(row.outcome).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refine skip is queryable from outcome without row-count heuristics", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-outcome-refine-skip-query-"));
    const telemetryPath = join(dir, "runs.jsonl");
    try {
      initGitRepo(dir);
      const specDir = join(dir, "spec", "my-plan");
      mkdirSync(specDir, { recursive: true });
      const intentPath = join(specDir, "intent.md");
      writeFileSync(intentPath, "seed\n", "utf8");

      const writer = createPlanTelemetryWriter({ telemetryPath, namespace: "plan:proj:tmp" });
      const agent = new FakeAgent("claude", () => {
        writeFileSync(intentPath, `seed\n\n${REFINE_SKIP_HEADING}\n\nDone.\n`, "utf8");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      await runRefineTurn({
        worktreePath: dir,
        name: "my-plan",
        config: testConfig,
        turnNumber: 1,
        totalTurns: 1,
        planTelemetry: writer,
        createAgent: () => agent,
      });

      const skipRows = readTelemetry(telemetryPath).filter((row) => row.outcome === "skip");
      expect(skipRows).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("plan summary accepts intent phase and outcome fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-outcome-summary-"));
    try {
      const telemetryPath = join(dir, "runs.jsonl");
      const writer = createPlanTelemetryWriter({ telemetryPath, namespace: "plan:proj:tmp" });
      writer.recordAgentAttempt({
        phase: "intent",
        agentCli: "claude",
        configuredModel: "haiku",
        durationMs: 10,
        result: { kind: "ok", stdout: "", stderr: "" },
        outcome: "success",
      });
      writer.recordAgentAttempt({
        phase: "refine",
        agentCli: "claude",
        configuredModel: "haiku",
        durationMs: 12,
        result: { kind: "ok", stdout: "", stderr: "" },
        outcome: "skip",
      });
      writer.recordAgentAttempt({
        phase: "draft",
        agentCli: "codex",
        configuredModel: "gpt-5.3-codex",
        durationMs: 20,
        result: { kind: "ok", stdout: "", stderr: "" },
      });

      const summary = planSummary({
        telemetryPath,
        namespace: "plan:proj:tmp",
        startTs: "2026-05-16T09:00:00.000Z",
        exitReason: "complete",
        durationMs: 1000,
        specPath: "spec/my-plan/index.md",
      });
      expect(summary).toContain("plan summary");
      expect(summary).toContain("phase attempts: 3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
