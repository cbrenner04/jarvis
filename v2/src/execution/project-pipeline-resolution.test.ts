import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RATING_LEVELS } from "../shared/seed-metadata.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import {
  type ProjectPipelineConfig,
  readProjectPipelineConfig,
  readProjectRegistry,
} from "../config/machine-config-loader.ts";
import type { PipelineDefinition, PipelineSupersedePolicy, PipelineTerminalAction } from "./pipeline-definition.ts";
import { validatePipelineDefinition } from "./pipeline-definition.ts";
import { getPipelineDefinition } from "./pipeline-registry.ts";
import {
  formatProjectPipelineResolutionError,
  RATING_PAIR_PIPELINES,
  resolveProjectPipeline,
  selectPipelineForRatings,
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
const DEFAULT_SUPERSEDE = "close";

function config(projectKey: string, pipeline: unknown): ProjectPipelineConfig {
  return { projectKey, pipeline };
}

function pipelineConfig(
  name: string,
  terminalAction = DEFAULT_TERMINAL_ACTION,
  reviewOverrides?: Record<string, string>,
  supersede?: string,
): Record<string, unknown> {
  return {
    name,
    terminalAction,
    ...(reviewOverrides === undefined ? {} : { reviewOverrides }),
    ...(supersede === undefined ? {} : { supersede }),
  };
}

function admittedDefinition(
  source: PipelineDefinition,
  terminalAction: PipelineTerminalAction,
  supersede: PipelineSupersedePolicy = DEFAULT_SUPERSEDE,
): PipelineDefinition {
  return { ...source, terminalAction, supersede };
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
  const dir = trackedMkdtempSync(join(tmpdir(), "jarvis-project-pipeline-"));
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

afterEach(() => {});

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
      definition: admittedDefinition(selected.definition, DEFAULT_TERMINAL_ACTION),
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
    ["missing name and terminalAction", {}, "projects.demo.pipeline.terminalAction"],
    ["empty name", { name: "", terminalAction: "leave-draft" }, "projects.demo.pipeline.name"],
    [
      "non-string minimumRisk",
      { name: "fast", terminalAction: "leave-draft", minimumRisk: 2 },
      "projects.demo.pipeline.minimumRisk",
    ],
    [
      "empty minimumEffort",
      { name: "fast", terminalAction: "leave-draft", minimumEffort: "" },
      "projects.demo.pipeline.minimumEffort",
    ],
    [
      "off-scale minimumRisk",
      { name: "fast", terminalAction: "leave-draft", minimumRisk: "extreme" },
      "projects.demo.pipeline.minimumRisk",
    ],
    [
      "off-scale minimumEffort",
      { name: "fast", terminalAction: "leave-draft", minimumEffort: "High" },
      "projects.demo.pipeline.minimumEffort",
    ],
    ["non-string name", { name: 1, terminalAction: "leave-draft" }, "projects.demo.pipeline.name"],
    ["missing terminalAction", { name: "fast" }, "projects.demo.pipeline.terminalAction"],
    ["empty terminalAction", { name: "fast", terminalAction: "" }, "projects.demo.pipeline.terminalAction"],
    ["null terminalAction", { name: "fast", terminalAction: null }, "projects.demo.pipeline.terminalAction"],
    ["non-string terminalAction", { name: "fast", terminalAction: 1 }, "projects.demo.pipeline.terminalAction"],
    ["unknown terminalAction", { name: "fast", terminalAction: "publish" }, "projects.demo.pipeline.terminalAction"],
    [
      "null overrides",
      pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, null as unknown as Record<string, string>),
      "projects.demo.pipeline.reviewOverrides",
    ],
    [
      "array overrides",
      pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, [] as unknown as Record<string, string>),
      "projects.demo.pipeline.reviewOverrides",
    ],
    [
      "string overrides",
      pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, "none" as unknown as Record<string, string>),
      "projects.demo.pipeline.reviewOverrides",
    ],
    [
      "numeric override",
      pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, { plan: 1 as unknown as string }),
      "projects.demo.pipeline.reviewOverrides.plan",
    ],
    [
      "null override",
      pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, { plan: null as unknown as string }),
      "projects.demo.pipeline.reviewOverrides.plan",
    ],
    [
      "off-scale override posture",
      pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, { plan: "Light" }),
      "projects.demo.pipeline.reviewOverrides.plan",
    ],
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

  test.each([
    ["empty", "", "projects.demo.pipeline.supersede must be a non-empty string"],
    ["null", null, "projects.demo.pipeline.supersede must be a string"],
    ["non-string", 1, "projects.demo.pipeline.supersede must be a string"],
    ["unknown", "discard", 'projects.demo.pipeline.supersede has unknown value "discard"'],
    ["whitespace-only", "   ", 'projects.demo.pipeline.supersede has unknown value "   "'],
  ] as Array<
    [string, unknown, string]
  >)("rejects %s supersede with its exact message before lookup", (_label, raw, message) => {
    let lookupCalls = 0;
    const result = resolveProjectPipeline(
      config("demo", { name: "fast", terminalAction: "leave-draft", supersede: raw }),
      (name) => {
        lookupCalls += 1;
        return getPipelineDefinition(name);
      },
      ALL_REVIEW_ROLES_CONFIG,
    );

    expectFailure(result);
    expect(result.error).toEqual({
      code: "invalid-project-pipeline-config",
      key: "projects.demo.pipeline.supersede",
      message,
    });
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
    expect(second.definition).toEqual(admittedDefinition(source, "ready"));
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
    ["leave-draft", "full-light-review"],
    ["ready", "full-light-review"],
    ["merge", "full-light-review"],
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

    expect(first.definition).toEqual(admittedDefinition(source.definition, terminalAction));
    expect(second.definition).toEqual(admittedDefinition(source.definition, terminalAction));
    expect(first.definition).not.toBe(source.definition);
    expect(second.definition).not.toBe(source.definition);
    expect(first.definition).not.toBe(second.definition);
    expect(first.definition.terminalAction).toBe(terminalAction);
    first.definition.terminalAction = "merge";
    expect(second.definition.terminalAction).toBe(terminalAction);
  });

  test("resolves supersede into isolated admitted definitions with registry copy isolation", () => {
    const first = resolveProjectPipeline(
      config("first", pipelineConfig("fast")),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    const second = resolveProjectPipeline(
      config("second", pipelineConfig("fast", DEFAULT_TERMINAL_ACTION, undefined, "keep")),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected successful resolutions");

    const source = getPipelineDefinition("fast");
    if (!source.ok) throw new Error("expected source definition");

    expect(first.definition).toEqual(admittedDefinition(source.definition, DEFAULT_TERMINAL_ACTION, "close"));
    expect(second.definition).toEqual(admittedDefinition(source.definition, DEFAULT_TERMINAL_ACTION, "keep"));
    expect(source.definition.supersede).toBeUndefined();
    expect(first.definition).not.toBe(source.definition);
    expect(second.definition).not.toBe(source.definition);
    expect(first.definition).not.toBe(second.definition);
    const sourceStages = structuredClone(source.definition.stages);
    expect(sourceStages.length).toBeGreaterThan(0);
    delete (first.definition as { supersede?: unknown }).supersede;
    second.definition.stages.length = 0;
    expect(first.definition.stages).toEqual(sourceStages);
    expect(second.definition.supersede).toBe("keep");
    const fresh = getPipelineDefinition("fast");
    if (!fresh.ok) throw new Error("expected source definition");
    expect(fresh.definition.supersede).toBeUndefined();
    expect(fresh.definition.stages).toEqual(sourceStages);
    const again = resolveProjectPipeline(
      config("first", pipelineConfig("fast")),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    if (!again.ok) throw new Error("expected successful resolution");
    expect(again.definition).toEqual(admittedDefinition(source.definition, DEFAULT_TERMINAL_ACTION, "close"));
  });

  test("rejects unknown supersede values before lookup with terminalAction message parity", () => {
    let lookupCalls = 0;
    const result = resolveProjectPipeline(
      config("demo", { name: "fast", terminalAction: "leave-draft", supersede: "discard" }),
      (name) => {
        lookupCalls += 1;
        return getPipelineDefinition(name);
      },
      ALL_REVIEW_ROLES_CONFIG,
    );

    expectFailure(result);
    expect(result.error).toEqual({
      code: "invalid-project-pipeline-config",
      key: "projects.demo.pipeline.supersede",
      message: 'projects.demo.pipeline.supersede has unknown value "discard"',
    });
    expect(lookupCalls).toBe(0);
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

  test("inverting terminal-action conflict guard admits pipelines without an implement workflow stage", () => {});

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

  test("rejects an off-scale override posture at its key and still forwards source validator errors", () => {
    const source: PipelineDefinition = {
      name: "invalid",
      stages: [
        { stageId: "plan-a", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "plan-b", kind: "workflow", workflow: "plan", review: "massive" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const lookup = () => ({ ok: true, definition: source }) as const;

    const offScale = resolveProjectPipeline(
      config("demo", pipelineConfig("invalid", DEFAULT_TERMINAL_ACTION, { "plan-a": "heavy" })),
      lookup,
      ALL_REVIEW_ROLES_CONFIG,
    );
    expectFailure(offScale);
    expect(offScale.error).toEqual({
      code: "invalid-project-pipeline-config",
      key: "projects.demo.pipeline.reviewOverrides.plan-a",
      message: 'projects.demo.pipeline.reviewOverrides.plan-a has unknown review posture "heavy"',
    });

    const composed: PipelineDefinition = {
      ...source,
      terminalAction: DEFAULT_TERMINAL_ACTION,
      supersede: DEFAULT_SUPERSEDE,
      stages: [
        { stageId: "plan-a", kind: "workflow", workflow: "plan", review: "light" },
        { stageId: "plan-b", kind: "workflow", workflow: "plan", review: "massive" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const expected = validatePipelineDefinition(composed, { agentModelConfig: ALL_REVIEW_ROLES_CONFIG });
    if (expected.ok) throw new Error("expected validator failure");

    const result = resolveProjectPipeline(
      config("demo", pipelineConfig("invalid", DEFAULT_TERMINAL_ACTION, { "plan-a": "light" })),
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
        stageId: "plan-b",
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

describe("rating selection", () => {
  const RATED = { terminalAction: DEFAULT_TERMINAL_ACTION };

  function selectedName(pipeline: Record<string, unknown>, supplied?: Record<string, string>): string {
    const result = resolveProjectPipeline(
      config("demo", pipeline),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
      supplied,
    );
    if (!result.ok) throw new Error(`expected resolution, got ${JSON.stringify(result.error)}`);
    return result.definition.name;
  }

  test("maps every (risk, effort) pair to exactly one registry definition", () => {
    const names = new Set<string>();
    for (const risk of RATING_LEVELS) {
      for (const effort of RATING_LEVELS) {
        const name = selectPipelineForRatings({ risk, effort });
        expect(getPipelineDefinition(name).ok).toBe(true);
        expect(RATING_PAIR_PIPELINES[risk][effort]).toBe(name);
        expect(selectedName(RATED, { risk, effort })).toBe(name);
        names.add(name);
      }
    }
    expect(names).toEqual(new Set(["fast", "full-light-review", "full-review"]));
    expect(selectPipelineForRatings({ risk: "high", effort: "low" })).toBe("full-review");
    expect(selectPipelineForRatings({ risk: "low", effort: "high" })).toBe("full-light-review");
    expect(selectPipelineForRatings({ risk: "low", effort: "low" })).toBe("fast");
    expect(selectPipelineForRatings({ risk: "medium", effort: "medium" })).toBe("full-light-review");
  });

  test("floors each dimension independently: below the minimum rises to it, above keeps its value", () => {
    const floors = { ...RATED, minimumRisk: "medium", minimumEffort: "medium" };
    expect(selectedName(floors, { risk: "low", effort: "low" })).toBe("full-light-review");
    expect(selectedName(floors, { risk: "high", effort: "low" })).toBe("full-review");
    expect(selectedName({ ...RATED, minimumRisk: "high" }, { risk: "low", effort: "low" })).toBe("full-review");
    expect(selectedName({ ...RATED, minimumEffort: "high" }, { risk: "low", effort: "low" })).toBe("full-light-review");
    expect(selectedName({ ...RATED, minimumRisk: "low", minimumEffort: "low" }, { risk: "high", effort: "high" })).toBe(
      "full-review",
    );
    const floored = resolveProjectPipeline(
      config("demo", { ...RATED, minimumRisk: "medium" }),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
      { risk: "low", effort: "low" },
    );
    expect(floored.ok).toBe(true);
    if (!floored.ok) throw new Error("expected resolution");
    expect(floored.admissionRatings).toEqual({
      effective: { risk: "medium", effort: "low" },
      sources: { risk: "minimum", effort: "seed" },
    });
  });

  test("a minimum is a floor, not a default: nothing supplied is unresolved with or without minimums", () => {
    for (const pipeline of [RATED, { ...RATED, minimumRisk: "high", minimumEffort: "high" }]) {
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
      expect(result.error).toEqual({
        code: "unresolved-rating",
        dimension: "risk",
        message:
          "risk rating is unresolved: neither seed frontmatter nor --risk supplies one, and a project minimum is a floor, not a default",
      });
      expect(lookupCalls).toBe(0);
    }
  });

  test("validates a supplied rating before the floor applies and names an unresolved dimension before lookup", () => {
    let lookupCalls = 0;
    const lookup = (name: string) => {
      lookupCalls += 1;
      return getPipelineDefinition(name);
    };
    const malformed = resolveProjectPipeline(
      config("demo", { ...RATED, minimumRisk: "high", minimumEffort: "high" }),
      lookup,
      ALL_REVIEW_ROLES_CONFIG,
      { risk: "extreme", effort: "low" },
    );
    expectFailure(malformed);
    expect(malformed.error).toEqual({
      code: "invalid-rating",
      dimension: "risk",
      value: "extreme",
      message: 'risk rating must be one of low, medium, high; got "extreme"',
    });

    const unresolved = resolveProjectPipeline(
      config("demo", { ...RATED, minimumRisk: "low" }),
      lookup,
      ALL_REVIEW_ROLES_CONFIG,
      {
        risk: "high",
      },
    );
    expectFailure(unresolved);
    expect(unresolved.error).toEqual({
      code: "unresolved-rating",
      dimension: "effort",
      message:
        "effort rating is unresolved: neither seed frontmatter nor --effort supplies one, and a project minimum is a floor, not a default",
    });
    expect(formatProjectPipelineResolutionError(unresolved)).toBe(
      "unresolved-rating: effort rating is unresolved: neither seed frontmatter nor --effort supplies one, and a project minimum is a floor, not a default",
    );
    expect(selectedName(RATED, { risk: " high ", effort: "low" })).toBe("full-review");
    expect(lookupCalls).toBe(0);
  });

  test("rejects a malformed or non-string supplied rating before the name short-circuit, without throwing", () => {
    const withName = resolveProjectPipeline(
      config("demo", { ...RATED, name: "fast" }),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
      { risk: "extreme", effort: "low" },
    );
    expectFailure(withName);
    expect(withName.error).toEqual({
      code: "invalid-rating",
      dimension: "risk",
      value: "extreme",
      message: 'risk rating must be one of low, medium, high; got "extreme"',
    });

    const nonString = resolveProjectPipeline(config("demo", RATED), getPipelineDefinition, ALL_REVIEW_ROLES_CONFIG, {
      risk: "low",
      effort: 42,
    });
    expectFailure(nonString);
    expect(nonString.error).toEqual({
      code: "invalid-rating",
      dimension: "effort",
      value: "42",
      message: "effort rating must be one of low, medium, high; got 42",
    });
  });

  test("an explicit pipeline.name wins over ratings and minimums", () => {
    expect(
      selectedName(
        { ...RATED, name: "fast", minimumRisk: "high", minimumEffort: "high" },
        { risk: "high", effort: "high" },
      ),
    ).toBe("fast");
    expect(selectedName({ ...RATED, name: "fast" })).toBe("fast");
    expect(selectedName({ ...RATED, name: "fast", minimumRisk: "high" })).toBe("fast");
    const malformedMinimum = resolveProjectPipeline(
      config("demo", { ...RATED, name: "fast", minimumRisk: "extreme" }),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    expectFailure(malformedMinimum);
    expect(malformedMinimum.error).toEqual({
      code: "invalid-project-pipeline-config",
      key: "projects.demo.pipeline.minimumRisk",
      message: 'projects.demo.pipeline.minimumRisk has unknown value "extreme"',
    });
  });

  test("review overrides may strengthen but never weaken a rating-selected pipeline", () => {
    const weakened = resolveProjectPipeline(
      config("demo", { ...RATED, minimumRisk: "high", reviewOverrides: { plan: "light" } }),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
      { risk: "low", effort: "low" },
    );
    expectFailure(weakened);
    expect(weakened.error).toEqual({
      code: "invalid-project-pipeline-config",
      key: "projects.demo.pipeline.reviewOverrides.plan",
      message:
        'projects.demo.pipeline.reviewOverrides.plan cannot weaken review "debate" to "light" below the rating-selected pipeline "full-review" (risk high, effort low)',
    });

    const strengthened = resolveProjectPipeline(
      config("demo", { ...RATED, reviewOverrides: { implement: "debate" } }),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
      { risk: "low", effort: "low" },
    );
    expect(strengthened.ok).toBe(true);
    if (!strengthened.ok) throw new Error("expected resolution");
    expect(strengthened.definition.stages.at(-1)).toEqual({
      stageId: "implement",
      kind: "workflow",
      workflow: "implement",
      review: "debate",
    });

    const explicitName = resolveProjectPipeline(
      config("demo", { ...RATED, name: "full-review", reviewOverrides: { plan: "light" } }),
      getPipelineDefinition,
      ALL_REVIEW_ROLES_CONFIG,
    );
    expect(explicitName.ok).toBe(true);
  });
});
