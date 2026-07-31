import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PIPELINE_APPROVE_USAGE,
  PIPELINE_LIST_USAGE,
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
import {
  buildPipelineDecisionRpcParams,
  parsePipelineDecisionArgs,
  parsePipelineMutationOutcome,
  pipelineMutationCommandExitCode,
} from "./pipeline.ts";

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
  stages: [
    { stageId: "plan", branchKey: "default", status: "succeeded", workflowInvocationId: "inv-plan" },
    { stageId: "gate", branchKey: "default", status: "awaiting", workflowInvocationId: null },
    { stageId: "implement", branchKey: "default", status: "pending", workflowInvocationId: null },
  ],
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

describe("pipeline start", () => {
  test("prints admitted pipeline ID on valid start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);

    const code = await withFixedUuid([SESSION_UUID, "pipe-start", "pipe-wait"], () =>
      main(["pipeline", "start", "demo", "--seed-text", "Ship feature"], cap.io, {
        ...pipelineDeps(configPath),
        connectIpcClient: async () =>
          makeIpcClient(
            pipelineFrames("pipe-start", ["pipe-wait"], "pipe-abc", [{ kind: "terminal", state: "succeeded" }]),
            { sent },
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
  });

  test("rejects invalid project pipeline configuration before daemon connect", async () => {
    // Inversion target: resolveProjectPipeline failure branch in pipeline.ts — falling through to daemon IPC on resolution failure turns this test RED.
    await expectPipelineConfigRejectedBeforeConnect(
      { name: "" },
      "invalid-project-pipeline-config: projects.demo.pipeline.name",
    );
  });

  test("rejects project pipeline missing terminalAction before daemon connect", async () => {
    // Inversion target: resolveProjectPipeline failure branch in pipeline.ts — falling through to daemon IPC on resolution failure turns this test RED.
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
    // Inversion target: startAdmittedPipeline detach branch in pipeline.ts — blocking on pipeline_wait when detach is true turns this test RED.
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
        connectIpcClient: async () =>
          makeIpcClient(
            pipelineFrames("pipe-att", ["pipe-w1", "pipe-w2"], "pipe-att-1", [
              { kind: "awaiting-approval", stageId: "approve-intent", branchKey: "default" },
              { kind: "terminal", state: "failed" },
            ]),
            { sent },
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

  test("reads --seed from a relative file path", async () => {
    const cap = captureIo();
    const seedDir = mkdtempSync(join(tmpdir(), "jarvis-pipeline-seed-"));
    const seedPath = join(seedDir, "seed.md");
    writeFileSync(seedPath, "From file", "utf8");

    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);
    const code = await withFixedUuid([SESSION_UUID, "pipe-seed", "pipe-seed-w"], () =>
      main(["pipeline", "start", "demo", "--seed", "seed.md"], cap.io, {
        ...pipelineDeps(configPath),
        cwd: () => seedDir,
        connectIpcClient: async () =>
          makeIpcClient(
            pipelineFrames("pipe-seed", ["pipe-seed-w"], "pipe-seed-1", [{ kind: "terminal", state: "succeeded" }]),
          ),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("pipe-seed-1\n");
  });

  test.each([
    ["/absolute/seed.md", "pipeline: --seed must be a relative path"],
    ["missing-seed.md", "pipeline: cannot resolve seed path:"],
    [".", "pipeline: seed is not a file: ."],
  ] as const)("rejects --seed %p before daemon connect", async (seedArg, stderrPrefix) => {
    const cap = captureIo();
    const seedDir = mkdtempSync(join(tmpdir(), "jarvis-pipeline-seed-"));
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);
    let contacted = false;

    const code = await main(["pipeline", "start", "demo", "--seed", seedArg], cap.io, {
      ...noDaemonDeps(pipelineDeps(configPath)),
      cwd: () => seedDir,
      connectIpcClient: async () => {
        contacted = true;
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(contacted).toBe(false);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain(stderrPrefix);
  });

  test("rejects unreadable --seed file before daemon connect", async () => {
    const cap = captureIo();
    const seedDir = mkdtempSync(join(tmpdir(), "jarvis-pipeline-seed-"));
    const seedPath = join(seedDir, "locked.md");
    writeFileSync(seedPath, "locked", "utf8");
    chmodSync(seedPath, 0o000);
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);
    let contacted = false;

    try {
      const code = await main(["pipeline", "start", "demo", "--seed", "locked.md"], cap.io, {
        ...noDaemonDeps(pipelineDeps(configPath)),
        cwd: () => seedDir,
        connectIpcClient: async () => {
          contacted = true;
          throw new Error("should not contact daemon");
        },
      });

      expect(code).toBe(1);
      expect(contacted).toBe(false);
      expect(cap.read().stdout).toBe("");
      expect(cap.read().stderr).toContain("pipeline: cannot resolve seed path:");
    } finally {
      chmodSync(seedPath, 0o644);
    }
  });
});

describe("pipeline list", () => {
  test("prints one minified JSON snapshot with ordered stage projection", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, "pipe-list"], () =>
      main(["pipeline", "list"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([pipelineListFrame("pipe-list", [SAMPLE_PIPELINE_SNAPSHOT])], { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({
      stdout: `${JSON.stringify({ pipelines: [SAMPLE_PIPELINE_SNAPSHOT] })}\n`,
      stderr: "",
    });
    expect(ipcFramesWithMethod(sent, "pipeline_list")).toHaveLength(1);
    expect(ipcFramesWithMethod(sent, "pipeline_wait")).toHaveLength(0);
  });

  test("prints an empty pipelines array for an empty store", async () => {
    const cap = captureIo();

    const code = await withFixedUuid([SESSION_UUID, "pipe-list-empty"], () =>
      main(["pipeline", "list"], cap.io, {
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
      main(["pipeline", "list"], cap.io, {
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
      main(["pipeline", "list"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([pipelineListFrame("pipe-list-fan", [TWO_BRANCH_PIPELINE_SNAPSHOT])], { sent }),
      }),
    );

    expect(code).toBe(0);
    const snapshot = JSON.parse(cap.read().stdout.trim()) as { pipelines: typeof TWO_BRANCH_PIPELINE_SNAPSHOT[] };
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

  test("pipeline approve/reject branchKey RPC guard inversion: omitting branchKey breaks branch-targeted params", () => {
    const parsed = parsePipelineDecisionArgs(["pipe-fan", "gate", "alpha"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const params = buildPipelineDecisionRpcParams(parsed);
    expect(params).toEqual({ pipelineId: "pipe-fan", stageId: "gate", branchKey: "alpha" });
    const { branchKey: _omit, ...withoutBranchKey } = params;
    expect(withoutBranchKey).not.toHaveProperty("branchKey");
    expect(expect.objectContaining({ params: withoutBranchKey })).not.toEqual(
      expect.objectContaining({ params }),
    );
    expect(
      TWO_BRANCH_AWAITING_SNAPSHOT.stages.find((row) => row.stageId === "gate" && row.branchKey === "beta")?.status,
    ).toBe("awaiting");
  });

  test("pipeline mutation applied-vs-refused exit guard inversion", () => {
    const applied = parsePipelineMutationOutcome(
      { kind: "applied", pipelineId: "pipe-fan", stageId: "gate", decision: "approved" },
      "applied",
    );
    expect(applied).toEqual({ kind: "applied" });
    expect(pipelineMutationCommandExitCode({ kind: "applied" }, "applied")).toBe(0);
    expect(
      pipelineMutationCommandExitCode({ kind: "refused", reason: "status_not_awaiting" }, "applied"),
    ).toBe(1);
    const invertExit = (outcome: { kind: string }, successKind: string) =>
      outcome.kind === successKind ? 1 : 0;
    expect(invertExit({ kind: "applied" }, "applied")).toBe(1);
    expect(invertExit({ kind: "refused" }, "applied")).toBe(0);
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
      main(["pipeline", "list"], listCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineListFrame("pipe-list-after-approve", [
              {
                ...TWO_BRANCH_AWAITING_SNAPSHOT,
                stages: TWO_BRANCH_AWAITING_SNAPSHOT.stages.map((row) =>
                  row.stageId === "gate" && row.branchKey === "alpha"
                    ? { ...row, status: "approved" }
                    : row,
                ),
              },
            ]),
          ]),
      }),
    );

    expect(listCode).toBe(0);
    const stages = (
      JSON.parse(listCap.read().stdout.trim()) as { pipelines: typeof TWO_BRANCH_AWAITING_SNAPSHOT[] }
    ).pipelines[0]?.stages ?? [];
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
      main(["pipeline", "list"], listCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([
            pipelineListFrame("pipe-list-after-reject", [
              {
                ...TWO_BRANCH_AWAITING_SNAPSHOT,
                stages: TWO_BRANCH_AWAITING_SNAPSHOT.stages.map((row) =>
                  row.stageId === "gate" && row.branchKey === "beta"
                    ? { ...row, status: "rejected" }
                    : row,
                ),
              },
            ]),
          ]),
      }),
    );

    expect(listCode).toBe(0);
    const stages = (
      JSON.parse(listCap.read().stdout.trim()) as { pipelines: typeof TWO_BRANCH_AWAITING_SNAPSHOT[] }
    ).pipelines[0]?.stages ?? [];
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
      main(["pipeline", "list"], listCap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([pipelineListFrame("pipe-list-wrong-branch", [TWO_BRANCH_AWAITING_SNAPSHOT])]),
      }),
    );

    expect(listCode).toBe(0);
    const stages = (
      JSON.parse(listCap.read().stdout.trim()) as { pipelines: typeof TWO_BRANCH_AWAITING_SNAPSHOT[] }
    ).pipelines[0]?.stages ?? [];
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

  test.each([
    [PIPELINE_RESUME_USAGE, ["pipeline", "resume"]],
    [PIPELINE_RESUME_USAGE, ["pipeline", "resume", "pipe-1", "extra"]],
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
  });

  test("help pipeline list matches list usage", async () => {
    const cap = captureIo();

    const code = await main(["help", "pipeline", "list"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain(PIPELINE_LIST_USAGE.trim());
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
