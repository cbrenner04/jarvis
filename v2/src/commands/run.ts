import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatRpcError, parseStreamPayload, request, withRunClient } from "../cli/ipc.ts";
import { waitForRunCompletion } from "../cli/run-completion.ts";
import { withConnectDispatch } from "../cli/stale-dispatch.ts";
import { RUN_LIST_USAGE, RUN_USAGE, WRITE_USAGE } from "../cli/usage.ts";
import type { DaemonListResult, DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { parseListRuns, parseStartResult } from "../daemon/daemon-wire.ts";
import { mergeRunLists } from "../daemon/merge-run-lists.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { TERMINAL_RUN_STATUSES, type RunStatus } from "../persistence/state-store.ts";
import { type ListRpcParams, resolveListRpcRequest } from "./run-list-rpc.ts";
import { runWorkflowCommand } from "./workflow.ts";
import { parseWriteCliInput } from "./write.ts";

function formatListRunRow(run: DaemonListRunRow): string {
  const e = run.error;
  const columns = [
    run.runId,
    run.project,
    run.branch,
    run.status,
    run.isLive ? "live" : "not-live",
    e?.reason ?? "-",
    e ? String(e.retryable) : "-",
    e?.nextAction ?? "-",
    run.worktreePath ?? "-",
    e?.publicationFailure === undefined ? "-" : JSON.stringify(e.publicationFailure),
    e?.survivingMutation ?? "-",
    e?.survivingMutationSourceFile ?? "-",
    e?.survivingMutationSourceLine === undefined ? "-" : String(e.survivingMutationSourceLine),
    run.prNumber !== undefined ? String(run.prNumber) : "-",
    run.prUrl ?? "-",
  ];
  return `${columns.join("\t")}\n`;
}

function isRunAction(subcommand: string | undefined): subcommand is "pause" | "resume" | "kill" {
  return subcommand === "pause" || subcommand === "resume" || subcommand === "kill";
}

const SINCE_UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 } as const;

function parseSince(value: string, nowMs: number): number | undefined {
  const durationMatch = /^(\d+)([dhms])$/.exec(value);
  if (durationMatch !== null) {
    const amount = Number(durationMatch[1]);
    if (!Number.isInteger(amount) || amount <= 0) return undefined;
    return nowMs - amount * SINCE_UNIT_MS[durationMatch[2] as keyof typeof SINCE_UNIT_MS];
  }
  if (/^\d+$/.test(value)) {
    const ms = Number(value);
    return Number.isSafeInteger(ms) ? ms : undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseLimitArgvValue(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

const LIST_ARGV_FLAGS = [
  "--since",
  "--limit",
  "--project",
  "--branch",
  "--spec",
  "--status",
] as const;
type ListArgvFlag = (typeof LIST_ARGV_FLAGS)[number];

const LIST_FLAG_MISSING_VALUE: Record<ListArgvFlag, string> = {
  "--since": "invalid_since: invalid value\n",
  "--limit": "invalid_limit: invalid value\n",
  "--project": "invalid_project: invalid value\n",
  "--branch": "invalid_branch: invalid value\n",
  "--spec": "invalid_spec: invalid value\n",
  "--status": "invalid_status: invalid value\n",
};

const STRING_LIST_FLAG_TO_PARAM: Record<"--project" | "--branch" | "--spec", keyof ListRpcParams> = {
  "--project": "project",
  "--branch": "branch",
  "--spec": "specPath",
};

let invertInvalidStatusGuardForTest = false;

export function setInvertInvalidStatusGuardForTest(value: boolean): void {
  invertInvalidStatusGuardForTest = value;
}

type ParseListArgvPiece =
  | { ok: true; fields: Partial<ListRpcParams> }
  | { ok: false; stderr: string };

function parseOneListArgvFlag(flag: ListArgvFlag, value: string, deps: CliDeps): ParseListArgvPiece {
  if (flag === "--since") {
    const cutoff = parseSince(value, deps.now?.() ?? Date.now());
    if (cutoff === undefined) return { ok: false, stderr: "invalid_since: invalid value\n" };
    return { ok: true, fields: { sinceMs: cutoff } };
  }
  if (flag === "--limit") {
    const parsedLimit = parseLimitArgvValue(value);
    if (parsedLimit === undefined) return { ok: false, stderr: "invalid_limit: invalid value\n" };
    return { ok: true, fields: { limit: parsedLimit } };
  }
  if (flag === "--project" || flag === "--branch" || flag === "--spec") {
    if (value.length === 0) return { ok: false, stderr: LIST_FLAG_MISSING_VALUE[flag] };
    const param = STRING_LIST_FLAG_TO_PARAM[flag];
    return { ok: true, fields: { [param]: value } };
  }
  if (value.length === 0) return { ok: false, stderr: LIST_FLAG_MISSING_VALUE["--status"] };
  if (invertInvalidStatusGuardForTest) return { ok: true, fields: { status: value as RunStatus } };
  if (!TERMINAL_RUN_STATUSES.has(value as RunStatus)) {
    return { ok: false, stderr: "invalid_status: invalid value\n" };
  }
  return { ok: true, fields: { status: value as RunStatus } };
}

function parseListArgv(
  rest: readonly string[],
  io: Io,
  deps: CliDeps,
): { ok: true; fields: ListRpcParams } | { ok: false } {
  const fields: ListRpcParams = {};
  const knownFlags = new Set<string>(LIST_ARGV_FLAGS);

  for (let index = 0; index < rest.length; ) {
    const flag = rest[index];
    if (typeof flag !== "string" || !knownFlags.has(flag)) {
      io.stderr(RUN_LIST_USAGE);
      return { ok: false };
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("-")) {
      io.stderr(LIST_FLAG_MISSING_VALUE[flag as ListArgvFlag]);
      return { ok: false };
    }
    if (flag === "--status" && fields.status !== undefined) {
      io.stderr("invalid_status: invalid value\n");
      return { ok: false };
    }
    const piece = parseOneListArgvFlag(flag as ListArgvFlag, value, deps);
    if (!piece.ok) {
      io.stderr(piece.stderr);
      return { ok: false };
    }
    Object.assign(fields, piece.fields);
    index += 2;
  }

  return { ok: true, fields };
}

/** When true, `run log` / `run wait` skip cross-daemon owner resolution (guard-inversion tests). */
let invertRunOwnerResolutionForTest = false;

export function setInvertRunOwnerResolutionForTest(value: boolean): void {
  invertRunOwnerResolutionForTest = value;
}

async function queryDaemonListsFromSockets(
  deps: CliDeps,
  listParams: ListRpcParams | undefined,
): Promise<{ listResults: Array<[string, DaemonListResult | undefined]>; firstError: unknown }> {
  const discovered = await (deps.socketDiscovery ?? (async () => []))();
  const socketPaths = [...new Set([...discovered, deps.socketPath])].sort();

  const listResults: Array<[string, DaemonListResult | undefined]> = [];
  let firstError: unknown;
  const fail = (socketPath: string, error: unknown) => {
    listResults.push([socketPath, undefined]);
    firstError ??= error;
  };

  for (const socketPath of socketPaths) {
    try {
      const client = await deps.connectIpcClient(socketPath);
      try {
        let result: unknown;
        try {
          result = await request(client, "list", listParams);
        } catch (error) {
          if (error instanceof RpcError) {
            fail(socketPath, error);
            continue;
          }
          throw error;
        }

        const list = parseListRuns(result);
        if (list === undefined) {
          fail(socketPath, new Error("invalid daemon response"));
          continue;
        }

        listResults.push([socketPath, list]);
      } finally {
        client.close();
      }
    } catch (error) {
      fail(socketPath, error);
    }
  }

  return { listResults, firstError };
}

async function resolveRunOwnerSocket(runId: string, deps: CliDeps): Promise<string> {
  const { listResults } = await queryDaemonListsFromSockets(deps, undefined);
  const { owners } = mergeRunLists(listResults);
  return owners.get(runId) ?? deps.socketPath;
}

async function runStartSubcommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const parsed = parseWriteCliInput(argv, deps);
  if (!parsed.ok) {
    if (parsed.message !== undefined) io.stderr(parsed.message);
    io.stderr(WRITE_USAGE);
    return 1;
  }

  return withConnectDispatch(io, deps, async (client) => {
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

async function runListSubcommand(rest: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const parsed = parseListArgv(rest, io, deps);
  if (!parsed.ok) return 1;

  const listParams = resolveListRpcRequest(parsed.fields);
  const { listResults, firstError } = await queryDaemonListsFromSockets(deps, listParams);

  if (listResults.every(([_, result]) => result === undefined)) {
    if (firstError instanceof RpcError) {
      io.stderr(formatRpcError(firstError));
    } else if (firstError instanceof Error) {
      io.stderr(`${firstError.message}\n`);
    } else {
      io.stderr("connection failed\n");
    }
    return 1;
  }

  const { rows } = mergeRunLists(listResults);
  rows.sort((a, b) => a.runId.localeCompare(b.runId));
  for (const run of rows) io.stdout(formatListRunRow(run));
  return 0;
}

async function runLogSubcommand(runId: string, io: Io, deps: CliDeps): Promise<number> {
  const socketPath = invertRunOwnerResolutionForTest ? deps.socketPath : await resolveRunOwnerSocket(runId, deps);
  return withRunClient(
    io,
    deps,
    async (client) => {
      const streamId = crypto.randomUUID();
      client.send({ kind: "stream-open", streamId, payload: { runId, afterSeq: 0 } });

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
    },
    socketPath,
  );
}

async function runActionCommand(
  subcommand: "pause" | "resume" | "kill",
  argv: readonly string[],
  io: Io,
  deps: CliDeps,
): Promise<number> {
  const runId = argv[0];
  if (argv.length !== 1 || runId === undefined) {
    io.stderr(RUN_USAGE);
    return 1;
  }
  if (subcommand === "resume") {
    return withConnectDispatch(io, deps, async (client) => {
      await request(client, "resume", { runId });
      io.stdout(`resumed ${runId}\n`);
      return 0;
    });
  }
  return withRunClient(io, deps, async (client) => {
    try {
      await request(client, subcommand, { runId });
    } catch (error) {
      if (error instanceof RpcError) {
        io.stderr(formatRpcError(error));
        return 1;
      }
      throw error;
    }
    const message = subcommand === "kill" ? "killed" : `${subcommand}d`;
    io.stdout(`${message} ${runId}\n`);
    return 0;
  });
}

export async function runRunCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];

  if (subcommand === "start") return runStartSubcommand(argv.slice(1), io, deps);
  if (subcommand === "workflow") return runWorkflowCommand(argv.slice(1), io, deps);
  if (subcommand === "list") return runListSubcommand(argv.slice(1), io, deps);

  if (subcommand === "log" && argv.length === 2) {
    const runId = argv[1];
    if (runId === undefined) {
      io.stderr(RUN_USAGE);
      return 1;
    }
    return runLogSubcommand(runId, io, deps);
  }

  if (isRunAction(subcommand)) return runActionCommand(subcommand, argv.slice(1), io, deps);

  if (subcommand === "wait" && argv.length === 2) {
    const runId = argv[1];
    if (runId === undefined) {
      io.stderr(RUN_USAGE);
      return 1;
    }
    const socketPath = invertRunOwnerResolutionForTest ? deps.socketPath : await resolveRunOwnerSocket(runId, deps);
    return withRunClient(io, deps, async (client) => waitForRunCompletion(client, runId, io), socketPath);
  }

  io.stderr(subcommand === "start" ? WRITE_USAGE : RUN_USAGE);
  return 1;
}
