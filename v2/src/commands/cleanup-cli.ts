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

type PromptStdin = {
  isTTY?: boolean;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  pause(): unknown;
};

/**
 * Interactive [y/N] confirmation. Non-TTY stdin never prompts: a closed stdin
 * emits `end` (never `data`), so a lone data listener hangs forever while
 * flowing-mode polling of the EOF'd fd spins the CPU — answer "no" immediately
 * instead, and treat `end`/`close` during a TTY prompt as "no" too.
 */
export function createPromptFunction(
  stdin: PromptStdin = process.stdin,
  write: (s: string) => void = (s) => process.stdout.write(s),
): (message: string) => Promise<boolean> {
  return async (message: string) => {
    if (stdin.isTTY !== true) {
      write(`${message}stdin is not interactive; assuming "no"\n`);
      return false;
    }
    write(message);
    const answer = await new Promise<string>((resolve) => {
      const settle = (value: string): void => {
        stdin.off("data", onData);
        stdin.off("end", onEof);
        stdin.off("close", onEof);
        stdin.pause();
        resolve(value);
      };
      const onData = (data: unknown): void => settle(String(data).trim().toLowerCase());
      const onEof = (): void => settle("");
      stdin.once("data", onData);
      stdin.once("end", onEof);
      stdin.once("close", onEof);
    });
    return answer === "y" || answer === "yes";
  };
}

export async function runCleanupCliCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  let dryRun = false;
  let yes = false;
  let abandonName: string | undefined;

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--abandon") {
      const name = args.shift();
      if (name === undefined || name.startsWith("-")) {
        io.stderr(CLEANUP_USAGE);
        return 1;
      }
      abandonName = name;
    } else {
      io.stderr(CLEANUP_USAGE);
      return 1;
    }
  }

  if (dryRun && yes) {
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

  const options = dryRun
    ? { dryRun: true }
    : { promptConfirm: yes ? async () => true : (deps.promptConfirm ?? createPromptFunction()) };

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
