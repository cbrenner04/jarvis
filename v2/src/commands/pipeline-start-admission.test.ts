import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RATING_LEVELS } from "../shared/seed-metadata.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { RATING_PAIR_PIPELINES, resolveProjectPipeline } from "../execution/project-pipeline-resolution.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import {
  admitPipelineStart,
  type PipelineStartAdmissionDeps,
  type PipelineStartAdmissionInput,
} from "./pipeline-start-admission.ts";

const AGENT_MODEL_CONFIG: AgentModelConfig = {
  claude: {
    critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] },
    actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] },
    adversary: { rungs: [{ adapterModel: "adversary", priceKey: "adversary" }] },
    advocate: { rungs: [{ adapterModel: "advocate", priceKey: "advocate" }] },
    adjudicator: { rungs: [{ adapterModel: "adjudicator", priceKey: "adjudicator" }] },
    implement: { rungs: [{ adapterModel: "implement", priceKey: "implement" }] },
    plan: { rungs: [{ adapterModel: "plan", priceKey: "plan" }] },
    shrink: { rungs: [{ adapterModel: "shrink", priceKey: "shrink" }] },
  },
};

const RESOLVED_PIPELINE_DEFINITION = {
  name: "fast",
  terminalAction: "leave-draft",
  supersede: "close",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

type RequestRecord = {
  method: string;
  params: unknown;
};

type AdmissionHarness = {
  deps: PipelineStartAdmissionDeps;
  connectCalls: { value: number };
  closeCalls: { value: number };
  requests: RequestRecord[];
};

let fixtureRoot: string;
let invocationCwd: string;

beforeAll(() => {
  mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
  fixtureRoot = trackedMkdtempSync(join(process.cwd(), ".scratch", "pipeline-admission-"));
  invocationCwd = join(fixtureRoot, "invocation");
  mkdirSync(invocationCwd);
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function makeHarness(overrides: Partial<PipelineStartAdmissionDeps> = {}): AdmissionHarness {
  const connectCalls = { value: 0 };
  const closeCalls = { value: 0 };
  const requests: RequestRecord[] = [];
  const connect = overrides.connect ?? (async () => ({ close: () => (closeCalls.value += 1) }));
  const dispatch = overrides.request ?? (async () => ({ pipelineId: "pipeline-123" }));
  const deps: PipelineStartAdmissionDeps = {
    cwd: invocationCwd,
    configPath: "/fixture/machines/home.json",
    readProjectRegistry: () => ({ demo: { root: fixtureRoot, origin: "git@example.test/demo.git" } }),
    readProjectConfigRecord: () => ({ pipeline: { name: "fast", terminalAction: "leave-draft" } }),
    loadMachineConfig: () => ["claude"],
    loadAgentModelConfig: () => AGENT_MODEL_CONFIG,
    resolveProjectPipeline,
    getPipelineDefinition,
    ...overrides,
    connect: async () => {
      connectCalls.value += 1;
      return connect();
    },
    request: async (connection, method, params) => {
      requests.push({ method, params });
      return dispatch(connection, method, params);
    },
  };
  return { deps, connectCalls, closeCalls, requests };
}

function expectNoDaemonContact(harness: AdmissionHarness): void {
  expect(harness.connectCalls.value).toBe(0);
  expect(harness.requests).toHaveLength(0);
}

describe("pipeline start admission", () => {
  test("admits seed text with the resolved definition and exclusive context", async () => {
    const harness = makeHarness();
    const result = await admitPipelineStart({ projectKey: "demo", seedText: "Ship feature" }, harness.deps);

    expect(result).toEqual({ kind: "admitted", pipelineId: "pipeline-123", admittedSelection: null });
    expect(harness.connectCalls.value).toBe(1);
    expect(harness.closeCalls.value).toBe(1);
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]).toEqual({
      method: "pipeline_start",
      params: {
        definition: RESOLVED_PIPELINE_DEFINITION,
        context: {
          cwd: invocationCwd,
          seed: "Ship feature",
          configPath: "/fixture/machines/home.json",
          projectRegistry: { demo: { root: fixtureRoot, origin: "git@example.test/demo.git" } },
        },
        admittedSelection: null,
      },
    });
    expect(harness.requests.some((request) => request.method === "pipeline_wait")).toBe(false);
  });

  test("admits a seed path resolved from invocation cwd while preserving its original value", async () => {
    const seedDir = join(fixtureRoot, "seeds");
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(join(seedDir, "intent.md"), "Intent", "utf8");
    const harness = makeHarness();
    const result = await admitPipelineStart({ projectKey: "demo", seedPath: "../seeds/intent.md" }, harness.deps);

    expect(result).toEqual({ kind: "admitted", pipelineId: "pipeline-123", admittedSelection: null });
    expect(harness.connectCalls.value).toBe(1);
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]).toMatchObject({
      method: "pipeline_start",
      params: {
        definition: RESOLVED_PIPELINE_DEFINITION,
        context: {
          cwd: invocationCwd,
          seedPath: "../seeds/intent.md",
          configPath: "/fixture/machines/home.json",
          projectRegistry: { demo: { root: fixtureRoot, origin: "git@example.test/demo.git" } },
        },
      },
    });
    expect((harness.requests[0]?.params as { context: object }).context).not.toHaveProperty("seed");
    expect(harness.requests.some((request) => request.method === "pipeline_wait")).toBe(false);
  });

  test("merges seed and flag ratings with per-dimension sources through resolution", async () => {
    const ratedProject = () => ({ pipeline: { terminalAction: "leave-draft", minimumRisk: "medium" } });
    const captureResolution = () => {
      const resolutions: ReturnType<typeof resolveProjectPipeline>[] = [];
      const harness = makeHarness({
        readProjectConfigRecord: ratedProject,
        resolveProjectPipeline: (...args) => {
          const result = resolveProjectPipeline(...args);
          resolutions.push(result);
          return result;
        },
      });
      return { harness, resolutions };
    };

    const seedOnly = captureResolution();
    await admitPipelineStart(
      { projectKey: "demo", seedText: "---\nrisk: low\neffort: low\n---\nBody" },
      seedOnly.harness.deps,
    );
    expect(seedOnly.resolutions[0]).toMatchObject({
      ok: true,
      admissionRatings: {
        effective: { risk: "medium", effort: "low" },
        sources: { risk: "minimum", effort: "seed" },
      },
    });
    expect(seedOnly.harness.requests[0]?.params).toMatchObject({
      definition: { name: "full-light-review" },
      admittedSelection: {
        effective: { risk: "medium", effort: "low" },
        sources: { risk: "minimum", effort: "seed" },
        registryName: "full-light-review",
      },
    });

    const riskFlag = captureResolution();
    await admitPipelineStart(
      { projectKey: "demo", seedText: "---\neffort: low\n---\nBody", risk: "high" },
      riskFlag.harness.deps,
    );
    expect(riskFlag.resolutions[0]).toMatchObject({
      ok: true,
      admissionRatings: {
        effective: { risk: "high", effort: "low" },
        sources: { risk: "flag", effort: "seed" },
      },
    });
    expect(riskFlag.harness.requests[0]?.params).toMatchObject({ definition: { name: "full-review" } });

    const effortFlag = captureResolution();
    await admitPipelineStart(
      { projectKey: "demo", seedText: "---\nrisk: low\n---\nBody", effort: "high" },
      effortFlag.harness.deps,
    );
    expect(effortFlag.resolutions[0]).toMatchObject({
      ok: true,
      admissionRatings: {
        effective: { risk: "medium", effort: "high" },
        sources: { risk: "minimum", effort: "flag" },
      },
    });

    const bothFlags = captureResolution();
    await admitPipelineStart(
      { projectKey: "demo", seedText: "---\nrisk: low\neffort: low\n---\nBody", risk: "low", effort: "high" },
      bothFlags.harness.deps,
    );
    expect(bothFlags.resolutions[0]).toMatchObject({
      ok: true,
      admissionRatings: {
        effective: { risk: "medium", effort: "high" },
        sources: { risk: "minimum", effort: "flag" },
      },
    });

    const aboveFloor = captureResolution();
    await admitPipelineStart(
      { projectKey: "demo", seedText: "---\nrisk: low\neffort: low\n---\nBody", risk: "high", effort: "high" },
      aboveFloor.harness.deps,
    );
    expect(aboveFloor.resolutions[0]).toMatchObject({
      ok: true,
      admissionRatings: {
        effective: { risk: "high", effort: "high" },
        sources: { risk: "flag", effort: "flag" },
      },
    });
    expect(aboveFloor.harness.requests[0]?.params).toMatchObject({ definition: { name: "full-review" } });

    const malformed = makeHarness({ readProjectConfigRecord: ratedProject });
    const malformedResult = await admitPipelineStart(
      { projectKey: "demo", seedText: "---\nrisk: low\neffort: low\n---\nBody", risk: "extreme" },
      malformed.deps,
    );
    expect(malformedResult).toMatchObject({
      kind: "pre-admission-failure",
      failure: "invalid-project-pipeline",
      detail: 'invalid-rating: risk rating must be one of low, medium, high; got "extreme"',
    });
    expectNoDaemonContact(malformed);

    // Non-string flag values from an untyped caller refuse as a typed failure instead of throwing.
    const nonString = makeHarness({ readProjectConfigRecord: ratedProject });
    const nonStringResult = await admitPipelineStart(
      { projectKey: "demo", seedText: "---\nrisk: low\neffort: low\n---\nBody", effort: 42 as unknown as string },
      nonString.deps,
    );
    expect(nonStringResult).toMatchObject({
      kind: "pre-admission-failure",
      failure: "invalid-project-pipeline",
      detail: "invalid-rating: effort rating must be one of low, medium, high; got 42",
    });
    expectNoDaemonContact(nonString);
  });

  test("validates rating flags but selects by name when pipeline.name is configured", async () => {
    const resolutions: ReturnType<typeof resolveProjectPipeline>[] = [];
    const harness = makeHarness({
      resolveProjectPipeline: (...args) => {
        const result = resolveProjectPipeline(...args);
        resolutions.push(result);
        return result;
      },
    });
    const result = await admitPipelineStart(
      { projectKey: "demo", seedText: "Body", risk: "high", effort: "high" },
      harness.deps,
    );
    expect(result).toEqual({ kind: "admitted", pipelineId: "pipeline-123", admittedSelection: null });
    expect(harness.requests[0]?.params).toMatchObject({ definition: { name: "fast" } });
    expect(resolutions[0]?.ok).toBe(true);
    expect(resolutions[0]).not.toHaveProperty("admissionRatings");

    const malformed = makeHarness();
    const malformedResult = await admitPipelineStart(
      { projectKey: "demo", seedText: "Body", risk: "extreme", effort: "high" },
      malformed.deps,
    );
    expect(malformedResult).toMatchObject({
      kind: "pre-admission-failure",
      failure: "invalid-project-pipeline",
      detail: 'invalid-rating: risk rating must be one of low, medium, high; got "extreme"',
    });
    expectNoDaemonContact(malformed);
  });

  test("maps distinct rating pairs to admit or refuse per RATING_PAIR_PIPELINES", async () => {
    const ratedProject = () => ({ pipeline: { terminalAction: "leave-draft" } });
    for (const risk of RATING_LEVELS) {
      for (const effort of RATING_LEVELS) {
        const expectedName = RATING_PAIR_PIPELINES[risk][effort];
        const harness = makeHarness({ readProjectConfigRecord: ratedProject });
        const result = await admitPipelineStart(
          { projectKey: "demo", seedText: `---\nrisk: ${risk}\neffort: ${effort}\n---\nBody` },
          harness.deps,
        );
        expect(result).toEqual({
          kind: "admitted",
          pipelineId: "pipeline-123",
          admittedSelection: {
            effective: { risk, effort },
            sources: { risk: "seed", effort: "seed" },
            registryName: expectedName,
          },
        });
        expect(harness.requests[0]?.params).toMatchObject({ definition: { name: expectedName } });
      }
    }
  });

  test("seed frontmatter ratings reach resolution and select the mapped definition for a name-less pipeline", async () => {
    const seedDir = join(fixtureRoot, "rated-seeds");
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(join(seedDir, "risky.md"), "---\nname: risky\nrisk: high\neffort: low\n---\nBody", "utf8");
    const ratedProject = () => ({ pipeline: { terminalAction: "leave-draft", minimumEffort: "medium" } });

    const fromText = makeHarness({ readProjectConfigRecord: ratedProject });
    const textResult = await admitPipelineStart(
      { projectKey: "demo", seedText: "---\nrisk: low\neffort: low\n---\nBody" },
      fromText.deps,
    );
    expect(textResult).toEqual({
      kind: "admitted",
      pipelineId: "pipeline-123",
      admittedSelection: {
        effective: { risk: "low", effort: "medium" },
        sources: { risk: "seed", effort: "minimum" },
        registryName: "full-light-review",
      },
    });
    expect(fromText.requests[0]?.params).toMatchObject({ definition: { name: "full-light-review" } });

    const fromPath = makeHarness({ readProjectConfigRecord: ratedProject });
    const pathResult = await admitPipelineStart(
      { projectKey: "demo", seedPath: "../rated-seeds/risky.md" },
      fromPath.deps,
    );
    expect(pathResult).toEqual({
      kind: "admitted",
      pipelineId: "pipeline-123",
      admittedSelection: {
        effective: { risk: "high", effort: "medium" },
        sources: { risk: "seed", effort: "minimum" },
        registryName: "full-review",
      },
    });
    expect(fromPath.requests[0]?.params).toMatchObject({
      definition: { name: "full-review" },
      context: { seedPath: "../rated-seeds/risky.md" },
    });

    const unrated = makeHarness({ readProjectConfigRecord: ratedProject });
    const unratedResult = await admitPipelineStart({ projectKey: "demo", seedText: "Body" }, unrated.deps);
    expect(unratedResult).toMatchObject({
      kind: "pre-admission-failure",
      failure: "invalid-project-pipeline",
      detail: expect.stringContaining("unresolved-rating: risk rating is unresolved"),
    });
    expectNoDaemonContact(unrated);
  });

  test("rejects a malformed seed rating by field before pipeline resolution", async () => {
    let resolutions = 0;
    const harness = makeHarness({
      resolveProjectPipeline: (...args) => {
        resolutions += 1;
        return resolveProjectPipeline(...args);
      },
    });
    const result = await admitPipelineStart(
      { projectKey: "demo", seedText: "---\neffort: extreme\n---\nBody" },
      harness.deps,
    );
    expect(result).toEqual({
      kind: "pre-admission-failure",
      failure: "invalid-seed-rating",
      detail: 'pipeline: seed frontmatter `effort:` must be one of low, medium, high; got "extreme"\n',
    });
    expect(resolutions).toBe(0);
    expectNoDaemonContact(harness);
  });

  test("rejects absent, duplicate, and malformed seed fields before configuration access", async () => {
    for (const input of [
      { projectKey: "demo" },
      { projectKey: "demo", seedPath: "seed.md", seedText: "text" },
      { projectKey: "demo", seedPath: 1 },
      { projectKey: "demo", seedText: 1 },
      { projectKey: "demo", seedPath: "seed.md", seedText: 1 },
      { projectKey: "demo", seedPath: 1, seedText: "text" },
    ]) {
      const harness = makeHarness({
        readProjectRegistry: () => {
          throw new Error("should not read configuration");
        },
      });
      const result = await admitPipelineStart(input as unknown as PipelineStartAdmissionInput, harness.deps);
      expect(result).toEqual({
        kind: "pre-admission-failure",
        failure: "invalid-seed-input",
        detail: "pipeline: exactly one of seedPath or seedText is required\n",
      });
      expectNoDaemonContact(harness);
    }
  });

  test("rejects an unregistered project before daemon contact", async () => {
    const harness = makeHarness({ readProjectRegistry: () => ({}) });
    const result = await admitPipelineStart({ projectKey: "missing", seedText: "text" }, harness.deps);
    expect(result).toEqual({
      kind: "pre-admission-failure",
      failure: "unregistered-project",
      detail: "unregistered project: missing\n",
    });
    expectNoDaemonContact(harness);
  });

  test("returns typed project and model configuration-read exceptions before daemon contact", async () => {
    for (const overrides of [
      {
        readProjectConfigRecord: () => {
          throw new Error("broken config");
        },
      },
      {
        loadAgentModelConfig: () => {
          throw new Error("broken config");
        },
      },
    ]) {
      const harness = makeHarness(overrides);
      const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
      expect(result).toEqual({
        kind: "pre-admission-failure",
        failure: "configuration-read-exception",
        detail: "Error: broken config\n",
      });
      expectNoDaemonContact(harness);
    }
  });

  test("rejects a missing project pipeline before daemon contact", async () => {
    const harness = makeHarness({ readProjectConfigRecord: () => ({ root: fixtureRoot }) });
    const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
    expect(result).toEqual({
      kind: "pre-admission-failure",
      failure: "missing-pipeline",
      detail: "projects.demo.pipeline is required\n",
    });
    expectNoDaemonContact(harness);
  });

  test("rejects missing machine-model configuration before daemon contact", async () => {
    const harness = makeHarness({ loadMachineConfig: () => undefined });
    const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
    expect(result).toEqual({
      kind: "pre-admission-failure",
      failure: "missing-machine-model-configuration",
      detail: "Machine config at /fixture/machines/home.json is missing required 'agents' key\n",
    });
    expectNoDaemonContact(harness);
  });

  test("validates the project's agents override as its admission agent order", async () => {
    const pipeline = { name: "fast", terminalAction: "leave-draft" };
    const loaded: (readonly string[])[] = [];
    const harness = makeHarness({
      readProjectConfigRecord: () => ({ pipeline, overrides: { agents: ["codex"] } }),
      loadAgentModelConfig: (agents) => {
        loaded.push(agents);
        return AGENT_MODEL_CONFIG;
      },
    });
    await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
    expect(loaded).toEqual([["codex"]]);

    const bad = makeHarness({ readProjectConfigRecord: () => ({ pipeline, overrides: { agentz: ["codex"] } }) });
    const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, bad.deps);
    expect(result).toMatchObject({ kind: "pre-admission-failure", failure: "configuration-read-exception" });
    expect(JSON.stringify(result)).toContain("projects.demo.overrides.agentz");
    expectNoDaemonContact(bad);
  });

  test("rejects invalid machine-model configuration before daemon contact", async () => {
    const harness = makeHarness({
      loadAgentModelConfig: () => ({ errors: ["agent claude: invalid critic", "agent claude: invalid actuator"] }),
    });
    const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
    expect(result).toEqual({
      kind: "pre-admission-failure",
      failure: "invalid-machine-model-configuration",
      detail: "agent claude: invalid critic; agent claude: invalid actuator\n",
    });
    expectNoDaemonContact(harness);
  });

  test("rejects unknown and invalid project pipeline resolution before daemon contact", async () => {
    for (const [pipeline, detail] of [
      [{ name: "absent", terminalAction: "ready" }, "unknown-pipeline: absent"],
      [{ name: "", terminalAction: "ready" }, "invalid-project-pipeline-config: projects.demo.pipeline.name"],
    ] as const) {
      const harness = makeHarness({ readProjectConfigRecord: () => ({ pipeline }) });
      const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
      expect(result).toMatchObject({
        kind: "pre-admission-failure",
        failure: "invalid-project-pipeline",
        detail: expect.stringContaining(detail),
      });
      expectNoDaemonContact(harness);
    }
  });

  test("rejects absolute, missing, and non-file seed paths before daemon contact", async () => {
    mkdirSync(join(invocationCwd, "directory-seed"), { recursive: true });
    for (const [seedPath, detail] of [
      [join(fixtureRoot, "absolute.md"), "pipeline: --seed must be a relative path\n"],
      ["missing.md", "pipeline: cannot resolve seed path:"],
      ["directory-seed", "pipeline: seed is not a file: directory-seed\n"],
    ] as const) {
      const harness = makeHarness();
      const result = await admitPipelineStart({ projectKey: "demo", seedPath }, harness.deps);
      expect(result).toMatchObject({
        kind: "pre-admission-failure",
        failure: "invalid-seed-path",
      });
      expect(result).toHaveProperty("detail", expect.stringContaining(detail));
      expectNoDaemonContact(harness);
    }
  });

  test("rejects unreadable seed files before daemon contact", async () => {
    const seedPath = join(invocationCwd, "unreadable.md");
    writeFileSync(seedPath, "locked", "utf8");
    chmodSync(seedPath, 0o000);
    try {
      const harness = makeHarness();
      const result = await admitPipelineStart({ projectKey: "demo", seedPath: "unreadable.md" }, harness.deps);
      expect(result).toMatchObject({
        kind: "pre-admission-failure",
        failure: "invalid-seed-path",
        detail: expect.stringContaining("pipeline: cannot resolve seed path:"),
      });
      expectNoDaemonContact(harness);
    } finally {
      chmodSync(seedPath, 0o644);
    }
  });

  test("rejects direct and symlink seed escapes before daemon contact", async () => {
    const outside = trackedMkdtempSync(join(process.cwd(), ".scratch", "pipeline-admission-outside-"));
    const outsideSeed = join(outside, "outside.md");
    writeFileSync(outsideSeed, "outside", "utf8");
    symlinkSync(outsideSeed, join(invocationCwd, "escape.md"));
    try {
      for (const seedPath of [`../../${outside.split("/").at(-1)}/outside.md`, "escape.md"]) {
        const harness = makeHarness();
        const result = await admitPipelineStart({ projectKey: "demo", seedPath }, harness.deps);
        expect(result).toMatchObject({
          kind: "pre-admission-failure",
          failure: "invalid-seed-path",
          detail: expect.stringContaining("pipeline: seed escapes registered project after symlink resolution:"),
        });
        expectNoDaemonContact(harness);
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("returns a named daemon refusal without a pipeline id", async () => {
    const harness = makeHarness({
      request: async () => {
        throw new RpcError("admission_failed", "refused");
      },
    });
    const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
    expect(result).toEqual({
      kind: "admission-failure",
      failure: "daemon-refusal",
      detail: "admission_failed: refused\n",
    });
    expect(result).not.toHaveProperty("pipelineId");
    expect(harness.connectCalls.value).toBe(1);
    expect(harness.requests).toHaveLength(1);
    expect(harness.closeCalls.value).toBe(1);
  });

  test("returns a named malformed-success failure without a pipeline id", async () => {
    const harness = makeHarness({ request: async () => ({ accepted: true }) });
    const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
    expect(result).toEqual({
      kind: "admission-failure",
      failure: "malformed-daemon-response",
      detail: "invalid daemon response\n",
    });
    expect(result).not.toHaveProperty("pipelineId");
    expect(harness.connectCalls.value).toBe(1);
    expect(harness.requests).toHaveLength(1);
    expect(harness.closeCalls.value).toBe(1);
  });

  test("returns a named RPC transport failure without a pipeline id", async () => {
    const harness = makeHarness({
      request: async () => {
        throw new Error("IPC connection lost");
      },
    });
    const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
    expect(result).toEqual({
      kind: "admission-failure",
      failure: "rpc-transport-failure",
      detail: "IPC connection lost\n",
    });
    expect(result).not.toHaveProperty("pipelineId");
    expect(harness.connectCalls.value).toBe(1);
    expect(harness.requests).toHaveLength(1);
    expect(harness.closeCalls.value).toBe(1);
  });

  test("returns named connection and auto-start lifecycle failures without a pipeline id", async () => {
    for (const [error, detail] of [
      [new Error("daemon boot failed"), "Error: daemon boot failed\n"],
      [
        new Error("Failed to connect to daemon on socket /fixture/daemon.sock after starting it"),
        "Failed to connect to daemon on socket /fixture/daemon.sock after starting it\n",
      ],
    ] as const) {
      const harness = makeHarness({
        connect: async () => {
          throw error;
        },
      });
      const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
      expect(result).toEqual({
        kind: "admission-failure",
        failure: "connection-lifecycle-failure",
        detail,
      });
      expect(result).not.toHaveProperty("pipelineId");
      expect(harness.connectCalls.value).toBe(1);
      expect(harness.requests).toHaveLength(0);
      expect(harness.closeCalls.value).toBe(0);
    }
  });

  test("preserves admission results when connection cleanup throws", async () => {
    for (const [request, expected] of [
      [
        async () => ({ pipelineId: "pipeline-123" }),
        { kind: "admitted", pipelineId: "pipeline-123", admittedSelection: null },
      ],
      [
        async () => {
          throw new RpcError("admission_failed", "refused");
        },
        { kind: "admission-failure", failure: "daemon-refusal", detail: "admission_failed: refused\n" },
      ],
    ] as const) {
      const harness = makeHarness({
        connect: async () => ({
          close: () => {
            throw new Error("cleanup failed");
          },
        }),
        request,
      });
      await expect(admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps)).resolves.toEqual(
        expected,
      );
    }
  });
});
