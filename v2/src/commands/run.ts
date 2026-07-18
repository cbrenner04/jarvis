import type { CliDeps } from "../cli/deps.ts";
import { stripAutoBounceFlag, withAutoBounceDispatch } from "../cli/stale-dispatch.ts";
import type { Io } from "../cli/io.ts";
import { formatRpcError, parseStreamPayload, request, withRunClient } from "../cli/ipc.ts";
import { waitForRunCompletion } from "../cli/run-completion.ts";
import { RUN_USAGE, WRITE_USAGE } from "../cli/usage.ts";
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
    run.prNumber !== undefined ? String(run.prNumber) : "-",
    run.prUrl ?? "-",
  ];
  return `${columns.join("\t")}\n`;
}

export async function runRunCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];

  if (subcommand === "start") {
    const bounce = stripAutoBounceFlag(argv.slice(1));
    const parsed = parseWriteCliInput(bounce.argv, deps);
    if (!parsed.ok) {
      if (parsed.message !== undefined) io.stderr(parsed.message);
      io.stderr(WRITE_USAGE);
      return 1;
    }

    return withAutoBounceDispatch(io, deps, bounce.autoBounce, async (client) => {
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

  const resumeBounce = subcommand === "resume" ? stripAutoBounceFlag(argv.slice(1)) : undefined;
  if ((subcommand === "pause" || subcommand === "resume" || subcommand === "kill") && (argv.length === 2 || (subcommand === "resume" && resumeBounce?.argv.length === 1))) {
    const runId = subcommand === "resume" ? resumeBounce?.argv[0] : argv[1];
    if (runId === undefined) { io.stderr(RUN_USAGE); return 1; }
    if (subcommand === "resume") return withAutoBounceDispatch(io, deps, resumeBounce?.autoBounce ?? true, async (client) => {
      await request(client, "resume", { runId });
      io.stdout(`resumed ${runId}\n`);
      return 0;
    });
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
