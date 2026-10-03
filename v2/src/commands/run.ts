import { parseArgs } from "node:util";
import {
  RUN_DISMISS_PARSE_ARG_OPTIONS,
  RUN_KILL_PARSE_ARG_OPTIONS,
  RUN_LIST_PARSE_ARG_OPTIONS,
  RUN_LOG_PARSE_ARG_OPTIONS,
  RUN_RESUME_PARSE_ARG_OPTIONS,
} from "../cli/command-help-flags.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatRpcError, parseStreamPayload, request, withRunClient } from "../cli/ipc.ts";
import { formatOperatorFailureBlock } from "../cli/operator-failure-presentation.ts";
import { waitForRunCompletion } from "../cli/run-completion.ts";
import { withConnectDispatch } from "../cli/stale-dispatch.ts";
import {
  RUN_DISMISS_USAGE,
  RUN_KILL_USAGE,
  RUN_LIST_USAGE,
  RUN_LOG_USAGE,
  RUN_RESUME_USAGE,
  RUN_UNDISMISS_USAGE,
  RUN_USAGE,
} from "../cli/usage.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { parseListRuns } from "../daemon/daemon-wire.ts";
import { type KillSurvivor, parseRunKillOutcome, type RunKillOutcome } from "../daemon/run-kill-outcome.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { isRunStatus, isTerminalRunStatus, type RunStatus, TERMINAL_RUN_STATUSES } from "../persistence/state-store.ts";
import { type DismissalMode, type DismissalRow, parseDismissalArgs, reportDismissalOutcome } from "./dismissal.ts";
import { type ListRpcParams, resolveListRpcRequest } from "./run-list-rpc.ts";
import { runWorkflowCommand } from "./workflow.ts";

/**
 * `<count>/<bound>` only when the refusal is slot contention AND both numbers are present; the
 * absent cell renders `-` like every other optional column. Emitting a partial cell (`0/?`) would
 * feed a non-numeric token to downstream parsers reading this column as numbers.
 */
export function formatSlotRedriveCell(error: DaemonListRunRow["error"]): string {
  if (error?.gateRefusalCause !== "slot_contention") return "-";
  if (error.slotRedriveCount === undefined || error.slotRedriveBound === undefined) return "-";
  return `${error.slotRedriveCount}/${error.slotRedriveBound}`;
}

function reviewFeedbackItemIdColumns(run: DaemonListRunRow): string[] {
  const {
    reviewFeedbackAddressedItemIds: a,
    reviewFeedbackDeclinedItemIds: d,
    reviewFeedbackUnaddressedItemIds: u,
  } = run;
  if (a === undefined && d === undefined && u === undefined) return [];
  return [JSON.stringify(a ?? []), JSON.stringify(d ?? []), JSON.stringify(u ?? [])];
}

function formatListRunRow(run: DaemonListRunRow, showDismissal: boolean): string {
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
    e?.message === undefined ? "-" : JSON.stringify(e.message),
    e?.gateRefusalCause ?? "-",
    formatSlotRedriveCell(e),
    e?.survivingMutationKillingTests === undefined ? "-" : JSON.stringify(e.survivingMutationKillingTests),
    e?.survivingMutationKillingSetResult ?? "-",
    // Fixed positions first: the `--all` dismissal marker stays at column 22 on every row; review-feedback
    // item ids trail it only on rows that carry them.
    ...(showDismissal ? [typeof run.dismissedAt === "number" ? "dismissed" : "-"] : []),
    ...reviewFeedbackItemIdColumns(run),
  ];
  return `${columns.join("\t")}\n`;
}

function formatListFailureSection(run: DaemonListRunRow): string {
  if (run.failure === undefined) return "";
  const lines = [`run ${run.runId}\t${run.project}\t${run.branch}`, ...formatOperatorFailureBlock(run.failure)];
  return `${lines.join("\n")}\n`;
}

function isRunAction(subcommand: string | undefined): subcommand is "resume" | "kill" {
  return subcommand === "resume" || subcommand === "kill";
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
  if (values.all === true) params.includeDismissed = true;

  return { ok: true, params };
}

async function runListSubcommand(rest: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const parsed = parseListArgv(rest, io, deps);
  if (!parsed.ok) return 1;

  const listParams = resolveListRpcRequest(parsed.params);
  return withRunClient(io, deps, async (client) => {
    let result: unknown;
    try {
      result = await request(client, "list", listParams);
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
    const rows = [...list.runs].sort((a, b) => a.runId.localeCompare(b.runId));
    const showDismissal = parsed.params.includeDismissed === true;
    for (const run of rows) io.stdout(formatListRunRow(run, showDismissal));
    for (const run of rows) {
      const section = formatListFailureSection(run);
      if (section !== "") io.stdout(section);
    }
    return 0;
  });
}

async function runLogSubcommand(runId: string, follow: boolean, io: Io, deps: CliDeps): Promise<number> {
  return withRunClient(io, deps, async (client) => {
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
  });
}

async function runActionCommand(
  subcommand: "resume" | "kill",
  argv: readonly string[],
  io: Io,
  deps: CliDeps,
): Promise<number> {
  const usage = subcommand === "kill" ? RUN_KILL_USAGE : RUN_RESUME_USAGE;
  let values: { force?: boolean; "allow-lane-pr-republish"?: boolean };
  let positionals: string[];
  try {
    const options: Record<string, { type: "boolean" }> =
      subcommand === "kill" ? RUN_KILL_PARSE_ARG_OPTIONS : RUN_RESUME_PARSE_ARG_OPTIONS;
    const parsed = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch {
    io.stderr(usage);
    return 1;
  }
  const runId = positionals[0];
  if (positionals.length !== 1 || runId === undefined) {
    io.stderr(usage);
    return 1;
  }
  if (subcommand === "resume") {
    const params = values["allow-lane-pr-republish"] === true ? { runId, allowLanePrRepublish: true } : { runId };
    return withConnectDispatch(io, deps, async (client) => {
      await request(client, "resume", params);
      io.stdout(`resumed ${runId}\n`);
      return 0;
    });
  }
  return withRunClient(io, deps, async (client) => {
    let result: unknown;
    try {
      const params = values.force === true ? { runId, force: true } : { runId };
      result = await request(client, "kill", params);
    } catch (error) {
      if (error instanceof RpcError) {
        io.stderr(formatRpcError(error));
        return 1;
      }
      throw error;
    }
    return renderRunKillOutcome(runId, result, io);
  });
}

function formatKillSurvivors(survivors: readonly KillSurvivor[]): string {
  return survivors.map((survivor) => `pid ${survivor.pid} (ppid ${survivor.ppid ?? "unknown"})`).join(", ");
}

/**
 * Render the daemon's kill settlement outcome: `killed <run-id>` only when the row is durably
 * terminal; a non-settling outcome is exit 1 with the live state and surviving children on stderr;
 * a malformed envelope fails closed as an invalid daemon response.
 */
function renderRunKillOutcome(runId: string, result: unknown, io: Io): number {
  const outcome: RunKillOutcome | undefined = parseRunKillOutcome(result);
  if (outcome === undefined || outcome.runId !== runId) {
    io.stderr(`kill ${runId}: invalid daemon response: expected a kill settlement outcome\n`);
    return 1;
  }
  if (!outcome.ok) {
    io.stderr(
      `kill ${runId}: not settled within ${outcome.boundMs}ms; durable status is ${outcome.status}` +
        (outcome.survivors.length > 0
          ? `; surviving children: ${formatKillSurvivors(outcome.survivors)}`
          : "; no surviving children observed") +
        "\n",
    );
    io.stderr(
      "Re-run with --force to settle the row killed, or attribute the survivors by parent pid (daemon-parented is a live verifier child; launchd-parented is an orphan) before retrying.\n",
    );
    return 1;
  }
  io.stdout(`killed ${runId}\n`);
  if (outcome.outcome === "force-settled" && outcome.survivors.length > 0) {
    io.stderr(
      `warning: ${runId} force-settled ${outcome.status} while children may survive: ${formatKillSurvivors(outcome.survivors)}\n`,
    );
  }
  return 0;
}

const RUN_DISMISSAL_ROW: DismissalRow<RunStatus> = {
  kind: "run",
  idField: "runId",
  stateField: "status",
  parseState: (value) => (isRunStatus(value) ? value : undefined),
  isTerminal: isTerminalRunStatus,
  confirmation: (mode, runId) => `${mode === "dismiss" ? "dismissed" : "undismissed"} ${runId}`,
};

const RUN_DISMISS_SELECTOR_CONFLICT = "run dismiss: a run ID and --project are mutually exclusive\n";

type RunDismissalSelector = { kind: "run"; runId: string } | { kind: "project"; project: string };

function parseRunDismissSelector(
  argv: readonly string[],
): { ok: true; selector: RunDismissalSelector } | { ok: false; error?: string } {
  let values: { project?: string };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: RUN_DISMISS_PARSE_ARG_OPTIONS,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch {
    return { ok: false };
  }
  if (values.project === undefined) {
    const single = parseDismissalArgs(positionals);
    return single.ok ? { ok: true, selector: { kind: "run", runId: single.id } } : { ok: false };
  }
  if (positionals.length > 0) return { ok: false, error: RUN_DISMISS_SELECTOR_CONFLICT };
  if (values.project.trim().length === 0) return { ok: false };
  return { ok: true, selector: { kind: "project", project: values.project } };
}

function parseBulkDismissalCount(value: unknown): number | undefined {
  const record = value as { kind?: unknown; dismissedCount?: unknown } | null;
  if (record?.kind !== "applied") return undefined;
  const count = record.dismissedCount;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : undefined;
}

/** Sends a dismissal-family request; `undefined` after reporting an RPC error on stderr. */
async function requestDismissal(
  client: Parameters<typeof request>[0],
  method: "dismiss" | "undismiss",
  params: { runId: string } | { project: string },
  io: Io,
): Promise<{ response: unknown } | undefined> {
  try {
    return { response: await request(client, method, params) };
  } catch (error) {
    if (!(error instanceof RpcError)) throw error;
    io.stderr(formatRpcError(error));
    return undefined;
  }
}

async function runRunBulkDismissalCommand(project: string, io: Io, deps: CliDeps): Promise<number> {
  return withRunClient(io, deps, async (client) => {
    const sent = await requestDismissal(client, "dismiss", { project }, io);
    if (sent === undefined) return 1;
    const dismissedCount = parseBulkDismissalCount(sent.response);
    if (dismissedCount === undefined) {
      io.stderr("invalid daemon response\n");
      return 1;
    }
    io.stdout(`dismissed ${dismissedCount}\n`);
    return 0;
  });
}

async function runRunDismissalCommand(mode: DismissalMode, runId: string, io: Io, deps: CliDeps): Promise<number> {
  return withRunClient(io, deps, async (client) => {
    const sent = await requestDismissal(client, mode, { runId }, io);
    if (sent === undefined) return 1;
    return reportDismissalOutcome(RUN_DISMISSAL_ROW, mode, sent.response, io);
  });
}

export async function runRunCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];

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
        options: RUN_LOG_PARSE_ARG_OPTIONS,
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

  if (subcommand === "dismiss") {
    const selector = parseRunDismissSelector(argv.slice(1));
    if (!selector.ok) {
      io.stderr(selector.error ?? RUN_DISMISS_USAGE);
      return 1;
    }
    if (selector.selector.kind === "project") return runRunBulkDismissalCommand(selector.selector.project, io, deps);
    return runRunDismissalCommand("dismiss", selector.selector.runId, io, deps);
  }

  if (subcommand === "undismiss") {
    const parsed = parseDismissalArgs(argv.slice(1));
    if (!parsed.ok) {
      io.stderr(RUN_UNDISMISS_USAGE);
      return 1;
    }
    return runRunDismissalCommand("undismiss", parsed.id, io, deps);
  }

  if (isRunAction(subcommand)) return runActionCommand(subcommand, argv.slice(1), io, deps);

  if (subcommand === "wait" && argv.length === 2) {
    const runId = argv[1];
    if (runId === undefined) {
      io.stderr(RUN_USAGE);
      return 1;
    }
    return withRunClient(io, deps, async (client) => waitForRunCompletion(client, runId, io));
  }

  io.stderr(RUN_USAGE);
  return 1;
}
