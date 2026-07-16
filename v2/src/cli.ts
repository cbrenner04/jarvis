import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import packageJson from "../../package.json";
import type { AgentModelConfig, LoadError } from "./config/agent-model-config.ts";
import {
  type ImplementReviewBehavior,
  loadMachineConfig,
  readIterationTimeoutMs,
  readMachineConfigDocument,
  readProjectRegistry,
  resolveMachineProfile,
  validateMachineConfigAgents,
} from "./config/machine-config-loader.ts";
import { loadMachineProfileModels } from "./config/machine-profile-loader.ts";
import { resolveWriteLoopBindings, type WaitRunCompletionResult } from "./daemon/daemon.ts";
import { getDaemonStatus, resolveSourceRevision, startDaemon, stopDaemon } from "./daemon/daemon-lifecycle.ts";
import { followDaemonProcessLog, readDaemonProcessLog } from "./daemon/daemon-process-log.ts";
import { parseListRuns, parseStartResult, parseWaitCompletion } from "./daemon/daemon-wire.ts";
import {
  WORKFLOW_PRESET_BUILDERS,
  type WorkflowPresetBuilder,
  type WorkflowPresetBuilderInput,
} from "./execution/workflow-presets.ts";
import {
  applyOperatorSessionId,
  executeWriteLoop,
  type WriteLoopInput,
  type WriteLoopResult,
} from "./execution/write-loop.ts";
import {
  buildWriteLoopInputFromCliValues,
  DEFAULT_WRITE_AGENTS,
  parseWriteArgs,
} from "./execution/write-loop-input.ts";
import { connectIpcClient, type IpcClient } from "./ipc/client.ts";
import { RpcError } from "./ipc/rpc-errors.ts";
import { createRpcTransport } from "./ipc/rpc-transport.ts";
import { DAEMON_LOG_PATH, DAEMON_PID_PATH, DAEMON_SOCKET_PATH, MACHINE_CONFIG_PATH } from "./paths.ts";
import { runTuiEntry } from "./tui/tui-entry.tsx";
import { runTuiLogFollow } from "./tui/tui-log-follow-entry.tsx";
import type { RunTuiLogFollowDeps } from "./tui/tui-log-follow-types.ts";
import type { RunTuiEntryDeps } from "./tui/tui-monitor-types.ts";

type Io = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

type CliDeps = {
  executeWriteLoop: (input: WriteLoopInput) => Promise<Awaited<ReturnType<typeof executeWriteLoop>>>;
  loadAgentModelConfig: (agents: readonly string[]) => AgentModelConfig | LoadError;
  connectIpcClient: (socketPath: string) => Promise<IpcClient>;
  startDaemon: typeof startDaemon;
  stopDaemon: typeof stopDaemon;
  getDaemonStatus: typeof getDaemonStatus;
  resolveSourceRevision: typeof resolveSourceRevision;
  readDaemonProcessLog: typeof readDaemonProcessLog;
  followDaemonProcessLog: typeof followDaemonProcessLog;
  onSigint: (handler: () => void) => () => void;
  runTuiEntry: (deps?: RunTuiEntryDeps) => Promise<number>;
  runTuiLogFollow: (runId: string, deps?: RunTuiLogFollowDeps) => Promise<number>;
  workflowPresetBuilders: Readonly<Record<string, WorkflowPresetBuilder>>;
  readProjectRegistry: () => Record<string, { root: string; origin?: string }>;
  cwd: () => string;
  socketPath: string;
  pidPath: string;
  logPath: string;
  machineConfigPath: string;
};

type WriteCliInput = { ok: true; input: WriteLoopInput } | { ok: false; message?: string };

const DAEMON_USAGE = "usage: jarvis daemon <start|stop|status|log>\n";
const DAEMON_LOG_USAGE = "usage: jarvis daemon log [--follow]\n";
const CONFIG_USAGE = "usage: jarvis config <show|path|set-agents> [args]\n";
const RUN_USAGE = "usage: jarvis run <start|list|log|pause|resume|kill|wait> [args]\n";
const TUI_USAGE = "usage: jarvis tui\n";
const TUI_LOG_USAGE = "usage: jarvis tui log <run-id>\n";
const WRITE_USAGE =
  "usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--max-iterations <n>]\n";
const WORKFLOW_IMPLEMENT_USAGE =
  "usage: jarvis run workflow implement --base <ref> --spec <path> [--branch <name>] [--artifact <path>] [--review-passes <n>] [--review-behavior debate|light]\n";
const WORKFLOW_INTENT_USAGE =
  "usage: jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n";
const WORKFLOW_PLAN_USAGE =
  "usage: jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n";
const WORKFLOW_USAGE = "usage: jarvis run workflow <intent|plan|implement> [flags]\n";

const LEGACY_WORKFLOW_ALIASES: Readonly<
  Record<string, { canonical: "intent" | "plan"; passes: number; behavior: "debate" | "light" }>
> = {
  "intent-reviewed": { canonical: "intent", passes: 1, behavior: "light" },
  "plan-reviewed": { canonical: "plan", passes: 1, behavior: "debate" },
  "plan-reviewed-light": { canonical: "plan", passes: 1, behavior: "light" },
};

export async function main(argv: readonly string[], io?: Io, deps?: Partial<CliDeps>): Promise<number> {
  const out = io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const runtimeDeps: CliDeps = {
    executeWriteLoop,
    loadAgentModelConfig: (agents) => loadMachineProfileModels(resolveMachineProfile(), agents),
    connectIpcClient,
    startDaemon,
    stopDaemon,
    getDaemonStatus,
    resolveSourceRevision,
    readDaemonProcessLog,
    followDaemonProcessLog,
    onSigint: (handler) => {
      process.on("SIGINT", handler);
      return () => process.off("SIGINT", handler);
    },
    runTuiEntry,
    runTuiLogFollow,
    readProjectRegistry,
    cwd: () => process.cwd(),
    socketPath: DAEMON_SOCKET_PATH,
    pidPath: DAEMON_PID_PATH,
    logPath: DAEMON_LOG_PATH,
    machineConfigPath: MACHINE_CONFIG_PATH,
    ...deps,
    workflowPresetBuilders: deps?.workflowPresetBuilders ?? WORKFLOW_PRESET_BUILDERS,
  };
  const command = argv[0];
  const operatorSessionId = crypto.randomUUID();

  if (argv.length === 1 && command === "--version") {
    out.stdout(`${packageJson.version}\n`);
    return 0;
  }

  if (command === "write") {
    const parsed = parseWriteCliInput(argv.slice(1), runtimeDeps);
    if (!parsed.ok) {
      if (parsed.message !== undefined) out.stderr(parsed.message);
      out.stderr(WRITE_USAGE);
      return 1;
    }

    const resolved = resolveWriteLoopBindings(parsed.input);
    if (!resolved.ok) {
      out.stderr(`${resolved.message}\n`);
      return 1;
    }

    const loopResult = await runtimeDeps.executeWriteLoop(applyOperatorSessionId(resolved.input, operatorSessionId));

    out.stdout(`${writeStdoutJson(loopResult)}\n`);

    return exitCodeForWriteResult(loopResult.kind);
  }

  if (command === "daemon") {
    return runDaemonCommand(argv.slice(1), out, runtimeDeps);
  }

  if (command === "config") {
    return runConfigCommand(argv.slice(1), out, runtimeDeps);
  }

  if (command === "run") {
    return runRunCommand(argv.slice(1), out, runtimeDeps);
  }

  if (command === "tui") {
    return runTuiCommand(argv.slice(1), out, runtimeDeps);
  }

  out.stdout("v2 not ready\n");
  return 0;
}

async function runDaemonCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];

  if (subcommand === "start" && argv.length === 1) {
    try {
      const result = await deps.startDaemon(deps.socketPath, { pidPath: deps.pidPath, logPath: deps.logPath });
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    } catch (error) {
      io.stderr(formatLifecycleError(error));
      return 1;
    }
  }

  if (subcommand === "stop" && (argv.length === 1 || (argv.length === 2 && argv[1] === "--force"))) {
    try {
      await deps.stopDaemon(deps.socketPath, { pidPath: deps.pidPath, force: argv[1] === "--force" });
      io.stdout("stopped\n");
      return 0;
    } catch (error) {
      io.stderr(formatLifecycleError(error));
      return 1;
    }
  }

  if (subcommand === "status" && argv.length === 1) {
    const pid = readPid(deps.pidPath);
    if (pid === null) {
      io.stdout("stopped\n");
      return 1;
    }

    const status = await deps.getDaemonStatus(pid, deps.socketPath);
    if (status.state === "stopped") {
      io.stdout("stopped\n");
      return 1;
    }
    const currentRevision = deps.resolveSourceRevision();
    const state = status.loadedRevision === currentRevision ? "running" : "stale";
    io.stdout(`${state} loaded=${status.loadedRevision} current=${currentRevision}\n`);
    return state === "running" ? 0 : 1;
  }

  if (subcommand === "log") {
    if (argv.length === 1) {
      return deps.readDaemonProcessLog(deps.logPath, { writeOut: io.stdout, writeErr: io.stderr });
    }
    if (argv.length === 2 && argv[1] === "--follow") {
      const controller = new AbortController();
      const unregister = deps.onSigint(() => controller.abort());
      try {
        return await deps.followDaemonProcessLog(
          deps.logPath,
          { writeOut: io.stdout, writeErr: io.stderr },
          controller.signal,
        );
      } finally {
        unregister();
      }
    }
    io.stderr(DAEMON_LOG_USAGE);
    return 1;
  }

  io.stderr(DAEMON_USAGE);
  return 1;
}

async function runConfigCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  if (argv[0] === "show" && argv.length === 1) {
    try {
      const agents = loadMachineConfig(deps.machineConfigPath);
      if (agents === undefined) {
        io.stdout("No machine agent override configured.\n");
        return 0;
      }
      for (const agent of agents) {
        io.stdout(`${agent}\n`);
      }
      return 0;
    } catch (error) {
      io.stderr(formatConnectionError(error));
      return 1;
    }
  }

  if (argv[0] === "path" && argv.length === 1) {
    io.stdout(`${deps.machineConfigPath}\n`);
    return 0;
  }

  const csv = argv[1];
  if (argv[0] !== "set-agents" || argv.length !== 2 || csv === undefined) {
    io.stderr(CONFIG_USAGE);
    return 1;
  }

  const parsed = parseSetAgentsCsv(csv);
  if (!parsed.ok) {
    io.stderr(parsed.message);
    return 1;
  }

  try {
    writeMachineConfigAgents(deps.machineConfigPath, parsed.agents);
  } catch (error) {
    io.stderr(formatConnectionError(error));
    return 1;
  }

  io.stdout(`${JSON.stringify({ agents: parsed.agents })}\n`);
  return 0;
}

async function runRunCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];

  if (subcommand === "start") {
    const parsed = parseWriteCliInput(argv.slice(1), deps);
    if (!parsed.ok) {
      if (parsed.message !== undefined) io.stderr(parsed.message);
      io.stderr(WRITE_USAGE);
      return 1;
    }

    return withRunClient(io, deps, async (client) => {
      let result: unknown;
      try {
        result = await request(client, "start", { input: parsed.input });
      } catch (error) {
        if (error instanceof RpcError) {
          io.stderr(formatRpcError(error));
          return 1;
        }
        throw error;
      }
      const start = parseStartResult(result);
      if (start === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }
      io.stdout(`${start.runId}\n`);
      return 0;
    });
  }

  if (subcommand === "workflow") {
    return runWorkflowCommand(argv.slice(1), io, deps);
  }

  if (subcommand === "list" && argv.length === 1) {
    return withRunClient(io, deps, async (client) => {
      let result: unknown;
      try {
        result = await request(client, "list");
      } catch (error) {
        if (error instanceof RpcError) {
          io.stderr(formatRpcError(error));
          return 1;
        }
        throw error;
      }

      const list = parseListRuns(result);
      if (list === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }

      for (const run of list.runs) {
        const e = run.error;
        io.stdout(
          `${run.runId}\t${run.project}\t${run.branch}\t${run.status}\t${run.isLive ? "live" : "not-live"}\t${e?.reason ?? "-"}\t${e ? String(e.retryable) : "-"}\t${e?.nextAction ?? "-"}\t${run.worktreePath ?? "-"}\n`,
        );
      }
      return 0;
    });
  }

  if (subcommand === "log" && argv.length === 2) {
    return withRunClient(io, deps, async (client) => {
      const streamId = crypto.randomUUID();
      client.send({ kind: "stream-open", streamId, payload: { runId: argv[1] } });

      while (true) {
        try {
          const frame = await client.nextFrame();
          if (frame.kind === "stream-data" && frame.streamId === streamId) {
            const record = parseStreamPayload(frame.payload);
            io.stdout(`${JSON.stringify(record)}\n`);
            continue;
          }
          if (frame.kind === "stream-end" && frame.streamId === streamId) {
            return 0;
          }
        } catch (error) {
          if (error instanceof Error && error.message === "connection closed") {
            return 0;
          }
          throw error;
        }
      }
    });
  }

  if ((subcommand === "pause" || subcommand === "resume" || subcommand === "kill") && argv.length === 2) {
    return withRunClient(io, deps, async (client) => {
      try {
        await request(client, subcommand, { runId: argv[1] });
      } catch (error) {
        if (error instanceof RpcError) {
          io.stderr(formatRpcError(error));
          return 1;
        }
        throw error;
      }
      const message = subcommand === "kill" ? "killed" : `${subcommand}d`;
      io.stdout(`${message} ${argv[1]}\n`);
      return 0;
    });
  }

  if (subcommand === "wait" && argv.length === 2) {
    const runId = argv[1];
    if (runId === undefined) {
      io.stderr(RUN_USAGE);
      return 1;
    }
    return withRunClient(io, deps, async (client) => {
      return waitForRunCompletion(client, runId, io);
    });
  }

  io.stderr(subcommand === "start" ? WRITE_USAGE : RUN_USAGE);
  return 1;
}

async function waitForRunCompletion(client: IpcClient, runId: string, io: Io): Promise<number> {
  let response: unknown;
  try {
    response = await request(client, "wait", { runId });
  } catch (error) {
    if (error instanceof RpcError) {
      io.stderr(formatRpcError(error));
      return 1;
    }
    throw error;
  }
  const result = parseWaitCompletion(response);
  if (result === undefined) {
    io.stderr("invalid daemon response\n");
    return 1;
  }
  io.stdout(`${JSON.stringify(buildWaitPayload(result))}\n`);
  return exitCodeForWaitResult(result);
}

function buildWaitPayload(result: WaitRunCompletionResult): Record<string, unknown> {
  const payload: Record<string, unknown> = { runStatus: result.runStatus };
  if (result.loopOutcomeKind !== undefined) payload.loopOutcomeKind = result.loopOutcomeKind;
  if (result.iterationsConsumed !== undefined) payload.iterationsConsumed = result.iterationsConsumed;
  if (result.resumable !== undefined) payload.resumable = result.resumable;
  if (result.error !== undefined) payload.error = result.error;
  if (result.worktreePath !== undefined) payload.worktreePath = result.worktreePath;
  return payload;
}

function runTuiCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  if (argv.length === 0) {
    return deps.runTuiEntry({ socketPath: deps.socketPath });
  }
  if (argv[0] === "log") {
    const runId = argv[1];
    if (argv.length !== 2 || runId === undefined) {
      io.stderr(TUI_LOG_USAGE);
      return Promise.resolve(1);
    }
    return deps.runTuiLogFollow(runId, { socketPath: deps.socketPath });
  }
  io.stderr(TUI_USAGE);
  return Promise.resolve(1);
}

function getWorkflowUsage(name: string): string {
  if (name === "intent") return WORKFLOW_INTENT_USAGE;
  if (name === "plan") return WORKFLOW_PLAN_USAGE;
  if (name === "implement") return WORKFLOW_IMPLEMENT_USAGE;
  return WORKFLOW_USAGE;
}

function parseWorkflowArgsByName(args: readonly string[], isIntentPreset: boolean, isPlanPreset: boolean) {
  if (isIntentPreset) {
    return parseIntentWorkflowArgs(args);
  }
  if (isPlanPreset) {
    return parsePlanWorkflowArgs(args);
  }
  return parseImplementWorkflowArgs(args);
}

function buildWorkflowBuilderInput(
  name: string,
  parsed: ImplementWorkflowCliInput | IntentWorkflowCliInput | PlanWorkflowCliInput,
  isIntentPreset: boolean,
  isPlanPreset: boolean,
  deps: CliDeps,
): { ok: true; input: WorkflowPresetBuilderInput } | { ok: false } {
  if (name === "implement") {
    const { ok: _ok, ...launchInput } = parsed as Extract<ImplementWorkflowCliInput, { ok: true }>;
    return {
      ok: true,
      input: {
        cwd: deps.cwd(),
        ...launchInput,
        configPath: deps.machineConfigPath,
        projectRegistry: deps.readProjectRegistry(),
      },
    };
  }
  const parsedRecord = parsed as Record<string, unknown>;
  if (isIntentPreset || isPlanPreset) {
    return {
      ok: true,
      input: { cwd: deps.cwd(), ...parsedRecord, configPath: deps.machineConfigPath } as WorkflowPresetBuilderInput,
    };
  }
  return {
    ok: true,
    input: { cwd: deps.cwd(), ...parsedRecord } as WorkflowPresetBuilderInput,
  };
}

async function runWorkflowCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const name = argv[0];
  const alias = name === undefined ? undefined : LEGACY_WORKFLOW_ALIASES[name];
  const canonicalName = alias?.canonical ?? name;
  const builder =
    canonicalName !== undefined && Object.hasOwn(deps.workflowPresetBuilders, canonicalName)
      ? deps.workflowPresetBuilders[canonicalName]
      : name !== undefined && Object.hasOwn(deps.workflowPresetBuilders, name)
        ? deps.workflowPresetBuilders[name]
        : undefined;
  if (builder === undefined || name === undefined) {
    io.stderr(WORKFLOW_USAGE);
    return 1;
  }

  const isIntentPreset = canonicalName === "intent";
  const isPlanPreset = canonicalName === "plan";
  const parsed = parseWorkflowArgsByName(argv.slice(1), isIntentPreset, isPlanPreset);
  if (!parsed.ok) {
    io.stderr(getWorkflowUsage(canonicalName ?? name ?? ""));
    return 1;
  }

  if (alias !== undefined) {
    if ("reviewPasses" in parsed && parsed.reviewPasses === undefined) parsed.reviewPasses = alias.passes;
    if ("reviewBehavior" in parsed && parsed.reviewBehavior === undefined) parsed.reviewBehavior = alias.behavior;
    io.stderr(
      `deprecated: use ${alias.canonical} --review-passes ${alias.passes} --review-behavior ${alias.behavior}\n`,
    );
  }

  const builderInputResult = buildWorkflowBuilderInput(
    canonicalName ?? name ?? "",
    parsed,
    isIntentPreset,
    isPlanPreset,
    deps,
  );
  if (!builderInputResult.ok) return 1;

  const built = await builder(builderInputResult.input as Parameters<WorkflowPresetBuilder>[0]);
  if (!built.ok) {
    io.stderr(`${built.error.replace(/\n+$/, "")}\n`);
    return 1;
  }

  let iterationTimeoutMs: number;
  try {
    iterationTimeoutMs = readIterationTimeoutMs(deps.machineConfigPath);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const steps = built.steps.map((step) => (step.behavior === "write" ? { ...step, iterationTimeoutMs } : step));

  return withRunClient(io, deps, async (client) => {
    let result: unknown;
    try {
      result = await request(client, "start", { steps });
    } catch (error) {
      if (error instanceof RpcError) {
        io.stderr(formatRpcError(error));
        return 1;
      }
      throw error;
    }
    const start = parseStartResult(result);
    if (start === undefined) {
      io.stderr("invalid daemon response\n");
      return 1;
    }
    if (isIntentPreset) {
      const intentStep = built.steps[0];
      if (
        intentStep?.behavior === "write" &&
        intentStep.landing?.kind === "intent-stage" &&
        intentStep.publishCompletion === false
      ) {
        io.stderr(`intent paths: ${intentStep.landing.output.durableDir}\n`);
      }
    }
    io.stdout(`${start.runId}\n`);
    return waitForRunCompletion(client, start.runId, io);
  });
}

async function withRunClient(io: Io, deps: CliDeps, fn: (client: IpcClient) => Promise<number>): Promise<number> {
  let client: IpcClient | undefined;
  try {
    client = await deps.connectIpcClient(deps.socketPath);
    return await fn(client);
  } catch (error) {
    io.stderr(formatConnectionError(error));
    return 1;
  } finally {
    client?.close();
  }
}

/** One transport per client: a client may carry several correlated requests (e.g. `run workflow`
 * issues `start` then `wait`), and closing the transport destroys the underlying socket. The
 * transport is torn down with the client by `withRunClient`. */
const clientTransports = new WeakMap<IpcClient, ReturnType<typeof createRpcTransport>>();

async function request(client: IpcClient, method: string, params?: unknown): Promise<unknown> {
  let transport = clientTransports.get(client);
  if (transport === undefined) {
    transport = createRpcTransport(client);
    clientTransports.set(client, transport);
  }
  return await transport.request(method, params);
}

function formatLifecycleError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n`;
  }
  return `${String(error)}\n`;
}

function formatRpcError(error: RpcError): string {
  return `${error.code}: ${error.message}\n`;
}

function formatConnectionError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n`;
  }
  return `${String(error)}\n`;
}

function readPid(pidPath: string): number | null {
  if (!existsSync(pidPath)) return null;
  const raw = readFileSync(pidPath, "utf8").trim();
  if (raw.length === 0) return null;
  const pid = Number.parseInt(raw, 10);
  return Number.isNaN(pid) ? null : pid;
}

function parseStreamPayload(payload: unknown): unknown {
  if (typeof payload !== "string") {
    throw new Error("invalid stream payload");
  }
  return JSON.parse(payload);
}

function isLoadError(value: AgentModelConfig | LoadError): value is LoadError {
  return "errors" in value && Array.isArray((value as LoadError).errors);
}

function parseWriteCliInput(argv: readonly string[], deps: CliDeps): WriteCliInput {
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    values = parseWriteArgs(argv);
  } catch {
    return { ok: false };
  }

  let fallbackAgents: readonly string[] | undefined;
  try {
    fallbackAgents = loadMachineConfig(deps.machineConfigPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${message}\n` };
  }

  const agents = fallbackAgents ?? DEFAULT_WRITE_AGENTS;
  let agentModelConfig: AgentModelConfig | LoadError;
  try {
    agentModelConfig = deps.loadAgentModelConfig(agents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${message}\n` };
  }
  if (isLoadError(agentModelConfig)) {
    return { ok: false, message: `Failed to load agent model config: ${agentModelConfig.errors.join(", ")}\n` };
  }

  const built = buildWriteLoopInputFromCliValues(values, agentModelConfig, fallbackAgents);
  if (!built.ok) {
    return { ok: false };
  }
  try {
    return { ok: true, input: { ...built.input, iterationTimeoutMs: readIterationTimeoutMs(deps.machineConfigPath) } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${message}\n` };
  }
}

type ReviewCliInput = { reviewPasses?: number; reviewBehavior?: ImplementReviewBehavior };

function parseReviewCliInput(
  values: Record<string, string | boolean | string[] | undefined>,
): ReviewCliInput | undefined {
  let reviewPasses: number | undefined;
  if (typeof values["review-passes"] === "string") {
    const raw = values["review-passes"];
    if (!/^\d+$/u.test(raw)) return undefined;
    reviewPasses = Number(raw);
    if (!Number.isSafeInteger(reviewPasses)) return undefined;
  }
  let reviewBehavior: ImplementReviewBehavior | undefined;
  if (typeof values["review-behavior"] === "string") {
    const raw = values["review-behavior"];
    if (raw !== "debate" && raw !== "light") return undefined;
    reviewBehavior = raw;
  }
  return {
    ...(reviewPasses !== undefined ? { reviewPasses } : {}),
    ...(reviewBehavior !== undefined ? { reviewBehavior } : {}),
  };
}

type ImplementWorkflowCliInput =
  | {
      ok: true;
      branchName?: string;
      baseRef: string;
      specPath: string;
      artifactPath?: string;
      reviewPasses?: number;
      reviewBehavior?: ImplementReviewBehavior;
    }
  | { ok: false };

function parseImplementWorkflowArgs(argv: readonly string[]): ImplementWorkflowCliInput {
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    values = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: {
        branch: { type: "string" },
        base: { type: "string" },
        spec: { type: "string" },
        artifact: { type: "string" },
        "review-passes": { type: "string" },
        "review-behavior": { type: "string" },
      },
    }).values;
  } catch {
    return { ok: false };
  }

  const branchName = typeof values.branch === "string" ? values.branch : undefined;
  const baseRef = typeof values.base === "string" ? values.base : undefined;
  const specPath = typeof values.spec === "string" ? values.spec : undefined;
  const artifactPath = typeof values.artifact === "string" ? values.artifact : undefined;
  const review = parseReviewCliInput(values);
  if (review === undefined) return { ok: false };

  if (baseRef === undefined || specPath === undefined) {
    return { ok: false };
  }

  return {
    ok: true,
    ...(branchName !== undefined ? { branchName } : {}),
    baseRef,
    specPath,
    ...(artifactPath !== undefined ? { artifactPath } : {}),
    ...review,
  };
}

type IntentWorkflowCliInput =
  | ({ ok: true; seed: string; targetDir?: string } & ReviewCliInput)
  | ({ ok: true; seedText: string; targetDir?: string } & ReviewCliInput)
  | { ok: false };

function parseIntentWorkflowArgs(argv: readonly string[]): IntentWorkflowCliInput {
  let values: Record<string, string | boolean | undefined>;
  try {
    const options: Record<string, { type: "string" }> = {
      seed: { type: "string" },
      "seed-text": { type: "string" },
      "target-dir": { type: "string" },
      "review-passes": { type: "string" },
      "review-behavior": { type: "string" },
    };
    values = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options,
    }).values;
  } catch {
    return { ok: false };
  }
  const seed = typeof values.seed === "string" ? values.seed : undefined;
  const seedText = typeof values["seed-text"] === "string" ? values["seed-text"] : undefined;
  const targetDir = typeof values["target-dir"] === "string" ? values["target-dir"] : undefined;
  const review = parseReviewCliInput(values);
  if (review === undefined) return { ok: false };
  if ((seed === undefined) === (seedText === undefined)) return { ok: false };
  if (seed !== undefined) {
    return {
      ok: true,
      seed,
      ...(targetDir !== undefined ? { targetDir } : {}),
      ...review,
    };
  }
  if (seedText !== undefined) {
    return {
      ok: true,
      seedText,
      ...(targetDir !== undefined ? { targetDir } : {}),
      ...review,
    };
  }
  return { ok: false };
}

type PlanWorkflowCliInput = ({ ok: true; readyIntent: string; targetDir?: string } & ReviewCliInput) | { ok: false };

function parsePlanWorkflowArgs(argv: readonly string[]): PlanWorkflowCliInput {
  let values: Record<string, string | boolean | undefined>;
  try {
    const options: Record<string, { type: "string" }> = {
      "ready-intent": { type: "string" },
      "target-dir": { type: "string" },
      "review-passes": { type: "string" },
      "review-behavior": { type: "string" },
    };
    values = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options,
    }).values;
  } catch {
    return { ok: false };
  }

  const readyIntent = typeof values["ready-intent"] === "string" ? values["ready-intent"] : undefined;
  const targetDir = typeof values["target-dir"] === "string" ? values["target-dir"] : undefined;
  const review = parseReviewCliInput(values);
  if (review === undefined) return { ok: false };

  if (readyIntent === undefined) {
    return { ok: false };
  }

  return {
    ok: true,
    readyIntent,
    ...(targetDir !== undefined ? { targetDir } : {}),
    ...review,
  };
}

function parseSetAgentsCsv(raw: string): { ok: true; agents: string[] } | { ok: false; message: string } {
  const agents = raw.split(",").map((part) => part.trim());
  for (const [i, agent] of agents.entries()) {
    if (agent.length === 0) {
      return { ok: false, message: `Error: invalid agents CSV "${raw}": empty segment at position ${i + 1}\n` };
    }
    if (agent.includes(":")) {
      return { ok: false, message: `Error: invalid agent "${agent}": expected bare agent name\n` };
    }
  }

  try {
    return { ok: true, agents: validateMachineConfigAgents(agents) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${message}\n` };
  }
}

function writeMachineConfigAgents(configPath: string, agents: readonly string[]): void {
  const existing = readMachineConfigDocument(configPath) ?? {};
  const next = { ...existing, agents: [...agents] };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
}

function writeStdoutJson(result: WriteLoopResult): string {
  const payload: Record<string, unknown> = {
    kind: result.kind,
    runId: result.runId,
    iterationsConsumed: result.iterationsConsumed,
    resumable: result.resumable,
  };
  if (result.failureKind !== undefined) {
    payload.failureKind = result.failureKind;
    payload.bindingAttempts = result.bindingAttempts;
  }
  if (result.commitSha !== undefined) payload.commitSha = result.commitSha;
  if (result.completionCommitError !== undefined) payload.completionCommitError = result.completionCommitError;
  if (result.readyGateError !== undefined) payload.readyGateError = result.readyGateError;
  if (result.readyFlipError !== undefined) payload.readyFlipError = result.readyFlipError;
  return JSON.stringify(payload, null, 2);
}

function exitCodeForWriteResult(kind: Awaited<ReturnType<typeof executeWriteLoop>>["kind"]): number {
  if (kind === "complete") return 0;
  if (kind === "completion_commit_failed" || kind === "ready_gate_failed" || kind === "ready_flip_failed") return 1;
  if (kind === "invocation_failure") return 2;
  if (kind === "budget-exhausted") return 5;
  return 1;
}

function exitCodeForWaitResult(result: WaitRunCompletionResult): number {
  if (result.loopOutcomeKind !== undefined) {
    return exitCodeForWriteResult(result.loopOutcomeKind);
  }

  switch (result.runStatus) {
    case "failed":
      return 3;
    case "killed":
      return 4;
    case "budget-soft-stopped":
      return 5;
    default:
      return 1;
  }
}

if (import.meta.main) {
  // Harness git calls (push/fetch/ls-remote) against an HTTPS remote without
  // cached credentials would otherwise prompt on /dev/tty and hang the session.
  // Default to non-interactive so they fail fast; respect an explicit override.
  if (!process.env.GIT_TERMINAL_PROMPT) {
    process.env.GIT_TERMINAL_PROMPT = "0";
  }
  process.exit(await main(process.argv.slice(2)));
}
