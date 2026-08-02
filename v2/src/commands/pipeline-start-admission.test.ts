import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { resolveProjectPipeline } from "../execution/project-pipeline-resolution.ts";
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
  fixtureRoot = mkdtempSync(join(process.cwd(), ".scratch", "pipeline-admission-"));
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

    expect(result).toEqual({ kind: "admitted", pipelineId: "pipeline-123" });
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

    expect(result).toEqual({ kind: "admitted", pipelineId: "pipeline-123" });
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

  test("rejects absent, duplicate, and malformed seed fields before configuration access", async () => {
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (hasSeedPath === hasSeedText) return invalid;" -> "if (false) return invalid;"
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
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (projectEntry === undefined) {" -> "if (false) {"
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
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (projectRecord === undefined || !(\"pipeline\" in projectRecord)) {" -> "if (false) {"
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
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (agents === undefined) {" -> "if (false) {"
    const harness = makeHarness({ loadMachineConfig: () => undefined });
    const result = await admitPipelineStart({ projectKey: "demo", seedText: "text" }, harness.deps);
    expect(result).toEqual({
      kind: "pre-admission-failure",
      failure: "missing-machine-model-configuration",
      detail: "Machine config at /fixture/machines/home.json is missing required 'agents' key\n",
    });
    expectNoDaemonContact(harness);
  });

  test("rejects invalid machine-model configuration before daemon contact", async () => {
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (isLoadError(agentModelConfig)) {" -> "if (false) {"
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
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (!pipelineResolution.ok) {" -> "if (false) {"
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
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (isAbsolute(seedPath)) return { ok: false, detail: \"pipeline: --seed must be a relative path\\n\" };" -> "if (false) return { ok: false, detail: \"pipeline: --seed must be a relative path\\n\" };"
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (!statSync(path).isFile()) {" -> "if (false) {"
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (seedPath !== undefined) {" -> "if (false) {"
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
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (!inside(realpathSync(projectRoot), canonical)) {" -> "if (false) {"
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (!seedResolution.ok) {" -> "if (false) {"
    const outside = mkdtempSync(join(process.cwd(), ".scratch", "pipeline-admission-outside-"));
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
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (error instanceof RpcError) {" -> "if (false) {"
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
    // @mutate v2/src/commands/pipeline-start-admission.ts "if (pipelineId === undefined) {" -> "if (pipelineId !== undefined) {"
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
      [async () => ({ pipelineId: "pipeline-123" }), { kind: "admitted", pipelineId: "pipeline-123" }],
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
