import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatRpcError, parseStreamPayload, request, withRunClient } from "../cli/ipc.ts";
import { waitForRunCompletion } from "../cli/run-completion.ts";
import { withConnectDispatch } from "../cli/stale-dispatch.ts";
import { RUN_LIST_USAGE, RUN_USAGE, WRITE_USAGE } from "../cli/usage.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { parseListRuns, parseStartResult } from "../daemon/daemon-wire.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
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

  if (subcommand === "start") {
    const parsed = parseWriteCliInput(argv.slice(1), deps);
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

  if (subcommand === "workflow") {
    return runWorkflowCommand(argv.slice(1), io, deps);
  }

  if (subcommand === "list") {
    const rest = argv.slice(1);
    let sinceMs: number | undefined;
    if (rest.length === 2 && rest[0] === "--since") {
      const value = rest[1];
      if (value === undefined || value.startsWith("-")) {
        io.stderr("invalid_since: invalid value\n");
        return 1;
      }
      const cutoff = parseSince(value, deps.now?.() ?? Date.now());
      if (cutoff === undefined) {
        io.stderr("invalid_since: invalid value\n");
        return 1;
      }
      sinceMs = cutoff;
    } else if (rest.length !== 0) {
      io.stderr(RUN_LIST_USAGE);
      return 1;
    }

    return withRunClient(io, deps, async (client) => {
      let result: unknown;
      try {
        result = await request(client, "list", sinceMs === undefined ? undefined : { sinceMs });
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

      for (const run of list.runs) io.stdout(formatListRunRow(run));
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

  if (isRunAction(subcommand)) return runActionCommand(subcommand, argv.slice(1), io, deps);

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
