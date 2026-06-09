import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";
import type { AgentEntry, Config } from "../../../src/config.ts";
import { runReview } from "../../../src/modes/review/run.ts";
import {
  type ReviewAdapter,
  type ReviewAttemptContext,
  type ReviewTelemetryEvent,
  ReviewTerminalError,
} from "../../../src/modes/review/types.ts";

function makeConfig(opts?: { planOrder?: AgentEntry[]; reviewOrder?: AgentEntry[]; reviewPasses?: number }): Config {
  const planOrder = opts?.planOrder ?? [{ agent: "claude", model: "haiku" }];
  return {
    version: 2,
    modes: {
      patch: { agentOrder: [{ agent: "claude", model: "haiku" }] },
      plan: { agentOrder: planOrder },
      prompt: { agentOrder: planOrder },
      review: {
        passes: opts?.reviewPasses ?? 2,
        ...(opts?.reviewOrder !== undefined ? { agentOrder: opts.reviewOrder } : {}),
      },
    },
    quotaFallback: "lenient",
    weakQuotaExitCodes: [],
    maxIterations: 10,
    iterationTimeoutMs: 30 * 60_000,
    logServerUrl: "http://127.0.0.1:4310/logs",
    logServerBind: "127.0.0.1:4310",
    telemetryPath: null,
    git: true,
    projects: {},
  };
}

function makeAgent(name: AgentName, resultFactory: () => AgentResult): Agent {
  return {
    name,
    attributionLabel: () => `${name}:label`,
    run: async (_prompt: string, _opts: AgentRunOptions) => resultFactory(),
  };
}

function makeAdapter(overrides?: Partial<ReviewAdapter>): {
  adapter: ReviewAdapter;
  calls: string[];
  telemetry: ReviewTelemetryEvent[];
  prompts: Array<{ passNumber: number; totalPasses: number; agent: string; model: string; role?: string }>;
  committed: ReviewAttemptContext[];
  blocked: Array<ReviewAttemptContext & { blocker: string }>;
  roles: string[];
} {
  const calls: string[] = [];
  const telemetry: ReviewTelemetryEvent[] = [];
  const prompts: Array<{ passNumber: number; totalPasses: number; agent: string; model: string; role?: string }> = [];
  const committed: ReviewAttemptContext[] = [];
  const blocked: Array<ReviewAttemptContext & { blocker: string }> = [];
  const roles: string[] = [];

  const adapter: ReviewAdapter = {
    buildPrompt: async ({ passNumber, totalPasses, agentEntry, role }) => {
      const roleStr = role ?? "unknown";
      calls.push(`build:${passNumber}:${roleStr}:${agentEntry.agent}`);
      roles.push(roleStr);
      prompts.push({
        passNumber,
        totalPasses,
        agent: agentEntry.agent,
        model: agentEntry.model,
        role: roleStr,
      });
      return `prompt:${passNumber}:${roleStr}:${agentEntry.agent}`;
    },
    enforceWriteBoundary: async (ctx) => {
      const roleStr = ctx.role ?? "unknown";
      calls.push(`enforce:${ctx.passNumber}:${roleStr}:${ctx.agent.name}`);
    },
    readBlocker: async (ctx) => {
      const roleStr = ctx.role ?? "unknown";
      calls.push(`blocker:${ctx.passNumber}:${roleStr}:${ctx.agent.name}`);
      return null;
    },
    handleBlocker: async (ctx) => {
      const roleStr = ctx.role ?? "unknown";
      calls.push(`handle-blocker:${ctx.passNumber}:${roleStr}:${ctx.agent.name}`);
      blocked.push(ctx);
      return 7;
    },
    commitPass: async (ctx) => {
      const roleStr = ctx.role ?? "unknown";
      calls.push(`commit:${ctx.passNumber}:${roleStr}:${ctx.agent.name}`);
      committed.push(ctx);
    },
    recordTelemetry: async (event) => {
      const roleStr = event.role ?? "unknown";
      calls.push(`telemetry:${event.passNumber}:${roleStr}:${event.agent.name}:${event.outcome}`);
      telemetry.push(event);
    },
    ...overrides,
  };

  return { adapter, calls, telemetry, prompts, committed, blocked, roles };
}

describe("runReview", () => {
  test("runs debate cycle: adversary, defender, judge per cycle", async () => {
    const { adapter, roles } = makeAdapter();

    await runReview({
      config: makeConfig({ reviewPasses: 2 }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "verdict", stderr: "" })),
    });

    expect(roles).toEqual(["adversary", "defender", "judge", "adversary", "defender", "judge"]);
  });

  test("uses cli review pass override before config and default", async () => {
    const { adapter, prompts } = makeAdapter();

    const overrideCode = await runReview({
      config: makeConfig({ reviewPasses: 7 }),
      cwd: "/tmp/review",
      adapter,
      reviewPassesOverride: 3,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "", stderr: "" })),
    });
    expect(overrideCode).toBe(0);
    expect(
      prompts.map((prompt) => `${prompt.passNumber}:${prompt.role}`),
    ).toEqual([
      "1:adversary",
      "1:defender",
      "1:judge",
      "2:adversary",
      "2:defender",
      "2:judge",
      "3:adversary",
      "3:defender",
      "3:judge",
    ]);

    prompts.length = 0;

    const configCode = await runReview({
      config: makeConfig({ reviewPasses: 4 }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "", stderr: "" })),
    });
    expect(configCode).toBe(0);
    expect(prompts).toHaveLength(12); // 4 cycles * 3 roles

    prompts.length = 0;

    const defaultCode = await runReview({
      config: makeConfig({ reviewPasses: 2 }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "", stderr: "" })),
    });
    expect(defaultCode).toBe(0);
    expect(prompts).toHaveLength(6); // 2 cycles * 3 roles
  });

  test("uses review agent order and falls back to plan order", async () => {
    const reviewPrompts = makeAdapter();
    await runReview({
      config: makeConfig({
        planOrder: [{ agent: "claude", model: "haiku" }],
        reviewOrder: [{ agent: "codex", model: "gpt-5.3-codex" }],
        reviewPasses: 1,
      }),
      cwd: "/tmp/review",
      adapter: reviewPrompts.adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "", stderr: "" })),
    });
    expect(reviewPrompts.prompts.map((p) => `${p.passNumber}:${p.agent}:${p.role}`)).toEqual([
      "1:codex:adversary",
      "1:codex:defender",
      "1:codex:judge",
    ]);

    const fallbackPrompts = makeAdapter();
    await runReview({
      config: makeConfig({
        planOrder: [{ agent: "cursor", model: "Composer 2" }],
        reviewPasses: 1,
      }),
      cwd: "/tmp/review",
      adapter: fallbackPrompts.adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "", stderr: "" })),
    });
    expect(fallbackPrompts.prompts.map((p) => `${p.passNumber}:${p.agent}:${p.role}`)).toEqual([
      "1:cursor:adversary",
      "1:cursor:defender",
      "1:cursor:judge",
    ]);
  });

  test("rotates to the next review agent on quota and exits 2 when all are exhausted", async () => {
    const { adapter, prompts, telemetry } = makeAdapter();
    const seen = new Map<string, number>();

    const code = await runReview({
      config: makeConfig({
        reviewOrder: [
          { agent: "claude", model: "haiku" },
          { agent: "codex", model: "gpt-5.3-codex" },
        ],
      }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => {
          const count = (seen.get(name) ?? 0) + 1;
          seen.set(name, count);
          if (name === "claude") return { kind: "quota", stderr: "limit" };
          return { kind: "ok", stdout: "", stderr: "" };
        }),
    });

    expect(code).toBe(0);
    // Each cycle (pass) runs 3 roles, rotating agents on quota.
    // Claude fails quota for each role, codex succeeds for each role.
    expect(prompts.map((prompt) => `${prompt.passNumber}:${prompt.role}:${prompt.agent}`)).toEqual([
      "1:adversary:claude",
      "1:adversary:codex",
      "1:defender:claude",
      "1:defender:codex",
      "1:judge:claude",
      "1:judge:codex",
      "2:adversary:claude",
      "2:adversary:codex",
      "2:defender:claude",
      "2:defender:codex",
      "2:judge:claude",
      "2:judge:codex",
    ]);
    expect(telemetry.map((event) => `${event.passNumber}:${event.role}:${event.agent.name}:${event.outcome}`)).toEqual([
      "1:adversary:claude:quota",
      "1:adversary:codex:ok",
      "1:defender:claude:quota",
      "1:defender:codex:ok",
      "1:judge:claude:quota",
      "1:judge:codex:ok",
      "2:adversary:claude:quota",
      "2:adversary:codex:ok",
      "2:defender:claude:quota",
      "2:defender:codex:ok",
      "2:judge:claude:quota",
      "2:judge:codex:ok",
    ]);

    const messages: string[] = [];
    const allQuotaCode = await runReview({
      config: makeConfig({
        reviewOrder: [
          { agent: "claude", model: "haiku" },
          { agent: "codex", model: "gpt-5.3-codex" },
        ],
        reviewPasses: 1,
      }),
      cwd: "/tmp/review",
      adapter: makeAdapter().adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "quota", stderr: `${name} limit` })),
      onAllAgentsQuotaExhausted: (message) => messages.push(message),
    });

    expect(allQuotaCode).toBe(2);
    expect(messages).toEqual(["all agents quota-exhausted"]);
  });

  test("exits 3 for model_config and stops on hard errors", async () => {
    const modelPrompts = makeAdapter();
    const modelCode = await runReview({
      config: makeConfig({ reviewPasses: 1 }),
      cwd: "/tmp/review",
      adapter: modelPrompts.adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "model_config", stderr: "bad model" })),
    });
    expect(modelCode).toBe(3);
    expect(modelPrompts.telemetry).toHaveLength(1);
    expect(modelPrompts.telemetry[0]?.outcome).toBe("model_config");
    expect(modelPrompts.telemetry[0]?.role).toBe("adversary");

    const errorPrompts = makeAdapter();
    const loaded: string[] = [];
    const errorCode = await runReview({
      config: makeConfig({
        reviewOrder: [
          { agent: "claude", model: "haiku" },
          { agent: "codex", model: "gpt-5.3-codex" },
        ],
        reviewPasses: 1,
      }),
      cwd: "/tmp/review",
      adapter: errorPrompts.adapter,
      loadAgent: ({ name }: { name: string; model: string }) => {
        loaded.push(name);
        return makeAgent(name as AgentName, () => ({ kind: "error", exitCode: 9, stderr: "boom" }));
      },
    });
    expect(errorCode).toBe(9);
    expect(loaded).toEqual(["claude"]);
    expect(errorPrompts.telemetry).toHaveLength(1);
    expect(errorPrompts.telemetry[0]?.outcome).toBe("error");
    expect(errorPrompts.telemetry[0]?.exitCode).toBe(9);
    expect(errorPrompts.telemetry[0]?.role).toBe("adversary");
  });

  test("normalizes error exit codes that collide with reserved outcomes", async () => {
    // 2 (quota), 3 (model_config), 7 (blocker), 130 (interrupt), 0 (success)
    // would be misread by callers if returned raw; they must come back as 1
    // while telemetry keeps the true code.
    for (const reserved of [0, 2, 3, 7, 130]) {
      const { adapter, telemetry } = makeAdapter();
      const code = await runReview({
        config: makeConfig({ reviewPasses: 1 }),
        cwd: "/tmp/review",
        adapter,
        loadAgent: ({ name }: { name: string; model: string }) =>
          makeAgent(name as AgentName, () => ({ kind: "error", exitCode: reserved, stderr: "boom" })),
      });
      expect(code).toBe(1);
      expect(telemetry).toHaveLength(1);
      expect(telemetry[0]?.outcome).toBe("error");
      // The genuine code survives in telemetry even though the return is 1.
      expect(telemetry[0]?.exitCode).toBe(reserved);
    }
  });

  test("calls adapter hooks for each role with role context and stops on blocker in first role", async () => {
    const success = makeAdapter();
    const successCode = await runReview({
      config: makeConfig({ reviewPasses: 1 }),
      cwd: "/tmp/review",
      adapter: success.adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "verdict", stderr: "" })),
      now: (() => {
        let tick = 0;
        return () => (tick += 5);
      })(),
    });

    expect(successCode).toBe(0);
    // 3 roles × hooks per role (build, enforce, blocker, commit, telemetry)
    expect(success.calls).toEqual([
      "build:1:adversary:claude",
      "enforce:1:adversary:claude",
      "blocker:1:adversary:claude",
      "commit:1:adversary:claude",
      "telemetry:1:adversary:claude:ok",
      "build:1:defender:claude",
      "enforce:1:defender:claude",
      "blocker:1:defender:claude",
      "commit:1:defender:claude",
      "telemetry:1:defender:claude:ok",
      "build:1:judge:claude",
      "enforce:1:judge:claude",
      "blocker:1:judge:claude",
      "commit:1:judge:claude",
      "telemetry:1:judge:claude:ok",
    ]);
    expect(success.committed).toHaveLength(3);
    expect(success.telemetry).toHaveLength(3);
    expect(success.telemetry[0]?.durationMs).toBe(5);

    const blocked = makeAdapter({
      readBlocker: async (ctx) => {
        const roleStr = ctx.role ?? "unknown";
        blocked.calls.push(`blocker:${ctx.passNumber}:${roleStr}:${ctx.agent.name}`);
        if (ctx.role === "adversary") return "need input";
        return null;
      },
      handleBlocker: async (ctx) => {
        const roleStr = ctx.role ?? "unknown";
        blocked.calls.push(`handle-blocker:${ctx.passNumber}:${roleStr}:${ctx.agent.name}`);
        blocked.blocked.push(ctx);
        return 7;
      },
    });

    const blockedCode = await runReview({
      config: makeConfig({ reviewPasses: 1 }),
      cwd: "/tmp/review",
      adapter: blocked.adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "", stderr: "" })),
    });

    expect(blockedCode).toBe(7);
    // Blocker stops the cycle, so only adversary runs
    expect(blocked.calls).toEqual([
      "build:1:adversary:claude",
      "enforce:1:adversary:claude",
      "blocker:1:adversary:claude",
      "handle-blocker:1:adversary:claude",
      "telemetry:1:adversary:claude:blocked",
    ]);
    expect(blocked.committed).toHaveLength(0);
    expect(blocked.blocked).toHaveLength(1);
    expect(blocked.telemetry[0]?.outcome).toBe("blocked");
    expect(blocked.telemetry[0]?.exitCode).toBe(7);
  });

  test("upgrades lenient weak-quota errors when porcelain is unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-review-lenient-"));
    execSync("git init -b main", { cwd: dir });
    const rotations: string[] = [];
    const { adapter, telemetry } = makeAdapter();
    const code = await runReview({
      config: makeConfig({
        reviewOrder: [
          { agent: "claude", model: "haiku" },
          { agent: "codex", model: "gpt-5.3-codex" },
        ],
        reviewPasses: 1,
      }),
      cwd: dir,
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => {
          if (name === "claude") {
            return { kind: "error", exitCode: 429, stderr: "rate limit exceeded" };
          }
          return { kind: "ok", stdout: "", stderr: "" };
        }),
      onQuotaRotation: (agent, _spawn, classified) => {
        if (classified.kind === "quota") {
          rotations.push(agent);
        }
      },
    });

    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
    expect(rotations.length).toBe(3); // One per role (adversary, defender, judge)
    expect(rotations).toEqual(["claude", "claude", "claude"]);
    expect(telemetry.map((event) => `${event.role}:${event.agent.name}:${event.outcome}`)).toEqual([
      "adversary:claude:quota",
      "adversary:codex:ok",
      "defender:claude:quota",
      "defender:codex:ok",
      "judge:claude:quota",
      "judge:codex:ok",
    ]);
  });

  test("records telemetry when adapter rejects a successful agent result", async () => {
    const { adapter, telemetry } = makeAdapter({
      readBlocker: async (ctx) => {
        if (ctx.role === "adversary") {
          throw new ReviewTerminalError("validation failed", 1);
        }
        return null;
      },
    });

    const code = await runReview({
      config: makeConfig({ reviewPasses: 1 }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "", stderr: "" })),
    });

    expect(code).toBe(1);
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]?.outcome).toBe("error");
    expect(telemetry[0]?.exitCode).toBe(1);
    expect(telemetry[0]?.result.kind).toBe("ok");
    expect(telemetry[0]?.role).toBe("adversary");
  });

  test("invokes executor with verdict after judge completes each cycle", async () => {
    const { adapter } = makeAdapter();
    const executorCalls: string[] = [];

    await runReview({
      config: makeConfig({ reviewPasses: 2 }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "verdict-content", stderr: "" })),
      executor: async (verdict, ctx) => {
        executorCalls.push(`execute:${ctx.passNumber}:${verdict}`);
      },
    });

    expect(executorCalls).toEqual(["execute:1:verdict-content", "execute:2:verdict-content"]);
  });

  test("skips executor when verdict is empty", async () => {
    const { adapter } = makeAdapter();
    const executorCalls: string[] = [];

    await runReview({
      config: makeConfig({ reviewPasses: 1 }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "", stderr: "" })),
      executor: async (verdict, ctx) => {
        executorCalls.push(`execute:${ctx.passNumber}:${verdict}`);
      },
    });

    expect(executorCalls).toHaveLength(0);
  });

  test("passes prior cycle verdict to next cycle's adversary", async () => {
    const { adapter, prompts } = makeAdapter();
    let priorVerdictSeen: string | undefined;

    await runReview({
      config: makeConfig({ reviewPasses: 2 }),
      cwd: "/tmp/review",
      adapter: {
        ...adapter,
        buildPrompt: async (ctx) => {
          if (ctx.role === "adversary" && ctx.passNumber === 2) {
            priorVerdictSeen = ctx.priorVerdict;
          }
          return adapter.buildPrompt(ctx);
        },
      },
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({
          kind: "ok",
          stdout: `verdict-${Math.random()}`,
          stderr: "",
        })),
      executor: async () => {
        // empty executor
      },
    });

    expect(priorVerdictSeen).toBeDefined();
    expect(priorVerdictSeen).toMatch(/^verdict-/);
  });

  test("executor errors are caught and exit code is mapped", async () => {
    const { adapter } = makeAdapter();

    const code = await runReview({
      config: makeConfig({ reviewPasses: 1 }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "verdict", stderr: "" })),
      executor: async () => {
        throw new Error("executor failed");
      },
    });

    expect(code).toBe(1);
  });

  test("executor terminal errors propagate exit code", async () => {
    const { adapter } = makeAdapter();

    const code = await runReview({
      config: makeConfig({ reviewPasses: 1 }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "verdict", stderr: "" })),
      executor: async () => {
        throw new ReviewTerminalError("executor blocked", 7, { telemetryRecorded: true });
      },
    });

    expect(code).toBe(7);
  });
});
