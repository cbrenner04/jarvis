import { describe, expect, test } from "bun:test";
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
import { resolveProjectPipeline } from "./project-pipeline-resolution.ts";

const ALL_REVIEW_ROLES_CONFIG: AgentModelConfig = {
  claude: {
    critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] },
    actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] },
    adversary: { rungs: [{ adapterModel: "adversary", priceKey: "adversary" }] },
    advocate: { rungs: [{ adapterModel: "advocate", priceKey: "advocate" }] },
    adjudicator: { rungs: [{ adapterModel: "adjudicator", priceKey: "adjudicator" }] },
  },
};

function config(projectKey: string, pipeline: unknown): ProjectPipelineConfig {
  return { projectKey, pipeline, pipelineKeyPresent: true };
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

describe("readProjectPipelineConfig", () => {
  test("retains the raw pipeline fragment while the project registry remains a root/origin projection", () => {
    const pipeline = { name: "fast", reviewOverrides: { plan: "light" } };
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

    expect(readProjectPipelineConfig("demo", path)).toEqual({
      projectKey: "demo",
      pipeline,
      pipelineKeyPresent: true,
    });
    expect(readProjectRegistry(path)).toEqual({
      demo: { root: "/repo", origin: "git@example.test:demo.git" },
    });
  });

  test("retains the project key and an absent fragment for missing or malformed project ancestors", () => {
    expect(readProjectPipelineConfig("demo", writeConfig({}))).toEqual({
      projectKey: "demo",
      pipeline: undefined,
      pipelineKeyPresent: false,
    });
    expect(readProjectPipelineConfig("demo", writeConfig({ projects: { demo: "bad" } }))).toEqual({
      projectKey: "demo",
      pipeline: undefined,
      pipelineKeyPresent: false,
    });
  });
});

describe("resolveProjectPipeline", () => {
  test("resolves the configured source-owned definition and reports a named registry miss without a default", () => {
    const resolved = resolveProjectPipeline(
      config("demo", { name: "fast" }),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    const selected = getPipelineDefinition("fast");
    if (!selected.ok) throw new Error("expected source definition");
    expect(resolved).toEqual({ ok: true, definition: selected.definition });

    expect(() =>
      resolveProjectPipeline(
        config("demo", { name: "does-not-exist" }),
        getPipelineDefinition,
        ALL_REVIEW_ROLES_CONFIG,
      ),
    ).not.toThrow();
    expect(
      resolveProjectPipeline(
        config("demo", { name: "does-not-exist" }),
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
    ["empty name", { name: "" }, "projects.demo.pipeline.name"],
    ["non-string name", { name: 1 }, "projects.demo.pipeline.name"],
    ["null overrides", { name: "fast", reviewOverrides: null }, "projects.demo.pipeline.reviewOverrides"],
    ["array overrides", { name: "fast", reviewOverrides: [] }, "projects.demo.pipeline.reviewOverrides"],
    ["string overrides", { name: "fast", reviewOverrides: "none" }, "projects.demo.pipeline.reviewOverrides"],
    ["numeric override", { name: "fast", reviewOverrides: { plan: 1 } }, "projects.demo.pipeline.reviewOverrides.plan"],
    ["null override", { name: "fast", reviewOverrides: { plan: null } }, "projects.demo.pipeline.reviewOverrides.plan"],
    ["stages key", { name: "fast", stages: [] }, "projects.demo.pipeline.stages"],
    ["prompt key", { name: "fast", prompt: "x" }, "projects.demo.pipeline.prompt"],
    ["code key", { name: "fast", code: "x" }, "projects.demo.pipeline.code"],
    ["other key", { name: "fast", extra: true }, "projects.demo.pipeline.extra"],
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
      config("demo", { name: "fast" }),
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
      ],
    };
    const lookup = (name: string) =>
      name === "custom"
        ? ({ ok: true, definition: source } as const)
        : ({ ok: false, error: { code: "unknown-pipeline" as const, name } } as const);

    const first = resolveProjectPipeline(
      config("first", { name: "custom", reviewOverrides: { "plan-step": "light" } }),
      lookup,
      ALL_REVIEW_ROLES_CONFIG,
    );
    const second = resolveProjectPipeline(config("second", { name: "custom" }), lookup, ALL_REVIEW_ROLES_CONFIG);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected successful resolutions");
    expect(first.definition.stages).toEqual([
      { stageId: "intent-step", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "approval", kind: "approval" },
      { stageId: "plan-step", kind: "workflow", workflow: "plan", review: "light" },
    ]);
    expect(second.definition).toEqual(source);
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
  });

  test.each([
    ["unknown stage", "missing", "must name an existing workflow stage"],
    ["prototype-named unknown stage", "__proto__", "must name an existing workflow stage"],
    ["approval stage", "approve-intent", "cannot target an approval stage"],
  ])("rejects an %s at its override key", (_label, stageId, message) => {
    const reviewOverrides = JSON.parse(`{"${stageId}":"light"}`) as Record<string, string>;
    const result = resolveProjectPipeline(
      config("demo", { name: "full-review", reviewOverrides }),
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
      ],
    };
    const lookup = () => ({ ok: true, definition: source }) as const;
    const composed: PipelineDefinition = {
      ...source,
      stages: [
        { stageId: "plan-a", kind: "workflow", workflow: "plan", review: "heavy" },
        { stageId: "plan-b", kind: "workflow", workflow: "plan", review: "massive" },
      ],
    };
    const expected = validatePipelineDefinition(composed, { agentModelConfig: ALL_REVIEW_ROLES_CONFIG });
    if (expected.ok) throw new Error("expected validator failure");

    const result = resolveProjectPipeline(
      config("demo", { name: "invalid", reviewOverrides: { "plan-a": "heavy" } }),
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
    const invalidSource: PipelineDefinition = { name: "empty", stages: [] };
    const result = resolveProjectPipeline(
      config("demo", { name: "empty" }),
      () => ({ ok: true, definition: invalidSource }) as const,
      ALL_REVIEW_ROLES_CONFIG,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid-pipeline-definition",
        errors: [
          {
            code: "empty-pipeline",
            stageId: null,
            field: "stages",
            message: "pipeline has no stages",
          },
        ],
      },
    });
  });

  test("positive and negative guards remain distinguishable", () => {
    const hit = resolveProjectPipeline(
      config("demo", { name: "fast" }),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    const parseFailure = resolveProjectPipeline(config("demo", {}), getPipelineDefinition, ALL_REVIEW_ROLES_CONFIG);
    const lookupFailure = resolveProjectPipeline(
      config("demo", { name: "missing" }),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    const targetFailure = resolveProjectPipeline(
      config("demo", { name: "fast", reviewOverrides: { missing: "light" } }),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );

    expect(hit.ok).toBe(true);
    expect(parseFailure.ok).toBe(false);
    expect(lookupFailure.ok).toBe(false);
    expect(targetFailure.ok).toBe(false);
  });
});
