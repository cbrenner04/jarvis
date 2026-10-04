import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RoutingInvocationResult } from "../../../shared/invocation/agents.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import { ROUTING_ACTION_CATALOG } from "../cli/free-text-routing-actions.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { resolveProjectPipeline } from "../execution/project-pipeline-resolution.ts";
import {
  admitPipelineStart,
  type PipelineStartAdmissionDeps,
  type PipelineStartAdmissionInput,
} from "./pipeline-start-admission.ts";
import { routingCatalogExcerpt, runFreeTextRouting, type FreeTextRoutingSeams } from "./free-text-routing.ts";

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
    routing: { rungs: [{ adapterModel: "routing", priceKey: "routing" }] },
  },
};

function captureIo(): Io & { read(): { stdout: string; stderr: string } } {
  const buffers = { stdout: "", stderr: "" };
  return {
    stdout: (s: string) => {
      buffers.stdout += s;
    },
    stderr: (s: string) => {
      buffers.stderr += s;
    },
    read: () => ({ stdout: buffers.stdout, stderr: buffers.stderr }),
  };
}

type RequestRecord = { method: string; params: unknown };

type AdmissionHarness = {
  deps: PipelineStartAdmissionDeps;
  connectCalls: { value: number };
  requests: RequestRecord[];
};

let fixtureRoot: string;
let invocationCwd: string;
let seedRelativePath: string;

beforeAll(() => {
  mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
  fixtureRoot = trackedMkdtempSync(join(process.cwd(), ".scratch", "free-text-routing-"));
  invocationCwd = join(fixtureRoot, "invocation");
  mkdirSync(invocationCwd);
  seedRelativePath = "seeds/intent.md";
  mkdirSync(join(invocationCwd, "seeds"), { recursive: true });
  writeFileSync(join(invocationCwd, seedRelativePath), "# seed\n", "utf8");
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function makeAdmissionHarness(overrides: Partial<PipelineStartAdmissionDeps> = {}): AdmissionHarness {
  const connectCalls = { value: 0 };
  const requests: RequestRecord[] = [];
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
      return { close: () => undefined };
    },
    request: async (_connection, method, params) => {
      requests.push({ method, params });
      return { pipelineId: "pipeline-123" };
    },
  };
  return { deps, connectCalls, requests };
}

function makeCliDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    cwd: () => invocationCwd,
    machineConfigPath: "/fixture/machines/home.json",
    socketPath: "/fixture/daemon.sock",
    pidPath: "/fixture/daemon.pid",
    logPath: "/fixture/daemon.log",
    readProjectRegistry: () => ({ demo: { root: fixtureRoot, origin: "git@example.test/demo.git" } }),
    loadAgentModelConfig: () => AGENT_MODEL_CONFIG,
    connectIpcClient: async () => {
      throw new Error("unexpected connectIpcClient");
    },
    startDaemon: async () => {
      throw new Error("unexpected startDaemon");
    },
    stopDaemon: async () => {
      throw new Error("unexpected stopDaemon");
    },
    getDaemonStatus: async () => ({ state: "stopped" }),
    readDaemonProcessLog: () => 0,
    followDaemonProcessLog: async () => 0,
    onSigint: () => () => undefined,
    runTuiEntry: async () => 0,
    runTuiLogFollow: async () => 0,
    workflowPresetBuilders: {},
    getExecutableDigest: async () => "digest",
    ...overrides,
  };
}

function routingOk(stdout: string): RoutingInvocationResult {
  return { kind: "ok", stdout, stderr: "" };
}

function expectNoDaemonRpc(harness: AdmissionHarness): void {
  expect(harness.connectCalls.value).toBe(0);
  expect(harness.requests).toHaveLength(0);
}

function expectRoutingStderr(io: ReturnType<typeof captureIo>, reason: string): void {
  expect(io.read().stderr).toBe(`free-text-routing: ${reason}\n`);
}

describe("routingCatalogExcerpt", () => {
  test("lists every catalog action and its field names", () => {
    const excerpt = routingCatalogExcerpt();
    for (const [action, schema] of Object.entries(ROUTING_ACTION_CATALOG)) {
      expect(excerpt).toContain(`${action}:`);
      for (const field of Object.keys(schema)) {
        expect(excerpt).toContain(field);
      }
    }
  });
});

describe("runFreeTextRouting", () => {
  test("pipeline.start reaches admitPipelineStart with the same inputs and result as explicit --seed admission", async () => {
    const routingHarness = makeAdmissionHarness();
    const explicitHarness = makeAdmissionHarness();
    const admitInput: PipelineStartAdmissionInput = { projectKey: "demo", seedPath: seedRelativePath };
    const explicitResult = await admitPipelineStart(admitInput, explicitHarness.deps);

    const admitInputs: PipelineStartAdmissionInput[] = [];
    const io = captureIo();
    const cliDeps = makeCliDeps();
    const routingJson = JSON.stringify({
      action: "pipeline.start",
      seedPath: seedRelativePath,
      project: "demo",
    });
    const routingExit = await runFreeTextRouting("start pipeline for seed", io, cliDeps, "session-1", {
      invokeRouting: async () => routingOk(routingJson),
      admitPipelineStart: async (input) => {
        admitInputs.push(input);
        return admitPipelineStart(input, routingHarness.deps);
      },
    });

    expect(routingExit).toBe(0);
    expect(admitInputs).toEqual([admitInput]);
    expect(routingHarness.requests).toEqual(explicitHarness.requests);
    if (explicitResult.kind !== "admitted") throw new Error("expected admitted pipeline");
    expect(io.read().stdout).toBe(`${explicitResult.pipelineId}\n`);
  });

  test("rejects unknown action with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => routingOk(JSON.stringify({ action: "pipeline.restart", pipelineId: "x" })),
      admitPipelineStart: async (input, deps) => {
        const { admitPipelineStart } = await import("./pipeline-start-admission.ts");
        return admitPipelineStart(input, harness.deps);
      },
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "unknown-action");
    expectNoDaemonRpc(harness);
  });

  test("rejects extra field with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () =>
        routingOk(JSON.stringify({ action: "run.log", runId: "00000000-0000-4000-8000-000000000001", extra: "x" })),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "extra-field");
    expectNoDaemonRpc(harness);
  });

  test("rejects missing field with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => routingOk(JSON.stringify({ action: "run.log" })),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "missing-field");
    expectNoDaemonRpc(harness);
  });

  test("rejects wrong type with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => routingOk(JSON.stringify({ action: "run.log", runId: 42 })),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "wrong-type");
    expectNoDaemonRpc(harness);
  });

  test("rejects command-payload with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => routingOk(JSON.stringify({ action: "run.log", runId: "run 42" })),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "command-payload");
    expectNoDaemonRpc(harness);
  });

  test("rejects routing tool_call with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => ({
        kind: "error",
        exitCode: -1,
        stderr: "tool",
        routingFailure: "tool_call",
      }),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "tool_call");
    expectNoDaemonRpc(harness);
  });

  test("rejects routing malformed_output with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => ({
        kind: "error",
        exitCode: -1,
        stderr: "bad",
        routingFailure: "malformed_output",
      }),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "malformed_output");
    expectNoDaemonRpc(harness);
  });

  test("rejects routing timeout with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => ({
        kind: "error",
        exitCode: -1,
        stderr: "slow",
        routingFailure: "timeout",
      }),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "timeout");
    expectNoDaemonRpc(harness);
  });

  test("rejects unregistered project with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () =>
        routingOk(JSON.stringify({ action: "pipeline.start", seedPath: seedRelativePath, project: "missing" })),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "unregistered-project");
    expectNoDaemonRpc(harness);
  });

  test("pipeline.start without project resolves registry from cwd", async () => {
    const routingHarness = makeAdmissionHarness();
    const admitInputs: PipelineStartAdmissionInput[] = [];
    const io = captureIo();
    const cliDeps = makeCliDeps();
    const routingJson = JSON.stringify({
      action: "pipeline.start",
      seedPath: seedRelativePath,
    });
    const routingExit = await runFreeTextRouting("start pipeline for seed", io, cliDeps, "session-1", {
      invokeRouting: async () => routingOk(routingJson),
      admitPipelineStart: async (input) => {
        admitInputs.push(input);
        return admitPipelineStart(input, routingHarness.deps);
      },
    });

    expect(routingExit).toBe(0);
    expect(admitInputs).toEqual([{ projectKey: "demo", seedPath: seedRelativePath }]);
    expect(io.read().stdout).toBe("pipeline-123\n");
  });

  test("pipeline.start without project rejects when cwd matches no registry root", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps({ cwd: () => join(fixtureRoot, "..") }), "s", {
      invokeRouting: async () => routingOk(JSON.stringify({ action: "pipeline.start", seedPath: seedRelativePath })),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "unregistered-project");
    expectNoDaemonRpc(harness);
  });

  test("rejects bad seed path with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () =>
        routingOk(JSON.stringify({ action: "pipeline.start", seedPath: "missing.md", project: "demo" })),
      admitPipelineStart: async (input) => {
        const { admitPipelineStart } = await import("./pipeline-start-admission.ts");
        return admitPipelineStart(input, harness.deps);
      },
    });
    expect(exit).toBe(1);
    expect(harness.connectCalls.value).toBe(0);
    expect(harness.requests).toHaveLength(0);
    expect(io.read().stderr).toContain("pipeline:");
  });

  test("rejects invalid target id before daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const runPipelineCommand = async () => {
      harness.requests.push({ method: "pipeline_approve", params: {} });
      return 0;
    };
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => routingOk(JSON.stringify({ action: "run.kill", runId: "run-42" })),
      runPipelineCommand,
      runRunCommand: async () => {
        harness.requests.push({ method: "kill", params: {} });
        return 0;
      },
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "invalid-target-id");
    expectNoDaemonRpc(harness);
  });

  test("pipeline.approve rejects invalid pipeline id before runPipelineCommand", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    let pipelineCommandCalls = 0;
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => routingOk(JSON.stringify({ action: "pipeline.approve", pipelineId: "not-a-uuid" })),
      runPipelineCommand: async () => {
        pipelineCommandCalls += 1;
        return 0;
      },
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "invalid-target-id");
    expect(pipelineCommandCalls).toBe(0);
    expectNoDaemonRpc(harness);
  });

  test("pipeline.approve dispatches valid pipeline id to runPipelineCommand", async () => {
    const pipelineId = "00000000-0000-4000-8000-000000000001";
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const pipelineArgv: string[][] = [];
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => routingOk(JSON.stringify({ action: "pipeline.approve", pipelineId })),
      runPipelineCommand: async (argv) => {
        pipelineArgv.push(argv);
        return 0;
      },
    });
    expect(exit).toBe(0);
    expect(pipelineArgv).toEqual([["approve", pipelineId]]);
    expectNoDaemonRpc(harness);
  });

  test("rejects unsupported routing output with no daemon RPC", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("?", io, makeCliDeps(), "s", {
      invokeRouting: async () => routingOk(JSON.stringify({ action: "not.real", id: "x" })),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "unknown-action");
    expectNoDaemonRpc(harness);
  });

  test("rejects missing machine agents before loading agent model config", async () => {
    let loadConfigCalls = 0;
    const io = captureIo();
    const exit = await runFreeTextRouting("start pipeline", io, makeCliDeps(), "s", {
      loadMachineAgents: () => undefined,
      loadAgentModelConfig: () => {
        loadConfigCalls += 1;
        return { errors: ["injected load should not run"] };
      },
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "routing-error");
    expect(loadConfigCalls).toBe(0);
  });

  test("rejects empty machine agent order before routing invocation", async () => {
    const io = captureIo();
    const exit = await runFreeTextRouting("start pipeline", io, makeCliDeps(), "s", {
      loadMachineAgents: () => [],
      loadAgentModelConfig: () => AGENT_MODEL_CONFIG,
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "routing-error");
  });

  test("maps no-routable-agent stderr from non-ok routing invocation", async () => {
    const harness = makeAdmissionHarness();
    const io = captureIo();
    const exit = await runFreeTextRouting("start pipeline", io, makeCliDeps(), "s", {
      invokeRouting: async () => ({
        kind: "error",
        exitCode: -1,
        stderr: "no agent in the order can run the routing role: cursor (missing routing rung)",
      }),
    });
    expect(exit).toBe(1);
    expectRoutingStderr(io, "no-routable-agent");
    expectNoDaemonRpc(harness);
  });
});
