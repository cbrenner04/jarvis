import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import {
  type CliRepoFixture,
  captureIo,
  cliMain as main,
  makeCliRepoFixture,
  makeIpcClient,
  SESSION_UUID,
  tempPaths,
  writeMachineConfig,
} from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import type { TuiDaemonClient } from "../tui/tui-daemon-client.ts";
import { runTuiEntry as productionRunTuiEntry } from "../tui/tui-entry.tsx";
import type { DetachedPipelineStartAdmission, TuiMonitorControls } from "../tui/tui-monitor-types.ts";

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

let fx: CliRepoFixture;

beforeAll(() => {
  fx = makeCliRepoFixture();
});

afterAll(() => {
  fx.cleanup();
});

function pipelineMachineConfig(projectKey: string, pipeline: unknown, root: string): string {
  return writeMachineConfig({
    machineProfile: "home",
    agents: ["claude"],
    projects: { [projectKey]: { root, pipeline } },
  });
}

function ipcFramesWithMethod(sent: readonly unknown[], method: string): unknown[] {
  return sent.filter((frame) => (frame as { method?: string }).method === method);
}

function healthyTuiDaemonClient(): TuiDaemonClient {
  return {
    async health() {
      return { ok: true };
    },
    async status() {
      return { state: "running" };
    },
    async list() {
      return { runs: [] };
    },
    async pipelineList() {
      return { pipelines: [] };
    },
    async start() {
      throw new Error("unexpected start");
    },
    async wait() {
      throw new Error("unexpected wait");
    },
    async pause() {
      return { ok: true };
    },
    async resume() {
      return { ok: true };
    },
    async kill() {
      return { ok: true };
    },
    close() {},
  };
}

describe("tui command", () => {
  test("jarvis tui dispatches to runTuiEntry with the production socket path", async () => {
    const paths = tempPaths();
    let seenSocketPath: string | undefined;

    const code = await main(["tui"], captureIo().io, {
      machineConfigPath: writeMachineConfig({ machineProfile: "workstation" }),
      socketPath: paths.socketPath,
      runTuiEntry: async (deps) => {
        seenSocketPath = deps?.socketPath;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenSocketPath).toBe(paths.socketPath);
  });

  test("jarvis tui hands the entry the discovery seam alongside the invoking socket path", async () => {
    const paths = tempPaths();
    let seenSocketPath: string | undefined;
    let seenSocketDiscovery: unknown;

    const code = await main(["tui"], captureIo().io, {
      machineConfigPath: writeMachineConfig({ machineProfile: "workstation" }),
      socketPath: paths.socketPath,
      runTuiEntry: async (deps) => {
        seenSocketPath = deps?.socketPath;
        seenSocketDiscovery = deps?.socketDiscovery;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenSocketPath).toBe(paths.socketPath);
    expect(seenSocketDiscovery).toBeDefined();
    expect(typeof seenSocketDiscovery).toBe("function");
  });

  test("jarvis tui resolves and supplies the invoking profile and keyed socket before opening", async () => {
    // @mutate v2/src/commands/tui.ts "if (machineProfile === undefined) return Promise.resolve(1);" -> "if (machineProfile !== undefined) return Promise.resolve(1);"
    const socketPath = "/tmp/daemon-0123456789abcdef.sock";
    let seenSocketPath: string | undefined;
    let seenMachineProfile: string | undefined;

    const code = await main(["tui"], captureIo().io, {
      machineConfigPath: writeMachineConfig({ machineProfile: "workstation" }),
      socketPath,
      runTuiEntry: async (deps) => {
        seenSocketPath = deps.socketPath;
        seenMachineProfile = deps.machineProfile;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenSocketPath).toBe(socketPath);
    expect(seenMachineProfile).toBe("workstation");
  });

  test.each([
    ["missing", {}],
    ["invalid", { machineProfile: 42 }],
  ])("jarvis tui rejects a %s machine profile before opening the monitor", async (_label, config) => {
    const cap = captureIo();
    let monitorOpenCount = 0;

    const code = await main(["tui"], cap.io, {
      machineConfigPath: writeMachineConfig(config),
      runTuiEntry: async () => {
        monitorOpenCount += 1;
        return 0;
      },
    });

    expect(code).toBe(1);
    expect(monitorOpenCount).toBe(0);
    expect(cap.read().stderr).toContain("missing required 'machineProfile' key");
  });

  test("jarvis tui with extra args prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["tui", "--foo"], cap.io, {
      runTuiEntry: async () => {
        throw new Error("should not run");
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis tui");
  });

  test("jarvis tui log dispatches to runTuiLogFollow with run id and production socket path", async () => {
    const paths = tempPaths();
    let seenRunId: string | undefined;
    let seenSocketPath: string | undefined;

    const code = await main(["tui", "log", "run-abc"], captureIo().io, {
      socketPath: paths.socketPath,
      runTuiLogFollow: async (runId, deps) => {
        seenRunId = runId;
        seenSocketPath = deps?.socketPath;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenRunId).toBe("run-abc");
    expect(seenSocketPath).toBe(paths.socketPath);
  });

  test("jarvis tui log hands the follow entry the discovery seam alongside the invoking socket path", async () => {
    const paths = tempPaths();
    let seenRunId: string | undefined;
    let seenSocketPath: string | undefined;
    let seenSocketDiscovery: unknown;

    const code = await main(["tui", "log", "run-abc"], captureIo().io, {
      socketPath: paths.socketPath,
      runTuiLogFollow: async (runId, deps) => {
        seenRunId = runId;
        seenSocketPath = deps?.socketPath;
        seenSocketDiscovery = deps?.socketDiscovery;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenRunId).toBe("run-abc");
    expect(seenSocketPath).toBe(paths.socketPath);
    expect(seenSocketDiscovery).toBeDefined();
    expect(typeof seenSocketDiscovery).toBe("function");
  });

  test("jarvis tui log with missing or extra arguments prints usage and exits 1", async () => {
    const cap = captureIo();

    const missingRunId = await main(["tui", "log"], cap.io, {
      runTuiLogFollow: async () => {
        throw new Error("should not run");
      },
    });
    const extraArgs = await main(["tui", "log", "run-abc", "extra"], cap.io, {
      runTuiLogFollow: async () => {
        throw new Error("should not run");
      },
    });

    expect(missingRunId).toBe(1);
    expect(extraArgs).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis tui log <run-id>");
  });

  test("rediscovery: a running TUI shows runs from a newly discovered live daemon without restart", async () => {
    const paths = tempPaths();
    let discoveryPhase = 0;

    const code = await main(["tui"], captureIo().io, {
      machineConfigPath: writeMachineConfig({ machineProfile: "workstation" }),
      socketPath: paths.socketPath,
      runTuiEntry: async (_deps) => {
        const discovery = async () => {
          discoveryPhase += 1;
          return discoveryPhase === 1 ? [paths.socketPath] : [paths.socketPath, "/tmp/other-daemon.sock"];
        };

        expect(await discovery()).toEqual([paths.socketPath]);
        expect(await discovery()).toEqual([paths.socketPath, "/tmp/other-daemon.sock"]);

        return 0;
      },
    });

    expect(code).toBe(0);
  });

  test("jarvis tui supplies monitor controls whose detached admission uses pipeline start seams", async () => {
    // @mutate v2/src/commands/tui.ts "admitDetachedPipelineStart: detachedPipelineStartAdmission(deps)," -> "admitDetachedPipelineStart: async () => ({ kind: \"admitted\", pipelineId: \"bypass\" }),"
    // @mutate v2/src/tui/tui-entry.tsx "return deps.admitDetachedPipelineStart(input);" -> "return Promise.resolve({ kind: \"admitted\", pipelineId: \"bypass\" });"
    const paths = tempPaths();
    const configPath = pipelineMachineConfig("demo", { name: "fast", terminalAction: "leave-draft" }, fx.repoRoot);
    const registry = { demo: { root: fx.repoRoot } };
    const tuiSent: unknown[] = [];
    const pipelineSent: unknown[] = [];
    let entryAdmission: DetachedPipelineStartAdmission | undefined;
    let monitorControls: TuiMonitorControls | undefined;
    let resolveOpened: () => void = () => {};
    const opened = new Promise<void>((resolve) => {
      resolveOpened = resolve;
    });

    const sharedDeps = {
      machineConfigPath: configPath,
      socketPath: paths.socketPath,
      cwd: () => fx.repoRoot,
      readProjectRegistry: () => registry,
      loadAgentModelConfig: () => ALL_REVIEW_ROLES_CONFIG,
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "response", id: "pipe-admit", result: { pipelineId: "pipe-tui" } }], {
          sent: tuiSent,
        }),
    };

    const tuiPending = main(["tui"], captureIo().io, {
      ...sharedDeps,
      runTuiEntry: (entryDeps) => {
        entryAdmission = entryDeps.admitDetachedPipelineStart;
        return productionRunTuiEntry({
          ...entryDeps,
          viewHost: {
            show() {},
            async openMonitor(_state, controls) {
              monitorControls = controls;
              resolveOpened();
              return {
                update() {},
                waitUntilExit: () => new Promise(() => {}),
                close() {},
              };
            },
          },
          connectTuiDaemon: async () => healthyTuiDaemonClient(),
        });
      },
    });

    await opened;
    expect(entryAdmission).toBeDefined();
    expect(monitorControls).toBeDefined();
    if (entryAdmission === undefined || monitorControls === undefined) throw new Error("missing admission binding");
    const controls = monitorControls;

    const tuiResult = await withFixedUuid("pipe-admit", () =>
      controls.admitDetachedPipelineStart({ projectKey: "demo", seedText: "Ship feature" }),
    );
    expect(tuiResult).toEqual({ kind: "admitted", pipelineId: "pipe-tui" });
    expect(ipcFramesWithMethod(tuiSent, "pipeline_start")).toHaveLength(1);
    expect(ipcFramesWithMethod(tuiSent, "pipeline_wait")).toHaveLength(0);
    expect(ipcFramesWithMethod(tuiSent, "pipeline_start")[0]).toMatchObject({
      params: {
        context: {
          cwd: fx.repoRoot,
          seed: "Ship feature",
          configPath,
          projectRegistry: registry,
        },
      },
    });

    const pipelineCode = await withFixedUuid([SESSION_UUID, "pipe-admit"], () =>
      main(["pipeline", "start", "demo", "--seed-text", "Ship feature", "--detach"], captureIo().io, {
        ...sharedDeps,
        connectIpcClient: async () =>
          makeIpcClient([{ kind: "response", id: "pipe-admit", result: { pipelineId: "pipe-cli" } }], {
            sent: pipelineSent,
          }),
      }),
    );
    expect(pipelineCode).toBe(0);
    expect(ipcFramesWithMethod(pipelineSent, "pipeline_start")).toHaveLength(1);
    expect(ipcFramesWithMethod(pipelineSent, "pipeline_wait")).toHaveLength(0);
    expect(ipcFramesWithMethod(pipelineSent, "pipeline_start")[0]).toMatchObject({
      params: {
        context: {
          cwd: fx.repoRoot,
          seed: "Ship feature",
          configPath,
          projectRegistry: registry,
        },
      },
    });

    let preAdmissionContacted = false;
    const missingProjectConfig = pipelineMachineConfig(
      "demo",
      { name: "fast", terminalAction: "leave-draft" },
      fx.repoRoot,
    );
    const preAdmission = await controls.admitDetachedPipelineStart({ projectKey: "missing", seedText: "text" });
    expect(preAdmission).toEqual({
      kind: "pre-admission-failure",
      failure: "unregistered-project",
      detail: "unregistered project: missing\n",
    });

    await main(["pipeline", "start", "missing", "--seed-text", "text"], captureIo().io, {
      machineConfigPath: missingProjectConfig,
      socketPath: paths.socketPath,
      cwd: () => fx.repoRoot,
      readProjectRegistry: () => registry,
      loadAgentModelConfig: () => ALL_REVIEW_ROLES_CONFIG,
      connectIpcClient: async () => {
        preAdmissionContacted = true;
        throw new Error("should not contact daemon");
      },
    });
    expect(preAdmissionContacted).toBe(false);

    controls.quit();
    expect(await tuiPending).toBe(0);
  });
});
