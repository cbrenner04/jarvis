import { describe, expect, test } from "bun:test";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";
import type { AgentEntry, Config } from "../../../src/config.ts";
import { runReview } from "../../../src/modes/review/run.ts";
import type { ReviewAdapter, ReviewAttemptContext, ReviewTelemetryEvent } from "../../../src/modes/review/types.ts";

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
  prompts: Array<{ passNumber: number; totalPasses: number; agent: string; model: string }>;
  committed: ReviewAttemptContext[];
  blocked: Array<ReviewAttemptContext & { blocker: string }>;
} {
  const calls: string[] = [];
  const telemetry: ReviewTelemetryEvent[] = [];
  const prompts: Array<{ passNumber: number; totalPasses: number; agent: string; model: string }> = [];
  const committed: ReviewAttemptContext[] = [];
  const blocked: Array<ReviewAttemptContext & { blocker: string }> = [];

  const adapter: ReviewAdapter = {
    buildPrompt: async ({ passNumber, totalPasses, agentEntry }) => {
      calls.push(`build:${passNumber}:${agentEntry.agent}`);
      prompts.push({
        passNumber,
        totalPasses,
        agent: agentEntry.agent,
        model: agentEntry.model,
      });
      return `prompt:${passNumber}:${agentEntry.agent}`;
    },
    enforceWriteBoundary: async (ctx) => {
      calls.push(`enforce:${ctx.passNumber}:${ctx.agent.name}`);
    },
    readBlocker: async (ctx) => {
      calls.push(`blocker:${ctx.passNumber}:${ctx.agent.name}`);
      return null;
    },
    handleBlocker: async (ctx) => {
      calls.push(`handle-blocker:${ctx.passNumber}:${ctx.agent.name}`);
      blocked.push(ctx);
      return 7;
    },
    commitPass: async (ctx) => {
      calls.push(`commit:${ctx.passNumber}:${ctx.agent.name}`);
      committed.push(ctx);
    },
    recordTelemetry: async (event) => {
      calls.push(`telemetry:${event.passNumber}:${event.agent.name}:${event.outcome}`);
      telemetry.push(event);
    },
    ...overrides,
  };

  return { adapter, calls, telemetry, prompts, committed, blocked };
}

describe("runReview", () => {
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
    expect(prompts.map((prompt) => prompt.passNumber)).toEqual([1, 2, 3]);

    prompts.length = 0;

    const configCode = await runReview({
      config: makeConfig({ reviewPasses: 4 }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "", stderr: "" })),
    });
    expect(configCode).toBe(0);
    expect(prompts.map((prompt) => prompt.passNumber)).toEqual([1, 2, 3, 4]);

    prompts.length = 0;

    const defaultCode = await runReview({
      config: makeConfig({ reviewPasses: 2 }),
      cwd: "/tmp/review",
      adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "", stderr: "" })),
    });
    expect(defaultCode).toBe(0);
    expect(prompts.map((prompt) => prompt.passNumber)).toEqual([1, 2]);
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
    expect(reviewPrompts.prompts).toEqual([{ passNumber: 1, totalPasses: 1, agent: "codex", model: "gpt-5.3-codex" }]);

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
    expect(fallbackPrompts.prompts).toEqual([{ passNumber: 1, totalPasses: 1, agent: "cursor", model: "Composer 2" }]);
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
    expect(prompts.map((prompt) => `${prompt.passNumber}:${prompt.agent}`)).toEqual(["1:claude", "1:codex", "2:codex"]);
    expect(telemetry.map((event) => `${event.passNumber}:${event.agent.name}:${event.outcome}`)).toEqual([
      "1:claude:quota",
      "1:codex:ok",
      "2:codex:ok",
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
    expect(modelPrompts.calls).not.toContain("commit:1:claude");

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
  });

  test("calls adapter hooks for prompt, write boundary, blocker handling, commit, and telemetry", async () => {
    const success = makeAdapter();
    const successCode = await runReview({
      config: makeConfig({ reviewPasses: 1 }),
      cwd: "/tmp/review",
      adapter: success.adapter,
      loadAgent: ({ name }: { name: string; model: string }) =>
        makeAgent(name as AgentName, () => ({ kind: "ok", stdout: "done", stderr: "" })),
      now: (() => {
        let tick = 0;
        return () => (tick += 5);
      })(),
    });

    expect(successCode).toBe(0);
    expect(success.calls).toEqual([
      "build:1:claude",
      "enforce:1:claude",
      "blocker:1:claude",
      "commit:1:claude",
      "telemetry:1:claude:ok",
    ]);
    expect(success.committed).toHaveLength(1);
    expect(success.telemetry[0]?.durationMs).toBe(5);

    const blocked = makeAdapter({
      readBlocker: async (ctx) => {
        blocked.calls.push(`blocker:${ctx.passNumber}:${ctx.agent.name}`);
        return "need input";
      },
      handleBlocker: async (ctx) => {
        blocked.calls.push(`handle-blocker:${ctx.passNumber}:${ctx.agent.name}`);
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
    expect(blocked.calls).toEqual([
      "build:1:claude",
      "enforce:1:claude",
      "blocker:1:claude",
      "handle-blocker:1:claude",
      "telemetry:1:claude:blocked",
    ]);
    expect(blocked.committed).toHaveLength(0);
    expect(blocked.blocked).toHaveLength(1);
    expect(blocked.telemetry[0]?.outcome).toBe("blocked");
    expect(blocked.telemetry[0]?.exitCode).toBe(7);
  });
});
