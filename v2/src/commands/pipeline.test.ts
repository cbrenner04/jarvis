import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  PIPELINE_APPROVE_USAGE,
  PIPELINE_LIST_USAGE,
  PIPELINE_RECOVER_USAGE,
  PIPELINE_REJECT_USAGE,
  PIPELINE_RESUME_USAGE,
  PIPELINE_START_USAGE,
  PIPELINE_USAGE,
  PIPELINE_WAIT_USAGE,
} from "../cli/usage.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import {
  type CliRepoFixture,
  captureIo,
  cliMain as main,
  makeCliRepoFixture,
  makeIpcClient,
  SESSION_UUID,
  writeMachineConfig,
} from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";

let fx: CliRepoFixture;

beforeAll(() => {
  fx = makeCliRepoFixture();
});

afterAll(() => {
  fx.cleanup();
});

const ALL_REVIEW_ROLES_CONFIG: AgentModelConfig = {
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

function pipelineMachineConfig(projectKey: string, pipeline: unknown, root: string): string {
  return writeMachineConfig({
    machineProfile: "home",
    agents: ["claude"],
    projects: { [projectKey]: { root, pipeline } },
  });
}

function pipelineFrames(
  startRequestId: string,
  waitRequestIds: readonly string[],
  pipelineId: string,
  waitResults: readonly unknown[],
): unknown[] {
  const frames: unknown[] = [{ kind: "response", id: startRequestId, result: { pipelineId } }];
  for (let index = 0; index < waitRequestIds.length; index += 1) {
    frames.push({ kind: "response", id: waitRequestIds[index], result: waitResults[index] });
  }
  return frames;
}

function noDaemonDeps(extra: NonNullable<Parameters<typeof main>[2]> = {}): NonNullable<Parameters<typeof main>[2]> {
  return {
    connectIpcClient: async () => {
      throw new Error("should not contact daemon");
    },
    ...extra,
  };
}

async function expectPipelineConfigRejectedBeforeConnect(pipeline: unknown, stderrContains: string): Promise<void> {
  const cap = captureIo();
  const configPath = pipelineMachineConfig("demo", pipeline, fx.repoRoot);
  let contacted = false;
  const code = await main(["pipeline", "start", "demo", "--seed-text", "Ship feature"], cap.io, {
    ...noDaemonDeps(pipelineDeps(configPath)),
    connectIpcClient: async () => {
      contacted = true;
      throw new Error("should not contact daemon");
    },
  });
  expect(code).toBe(1);
  expect(contacted).toBe(false);
  expect(cap.read().stderr).toContain(stderrContains);
  expect(cap.read().stdout).toBe("");
}

function pipelineDeps(
  configPath: string | undefined,
  extra: NonNullable<Parameters<typeof main>[2]> = {},
): NonNullable<Parameters<typeof main>[2]> {
  return {
    cwd: () => fx.repoRoot,
    ...(configPath === undefined
      ? {}
      : {
          machineConfigPath: configPath,
          readProjectRegistry: () => ({ demo: { root: fx.repoRoot } }),
          loadAgentModelConfig: () => ALL_REVIEW_ROLES_CONFIG,
        }),
    ...extra,
  };
}

function ipcClientAbortingOnWait(frames: unknown[], sent: unknown[]): ReturnType<typeof makeIpcClient> {
  const client = makeIpcClient(frames, { sent });
  return {
    send(frame: unknown): void {
      client.send(frame);
      if ((frame as { method?: string }).method === "pipeline_wait") client.close();
    },
    nextFrame: client.nextFrame,
    close: client.close,
  };
}

function pipelineStartClients(frames: unknown[], sent: unknown[]): () => Promise<ReturnType<typeof makeIpcClient>> {
  let connected = false;
  return async () => {
    if (connected) throw new Error("pipeline start must retain its admitted connection");
    connected = true;
    return makeIpcClient(frames, { sent });
  };
}

function pipelineListFrame(id: string, pipelines: unknown[]): unknown {
  return { kind: "response", id, result: { pipelines } };
}

function pipelineWaitFrame(id: string, boundary: unknown): unknown {
  return { kind: "response", id, result: boundary };
}

const SAMPLE_PIPELINE_SNAPSHOT = {
  pipelineId: "pipe-1",
  name: "sample-pipeline",
  state: "awaiting-approval",
  terminalAction: "ready",
  seedPath: "seeds/intent.md",
  terminalPublicationSucceededAt: null,
  terminalPublicationFailure: null,
  createdAt: 1_700_000_000_000,
  finishedAtMs: null,
  stages: [
    {
      id: "stage-plan",
      stageId: "plan",
      branchKey: "default",
      position: 0,
      status: "succeeded",
      workflowInvocationId: "inv-plan",
      startedAt: 1_700_000_001_000,
      endedAt: 1_700_000_002_000,
      artifact: false,
      failureDetail: 0,
    },
    {
      id: "stage-gate",
      stageId: "gate",
      branchKey: "default",
      position: 1,
      status: "awaiting",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      artifact: "",
      failureDetail: null,
    },
  ],
};

const SAMPLE_PIPELINE_WITH_OMITTED_OPTIONALS = {
  pipelineId: "pipe-2",
  name: "no-options",
  state: "succeeded",
  terminalPublicationSucceededAt: 1_700_000_004_000,
  terminalPublicationFailure: null,
  createdAt: 1_700_000_003_000,
  finishedAtMs: 1_700_000_004_000,
  stages: [],
};

const LIVE_RUNNING_SNAPSHOT = {
  pipelineId: "pipe-live",
  name: "fast",
  state: "running",
  stages: [
    { stageId: "s1", branchKey: "default", status: "running", workflowInvocationId: "inv-1" },
    { stageId: "s2", branchKey: "default", status: "pending", workflowInvocationId: null },
  ],
};

const TWO_BRANCH_FAN_STAGES = [
  { stageId: "intent", branchKey: "default", status: "succeeded", workflowInvocationId: "inv-intent" },
  { stageId: "gate", branchKey: "default", status: "skipped", workflowInvocationId: null },
  { stageId: "gate", branchKey: "alpha", status: "pending", workflowInvocationId: null },
  { stageId: "gate", branchKey: "beta", status: "pending", workflowInvocationId: null },
  { stageId: "plan", branchKey: "default", status: "skipped", workflowInvocationId: null },
  { stageId: "plan", branchKey: "alpha", status: "pending", workflowInvocationId: null },
  { stageId: "plan", branchKey: "beta", status: "pending", workflowInvocationId: null },
  { stageId: "implement", branchKey: "default", status: "skipped", workflowInvocationId: null },
  { stageId: "implement", branchKey: "alpha", status: "pending", workflowInvocationId: null },
  { stageId: "implement", branchKey: "beta", status: "pending", workflowInvocationId: null },
] as const;

function twoBranchFanSnapshot(
  state: string,
  gate: { alpha: string; beta: string },
  planBeta?: { status: string; workflowInvocationId?: string | null },
) {
  return {
    pipelineId: "pipe-fan",
    name: "fan-out",
    state,
    stages: TWO_BRANCH_FAN_STAGES.map((row) => {
      if (row.stageId === "gate" && row.branchKey === "alpha") return { ...row, status: gate.alpha };
      if (row.stageId === "gate" && row.branchKey === "beta") return { ...row, status: gate.beta };
      if (planBeta !== undefined && row.stageId === "plan" && row.branchKey === "beta") {
        return {
          ...row,
          status: planBeta.status,
          workflowInvocationId: planBeta.workflowInvocationId ?? null,
        };
      }
      return { ...row };
    }),
  };
}

const TWO_BRANCH_PIPELINE_SNAPSHOT = twoBranchFanSnapshot(
  "running",
  { alpha: "awaiting", beta: "approved" },
  { status: "running", workflowInvocationId: "inv-beta-plan" },
);
const TWO_BRANCH_AWAITING_SNAPSHOT = twoBranchFanSnapshot("awaiting-approval", {
  alpha: "awaiting",
  beta: "awaiting",
});

function ipcFramesWithMethod(sent: readonly unknown[], method: string): unknown[] {
  return sent.filter((frame) => (frame as { method?: string }).method === method);
}

function pipelineStartContext(sent: readonly unknown[]): Record<string, unknown> | undefined {
  return (ipcFramesWithMethod(sent, "pipeline_start")[0] as { params?: { context?: Record<string, unknown> } }).params
    ?.context;
}

async function expectSeedRejectedBeforeConnect(seedArg: string, stderrContains: string): Promise<void> {
  const cap = captureIo();
  const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);
  let contacted = false;
  const code = await main(["pipeline", "start", "demo", "--seed", seedArg], cap.io, {
    ...noDaemonDeps(pipelineDeps(configPath)),
    connectIpcClient: async () => {
      contacted = true;
      throw new Error("should not contact daemon");
    },
  });
  expect(code).toBe(1);
  expect(contacted).toBe(false);
  expect(cap.read().stdout).toBe("");
  expect(cap.read().stderr).toContain(stderrContains);
}

describe("pipeline start", () => {
  test("prints admitted pipeline ID on valid start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);

    const code = await withFixedUuid([SESSION_UUID, "pipe-start", "pipe-wait"], () =>
      main(["pipeline", "start", "demo", "--seed-text", "Ship feature"], cap.io, {
        ...pipelineDeps(configPath),
        connectIpcClient: pipelineStartClients(
          pipelineFrames("pipe-start", ["pipe-wait"], "pipe-abc", [{ kind: "terminal", state: "succeeded" }]),
          sent,
        ),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({
      stdout: 'pipe-abc\n{"kind":"terminal","state":"succeeded"}\n',
      stderr: "",
    });
    expect(ipcFramesWithMethod(sent, "pipeline_start")).toHaveLength(1);
    expect(ipcFramesWithMethod(sent, "pipeline_start")[0]).toMatchObject({
      params: {
        context: {
          cwd: fx.repoRoot,
          seed: "Ship feature",
          configPath,
          projectRegistry: { demo: { root: fx.repoRoot } },
        },
      },
    });
    expect(pipelineStartContext(sent)).not.toHaveProperty("seedPath");
    // Mutation checkpoint: setting `seedPath` on the text branch turns the test RED.
  });

  test("rejects invalid project pipeline configuration before daemon connect", async () => {
    // Inversion target: resolveProjectPipeline failure branch in pipeline-start-admission.ts — falling through to daemon IPC turns this test RED.
    await expectPipelineConfigRejectedBeforeConnect(
      { name: "" },
      "invalid-project-pipeline-config: projects.demo.pipeline.name",
    );
  });

  test("rejects project pipeline missing terminalAction before daemon connect", async () => {
    // Inversion target: resolveProjectPipeline failure branch in pipeline-start-admission.ts — falling through to daemon IPC turns this test RED.
    await expectPipelineConfigRejectedBeforeConnect(
      { name: "fast" },
      "invalid-project-pipeline-config: projects.demo.pipeline.terminalAction",
    );
  });

  test("refuses a registered project with no pipeline key before daemon connect", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({
      machineProfile: "home",
      agents: ["claude"],
      projects: { demo: { root: fx.repoRoot } },
    });

    const code = await main(["pipeline", "start", "demo", "--seed-text", "Ship feature"], cap.io, {
      ...noDaemonDeps(pipelineDeps(configPath)),
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "projects.demo.pipeline is required\n",
    });
  });

  test("refuses an unregistered project before daemon connect", async () => {
    const cap = captureIo();
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);

    const code = await main(["pipeline", "start", "missing", "--seed-text", "Ship feature"], cap.io, {
      ...noDaemonDeps(pipelineDeps(configPath)),
      readProjectRegistry: () => ({ demo: { root: fx.repoRoot } }),
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "unregistered project: missing\n" });
  });

  test("prints usage when seed flags are missing or combined", async () => {
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);
    const deps = noDaemonDeps(pipelineDeps(configPath));

    const missingCap = captureIo();
    const missing = await main(["pipeline", "start", "demo"], missingCap.io, deps);
    expect(missing).toBe(1);
    expect(missingCap.read().stderr).toBe(PIPELINE_START_USAGE);

    const bothCap = captureIo();
    const both = await main(["pipeline", "start", "demo", "--seed", "seed.md", "--seed-text", "x"], bothCap.io, deps);
    expect(both).toBe(1);
    expect(bothCap.read().stderr).toBe(PIPELINE_START_USAGE);
  });

  test("--detach exits 0 after admission without pipeline_wait", async () => {
    // Inversion target: runPipelineStartCommand detach branch in pipeline.ts — blocking on pipeline_wait when detach is true turns this test RED.
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);

    const code = await withFixedUuid([SESSION_UUID, "pipe-detach"], () =>
      main(["pipeline", "start", "demo", "--seed-text", "Ship feature", "--detach"], cap.io, {
        ...pipelineDeps(configPath),
        connectIpcClient: async () => makeIpcClient(pipelineFrames("pipe-detach", [], "pipe-detach-1", []), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "pipe-detach-1\n", stderr: "" });
    expect(ipcFramesWithMethod(sent, "pipeline_start")).toHaveLength(1);
    expect(ipcFramesWithMethod(sent, "pipeline_wait")).toHaveLength(0);
  });

  test("attached start waits through awaiting-approval to terminal JSON and exit code", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);

    const code = await withFixedUuid([SESSION_UUID, "pipe-att", "pipe-w1", "pipe-w2"], () =>
      main(["pipeline", "start", "demo", "--seed-text", "Ship feature"], cap.io, {
        ...pipelineDeps(configPath),
        connectIpcClient: pipelineStartClients(
          pipelineFrames("pipe-att", ["pipe-w1", "pipe-w2"], "pipe-att-1", [
            { kind: "awaiting-approval", stageId: "approve-intent", branchKey: "default" },
            { kind: "terminal", state: "failed" },
          ]),
          sent,
        ),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: 'pipe-att-1\n{"kind":"terminal","state":"failed"}\n',
      stderr: "",
    });
    expect(ipcFramesWithMethod(sent, "pipeline_wait")).toHaveLength(2);
  });

  test("failed daemon admission exits non-zero with stderr detail and no pipeline ID on stdout", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);

    const code = await withFixedUuid([SESSION_UUID, "pipe-fail"], () =>
      main(["pipeline", "start", "demo", "--seed-text", "Ship feature"], cap.io, {
        ...pipelineDeps(configPath),
        connectIpcClient: async () =>
          makeIpcClient([{ kind: "error", id: "pipe-fail", code: "admission_failed", message: "refused" }], {
            sent,
          }),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "admission_failed: refused\n" });
    expect(ipcFramesWithMethod(sent, "pipeline_start")).toHaveLength(1);
  });

  test("operator abort during attached start reports stderr detail without boundary JSON", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);

    const code = await withFixedUuid([SESSION_UUID, "pipe-abort", "pipe-abort-w"], () =>
      main(["pipeline", "start", "demo", "--seed-text", "Ship feature"], cap.io, {
        ...pipelineDeps(configPath),
        connectIpcClient: async () =>
          ipcClientAbortingOnWait([{ kind: "response", id: "pipe-abort", result: { pipelineId: "pipe-abort" } }], sent),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("pipe-abort\n");
    expect(cap.read().stderr).toContain("IPC connection lost");
    expect(ipcFramesWithMethod(sent, "pipeline_wait")).toHaveLength(1);
  });

  test("admits --seed as context.seedPath without inlining file content", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const seedRelative = "seeds/seed.md";
    mkdirSync(join(fx.repoRoot, "seeds"), { recursive: true });
    writeFileSync(join(fx.repoRoot, seedRelative), "From file", "utf8");

    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);
    const code = await withFixedUuid([SESSION_UUID, "pipe-seed", "pipe-seed-w"], () =>
      main(["pipeline", "start", "demo", "--seed", seedRelative], cap.io, {
        ...pipelineDeps(configPath),
        connectIpcClient: pipelineStartClients(
          pipelineFrames("pipe-seed", ["pipe-seed-w"], "pipe-seed-1", [{ kind: "terminal", state: "succeeded" }]),
          sent,
        ),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("pipe-seed-1\n");
    expect(ipcFramesWithMethod(sent, "pipeline_start")).toHaveLength(1);
    const context = pipelineStartContext(sent);
    expect(context?.seedPath).toBe(seedRelative);
    expect(context).not.toHaveProperty("seed");
    // Mutation checkpoint: stuffing file text into `context.seed` turns the test RED.
  });

  test.each([
    ["/absolute/seed.md", "pipeline: --seed must be a relative path"],
    ["missing-seed.md", "pipeline: cannot resolve seed path:"],
    [".", "pipeline: seed is not a file: ."],
  ] as const)("rejects --seed %p before daemon connect", async (seedArg, stderrPrefix) => {
    await expectSeedRejectedBeforeConnect(seedArg, stderrPrefix);
  });

  test("rejects unreadable --seed file before daemon connect", async () => {
    const seedPath = join(fx.repoRoot, "locked.md");
    writeFileSync(seedPath, "locked", "utf8");
    chmodSync(seedPath, 0o000);
    try {
      await expectSeedRejectedBeforeConnect("locked.md", "pipeline: cannot resolve seed path:");
    } finally {
      chmodSync(seedPath, 0o644);
    }
  });

  test("rejects --seed outside registered project root before daemon connect", async () => {
    const outsideSeed = join(dirname(fx.repoRoot), "outside-seed.md");
    writeFileSync(outsideSeed, "outside", "utf8");
    try {
      await expectSeedRejectedBeforeConnect(
        "../outside-seed.md",
        "pipeline: seed escapes registered project after symlink resolution:",
      );
    } finally {
      try {
        unlinkSync(outsideSeed);
      } catch {
        // best-effort cleanup
      }
    }
    // Mutation checkpoint: inverting the project-root containment guard in `resolvePipelineSeed` turns both cases RED.
  });

  test("rejects --seed symlink escape outside registered project root before daemon connect", async () => {
    const outside = mkdtempSync(join(tmpdir(), "jarvis-pipeline-outside-"));
    writeFileSync(join(outside, "escaped.md"), "escaped", "utf8");
    symlinkSync(join(outside, "escaped.md"), join(fx.repoRoot, "escaped.md"));
    await expectSeedRejectedBeforeConnect(
      "escaped.md",
      "pipeline: seed escapes registered project after symlink resolution:",
    );
  });
});

describe("pipeline list", () => {
  const SEC = 1_000;
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  test("list --json preserves the unmodified pipeline_list snapshot", async () => {
    // Mutation checkpoint: the human path must not run when --json is given.
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, "pipe-list"], () =>
      main(["pipeline", "list", "--json"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient(
            [pipelineListFrame("pipe-list", [SAMPLE_PIPELINE_SNAPSHOT, SAMPLE_PIPELINE_WITH_OMITTED_OPTIONALS])],
            { sent },
          ),
      }),
    );
    // @mutate v2/src/commands/pipeline.ts "if (parsed.json) {" -> "if (false) {"

    expect(code).toBe(0);
    expect(cap.read()).toEqual({
      stdout: `${JSON.stringify({
        pipelines: [SAMPLE_PIPELINE_SNAPSHOT, SAMPLE_PIPELINE_WITH_OMITTED_OPTIONALS],
      })}\n`,
      stderr: "",
    });
    expect(ipcFramesWithMethod(sent, "pipeline_list")).toHaveLength(1);
    expect(ipcFramesWithMethod(sent, "pipeline_wait")).toHaveLength(0);
  });

  test("list --json prints the empty pipelines array unmodified", async () => {
    const cap = captureIo();

    const code = await withFixedUuid([SESSION_UUID, "pipe-list-empty"], () =>
      main(["pipeline", "list", "--json"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => makeIpcClient([pipelineListFrame("pipe-list-empty", [])]),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toBe('{"pipelines":[]}\n');
  });

  test("live list returns within 500ms while reporting a non-terminal derived state", async () => {
    // Inversion target: runPipelineListCommand single-fetch path in pipeline.ts — polling pipeline_list until terminals settle turns this test RED.
    const cap = captureIo();
    const sent: unknown[] = [];
    const startedAt = Date.now();

    const code = await withFixedUuid([SESSION_UUID, "pipe-list-live"], () =>
      main(["pipeline", "list", "--json"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([pipelineListFrame("pipe-list-live", [LIVE_RUNNING_SNAPSHOT])], { sent }),
      }),
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(code).toBe(0);
    expect(JSON.parse(cap.read().stdout.trim())).toEqual({ pipelines: [LIVE_RUNNING_SNAPSHOT] });
    expect(ipcFramesWithMethod(sent, "pipeline_list")).toHaveLength(1);
  });

  test("two-branch list stdout shows distinguishable branchKey values and per-branch statuses", async () => {
    // Inversion target: runPipelineListCommand JSON passthrough in pipeline.ts — collapsing stage rows to one per stageId turns this test RED.
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, "pipe-list-fan"], () =>
      main(["pipeline", "list", "--json"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([pipelineListFrame("pipe-list-fan", [TWO_BRANCH_PIPELINE_SNAPSHOT])], { sent }),
      }),
    );

    expect(code).toBe(0);
    const snapshot = JSON.parse(cap.read().stdout.trim()) as { pipelines: (typeof TWO_BRANCH_PIPELINE_SNAPSHOT)[] };
    const stages = snapshot.pipelines[0]?.stages ?? [];
    expect(stages.filter((row) => row.stageId === "gate")).toHaveLength(3);
    expect(stages.filter((row) => row.stageId === "gate" && row.branchKey === "alpha")).toEqual([
      { stageId: "gate", branchKey: "alpha", status: "awaiting", workflowInvocationId: null },
    ]);
    expect(stages.filter((row) => row.stageId === "plan" && row.branchKey === "beta")).toEqual([
      { stageId: "plan", branchKey: "beta", status: "running", workflowInvocationId: "inv-beta-plan" },
    ]);
    expect(new Set(stages.map((row) => row.branchKey)).size).toBeGreaterThan(1);
    expect(ipcFramesWithMethod(sent, "pipeline_list")).toHaveLength(1);
  });

  test("list renders one human row per pipeline", async () => {
    // @mutate v2/src/commands/pipeline.ts "io.stdout(renderPipelineListRows(selected, deps.now()));" -> "io.stdout(`${JSON.stringify(snapshot)}\n`);"
    const NOW_MS = 2_000_000_000_000;
    const cap = captureIo();
    const sent: unknown[] = [];

    const glyphPipeline = {
      pipelineId: "cccccccc-glyphs",
      name: "glyph-check",
      state: "awaiting-approval",
      seedPath: undefined,
      createdAt: NOW_MS - 3 * SEC,
      stages: [
        { stageId: "st-interrupted", branchKey: "default", position: 0, status: "interrupted" },
        { stageId: "st-rejected", branchKey: "default", position: 1, status: "rejected" },
        { stageId: "st-failed", branchKey: "default", position: 2, status: "failed" },
        { stageId: "st-running", branchKey: "default", position: 3, status: "running" },
        { stageId: "st-awaiting", branchKey: "default", position: 4, status: "awaiting" },
        { stageId: "st-pending", branchKey: "default", position: 5, status: "pending" },
        { stageId: "st-skipped", branchKey: "default", position: 6, status: "skipped" },
        { stageId: "st-approved", branchKey: "default", position: 7, status: "approved" },
        { stageId: "st-succeeded", branchKey: "default", position: 8, status: "succeeded" },
        { stageId: "fan", branchKey: "default", position: 9, status: "skipped" },
        { stageId: "fan", branchKey: "alpha", position: 9, status: "running" },
        { stageId: "fan", branchKey: "beta", position: 9, status: "pending" },
      ],
    };
    const zeroPipeline = {
      pipelineId: "00000000-zero",
      name: "zero-age",
      state: "running",
      seedPath: "seeds/zero.md",
      createdAt: NOW_MS,
      stages: [{ stageId: "only", branchKey: "default", position: 0, status: "succeeded" }],
    };
    const secPipeline = {
      pipelineId: "11111111-sec",
      name: "sec-age",
      state: "succeeded",
      seedPath: undefined,
      createdAt: NOW_MS - 7 * SEC,
      stages: [{ stageId: "only", branchKey: "default", position: 0, status: "succeeded" }],
    };
    const tieA = {
      pipelineId: "22222222-tie",
      name: "tie-a",
      state: "succeeded",
      seedPath: "a.md",
      createdAt: NOW_MS - 5 * MIN,
      stages: [{ stageId: "only", branchKey: "default", position: 0, status: "succeeded" }],
    };
    const tieB = {
      pipelineId: "33333333-tie",
      name: "tie-b",
      state: "succeeded",
      seedPath: "b.md",
      createdAt: NOW_MS - 5 * MIN,
      stages: [{ stageId: "only", branchKey: "default", position: 0, status: "succeeded" }],
    };
    const minPipeline = {
      pipelineId: "44444444-min",
      name: "min-age",
      state: "failed",
      seedPath: "min.md",
      createdAt: NOW_MS - (42 * MIN + 10 * SEC),
      stages: [{ stageId: "only", branchKey: "default", position: 0, status: "failed" }],
    };
    const hourPipeline = {
      pipelineId: "55555555-hour",
      name: "hour-age",
      state: "interrupted",
      seedPath: undefined,
      createdAt: NOW_MS - (5 * HOUR + 40 * MIN),
      stages: [{ stageId: "only", branchKey: "default", position: 0, status: "interrupted" }],
    };
    const dayPipeline = {
      pipelineId: "66666666-day",
      name: "day-age",
      state: "rejected",
      seedPath: "day.md",
      createdAt: NOW_MS - (3 * DAY + 5 * HOUR),
      stages: [{ stageId: "only", branchKey: "default", position: 0, status: "rejected" }],
    };

    const code = await withFixedUuid([SESSION_UUID, "pipe-list-human"], () =>
      main(["pipeline", "list"], cap.io, {
        ...pipelineDeps(undefined),
        now: () => NOW_MS,
        connectIpcClient: async () =>
          makeIpcClient(
            [
              pipelineListFrame("pipe-list-human", [
                dayPipeline,
                minPipeline,
                tieB,
                secPipeline,
                hourPipeline,
                tieA,
                zeroPipeline,
                glyphPipeline,
              ]),
            ],
            { sent },
          ),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toBe(
      [
        "00000000\tzero-age\trunning\tzero.md\t0s\t✓only",
        "cccccccc\tglyph-check\tawaiting-approval\t-\t3s\t" +
          "!st-interrupted ✗st-rejected ✗st-failed ●st-running ?st-awaiting ·st-pending –st-skipped ✓st-approved ✓st-succeeded ●fan×3",
        "11111111\tsec-age\tsucceeded\t-\t7s\t✓only",
        "22222222\ttie-a\tsucceeded\ta.md\t5m\t✓only",
        "33333333\ttie-b\tsucceeded\tb.md\t5m\t✓only",
        "44444444\tmin-age\tfailed\tmin.md\t42m\t✗only",
        "55555555\thour-age\tinterrupted\t-\t5h\t!only",
        "66666666\tday-age\trejected\tday.md\t3d\t✗only",
        "",
      ].join("\n"),
    );
    expect(cap.read().stderr).toBe("");
    expect(ipcFramesWithMethod(sent, "pipeline_list")).toHaveLength(1);
  });

  test("list filters human output by cutoff and exact pipeline state", async () => {
    // @mutate v2/src/commands/pipeline.ts "return pipeline.createdAt >= cutoff && (state === undefined || pipeline.state === state);" -> "return true;"
    const NOW_MS = 3_000_000_000_000;
    const cutoffIso = new Date(NOW_MS - HOUR).toISOString();

    const p1 = {
      pipelineId: "p1",
      name: "p1",
      state: "running",
      createdAt: NOW_MS - 30 * MIN,
      stages: [],
    };
    const p2 = {
      pipelineId: "p2",
      name: "p2",
      state: "succeeded",
      createdAt: NOW_MS - 2 * HOUR,
      stages: [],
    };
    const p3 = {
      pipelineId: "p3",
      name: "p3",
      state: "running",
      createdAt: NOW_MS - 25 * HOUR,
      stages: [],
    };
    const p4 = {
      pipelineId: "p4",
      name: "p4",
      state: "failed",
      createdAt: NOW_MS - 10 * MIN,
      stages: [],
    };
    const p5 = {
      pipelineId: "p5",
      name: "p5",
      state: "succeeded",
      createdAt: NOW_MS - HOUR,
      stages: [],
    };
    const pipelines = [p1, p2, p3, p4, p5];

    async function runFiltered(argv: readonly string[]): Promise<string[]> {
      const cap = captureIo();
      const code = await withFixedUuid([SESSION_UUID, `pipe-list-filter-${argv.join("-")}`], () =>
        main(["pipeline", "list", ...argv], cap.io, {
          ...pipelineDeps(undefined),
          now: () => NOW_MS,
          connectIpcClient: async () =>
            makeIpcClient([pipelineListFrame(`pipe-list-filter-${argv.join("-")}`, pipelines)]),
        }),
      );
      expect(code).toBe(0);
      return cap
        .read()
        .stdout.trim()
        .split("\n")
        .map((line) => line.split("\t")[1] ?? "");
    }

    expect(await runFiltered(["--since", "1h"])).toEqual(["p4", "p1", "p5"]);
    expect(await runFiltered(["--since", cutoffIso])).toEqual(["p4", "p1", "p5"]);
    expect(await runFiltered(["--state", "failed"])).toEqual(["p4"]);
    expect(await runFiltered(["--since", "1h", "--state", "running"])).toEqual(["p1"]);
    expect(await runFiltered([])).toEqual(["p4", "p1", "p5", "p2", "p3"]);
  });

  test.each([
    ["unknown flag", ["pipeline", "list", "--bogus"]],
    ["missing --since value", ["pipeline", "list", "--since"]],
    ["invalid --since value", ["pipeline", "list", "--since", "not-a-time"]],
    ["non-positive --since duration", ["pipeline", "list", "--since", "0d"]],
    ["missing --state value", ["pipeline", "list", "--state"]],
    ["invalid --state value", ["pipeline", "list", "--state", "bogus"]],
    ["extra positional", ["pipeline", "list", "extra"]],
  ] as const)("list usage error (%s) prints usage before daemon connect", async (_label, argv) => {
    const cap = captureIo();
    let contacted = false;

    const code = await main([...argv], cap.io, {
      ...pipelineDeps(undefined),
      connectIpcClient: async () => {
        contacted = true;
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(contacted).toBe(false);
    expect(cap.read()).toEqual({ stdout: "", stderr: PIPELINE_LIST_USAGE });
  });

  test("list rejects json combined with human filters", async () => {
    // @mutate v2/src/commands/pipeline.ts "if (parsed.json && (parsed.since !== undefined || parsed.state !== undefined)) {" -> "if (false) {"
    for (const argv of [
      ["pipeline", "list", "--json", "--since", "1h"],
      ["pipeline", "list", "--json", "--state", "running"],
    ]) {
      const cap = captureIo();
      let contacted = false;

      const code = await main(argv, cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => {
          contacted = true;
          throw new Error("should not contact daemon");
        },
      });

      expect(code).toBe(1);
      expect(contacted).toBe(false);
      expect(cap.read()).toEqual({ stdout: "", stderr: PIPELINE_LIST_USAGE });
    }
  });

  test("list reports no pipelines for an empty human selection", async () => {
    // @mutate v2/src/commands/pipeline.ts "if (selected.length === 0) {" -> "if (false) {"
    const emptyStoreCap = captureIo();
    const emptyStoreCode = await withFixedUuid([SESSION_UUID, "pipe-list-empty-human"], () =>
      main(["pipeline", "list"], emptyStoreCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => makeIpcClient([pipelineListFrame("pipe-list-empty-human", [])]),
      }),
    );
    expect(emptyStoreCode).toBe(0);
    expect(emptyStoreCap.read()).toEqual({ stdout: "No pipelines.\n", stderr: "" });

    const filteredCap = captureIo();
    const filteredCode = await withFixedUuid([SESSION_UUID, "pipe-list-filtered-empty"], () =>
      main(["pipeline", "list", "--state", "failed"], filteredCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineListFrame("pipe-list-filtered-empty", [
              { pipelineId: "p1", name: "p1", state: "running", createdAt: 1, stages: [] },
            ]),
          ]),
      }),
    );
    expect(filteredCode).toBe(0);
    expect(filteredCap.read()).toEqual({ stdout: "No pipelines.\n", stderr: "" });
  });
});

describe("pipeline wait", () => {
  test.each([
    [{ kind: "terminal", state: "succeeded" }, 0],
    [{ kind: "terminal", state: "failed" }, 1],
    [{ kind: "terminal", state: "rejected" }, 1],
    [{ kind: "terminal", state: "interrupted" }, 1],
    [{ kind: "awaiting-approval", stageId: "approve-intent", branchKey: "default" }, 0],
  ] as const)("prints wait boundary %p with exit %i", async (boundary, expectedExit) => {
    // Inversion target: runPipelineWaitCommand pipeline_wait path in pipeline.ts — resolving on pending/running from pipeline_list alone turns this test RED.
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, "pipe-wait"], () =>
      main(["pipeline", "wait", "pipe-1"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => makeIpcClient([pipelineWaitFrame("pipe-wait", boundary)], { sent }),
      }),
    );

    expect(code).toBe(expectedExit);
    expect(cap.read()).toEqual({ stdout: `${JSON.stringify(boundary)}\n`, stderr: "" });
    expect(ipcFramesWithMethod(sent, "pipeline_wait")).toHaveLength(1);
    expect(ipcFramesWithMethod(sent, "pipeline_list")).toHaveLength(0);
  });

  test("returns promptly when the pipeline is already at a boundary", async () => {
    const cap = captureIo();
    const startedAt = Date.now();
    const boundary = { kind: "awaiting-approval", stageId: "gate", branchKey: "default" } as const;

    const code = await withFixedUuid([SESSION_UUID, "pipe-wait-now"], () =>
      main(["pipeline", "wait", "pipe-1"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => makeIpcClient([pipelineWaitFrame("pipe-wait-now", boundary)]),
      }),
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(code).toBe(0);
    expect(cap.read().stdout).toBe(`${JSON.stringify(boundary)}\n`);
  });

  test("missing pipeline ID prints usage before daemon connect", async () => {
    const cap = captureIo();
    let contacted = false;

    const code = await main(["pipeline", "wait"], cap.io, {
      ...pipelineDeps(undefined),
      connectIpcClient: async () => {
        contacted = true;
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(contacted).toBe(false);
    expect(cap.read()).toEqual({ stdout: "", stderr: PIPELINE_WAIT_USAGE });
  });

  test("whitespace-only pipeline ID prints usage before daemon connect", async () => {
    const cap = captureIo();
    let contacted = false;

    const code = await main(["pipeline", "wait", "   "], cap.io, {
      ...pipelineDeps(undefined),
      connectIpcClient: async () => {
        contacted = true;
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(contacted).toBe(false);
    expect(cap.read()).toEqual({ stdout: "", stderr: PIPELINE_WAIT_USAGE });
  });

  test("unknown pipeline ID surfaces daemon unknown_pipeline on stderr", async () => {
    const cap = captureIo();

    const code = await withFixedUuid([SESSION_UUID, "pipe-wait-miss"], () =>
      main(["pipeline", "wait", "pipe-missing"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            {
              kind: "error",
              id: "pipe-wait-miss",
              code: "unknown_pipeline",
              message: "Pipeline pipe-missing not found",
            },
          ]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "unknown_pipeline: Pipeline pipe-missing not found\n",
    });
  });

  test("operator abort during pipeline wait reports stderr detail without boundary JSON", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, "pipe-wait-abort"], () =>
      main(["pipeline", "wait", "pipe-abort"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => ipcClientAbortingOnWait([], sent),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain("IPC connection lost");
    expect(ipcFramesWithMethod(sent, "pipeline_wait")).toHaveLength(1);
  });

  test("two-branch wait names awaiting branchKey while sibling branch runs", async () => {
    // Inversion target: parsePipelineWaitBoundary branchKey requirement in pipeline.ts — accepting awaiting-approval without branchKey turns this test RED.
    const cap = captureIo();
    const boundary = { kind: "awaiting-approval", stageId: "gate", branchKey: "alpha" } as const;

    const code = await withFixedUuid([SESSION_UUID, "pipe-wait-fan"], () =>
      main(["pipeline", "wait", "pipe-fan"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => makeIpcClient([pipelineWaitFrame("pipe-wait-fan", boundary)]),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toBe(`${JSON.stringify(boundary)}\n`);
  });
});

describe("pipeline approve and reject", () => {
  test.each([
    ["approve", "pipeline_approve", { kind: "applied", pipelineId: "pipe-1", stageId: "gate", decision: "approved" }],
    ["reject", "pipeline_reject", { kind: "applied", pipelineId: "pipe-1", stageId: "gate", decision: "rejected" }],
  ] as const)("pipeline %s exits 0 on applied decision and sends branch-keyed IDs", async (subcommand, method, result) => {
    // Inversion target: runPipelineMutationCommand exit mapping in pipeline.ts — treating applied outcomes as failure turns this test RED.
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, `pipe-${subcommand}`], () =>
      main(["pipeline", subcommand, "pipe-1", "gate", "default"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => makeIpcClient([pipelineWaitFrame(`pipe-${subcommand}`, result)], { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "", stderr: "" });
    expect(ipcFramesWithMethod(sent, method)).toEqual([
      expect.objectContaining({ params: { pipelineId: "pipe-1", stageId: "gate", branchKey: "default" } }),
    ]);
  });

  test("pipeline approve on one branch sends branchKey and leaves sibling gate awaiting", async () => {
    // Inversion target: approve/reject RPC branchKey wiring in pipeline.ts — omitting branchKey from pipeline_approve params turns this test RED.
    // Inversion target: runPipelineMutationCommand exit mapping in pipeline.ts — treating applied outcomes as failure turns this test RED.
    const approveCap = captureIo();
    const approveSent: unknown[] = [];

    const approveCode = await withFixedUuid([SESSION_UUID, "pipe-approve-alpha"], () =>
      main(["pipeline", "approve", "pipe-fan", "gate", "alpha"], approveCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient(
            [
              pipelineWaitFrame("pipe-approve-alpha", {
                kind: "applied",
                pipelineId: "pipe-fan",
                stageId: "gate",
                decision: "approved",
              }),
            ],
            { sent: approveSent },
          ),
      }),
    );

    expect(approveCode).toBe(0);
    expect(ipcFramesWithMethod(approveSent, "pipeline_approve")).toEqual([
      expect.objectContaining({ params: { pipelineId: "pipe-fan", stageId: "gate", branchKey: "alpha" } }),
    ]);

    const listCap = captureIo();
    const listCode = await withFixedUuid([SESSION_UUID, "pipe-list-after-approve"], () =>
      main(["pipeline", "list", "--json"], listCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineListFrame("pipe-list-after-approve", [
              {
                ...TWO_BRANCH_AWAITING_SNAPSHOT,
                stages: TWO_BRANCH_AWAITING_SNAPSHOT.stages.map((row) =>
                  row.stageId === "gate" && row.branchKey === "alpha" ? { ...row, status: "approved" } : row,
                ),
              },
            ]),
          ]),
      }),
    );

    expect(listCode).toBe(0);
    const stages =
      (JSON.parse(listCap.read().stdout.trim()) as { pipelines: (typeof TWO_BRANCH_AWAITING_SNAPSHOT)[] }).pipelines[0]
        ?.stages ?? [];
    expect(stages.find((row) => row.stageId === "gate" && row.branchKey === "beta")?.status).toBe("awaiting");
    expect(stages.find((row) => row.stageId === "gate" && row.branchKey === "alpha")?.status).toBe("approved");
  });

  test("pipeline reject on one branch sends branchKey and leaves sibling gate awaiting", async () => {
    const rejectCap = captureIo();
    const rejectSent: unknown[] = [];

    const rejectCode = await withFixedUuid([SESSION_UUID, "pipe-reject-beta"], () =>
      main(["pipeline", "reject", "pipe-fan", "gate", "beta"], rejectCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient(
            [
              pipelineWaitFrame("pipe-reject-beta", {
                kind: "applied",
                pipelineId: "pipe-fan",
                stageId: "gate",
                decision: "rejected",
              }),
            ],
            { sent: rejectSent },
          ),
      }),
    );

    expect(rejectCode).toBe(0);
    expect(ipcFramesWithMethod(rejectSent, "pipeline_reject")).toEqual([
      expect.objectContaining({ params: { pipelineId: "pipe-fan", stageId: "gate", branchKey: "beta" } }),
    ]);

    const listCap = captureIo();
    const listCode = await withFixedUuid([SESSION_UUID, "pipe-list-after-reject"], () =>
      main(["pipeline", "list", "--json"], listCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineListFrame("pipe-list-after-reject", [
              {
                ...TWO_BRANCH_AWAITING_SNAPSHOT,
                stages: TWO_BRANCH_AWAITING_SNAPSHOT.stages.map((row) =>
                  row.stageId === "gate" && row.branchKey === "beta" ? { ...row, status: "rejected" } : row,
                ),
              },
            ]),
          ]),
      }),
    );

    expect(listCode).toBe(0);
    const stages =
      (JSON.parse(listCap.read().stdout.trim()) as { pipelines: (typeof TWO_BRANCH_AWAITING_SNAPSHOT)[] }).pipelines[0]
        ?.stages ?? [];
    expect(stages.find((row) => row.stageId === "gate" && row.branchKey === "alpha")?.status).toBe("awaiting");
    expect(stages.find((row) => row.stageId === "gate" && row.branchKey === "beta")?.status).toBe("rejected");
  });

  test("pipeline approve on wrong branchKey leaves untouched branch awaiting", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, "pipe-approve-wrong"], () =>
      main(["pipeline", "approve", "pipe-fan", "gate", "beta"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient(
            [
              pipelineWaitFrame("pipe-approve-wrong", {
                kind: "refused",
                pipelineId: "pipe-fan",
                stageId: "gate",
                reason: "status_not_awaiting",
              }),
            ],
            { sent },
          ),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "status_not_awaiting\n" });
    expect(ipcFramesWithMethod(sent, "pipeline_approve")).toEqual([
      expect.objectContaining({ params: { pipelineId: "pipe-fan", stageId: "gate", branchKey: "beta" } }),
    ]);

    const listCap = captureIo();
    const listCode = await withFixedUuid([SESSION_UUID, "pipe-list-wrong-branch"], () =>
      main(["pipeline", "list", "--json"], listCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([pipelineListFrame("pipe-list-wrong-branch", [TWO_BRANCH_AWAITING_SNAPSHOT])]),
      }),
    );

    expect(listCode).toBe(0);
    const stages =
      (JSON.parse(listCap.read().stdout.trim()) as { pipelines: (typeof TWO_BRANCH_AWAITING_SNAPSHOT)[] }).pipelines[0]
        ?.stages ?? [];
    expect(stages.find((row) => row.stageId === "gate" && row.branchKey === "alpha")?.status).toBe("awaiting");
    expect(stages.find((row) => row.stageId === "gate" && row.branchKey === "beta")?.status).toBe("awaiting");
  });

  test("pipeline approve prints status_not_awaiting on stderr and exits non-zero", async () => {
    const cap = captureIo();

    const code = await withFixedUuid([SESSION_UUID, "pipe-approve-refused"], () =>
      main(["pipeline", "approve", "pipe-1", "gate", "default"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineWaitFrame("pipe-approve-refused", {
              kind: "refused",
              pipelineId: "pipe-1",
              stageId: "gate",
              reason: "status_not_awaiting",
            }),
          ]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "status_not_awaiting\n" });
  });

  test("pipeline reject prints invalid_decision on stderr with no success stdout", async () => {
    const cap = captureIo();

    const code = await withFixedUuid([SESSION_UUID, "pipe-reject-refused"], () =>
      main(["pipeline", "reject", "pipe-1", "gate", "default"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineWaitFrame("pipe-reject-refused", {
              kind: "refused",
              pipelineId: "pipe-1",
              stageId: "gate",
              reason: "invalid_decision",
            }),
          ]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "invalid_decision\n" });
  });

  test.each([
    ["approve", PIPELINE_APPROVE_USAGE, ["pipeline", "approve"]],
    ["approve", PIPELINE_APPROVE_USAGE, ["pipeline", "approve", "pipe-1"]],
    ["approve", PIPELINE_APPROVE_USAGE, ["pipeline", "approve", "pipe-1", "gate"]],
    ["approve", PIPELINE_APPROVE_USAGE, ["pipeline", "approve", "pipe-1", "gate", "branch", "extra"]],
    ["approve", PIPELINE_APPROVE_USAGE, ["pipeline", "approve", "   ", "gate", "alpha"]],
    ["approve", PIPELINE_APPROVE_USAGE, ["pipeline", "approve", "pipe-1", "   ", "alpha"]],
    ["approve", PIPELINE_APPROVE_USAGE, ["pipeline", "approve", "pipe-1", "gate", "   "]],
    ["reject", PIPELINE_REJECT_USAGE, ["pipeline", "reject"]],
    ["reject", PIPELINE_REJECT_USAGE, ["pipeline", "reject", "pipe-1"]],
    ["reject", PIPELINE_REJECT_USAGE, ["pipeline", "reject", "pipe-1", "gate"]],
    ["reject", PIPELINE_REJECT_USAGE, ["pipeline", "reject", "pipe-1", "gate", "branch", "extra"]],
    ["reject", PIPELINE_REJECT_USAGE, ["pipeline", "reject", "   ", "gate", "alpha"]],
    ["reject", PIPELINE_REJECT_USAGE, ["pipeline", "reject", "pipe-1", "   ", "alpha"]],
    ["reject", PIPELINE_REJECT_USAGE, ["pipeline", "reject", "pipe-1", "gate", "   "]],
  ] as const)("%s usage error %p prints usage before daemon connect", async (_subcommand, usage, argv) => {
    const cap = captureIo();
    let contacted = false;

    const code = await main([...argv], cap.io, {
      ...pipelineDeps(undefined),
      connectIpcClient: async () => {
        contacted = true;
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(contacted).toBe(false);
    expect(cap.read()).toEqual({ stdout: "", stderr: usage });
  });

  test.each([
    "approve",
    "reject",
  ] as const)("pipeline %s prints invalid daemon response for malformed envelope", async (subcommand) => {
    const cap = captureIo();

    const code = await withFixedUuid([SESSION_UUID, `pipe-${subcommand}-bad`], () =>
      main(["pipeline", subcommand, "pipe-1", "gate", "default"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => makeIpcClient([pipelineWaitFrame(`pipe-${subcommand}-bad`, { kind: "unknown" })]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "invalid daemon response\n" });
  });
});

describe("pipeline resume", () => {
  test.each([
    ["pipe-resume-failed", "pipe-failed"],
    ["pipe-resume-await", "pipe-await"],
  ] as const)("pipeline resume exits 0 on resumed for %s", async (rpcId, pipelineId) => {
    // Inversion target: runPipelineMutationCommand exit mapping in pipeline.ts — treating resumed outcomes as failure turns this test RED.
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, rpcId], () =>
      main(["pipeline", "resume", pipelineId], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([pipelineWaitFrame(rpcId, { kind: "resumed", pipelineId })], { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "", stderr: "" });
    expect(ipcFramesWithMethod(sent, "pipeline_resume")).toEqual([expect.objectContaining({ params: { pipelineId } })]);
  });

  test("pipeline resume forwards the branch positional as branchKey", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, "pipe-resume-branch"], () =>
      main(["pipeline", "resume", "pipe-1", " alpha "], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([pipelineWaitFrame("pipe-resume-branch", { kind: "resumed", pipelineId: "pipe-1" })], {
            sent,
          }),
      }),
    );
    // @mutate v2/src/commands/pipeline.ts "{ pipelineId: parsed.pipelineId, ...(parsed.branchKey !== undefined ? { branchKey: parsed.branchKey } : {}) }," -> "{ pipelineId: parsed.pipelineId },"

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "", stderr: "" });
    expect(ipcFramesWithMethod(sent, "pipeline_resume")).toEqual([
      expect.objectContaining({ params: { pipelineId: "pipe-1", branchKey: " alpha " } }),
    ]);
  });

  test.each([
    ["pipe-resume-done", "pipe-done", "pipeline_terminal_succeeded"],
    ["pipe-resume-rej", "pipe-rej", "pipeline_terminal_rejected"],
  ] as const)("pipeline resume on terminal pipeline prints %s on stderr", async (rpcId, pipelineId, reason) => {
    const cap = captureIo();

    const code = await withFixedUuid([SESSION_UUID, rpcId], () =>
      main(["pipeline", "resume", pipelineId], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([pipelineWaitFrame(rpcId, { kind: "refused", pipelineId, reason })]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: `${reason}\n` });
  });

  test("pipeline resume prints a branch-scoped refusal verbatim on stderr", async () => {
    const cap = captureIo();

    const code = await withFixedUuid([SESSION_UUID, "pipe-resume-branch-refused"], () =>
      main(["pipeline", "resume", "pipe-fan", "alpha"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineWaitFrame("pipe-resume-branch-refused", {
              kind: "refused",
              pipelineId: "pipe-fan",
              branchKey: "alpha",
              stageId: "gate",
              reason: "branch_awaiting_approval",
            }),
          ]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "branch_awaiting_approval\n" });
  });

  test.each([
    [PIPELINE_RESUME_USAGE, ["pipeline", "resume"]],
    [PIPELINE_RESUME_USAGE, ["pipeline", "resume", "   "]],
  ] as const)("resume usage error %p prints usage before daemon connect", async (usage, argv) => {
    const cap = captureIo();
    let contacted = false;

    const code = await main([...argv], cap.io, {
      ...pipelineDeps(undefined),
      connectIpcClient: async () => {
        contacted = true;
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(contacted).toBe(false);
    expect(cap.read()).toEqual({ stdout: "", stderr: usage });
  });

  test("pipeline resume usage errors reject malformed branch arity before daemon connect", async () => {
    const tooManyArgsCap = captureIo();
    let tooManyArgsContacted = false;

    const tooManyArgsCode = await main(["pipeline", "resume", "pipe-1", "alpha", "extra"], tooManyArgsCap.io, {
      ...pipelineDeps(undefined),
      connectIpcClient: async () => {
        tooManyArgsContacted = true;
        throw new Error("should not contact daemon");
      },
    });
    // @mutate v2/src/commands/pipeline.ts "if (argv.length < 1 || argv.length > 2) return { ok: false };" -> "if (argv.length < 1) return { ok: false };"

    expect(tooManyArgsCode).toBe(1);
    expect(tooManyArgsContacted).toBe(false);
    expect(tooManyArgsCap.read()).toEqual({ stdout: "", stderr: PIPELINE_RESUME_USAGE });
    expect(PIPELINE_RESUME_USAGE).toContain("[<branch-key>]");

    const blankBranchCap = captureIo();
    let blankBranchContacted = false;

    const blankBranchCode = await main(["pipeline", "resume", "pipe-1", "   "], blankBranchCap.io, {
      ...pipelineDeps(undefined),
      connectIpcClient: async () => {
        blankBranchContacted = true;
        throw new Error("should not contact daemon");
      },
    });
    // @mutate v2/src/commands/pipeline.ts "if (branchKey.trim().length === 0) return { ok: false };" -> "if (branchKey.length === 0) return { ok: false };"

    expect(blankBranchCode).toBe(1);
    expect(blankBranchContacted).toBe(false);
    expect(blankBranchCap.read()).toEqual({ stdout: "", stderr: PIPELINE_RESUME_USAGE });
  });

  test("pipeline resume prints invalid daemon response for malformed envelope", async () => {
    const cap = captureIo();

    const code = await withFixedUuid([SESSION_UUID, "pipe-resume-bad"], () =>
      main(["pipeline", "resume", "pipe-1"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => makeIpcClient([pipelineWaitFrame("pipe-resume-bad", { kind: "unknown" })]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "invalid daemon response\n" });
  });
});

describe("pipeline recover", () => {
  test("pipeline recover admits a branch-scoped recovery request", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const result = {
      kind: "admitted",
      pipelineId: "pipe-1",
      branchKey: " alpha ",
      stageId: "plan",
      entryRunId: "run-9",
    };

    const code = await withFixedUuid([SESSION_UUID, "pipe-recover"], () =>
      main(["pipeline", "recover", "pipe-1", " alpha "], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => makeIpcClient([pipelineWaitFrame("pipe-recover", result)], { sent }),
      }),
    );
    // @mutate v2/src/commands/pipeline.ts "return runPipelineRecoverCommand(parsed.pipelineId, parsed.branchKey, io, deps);" -> "io.stderr(PIPELINE_USAGE); return 1;"

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: `${JSON.stringify(result)}\n`, stderr: "" });
    expect(ipcFramesWithMethod(sent, "pipeline_recover")).toEqual([
      expect.objectContaining({ params: { pipelineId: "pipe-1", branchKey: " alpha " } }),
    ]);
  });

  test("pipeline recover reports daemon refusals without admitting", async () => {
    const refusedCap = captureIo();
    const refusedCode = await withFixedUuid([SESSION_UUID, "pipe-recover-refused"], () =>
      main(["pipeline", "recover", "pipe-1", "alpha"], refusedCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineWaitFrame("pipe-recover-refused", {
              kind: "resolution_refused",
              pipelineId: "pipe-1",
              branchKey: "alpha",
              reason: "no_failed_stage",
              message: "branch alpha carries no failed workflow stage row",
            }),
          ]),
      }),
    );
    // @mutate v2/src/commands/pipeline.ts "return outcome.kind === \"admitted\" ? 0 : 1;" -> "return 0;"
    expect(refusedCode).toBe(1);
    expect(refusedCap.read()).toEqual({
      stdout: "",
      stderr: "no_failed_stage: branch alpha carries no failed workflow stage row\n",
    });

    const claimedCap = captureIo();
    const claimedCode = await withFixedUuid([SESSION_UUID, "pipe-recover-claimed"], () =>
      main(["pipeline", "recover", "pipe-1", "alpha"], claimedCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineWaitFrame("pipe-recover-claimed", {
              kind: "stage_claimed",
              pipelineId: "pipe-1",
              branchKey: "alpha",
              stageId: "plan",
            }),
          ]),
      }),
    );
    expect(claimedCode).toBe(1);
    expect(claimedCap.read()).toEqual({
      stdout: "",
      stderr: "pipeline recover: stage plan is claimed by another operation\n",
    });

    const unknownCap = captureIo();
    const unknownCode = await withFixedUuid([SESSION_UUID, "pipe-recover-unknown"], () =>
      main(["pipeline", "recover", "pipe-1", "alpha"], unknownCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => makeIpcClient([pipelineWaitFrame("pipe-recover-unknown", { kind: "unknown" })]),
      }),
    );
    // @mutate v2/src/commands/pipeline.ts "if (typeof record.kind !== \"string\" || !PIPELINE_RECOVER_RESULT_KINDS.has(record.kind)) return undefined;" -> "if (typeof record.kind !== \"string\") return undefined;"
    expect(unknownCode).toBe(1);
    expect(unknownCap.read()).toEqual({ stdout: "", stderr: "invalid daemon response\n" });

    const malformedCap = captureIo();
    const malformedCode = await withFixedUuid([SESSION_UUID, "pipe-recover-malformed"], () =>
      main(["pipeline", "recover", "pipe-1", "alpha"], malformedCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineWaitFrame("pipe-recover-malformed", {
              kind: "admitted",
              pipelineId: "pipe-1",
              branchKey: "alpha",
              stageId: "plan",
              // entryRunId missing: an admitted envelope stripped of its handles must not admit.
            }),
          ]),
      }),
    );
    expect(malformedCode).toBe(1);
    expect(malformedCap.read()).toEqual({ stdout: "", stderr: "invalid daemon response\n" });
  });

  test("pipeline recover rejects malformed arity before daemon connect", async () => {
    async function expectUsage(argv: readonly string[]): Promise<void> {
      const cap = captureIo();
      let contacted = false;
      const code = await main([...argv], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () => {
          contacted = true;
          throw new Error("should not contact daemon");
        },
      });
      expect(code).toBe(1);
      expect(contacted).toBe(false);
      expect(cap.read()).toEqual({ stdout: "", stderr: PIPELINE_RECOVER_USAGE });
    }

    await expectUsage(["pipeline", "recover", "pipe-1"]);
    await expectUsage(["pipeline", "recover", "pipe-1", "alpha", "extra"]);
    await expectUsage(["pipeline", "recover", "pipe-1", "   "]);
    // @mutate v2/src/commands/pipeline.ts "if (argv.length !== 2) return { ok: false };" -> "if (argv.length < 2) return { ok: false };"
    // @mutate v2/src/commands/pipeline.ts "if (pipelineId.trim().length === 0 || branchKey.trim().length === 0) return { ok: false };" -> "if (pipelineId.length === 0 || branchKey.length === 0) return { ok: false };"
  });

  test("help pipeline recover matches recover usage", async () => {
    const cap = captureIo();

    const code = await main(["help", "pipeline", "recover"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain(PIPELINE_RECOVER_USAGE.trim());

    const familyCap = captureIo();
    const familyCode = await main(["help", "pipeline"], familyCap.io);

    expect(familyCode).toBe(0);
    const familyOutput = familyCap.read().stdout;
    expect(familyOutput).toContain(PIPELINE_USAGE.trim());
    expect(familyOutput).toContain("recover\tRevalidate a corrected blocked branch stage.");
  });
});

describe("pipeline help", () => {
  test("help pipeline exposes the full family with list and wait semantics", async () => {
    const cap = captureIo();

    const code = await main(["help", "pipeline"], cap.io);

    expect(code).toBe(0);
    const output = cap.read().stdout;
    expect(output).toContain(PIPELINE_USAGE.trim());
    expect(output).toContain("start\tStart a pipeline for a registered project.");
    expect(output).toContain("list\tSnapshot admitted pipelines and stage progress.");
    expect(output).toContain("wait\tBlock until a pipeline reaches a wait boundary.");
    expect(output).toContain("approve\tAdmit an approval decision on a named gate.");
    expect(output).toContain("reject\tReject an approval gate and settle the pipeline.");
    expect(output).toContain("resume\tResume a failed or awaiting-approval pipeline.");
    expect(output).toContain("recover\tRevalidate a corrected blocked branch stage.");
  });

  test("help pipeline list matches list usage and shows filter flags", async () => {
    const cap = captureIo();

    const code = await main(["help", "pipeline", "list"], cap.io);

    expect(code).toBe(0);
    const output = cap.read().stdout;
    expect(output).toContain(PIPELINE_LIST_USAGE.trim());
    expect(output).toContain("--json");
    expect(output).toContain("--since");
    expect(output).toContain("--state");
  });

  test("help pipeline wait matches wait usage", async () => {
    const cap = captureIo();

    const code = await main(["help", "pipeline", "wait"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain(PIPELINE_WAIT_USAGE.trim());
  });

  test("help pipeline approve matches approve usage", async () => {
    const cap = captureIo();

    const code = await main(["help", "pipeline", "approve"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain(PIPELINE_APPROVE_USAGE.trim());
  });

  test("help pipeline reject matches reject usage", async () => {
    const cap = captureIo();

    const code = await main(["help", "pipeline", "reject"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain(PIPELINE_REJECT_USAGE.trim());
  });

  test("help pipeline resume matches resume usage", async () => {
    const cap = captureIo();

    const code = await main(["help", "pipeline", "resume"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain(PIPELINE_RESUME_USAGE.trim());
  });

  test("help pipeline start matches start usage and detach behavior", async () => {
    const cap = captureIo();

    const code = await main(["help", "pipeline", "start"], cap.io);

    expect(code).toBe(0);
    const output = cap.read().stdout;
    expect(output).toContain(PIPELINE_START_USAGE.trim());
    expect(output).toContain("do not block on completion");
    expect(output).toContain("--detach");
    expect(output).toContain("--seed");
    expect(output).toContain("--seed-text");
  });
});
