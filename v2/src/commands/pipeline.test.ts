import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_LIST_USAGE, PIPELINE_START_USAGE, PIPELINE_USAGE, PIPELINE_WAIT_USAGE } from "../cli/usage.ts";
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
  setInvertDetachClientWaitGuardForTest,
  setInvertListNonFollowGuardForTest,
  setInvertPreAdmissionResolutionGuardForTest,
  setInvertWaitBoundaryGuardForTest,
} from "./pipeline.ts";

let fx: CliRepoFixture;

beforeAll(() => {
  fx = makeCliRepoFixture();
});

afterAll(() => {
  fx.cleanup();
});

afterEach(() => {
  setInvertPreAdmissionResolutionGuardForTest(false);
  setInvertDetachClientWaitGuardForTest(false);
  setInvertListNonFollowGuardForTest(false);
  setInvertWaitBoundaryGuardForTest(false);
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
    { stageId: "plan", status: "succeeded", workflowInvocationId: "inv-plan" },
    { stageId: "gate", status: "awaiting", workflowInvocationId: null },
    { stageId: "implement", status: "pending", workflowInvocationId: null },
  ],
};

const LIVE_RUNNING_SNAPSHOT = {
  pipelineId: "pipe-live",
  name: "fast",
  state: "running",
  stages: [
    { stageId: "s1", status: "running", workflowInvocationId: "inv-1" },
    { stageId: "s2", status: "pending", workflowInvocationId: null },
  ],
};

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
    const cap = captureIo();
    const configPath = pipelineMachineConfig("demo", { name: "" }, fx.repoRoot);
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
    expect(cap.read().stderr).toContain("invalid-project-pipeline-config: projects.demo.pipeline.name");
    expect(cap.read().stdout).toBe("");
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
              { kind: "awaiting-approval", stageId: "approve-intent" },
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

  test("inverting the pre-admission resolution guard reaches daemon IPC with invalid configuration", async () => {
    setInvertPreAdmissionResolutionGuardForTest(true);
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = pipelineMachineConfig("demo", { name: "" }, fx.repoRoot);

    const code = await withFixedUuid([SESSION_UUID, "pipe-guard"], () =>
      main(["pipeline", "start", "demo", "--seed-text", "Ship feature", "--detach"], cap.io, {
        ...pipelineDeps(configPath),
        connectIpcClient: async () => makeIpcClient(pipelineFrames("pipe-guard", [], "pipe-guard-1", []), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(ipcFramesWithMethod(sent, "pipeline_start")).toHaveLength(1);
  });

  test("inverting the detach client-wait guard blocks on pipeline_wait", async () => {
    setInvertDetachClientWaitGuardForTest(true);
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);

    const code = await withFixedUuid([SESSION_UUID, "pipe-det-guard", "pipe-det-w"], () =>
      main(["pipeline", "start", "demo", "--seed-text", "Ship feature", "--detach"], cap.io, {
        ...pipelineDeps(configPath),
        connectIpcClient: async () =>
          makeIpcClient(
            pipelineFrames("pipe-det-guard", ["pipe-det-w"], "pipe-det-guard-1", [
              { kind: "terminal", state: "succeeded" },
            ]),
            { sent },
          ),
      }),
    );

    expect(code).toBe(0);
    expect(ipcFramesWithMethod(sent, "pipeline_wait")).toHaveLength(1);
    expect(cap.read().stdout).toContain('{"kind":"terminal","state":"succeeded"}');
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

  test("inverting the list non-follow guard issues multiple pipeline_list RPCs", async () => {
    setInvertListNonFollowGuardForTest(true);
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, "pipe-list-g1", "pipe-list-g2"], () =>
      main(["pipeline", "list"], cap.io, {
        ...pipelineDeps(undefined, {
          sleep: async () => {},
        }),
        connectIpcClient: async () =>
          makeIpcClient(
            [
              pipelineListFrame("pipe-list-g1", [LIVE_RUNNING_SNAPSHOT]),
              pipelineListFrame("pipe-list-g2", [{ ...LIVE_RUNNING_SNAPSHOT, state: "succeeded" }]),
            ],
            { sent },
          ),
      }),
    );

    expect(ipcFramesWithMethod(sent, "pipeline_list").length).toBeGreaterThan(1);
    expect(code).toBe(0);
  });
});

describe("pipeline wait", () => {
  test.each([
    [{ kind: "terminal", state: "succeeded" }, 0],
    [{ kind: "terminal", state: "failed" }, 1],
    [{ kind: "terminal", state: "rejected" }, 1],
    [{ kind: "terminal", state: "interrupted" }, 1],
    [{ kind: "awaiting-approval", stageId: "approve-intent" }, 0],
  ] as const)("prints wait boundary %p with exit %i", async (boundary, expectedExit) => {
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
    const boundary = { kind: "awaiting-approval", stageId: "gate" } as const;

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

  test("inverting the wait-boundary guard resolves on pending or running alone", async () => {
    setInvertWaitBoundaryGuardForTest(true);
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withFixedUuid([SESSION_UUID, "pipe-wait-guard"], () =>
      main(["pipeline", "wait", "pipe-live"], cap.io, {
        ...pipelineDeps(undefined),
        connectIpcClient: async () =>
          makeIpcClient([pipelineListFrame("pipe-wait-guard", [LIVE_RUNNING_SNAPSHOT])], { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toBe('{"kind":"intermediate","state":"running"}\n');
    expect(ipcFramesWithMethod(sent, "pipeline_wait")).toHaveLength(0);
    expect(ipcFramesWithMethod(sent, "pipeline_list")).toHaveLength(1);
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
