import { parseArgs } from "node:util";
import { RUN_LIST_PARSE_ARG_OPTIONS } from "../cli/command-help-flags.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatRpcError, parseStreamPayload, request, withRunClient } from "../cli/ipc.ts";
import { waitForRunCompletion } from "../cli/run-completion.ts";
import { withConnectDispatch } from "../cli/stale-dispatch.ts";
import { RUN_LIST_USAGE, RUN_LOG_USAGE, RUN_USAGE, WRITE_USAGE } from "../cli/usage.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { parseStartResult } from "../daemon/daemon-wire.ts";
import { mergeRunLists } from "../daemon/merge-run-lists.ts";
import { queryDaemonListsFromSockets } from "../daemon/query-daemon-lists-from-sockets.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { isRunStatus, type RunStatus, TERMINAL_RUN_STATUSES } from "../persistence/state-store.ts";
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
    e?.completionCommitError === undefined ? "-" : JSON.stringify(e.completionCommitError),
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

const LIST_VALUE_FLAGS = ["--since", "--limit", "--project", "--branch", "--spec", "--status"] as const;

type ListValueFlag = (typeof LIST_VALUE_FLAGS)[number];

const LIST_FLAG_INVALID_MESSAGE = {
  "--since": "invalid_since: invalid value\n",
  "--limit": "invalid_limit: invalid value\n",
  "--project": "invalid_project: invalid value\n",
  "--branch": "invalid_branch: invalid value\n",
  "--spec": "invalid_spec: invalid value\n",
  "--status": "invalid_status: invalid value\n",
} as const satisfies Record<ListValueFlag, string>;

function listFlagMissingValueMessage(flag: ListValueFlag): string {
  return LIST_FLAG_INVALID_MESSAGE[flag];
}

const LIST_STRING_DIMENSIONS = [
  { argvKey: "project", flag: "--project", paramKey: "project" },
  { argvKey: "branch", flag: "--branch", paramKey: "branch" },
  { argvKey: "spec", flag: "--spec", paramKey: "specPath" },
] as const satisfies ReadonlyArray<{
  argvKey: keyof typeof RUN_LIST_PARSE_ARG_OPTIONS;
  flag: ListValueFlag;
  paramKey: keyof ListRpcParams;
}>;

function parseListStatusValue(value: string): RunStatus | undefined {
  if (!isRunStatus(value)) return undefined;
  return TERMINAL_RUN_STATUSES.has(value) ? value : undefined;
}

function parseOneListArgvFlag(
  flag: "--since" | "--limit",
  value: string,
  deps: CliDeps,
): { ok: true; sinceMs?: number; limit?: number } | { ok: false; stderr: string } {
  if (flag === "--since") {
    const cutoff = parseSince(value, deps.now?.() ?? Date.now());
    if (cutoff === undefined) {
      return { ok: false, stderr: "invalid_since: invalid value\n" };
    }
    return { ok: true, sinceMs: cutoff };
  }
  const parsedLimit = parseLimitArgvValue(value);
  if (parsedLimit === undefined) {
    return { ok: false, stderr: "invalid_limit: invalid value\n" };
  }
  return { ok: true, limit: parsedLimit };
}

function listFlagHasValue(rest: readonly string[], flag: ListValueFlag): boolean {
  const index = rest.indexOf(flag);
  if (index === -1) return true;
  const value = rest[index + 1];
  return value !== undefined && !value.startsWith("-");
}

function listArgvRepeatsFlag(rest: readonly string[], flag: ListValueFlag): boolean {
  let count = 0;
  for (const token of rest) {
    if (token === flag) count += 1;
  }
  return count > 1;
}

/** Parse and apply one numeric list flag (`--since` / `--limit`); false on invalid value (stderr already written). */
function applyNumericListFlag(
  flag: "--since" | "--limit",
  value: string | boolean | string[] | undefined,
  params: ListRpcParams,
  deps: CliDeps,
  io: Io,
): boolean {
  if (typeof value !== "string") return true;
  const piece = parseOneListArgvFlag(flag, value, deps);
  if (!piece.ok) {
    io.stderr(piece.stderr);
    return false;
  }
  if (piece.sinceMs !== undefined) params.sinceMs = piece.sinceMs;
  if (piece.limit !== undefined) params.limit = piece.limit;
  return true;
}

function parseListArgv(
  rest: readonly string[],
  io: Io,
  deps: CliDeps,
): { ok: true; params: ListRpcParams } | { ok: false } {
  if (listArgvRepeatsFlag(rest, "--status")) {
    io.stderr(listFlagMissingValueMessage("--status"));
    return { ok: false };
  }

  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    values = parseArgs({
      args: [...rest],
      allowPositionals: false,
      strict: true,
      options: RUN_LIST_PARSE_ARG_OPTIONS,
    }).values;
  } catch {
    for (const flag of LIST_VALUE_FLAGS) {
      if (!listFlagHasValue(rest, flag)) {
        io.stderr(listFlagMissingValueMessage(flag));
        return { ok: false };
      }
    }
    io.stderr(RUN_LIST_USAGE);
    return { ok: false };
  }

  const params: ListRpcParams = {};

  if (!applyNumericListFlag("--since", values.since, params, deps, io)) return { ok: false };
  if (!applyNumericListFlag("--limit", values.limit, params, deps, io)) return { ok: false };
  for (const { argvKey, flag, paramKey } of LIST_STRING_DIMENSIONS) {
    const raw = values[argvKey];
    if (typeof raw !== "string") continue;
    if (raw.length === 0) {
      io.stderr(listFlagMissingValueMessage(flag));
      return { ok: false };
    }
    params[paramKey] = raw;
  }
  if (typeof values.status === "string") {
    const status = parseListStatusValue(values.status);
    if (status === undefined) {
      io.stderr(listFlagMissingValueMessage("--status"));
      return { ok: false };
    }
    params.status = status;
  }

  return { ok: true, params };
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

  const listParams = resolveListRpcRequest(parsed.params);
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

async function runLogSubcommand(runId: string, follow: boolean, io: Io, deps: CliDeps): Promise<number> {
  const socketPath = await resolveRunOwnerSocket(runId, deps);
  return withRunClient(
    io,
    deps,
    async (client) => {
      const streamId = crypto.randomUUID();
      const payload = follow ? { runId, afterSeq: 0, follow: true } : { runId, afterSeq: 0 };
      client.send({ kind: "stream-open", streamId, payload });

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

  if (subcommand === "log") {
    let logValues: { follow?: boolean };
    let logPositionals: string[];
    try {
      const parsed = parseArgs({
        args: argv.slice(1),
        allowPositionals: true,
        strict: true,
        options: { follow: { type: "boolean" } },
      });
      logValues = parsed.values;
      logPositionals = parsed.positionals;
    } catch {
      io.stderr(RUN_LOG_USAGE);
      return 1;
    }
    const runId = logPositionals[0];
    if (logPositionals.length !== 1 || runId === undefined) {
      io.stderr(RUN_LOG_USAGE);
      return 1;
    }
    return runLogSubcommand(runId, logValues.follow === true, io, deps);
  }

  if (isRunAction(subcommand)) return runActionCommand(subcommand, argv.slice(1), io, deps);

  if (subcommand === "wait" && argv.length === 2) {
    const runId = argv[1];
    if (runId === undefined) {
      io.stderr(RUN_USAGE);
      return 1;
    }
    const socketPath = await resolveRunOwnerSocket(runId, deps);
    return withRunClient(io, deps, async (client) => waitForRunCompletion(client, runId, io), socketPath);
  }

  io.stderr(subcommand === "start" ? WRITE_USAGE : RUN_USAGE);
  return 1;
}
