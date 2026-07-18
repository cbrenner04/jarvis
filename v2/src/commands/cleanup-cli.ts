import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatConnectionError, request } from "../cli/ipc.ts";
import { CLEANUP_USAGE } from "../cli/usage.ts";
import { parseListRuns } from "../daemon/daemon-wire.ts";
import { jarvisHome } from "../paths.ts";
import { openStateStore } from "../persistence/state-store.ts";
import type { DaemonClient } from "./cleanup.ts";
import { runAbandonCommand, runCleanupCommand } from "./cleanup.ts";

function createPromptFunction(): (message: string) => Promise<boolean> {
  return async (message: string) => {
    process.stdout.write(message);
    const answer = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim().toLowerCase());
      });
    });
    return answer === "y" || answer === "yes";
  };
}

export async function runCleanupCliCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  let dryRun = false;
  let abandonName: string | undefined;
  let args: readonly string[] = argv;

  if (argv[0] === "--dry-run") {
    dryRun = true;
    args = argv.slice(1);
  } else if (argv[0] === "--abandon" && argv[1]) {
    abandonName = argv[1];
    args = argv.slice(2);
  }

  if (args.length > 0) {
    io.stderr(CLEANUP_USAGE);
    return 1;
  }

  const registry = deps.readProjectRegistry();

  // Use the real daemon client for both preview and removal so the dry-run
  // preview reflects true eligibility (a fail-open `() => []` would show a
  // worktree as eligible that a live daemon run actually protects).
  let daemonClient: DaemonClient;
  try {
    const client = await deps.connectIpcClient(deps.socketPath);
    daemonClient = async (project: string, branch: string) => {
      try {
        const result = await request(client, "list");
        const list = parseListRuns(result);
        if (list === undefined) return [];
        return list.runs.filter((r) => r.project === project && r.branch === branch).map((r) => ({ isLive: r.isLive }));
      } catch (error) {
        throw new Error(`Daemon query failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
  } catch (error) {
    io.stderr(formatConnectionError(error));
    return 1;
  }

  const options = dryRun ? { dryRun: true } : { promptConfirm: deps.promptConfirm ?? createPromptFunction() };

  if (abandonName !== undefined) {
    return runAbandonCommand(
      abandonName,
      options,
      registry,
      deps.jarvisRoot ?? jarvisHome(),
      deps.subprocessRunner ?? realAsyncSubprocessRunner,
      daemonClient,
      io,
    );
  }

  const store = openStateStore();

  return runCleanupCommand(
    options,
    registry,
    deps.jarvisRoot ?? jarvisHome(),
    deps.subprocessRunner ?? realAsyncSubprocessRunner,
    daemonClient,
    store,
    io,
  );
}
