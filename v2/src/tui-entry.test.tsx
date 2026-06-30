import { describe, expect, test } from "bun:test";
import { createAgentBindings } from "../../shared/invocation/agents.ts";
import { simulatedBindings } from "./testing/bindings.ts";
import type { TuiDaemonClient } from "./tui-daemon-client.ts";
import { TuiDaemonConnectionError, TuiDaemonRpcError } from "./tui-daemon-client.ts";
import { type RunTuiEntryDeps, runTuiEntry, TUI_DAEMON_SOCKET_DISPLAY, type TuiViewState } from "./tui-entry.tsx";
import type { LaunchFieldCollectionResult } from "./tui-field-collector.tsx";
import type { WriteLoopInput } from "./write-loop.ts";
import { buildWriteLoopInput, type WriteLaunchFieldValues } from "./write-loop-input.ts";

const FIXTURE_FIELDS: WriteLaunchFieldValues = {
  projectRoot: "/tmp/repo",
  projectName: "demo",
  branchName: "write-run",
  baseRef: "HEAD",
  specPath: "spec.md",
  artifactPath: "proof.txt",
};

const collectFixtureFields = async () => ({ ok: true, fields: FIXTURE_FIELDS }) as const;
const simBindings = () => simulatedBindings(["done"]);

function recordingViewHost(): { host: { show: (state: TuiViewState) => void }; states: TuiViewState[] } {
  const states: TuiViewState[] = [];
  return {
    states,
    host: {
      show(state: TuiViewState): void {
        states.push(state);
      },
    },
  };
}

type FakeClientOptions = {
  methods?: string[];
  startInput?: WriteLoopInput;
  healthError?: TuiDaemonRpcError;
  statusError?: TuiDaemonRpcError;
  startError?: TuiDaemonRpcError;
  startResult?: { runId: string };
  connectionErrorOnStart?: boolean;
};

function fakeClient(options: FakeClientOptions = {}): TuiDaemonClient {
  const methods = options.methods ?? [];
  return {
    async health() {
      methods.push("health");
      if (options.healthError !== undefined) throw options.healthError;
      return { ok: true };
    },
    async status() {
      methods.push("status");
      if (options.statusError !== undefined) throw options.statusError;
      return { state: "running" };
    },
    async start(input: WriteLoopInput) {
      methods.push("start");
      if (options.connectionErrorOnStart) {
        throw new TuiDaemonConnectionError("IPC connection lost");
      }
      if (options.startError !== undefined) throw options.startError;
      options.startInput = input;
      return options.startResult ?? { runId: "run-999" };
    },
    async list() {
      methods.push("list");
      return { runs: [] };
    },
    async wait(_runId: string) {
      methods.push("wait");
      return { runStatus: "completed" };
    },
    close(): void {
      methods.push("close");
    },
  };
}

function launchDeps(
  clientOptions: FakeClientOptions = {},
  overrides: Partial<RunTuiEntryDeps> = {},
): { deps: RunTuiEntryDeps; clientOptions: FakeClientOptions } {
  return {
    clientOptions,
    deps: {
      collectLaunchFields: collectFixtureFields,
      createBindings: simBindings,
      connectTuiDaemon: async () => fakeClient(clientOptions),
      ...overrides,
    },
  };
}

describe("runTuiEntry", () => {
  test("success path collects fields, sends start, records run ID, exits 0", async () => {
    const { host, states } = recordingViewHost();
    const { deps, clientOptions } = launchDeps({ methods: [] }, { viewHost: host });

    const code = await runTuiEntry(deps);

    const built = buildWriteLoopInput(FIXTURE_FIELDS, simBindings);
    expect(code).toBe(0);
    expect(clientOptions.methods).toEqual(["health", "status", "start", "close"]);
    if (built.ok) {
      expect(clientOptions.startInput).toMatchObject({
        worktree: built.input.worktree,
        specPath: built.input.specPath,
        stepRules: built.input.stepRules,
        expectedArtifactPath: built.input.expectedArtifactPath,
      });
    }
    expect(states).toEqual([{ kind: "launch-success", runId: "run-999" }]);
  });

  test("run_in_progress guard passes through as rpc-error, exits 1", async () => {
    const { host, states } = recordingViewHost();
    const { deps, clientOptions } = launchDeps(
      {
        methods: [],
        startError: new TuiDaemonRpcError(
          "run_in_progress",
          "A run is already in progress; at most one in-flight run globally",
        ),
      },
      { viewHost: host },
    );

    const code = await runTuiEntry(deps);

    expect(code).toBe(1);
    expect(clientOptions.methods).toEqual(["health", "status", "start", "close"]);
    expect(states).toEqual([
      {
        kind: "rpc-error",
        code: "run_in_progress",
        message: "A run is already in progress; at most one in-flight run globally",
      },
    ]);
  });

  test("worktree_claimed guard passes through as rpc-error, exits 1", async () => {
    const { host, states } = recordingViewHost();
    const { deps } = launchDeps(
      { startError: new TuiDaemonRpcError("worktree_claimed", "Run already active for project/branch") },
      { viewHost: host },
    );

    const code = await runTuiEntry(deps);

    expect(code).toBe(1);
    expect(states).toEqual([
      { kind: "rpc-error", code: "worktree_claimed", message: "Run already active for project/branch" },
    ]);
  });

  test("generic start RPC error passes through, exits 1", async () => {
    const { host, states } = recordingViewHost();
    const { deps } = launchDeps(
      { startError: new TuiDaemonRpcError("invalid_params", "missing input") },
      { viewHost: host },
    );

    const code = await runTuiEntry(deps);

    expect(code).toBe(1);
    expect(states).toEqual([{ kind: "rpc-error", code: "invalid_params", message: "missing input" }]);
  });

  test("validation failure from field collector records errors and skips start", async () => {
    const { host, states } = recordingViewHost();
    const clientOptions: FakeClientOptions = { methods: [] };

    const code = await runTuiEntry({
      viewHost: host,
      collectLaunchFields: async () => ({ ok: false, errors: ["missing required field: project-root"] }),
      connectTuiDaemon: async () => fakeClient(clientOptions),
    });

    expect(code).toBe(1);
    expect(clientOptions.methods).toEqual(["health", "status", "close"]);
    expect(states).toEqual([{ kind: "validation-failure", errors: ["missing required field: project-root"] }]);
  });

  test("validation failure from shared builder records errors and skips start", async () => {
    const { host, states } = recordingViewHost();
    const clientOptions: FakeClientOptions = { methods: [] };

    const code = await runTuiEntry({
      viewHost: host,
      collectLaunchFields: async () =>
        ({ ok: true, fields: { projectRoot: "/tmp/repo" } }) as LaunchFieldCollectionResult,
      connectTuiDaemon: async () => fakeClient(clientOptions),
    });

    expect(code).toBe(1);
    expect(clientOptions.methods).toEqual(["health", "status", "close"]);
    expect(states[0]?.kind).toBe("validation-failure");
  });

  test("health RPC error records rpc-error and exits 1", async () => {
    const { host, states } = recordingViewHost();
    const clientOptions: FakeClientOptions = { methods: [] };

    const code = await runTuiEntry({
      viewHost: host,
      connectTuiDaemon: async () =>
        fakeClient({
          ...clientOptions,
          healthError: new TuiDaemonRpcError("unhealthy", "daemon not ready"),
        }),
    });

    expect(code).toBe(1);
    expect(clientOptions.methods).toEqual(["health", "close"]);
    expect(states).toEqual([{ kind: "rpc-error", code: "unhealthy", message: "daemon not ready" }]);
  });

  test("status RPC error records rpc-error and exits 1", async () => {
    const { host, states } = recordingViewHost();

    const code = await runTuiEntry({
      viewHost: host,
      connectTuiDaemon: async () =>
        fakeClient({
          statusError: new TuiDaemonRpcError("status_unavailable", "no status"),
        }),
    });

    expect(code).toBe(1);
    expect(states).toEqual([{ kind: "rpc-error", code: "status_unavailable", message: "no status" }]);
  });

  test("unavailable daemon at connect records unavailable feedback and exits 1", async () => {
    const { host, states } = recordingViewHost();

    const code = await runTuiEntry({
      viewHost: host,
      connectTuiDaemon: async () => {
        throw new TuiDaemonConnectionError("cannot connect");
      },
    });

    expect(code).toBe(1);
    expect(states).toEqual([{ kind: "unavailable" }]);
    expect(TUI_DAEMON_SOCKET_DISPLAY).toBe("~/.jarvis/daemon.sock");
  });

  test("connection loss during start records unavailable feedback and exits 1", async () => {
    const { host, states } = recordingViewHost();
    const { deps } = launchDeps({ connectionErrorOnStart: true }, { viewHost: host });

    const code = await runTuiEntry(deps);

    expect(code).toBe(1);
    expect(states).toEqual([{ kind: "unavailable" }]);
  });

  test("production path renders launch success through injectable ink", async () => {
    let inkRendered = false;
    const { deps, clientOptions } = launchDeps({ methods: [], startResult: { runId: "run-ink" } });

    const code = await runTuiEntry({
      ...deps,
      inkRender: (_node) => {
        inkRendered = true;
        return {
          rerender: () => {},
          unmount: () => {},
          waitUntilExit: async () => undefined,
          waitUntilRenderFlush: async () => {},
          cleanup: () => {},
          clear: () => {},
        };
      },
    });

    expect(code).toBe(0);
    expect(inkRendered).toBe(true);
    expect(clientOptions.methods).toEqual(["health", "status", "start", "close"]);
  });

  test("default createBindings matches CLI agent wiring", async () => {
    const clientOptions: FakeClientOptions = {};

    await runTuiEntry({
      viewHost: recordingViewHost().host,
      collectLaunchFields: collectFixtureFields,
      connectTuiDaemon: async () => fakeClient(clientOptions),
    });

    expect(clientOptions.startInput?.bindings).toHaveLength(1);
    expect(clientOptions.startInput?.bindings[0]?.id).toBe("claude");
    expect(createAgentBindings(["claude"])).toHaveLength(1);
  });
});
