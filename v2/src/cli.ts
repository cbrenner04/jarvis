import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json";
import { createAgentBindings } from "../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import type { WaitRunCompletionResult } from "./daemon/daemon.ts";
import { getDaemonStatus, startDaemon, stopDaemon } from "./daemon/daemon-lifecycle.ts";
import { parseListRuns, parseWaitCompletion } from "./daemon/daemon-wire.ts";
import { executeWriteLoop, type WriteLoopInput, type WriteLoopResult } from "./execution/write-loop.ts";
import { buildWriteLoopInputFromCliValues, parseWriteArgs } from "./execution/write-loop-input.ts";
import { connectIpcClient, type IpcClient } from "./ipc/client.ts";
import type { ErrorFrame, ResponseFrame } from "./ipc/types.ts";
import { runTuiEntry } from "./tui-entry.tsx";
import { runTuiLogFollow } from "./tui-log-follow-entry.tsx";
import type { RunTuiLogFollowDeps } from "./tui-log-follow-types.ts";
import type { RunTuiEntryDeps } from "./tui-monitor-types.ts";

export type Io = {
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
  socketPath: string;
  pidPath: string;
};

type WriteCliInput = { ok: true; input: WriteLoopInput } | { ok: false; message?: string };

const DEFAULT_SOCKET_PATH = join(homedir(), ".jarvis", "daemon.sock");
const DEFAULT_PID_PATH = join(homedir(), ".jarvis", "daemon.pid");
const DAEMON_USAGE = "usage: jarvis daemon <start|stop|status>\n";
const RUN_USAGE = "usage: jarvis run <start|list|log|pause|resume|kill|wait> [args]\n";
const TUI_USAGE = "usage: jarvis tui\n";
const TUI_LOG_USAGE = "usage: jarvis tui log <run-id>\n";
const WRITE_USAGE =
  "usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--agents <csv>] [--max-iterations <n>]\n";
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
    socketPath: DEFAULT_SOCKET_PATH,
    pidPath: DEFAULT_PID_PATH,
    ...deps,
  };
  const command = argv[0];

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

    const loopResult = await runtimeDeps.executeWriteLoop(parsed.input);

    out.stdout(`${writeStdoutJson(loopResult)}\n`);

    return exitCodeForWriteResult(loopResult.kind);
  }

  if (command === "daemon") {
    return runDaemonCommand(argv.slice(1), out, runtimeDeps);
  }

  if (command === "run") {
    return runRunCommand(argv.slice(1), out, runtimeDeps);
  }

  if (command === "tui") {
    if (argv.length === 1) {
      return runtimeDeps.runTuiEntry({ socketPath: runtimeDeps.socketPath });
    }
    if (argv[1] === "log") {
      if (argv.length !== 3) {
        out.stderr(TUI_LOG_USAGE);
        return 1;
      }
      return runtimeDeps.runTuiLogFollow(argv[2]!, { socketPath: runtimeDeps.socketPath });
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
      const runId = stringProperty(response.result, "runId");
      if (runId === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }
      io.stdout(`${runId}\n`);
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

function stringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const prop = (value as Record<string, unknown>)[key];
  return typeof prop === "string" ? prop : undefined;
}

function parseWriteCliInput(argv: readonly string[], deps: CliDeps): WriteCliInput {
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    values = parseWriteArgs(argv);
  } catch {
    return { ok: false };
  }

  const built = buildWriteLoopInputFromCliValues(values, deps.createBindings);
  if (!built.ok) {
    return "message" in built ? { ok: false, message: built.message } : { ok: false };
  }
  return { ok: true, input: built.input };
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
