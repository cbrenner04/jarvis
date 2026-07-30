import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import {
  type ProjectPipelineConfig,
  readProjectPipelineConfig,
  readProjectRegistry,
} from "../config/machine-config-loader.ts";
import type { PipelineDefinition } from "./pipeline-definition.ts";
import { validatePipelineDefinition } from "./pipeline-definition.ts";
import { getPipelineDefinition } from "./pipeline-registry.ts";
import {
  resolveProjectPipeline,
  setInvertTerminalActionConflictGuardForTest,
} from "./project-pipeline-resolution.ts";

const ALL_REVIEW_ROLES_CONFIG: AgentModelConfig = {
  claude: {
    critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] },
    actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] },
    adversary: { rungs: [{ adapterModel: "adversary", priceKey: "adversary" }] },
    advocate: { rungs: [{ adapterModel: "advocate", priceKey: "advocate" }] },
    adjudicator: { rungs: [{ adapterModel: "adjudicator", priceKey: "adjudicator" }] },
  },
};

const DEFAULT_TERMINAL_ACTION = "leave-draft";

function config(projectKey: string, pipeline: unknown): ProjectPipelineConfig {
  return { projectKey, pipeline };
}

function pipelineConfig(
  name: string,
  terminalAction = DEFAULT_TERMINAL_ACTION,
  reviewOverrides?: Record<string, string>,
): Record<string, unknown> {
  return reviewOverrides === undefined
    ? { name, terminalAction }
    : { name, terminalAction, reviewOverrides };
}

const NO_IMPLEMENT_PIPELINE: PipelineDefinition = {
  name: "no-implement",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

function lookupFixed(definition: PipelineDefinition) {
  return () => ({ ok: true, definition }) as const;
}

function writeConfig(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-project-pipeline-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function expectFailure(
  result: ReturnType<typeof resolveProjectPipeline>,
): asserts result is Extract<ReturnType<typeof resolveProjectPipeline>, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
}

afterEach(() => {
  setInvertTerminalActionConflictGuardForTest(false);
});

describe("readProjectPipelineConfig", () => {
  test("retains the raw pipeline fragment while the project registry remains a root/origin projection", () => {
    const pipeline = pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, { plan: "light" });
    const path = writeConfig({
      projects: {
        demo: {
          root: "/repo",
          origin: "git@example.test:demo.git",
          pipeline,
          ignored: "registry projection must omit this",
        },
      },
    });

    expect(readProjectPipelineConfig("demo", path)).toEqual({ projectKey: "demo", pipeline });
    expect(readProjectRegistry(path)).toEqual({
      demo: { root: "/repo", origin: "git@example.test:demo.git" },
    });
  });

  test("retains the project key and an absent fragment for missing or malformed project ancestors", () => {
    expect(readProjectPipelineConfig("demo", writeConfig({}))).toEqual({
      projectKey: "demo",
      pipeline: undefined,
    });
    expect(readProjectPipelineConfig("demo", writeConfig({ projects: { demo: "bad" } }))).toEqual({
      projectKey: "demo",
      pipeline: undefined,
    });
  });
});

describe("resolveProjectPipeline", () => {
  test("resolves the configured source-owned definition and reports a named registry miss without a default", () => {
    const resolved = resolveProjectPipeline(
      config("demo", pipelineConfig("fast")),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    const selected = getPipelineDefinition("fast");
    if (!selected.ok) throw new Error("expected source definition");
    expect(resolved).toEqual({
      ok: true,
      definition: { ...selected.definition, terminalAction: DEFAULT_TERMINAL_ACTION },
    });
    expect(resolved.ok && resolved.definition).not.toBe(selected.definition);

    expect(() =>
      resolveProjectPipeline(
        config("demo", pipelineConfig("does-not-exist")),
        getPipelineDefinition,
        ALL_REVIEW_ROLES_CONFIG,
      ),
    ).not.toThrow();
    expect(
      resolveProjectPipeline(
        config("demo", pipelineConfig("does-not-exist")),
        getPipelineDefinition,
        ALL_REVIEW_ROLES_CONFIG,
      ),
    ).toEqual({ ok: false, error: { code: "unknown-pipeline", name: "does-not-exist" } });
  });

  test.each([
    ["missing pipeline", undefined, "projects.demo.pipeline"],
    ["null pipeline", null, "projects.demo.pipeline"],
    ["array pipeline", [], "projects.demo.pipeline"],
    ["string pipeline", "fast", "projects.demo.pipeline"],
    ["missing name", {}, "projects.demo.pipeline.name"],
    ["empty name", { terminalAction: "leave-draft" }, "projects.demo.pipeline.name"],
    ["non-string name", { name: 1, terminalAction: "leave-draft" }, "projects.demo.pipeline.name"],
    ["missing terminalAction", { name: "fast" }, "projects.demo.pipeline.terminalAction"],
    ["empty terminalAction", { name: "fast", terminalAction: "" }, "projects.demo.pipeline.terminalAction"],
    ["null terminalAction", { name: "fast", terminalAction: null }, "projects.demo.pipeline.terminalAction"],
    ["non-string terminalAction", { name: "fast", terminalAction: 1 }, "projects.demo.pipeline.terminalAction"],
    [
      "unknown terminalAction",
      { name: "fast", terminalAction: "publish" },
      "projects.demo.pipeline.terminalAction",
    ],
    ["null overrides", pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, null as unknown as Record<string, string>), "projects.demo.pipeline.reviewOverrides"],
    ["array overrides", pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, [] as unknown as Record<string, string>), "projects.demo.pipeline.reviewOverrides"],
    ["string overrides", pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, "none" as unknown as Record<string, string>), "projects.demo.pipeline.reviewOverrides"],
    ["numeric override", pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, { plan: 1 as unknown as string }), "projects.demo.pipeline.reviewOverrides.plan"],
    ["null override", pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, { plan: null as unknown as string }), "projects.demo.pipeline.reviewOverrides.plan"],
    ["stages key", { ...pipelineConfig("fast"), stages: [] }, "projects.demo.pipeline.stages"],
    ["prompt key", { ...pipelineConfig("fast"), prompt: "x" }, "projects.demo.pipeline.prompt"],
    ["code key", { ...pipelineConfig("fast"), code: "x" }, "projects.demo.pipeline.code"],
    ["other key", { ...pipelineConfig("fast"), extra: true }, "projects.demo.pipeline.extra"],
  ] as Array<[string, unknown, string]>)("rejects %s path-specifically before lookup", (_label, pipeline, key) => {
    let lookupCalls = 0;
    const result = resolveProjectPipeline(
      config("demo", pipeline),
      (name) => {
        lookupCalls += 1;
        return getPipelineDefinition(name);
      },
      ALL_REVIEW_ROLES_CONFIG,
    );

    expectFailure(result);
    expect(result.error).toMatchObject({
      code: "invalid-project-pipeline-config",
      key,
    });
    expect("message" in result.error && result.error.message.length > 0).toBe(true);
    expect(lookupCalls).toBe(0);
  });

  test("parsing succeeds before exactly one source lookup", () => {
    let lookupCalls = 0;
    const result = resolveProjectPipeline(
      config("demo", pipelineConfig("fast")),
      (name) => {
        lookupCalls += 1;
        return getPipelineDefinition(name);
      },
      ALL_REVIEW_ROLES_CONFIG,
    );

    expect(result.ok).toBe(true);
    expect(lookupCalls).toBe(1);
  });

  test("overrides only the named workflow stage in an independently owned copy", () => {
    const source: PipelineDefinition = {
      name: "custom",
      stages: [
        { stageId: "intent-step", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "approval", kind: "approval" },
        { stageId: "plan-step", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "implement-step", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const lookup = (name: string) =>
      name === "custom"
        ? ({ ok: true, definition: source } as const)
        : ({ ok: false, error: { code: "unknown-pipeline" as const, name } } as const);

    const first = resolveProjectPipeline(
      config("first", pipelineConfig("custom", DEFAULT_TERMINAL_ACTION, { "plan-step": "light" })),
      lookup,
      ALL_REVIEW_ROLES_CONFIG,
    );
    const second = resolveProjectPipeline(
      config("second", pipelineConfig("custom", "ready")),
      lookup,
      ALL_REVIEW_ROLES_CONFIG,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected successful resolutions");
    expect(first.definition.stages).toEqual([
      { stageId: "intent-step", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "approval", kind: "approval" },
      { stageId: "plan-step", kind: "workflow", workflow: "plan", review: "light" },
      { stageId: "implement-step", kind: "workflow", workflow: "implement", review: "light" },
    ]);
    expect(second.definition.stages).toEqual(source.stages);
    expect(second.definition).toEqual({ ...source, terminalAction: "ready" });
    expect(first.definition).not.toBe(source);
    expect(second.definition).not.toBe(source);
    expect(first.definition).not.toBe(second.definition);
    for (let index = 0; index < source.stages.length; index += 1) {
      expect(first.definition.stages[index]).not.toBe(source.stages[index]);
      expect(second.definition.stages[index]).not.toBe(source.stages[index]);
      expect(first.definition.stages[index]).not.toBe(second.definition.stages[index]);
    }

    const firstPlan = first.definition.stages[2];
    if (firstPlan?.kind !== "workflow") throw new Error("expected workflow stage");
    firstPlan.review = "debate";
    expect(source.stages[2]).toEqual({
      stageId: "plan-step",
      kind: "workflow",
      workflow: "plan",
      review: "none",
    });
    expect(second.definition.stages[2]).toEqual(source.stages[2]);
    first.definition.terminalAction = "merge";
    expect(second.definition.terminalAction).toBe("ready");
  });

  test.each([
    ["leave-draft", "fast"],
    ["ready", "fast"],
    ["merge", "fast"],
    ["leave-draft", "full-review"],
    ["ready", "full-review"],
    ["merge", "full-review"],
  ] as const)("resolves every terminal action into an isolated admitted definition: %s on %s", (terminalAction, pipelineName) => {
    const first = resolveProjectPipeline(
      config("first", pipelineConfig(pipelineName, terminalAction)),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    const second = resolveProjectPipeline(
      config("second", pipelineConfig(pipelineName, terminalAction)),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected successful resolutions");

    const source = getPipelineDefinition(pipelineName);
    if (!source.ok) throw new Error("expected source definition");

    expect(first.definition).toEqual({ ...source.definition, terminalAction });
    expect(second.definition).toEqual({ ...source.definition, terminalAction });
    expect(first.definition).not.toBe(source.definition);
    expect(second.definition).not.toBe(source.definition);
    expect(first.definition).not.toBe(second.definition);
    expect(first.definition.terminalAction).toBe(terminalAction);
    first.definition.terminalAction = "merge";
    expect(second.definition.terminalAction).toBe(terminalAction);
  });

  test("rejects unknown terminal actions and approval conflicts before admission", () => {
    let lookupCalls = 0;
    const result = resolveProjectPipeline(
      config("demo", { name: "fast", terminalAction: "publish" }),
      (name) => {
        lookupCalls += 1;
        return getPipelineDefinition(name);
      },
      ALL_REVIEW_ROLES_CONFIG,
    );

    expectFailure(result);
    expect(result.error).toMatchObject({
      code: "invalid-project-pipeline-config",
      key: "projects.demo.pipeline.terminalAction",
    });
    expect(lookupCalls).toBe(0);
  });

  test("rejects terminal-action approval conflicts", () => {
    const result = resolveProjectPipeline(
      config("demo", pipelineConfig("no-implement", "merge")),
      lookupFixed(NO_IMPLEMENT_PIPELINE),
      ALL_REVIEW_ROLES_CONFIG,
    );

    expectFailure(result);
    expect(result.error).toEqual({
      code: "invalid-project-pipeline-config",
      key: "projects.demo.pipeline.terminalAction",
      message:
        "projects.demo.pipeline.terminalAction is incompatible with projects.demo.pipeline.name when the composed pipeline has no implement workflow stage",
    });
  });

  test("inverting terminal-action conflict guard admits pipelines without an implement workflow stage", () => {
    setInvertTerminalActionConflictGuardForTest(true);
    const result = resolveProjectPipeline(
      config("demo", pipelineConfig("no-implement", "merge")),
      lookupFixed(NO_IMPLEMENT_PIPELINE),
      ALL_REVIEW_ROLES_CONFIG,
    );

    expect(result.ok).toBe(true);
  });

  test.each([
    ["unknown stage", "missing", "must name an existing workflow stage"],
    ["prototype-named unknown stage", "__proto__", "must name an existing workflow stage"],
    ["approval stage", "approve-intent", "cannot target an approval stage"],
  ])("rejects an %s at its override key", (_label, stageId, message) => {
    const reviewOverrides = JSON.parse(`{"${stageId}":"light"}`) as Record<string, string>;
    const result = resolveProjectPipeline(
      config("demo", pipelineConfig("full-review", DEFAULT_TERMINAL_ACTION, reviewOverrides)),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );

    expectFailure(result);
    expect(result.error).toEqual({
      code: "invalid-project-pipeline-config",
      key: `projects.demo.pipeline.reviewOverrides.${stageId}`,
      message: `projects.demo.pipeline.reviewOverrides.${stageId} ${message}`,
    });
  });

  test("passes invalid override postures to the definition validator and preserves every error", () => {
    const source: PipelineDefinition = {
      name: "invalid",
      stages: [
        { stageId: "plan-a", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "plan-b", kind: "workflow", workflow: "plan", review: "massive" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const lookup = () => ({ ok: true, definition: source }) as const;
    const composed: PipelineDefinition = {
      ...source,
      terminalAction: DEFAULT_TERMINAL_ACTION,
      stages: [
        { stageId: "plan-a", kind: "workflow", workflow: "plan", review: "heavy" },
        { stageId: "plan-b", kind: "workflow", workflow: "plan", review: "massive" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const expected = validatePipelineDefinition(composed, { agentModelConfig: ALL_REVIEW_ROLES_CONFIG });
    if (expected.ok) throw new Error("expected validator failure");

    const result = resolveProjectPipeline(
      config("demo", pipelineConfig("invalid", DEFAULT_TERMINAL_ACTION, { "plan-a": "heavy" })),
      lookup,
      ALL_REVIEW_ROLES_CONFIG,
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "invalid-pipeline-definition", errors: expected.errors },
    });
    for (const error of expected.errors) {
      expect(error).toEqual({
        code: "invalid-review-posture",
        stageId: expect.any(String),
        field: "review",
        message: expect.stringContaining("review"),
      });
    }
  });

  test("validates a selected definition even when no overrides are configured", () => {
    const invalidSource: PipelineDefinition = {
      name: "bad-posture",
      stages: [{ stageId: "implement", kind: "workflow", workflow: "implement", review: "massive" }],
    };
    const result = resolveProjectPipeline(
      config("demo", pipelineConfig("bad-posture")),
      () => ({ ok: true, definition: invalidSource }) as const,
      ALL_REVIEW_ROLES_CONFIG,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid-pipeline-definition",
        errors: [
          {
            code: "invalid-review-posture",
            stageId: "implement",
            field: "review",
            message: 'stage "implement": field review has invalid posture "massive"',
          },
        ],
      },
    });
  });

  test("positive and negative guards remain distinguishable", () => {
    const hit = resolveProjectPipeline(
      config("demo", pipelineConfig("fast")),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    const parseFailure = resolveProjectPipeline(config("demo", {}), getPipelineDefinition, ALL_REVIEW_ROLES_CONFIG);
    const lookupFailure = resolveProjectPipeline(
      config("demo", pipelineConfig("missing")),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    const targetFailure = resolveProjectPipeline(
      config("demo", pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, { missing: "light" })),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );

    expect(hit.ok).toBe(true);
    expect(parseFailure.ok).toBe(false);
    expect(lookupFailure.ok).toBe(false);
    expect(targetFailure.ok).toBe(false);
  });
});
