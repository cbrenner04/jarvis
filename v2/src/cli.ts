import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import packageJson from "../../package.json";
import { createAgentBindings } from "../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import {
  loadMachineConfig,
  readMachineConfigDocument,
  validateMachineConfigAgents,
} from "./config/machine-config-loader.ts";
import type { WaitRunCompletionResult } from "./daemon/daemon.ts";
import { getDaemonStatus, startDaemon, stopDaemon } from "./daemon/daemon-lifecycle.ts";
import { parseListRuns, parseStartResult, parseWaitCompletion } from "./daemon/daemon-wire.ts";
import { buildImplementWorkflowSteps } from "./execution/implement-workflow-steps.ts";
import { executeWriteLoop, type WriteLoopInput, type WriteLoopResult } from "./execution/write-loop.ts";
import { buildWriteLoopInputFromCliValues, parseWriteArgs } from "./execution/write-loop-input.ts";
import { connectIpcClient, type IpcClient } from "./ipc/client.ts";
import type { ErrorFrame, ResponseFrame } from "./ipc/types.ts";
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
  createBindings: (agentIds: readonly string[]) => readonly InvocationBinding[];
  connectIpcClient: (socketPath: string) => Promise<IpcClient>;
  startDaemon: typeof startDaemon;
  stopDaemon: typeof stopDaemon;
  getDaemonStatus: typeof getDaemonStatus;
  runTuiEntry: (deps?: RunTuiEntryDeps) => Promise<number>;
  runTuiLogFollow: (runId: string, deps?: RunTuiLogFollowDeps) => Promise<number>;
  buildImplementWorkflowSteps: typeof buildImplementWorkflowSteps;
  cwd: () => string;
  socketPath: string;
  pidPath: string;
  machineConfigPath: string;
};

type WriteCliInput = { ok: true; input: WriteLoopInput } | { ok: false; message?: string };

const DEFAULT_SOCKET_PATH = join(homedir(), ".jarvis", "daemon.sock");
const DEFAULT_PID_PATH = join(homedir(), ".jarvis", "daemon.pid");
const DEFAULT_MACHINE_CONFIG_PATH = join(homedir(), ".jarvis", "config.json");
const DAEMON_USAGE = "usage: jarvis daemon <start|stop|status>\n";
const CONFIG_USAGE = "usage: jarvis config <show|path|set-agents> [args]\n";
const RUN_USAGE = "usage: jarvis run <start|list|log|pause|resume|kill|wait> [args]\n";
const TUI_USAGE = "usage: jarvis tui\n";
const TUI_LOG_USAGE = "usage: jarvis tui log <run-id>\n";
const WRITE_USAGE =
  "usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--max-iterations <n>]\n";
const WORKFLOW_IMPLEMENT_USAGE =
  "usage: jarvis run workflow implement --branch <name> --base <ref> --spec <path> --artifact <path>\n";
const LOG_FRAME_WAIT_MS = 86_400_000;

export async function main(argv: readonly string[], io?: Io, deps?: Partial<CliDeps>): Promise<number> {
  const out = io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const runtimeDeps: CliDeps = {
    executeWriteLoop,
    createBindings: createAgentBindings,
    connectIpcClient,
    startDaemon,
    stopDaemon,
    getDaemonStatus,
    runTuiEntry,
    runTuiLogFollow,
    buildImplementWorkflowSteps,
    cwd: () => process.cwd(),
    socketPath: DEFAULT_SOCKET_PATH,
    pidPath: DEFAULT_PID_PATH,
    machineConfigPath: DEFAULT_MACHINE_CONFIG_PATH,
    ...deps,
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

    const loopResult = await runtimeDeps.executeWriteLoop(withOperatorSessionId(parsed.input, operatorSessionId));

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
    if (argv.length === 1) {
      return runtimeDeps.runTuiEntry({ socketPath: runtimeDeps.socketPath });
    }
    if (argv[1] === "log") {
      const runId = argv[2];
      if (argv.length !== 3 || runId === undefined) {
        out.stderr(TUI_LOG_USAGE);
        return 1;
      }
      return runtimeDeps.runTuiLogFollow(runId, { socketPath: runtimeDeps.socketPath });
    }
    out.stderr(TUI_USAGE);
    return 1;
  }

  out.stdout("v2 not ready\n");
  return 0;
}

async function runDaemonCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];

  if (subcommand === "start" && argv.length === 1) {
    try {
      const result = await deps.startDaemon(deps.socketPath, { pidPath: deps.pidPath });
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    } catch (error) {
      io.stderr(formatLifecycleError(error));
      return 1;
    }
  }

  if (subcommand === "stop" && argv.length === 1) {
    await deps.stopDaemon(deps.socketPath, { pidPath: deps.pidPath });
    io.stdout("stopped\n");
    return 0;
  }

  if (subcommand === "status" && argv.length === 1) {
    const pid = readPid(deps.pidPath);
    if (pid === null) {
      io.stdout("stopped\n");
      return 1;
    }

    const status = await deps.getDaemonStatus(pid, deps.socketPath);
    io.stdout(`${status}\n`);
    return status === "running" ? 0 : 1;
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
      const response = await request(client, "start", { input: parsed.input });
      if (response.kind === "error") {
        io.stderr(formatRpcError(response));
        return 1;
      }
      const start = parseStartResult(response.result);
      if (start === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }
      io.stdout(`${start.runId}\n`);
      return 0;
    });
  }

  if (subcommand === "workflow" && argv[1] === "implement") {
    const parsed = parseImplementWorkflowArgs(argv.slice(2));
    if (!parsed.ok) {
      io.stderr(WORKFLOW_IMPLEMENT_USAGE);
      return 1;
    }

    const built = deps.buildImplementWorkflowSteps({
      cwd: deps.cwd(),
      branchName: parsed.branchName,
      baseRef: parsed.baseRef,
      specPath: parsed.specPath,
      artifactPath: parsed.artifactPath,
    });
    if (!built.ok) {
      io.stderr(`${built.error}\n`);
      return 1;
    }

    return withRunClient(io, deps, async (client) => {
      const response = await request(client, "start", { steps: built.steps });
      if (response.kind === "error") {
        io.stderr(formatRpcError(response));
        return 1;
      }
      const start = parseStartResult(response.result);
      if (start === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }
      io.stdout(`${start.runId}\n`);
      return 0;
    });
  }

  if (subcommand === "list" && argv.length === 1) {
    return withRunClient(io, deps, async (client) => {
      const response = await request(client, "list");
      if (response.kind === "error") {
        io.stderr(formatRpcError(response));
        return 1;
      }

      const list = parseListRuns(response.result);
      if (list === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }

      for (const run of list.runs) {
        const e = run.error;
        io.stdout(
          `${run.runId}\t${run.project}\t${run.branch}\t${run.status}\t${run.isLive ? "live" : "not-live"}\t${e?.reason ?? "-"}\t${e ? String(e.retryable) : "-"}\t${e?.nextAction ?? "-"}\n`,
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
          const frame = await client.nextFrame(LOG_FRAME_WAIT_MS);
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
      const response = await request(client, subcommand, { runId: argv[1] });
      if (response.kind === "error") {
        io.stderr(formatRpcError(response));
        return 1;
      }
      const message = subcommand === "kill" ? "killed" : `${subcommand}d`;
      io.stdout(`${message} ${argv[1]}\n`);
      return 0;
    });
  }

  if (subcommand === "wait" && argv.length === 2) {
    return withRunClient(io, deps, async (client) => {
      const response = await request(client, "wait", { runId: argv[1] });
      if (response.kind === "error") {
        io.stderr(formatRpcError(response));
        return 1;
      }
      const result = parseWaitCompletion(response.result);
      if (result === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }
      const payload: Record<string, unknown> = { runStatus: result.runStatus };
      if (result.loopOutcomeKind !== undefined) payload.loopOutcomeKind = result.loopOutcomeKind;
      if (result.iterationsConsumed !== undefined) payload.iterationsConsumed = result.iterationsConsumed;
      if (result.resumable !== undefined) payload.resumable = result.resumable;
      if (result.error !== undefined) payload.error = result.error;
      io.stdout(`${JSON.stringify(payload)}\n`);
      return exitCodeForWaitResult(result);
    });
  }

  io.stderr(subcommand === "start" ? WRITE_USAGE : RUN_USAGE);
  return 1;
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

async function request(client: IpcClient, method: string, params?: unknown): Promise<ResponseFrame | ErrorFrame> {
  const id = crypto.randomUUID();
  client.send({ kind: "request", id, method, ...(params !== undefined ? { params } : {}) });

  while (true) {
    const frame = await client.nextFrame();
    if ((frame.kind === "response" || frame.kind === "error") && frame.id === id) {
      return frame;
    }
  }
}

function formatLifecycleError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n`;
  }
  return `${String(error)}\n`;
}

function formatRpcError(frame: ErrorFrame): string {
  return `${frame.code}: ${frame.message}\n`;
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

/** Tag `input` with the process's operator session id unless the caller already set `telemetry`. */
export function withOperatorSessionId(input: WriteLoopInput, operatorSessionId: string): WriteLoopInput {
  if (input.telemetry !== undefined) return input;
  return { ...input, telemetry: { operatorSessionId } };
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

  const built = buildWriteLoopInputFromCliValues(values, deps.createBindings, fallbackAgents);
  if (!built.ok) {
    return "message" in built ? { ok: false, message: built.message } : { ok: false };
  }
  return { ok: true, input: built.input };
}

type ImplementWorkflowCliInput =
  | { ok: true; branchName: string; baseRef: string; specPath: string; artifactPath: string }
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
      },
    }).values;
  } catch {
    return { ok: false };
  }

  const branchName = typeof values.branch === "string" ? values.branch : undefined;
  const baseRef = typeof values.base === "string" ? values.base : undefined;
  const specPath = typeof values.spec === "string" ? values.spec : undefined;
  const artifactPath = typeof values.artifact === "string" ? values.artifact : undefined;

  if (branchName === undefined || baseRef === undefined || specPath === undefined || artifactPath === undefined) {
    return { ok: false };
  }

  return { ok: true, branchName, baseRef, specPath, artifactPath };
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
  return JSON.stringify(payload, null, 2);
}

function exitCodeForWriteResult(kind: Awaited<ReturnType<typeof executeWriteLoop>>["kind"]): number {
  if (kind === "complete") return 0;
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
