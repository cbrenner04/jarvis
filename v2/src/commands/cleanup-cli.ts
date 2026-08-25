import { parseArgs } from "node:util";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { CLEANUP_PARSE_ARG_OPTIONS } from "../cli/command-help-flags.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatConnectionError } from "../cli/ipc.ts";
import { CLEANUP_USAGE } from "../cli/usage.ts";
import { jarvisHome } from "../paths.ts";
import { openStateStore } from "../persistence/state-store.ts";
import {
  createBulkCleanupDaemonClient,
  createStaleResetDaemonClient,
  type DaemonClient,
  runAbandonCommand,
  runCleanupCommand,
} from "./cleanup.ts";

type PromptStdin = {
  isTTY?: boolean;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  pause(): unknown;
};

type CleanupCliArgs = {
  abandonName: string | undefined;
  dryRun: boolean;
  projectName: string | undefined;
  yes: boolean;
};

function parseCleanupCliArgs(argv: readonly string[], io: Io): CleanupCliArgs | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: CLEANUP_PARSE_ARG_OPTIONS,
    });
    if (positionals.length > 1) {
      io.stderr(CLEANUP_USAGE);
      return undefined;
    }

    const projectName = positionals[0];
    const abandonName = typeof values.abandon === "string" ? values.abandon : undefined;
    if (projectName !== undefined && abandonName !== undefined) {
      io.stderr(CLEANUP_USAGE);
      return undefined;
    }

    const dryRun = values["dry-run"] === true;
    const yes = values.yes === true;
    if (dryRun && yes) {
      io.stderr(CLEANUP_USAGE);
      return undefined;
    }

    return { dryRun, yes, abandonName, projectName };
  } catch {
    io.stderr(CLEANUP_USAGE);
    return undefined;
  }
}

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
  const parsedArgs = parseCleanupCliArgs(argv, io);
  if (parsedArgs === undefined) return 1;
  const { dryRun, yes, abandonName, projectName } = parsedArgs;

  const registry = deps.readProjectRegistry();
  if (projectName !== undefined && !Object.hasOwn(registry, projectName)) {
    io.stderr(`Unknown project: ${projectName}\n`);
    return 1;
  }
  const cleanupRegistry =
    projectName === undefined
      ? registry
      : Object.fromEntries(Object.entries(registry).filter(([name]) => name === projectName));
  const options = dryRun
    ? { dryRun: true }
    : { promptConfirm: yes ? async () => true : (deps.promptConfirm ?? createPromptFunction()) };

  if (abandonName !== undefined) {
    let daemonClient: DaemonClient;
    try {
      const client = await deps.connectIpcClient(deps.socketPath);
      daemonClient = createStaleResetDaemonClient(client);
    } catch (error) {
      if (isNoListenerError(error)) {
        io.stderr("Cannot abandon: no daemon is listening; run `jarvis daemon start`\n");
        return 1;
      }
      io.stderr(formatConnectionError(error));
      return 1;
    }

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

  const { client: daemonClient, hasAnsweringDaemon, firstError } = await createBulkCleanupDaemonClient(deps);

  if (!hasAnsweringDaemon) {
    if (firstError !== undefined && !isNoListenerError(firstError)) {
      io.stderr(formatConnectionError(firstError));
      return 1;
    }
    io.stderr(
      "No daemon is listening for this jarvis executable; continuing cleanup without daemon-backed worktree retirement. Run `jarvis daemon start`.\n",
    );
  }

  const store = openStateStore();

  return runCleanupCommand(
    options,
    cleanupRegistry,
    deps.jarvisRoot ?? jarvisHome(),
    deps.subprocessRunner ?? realAsyncSubprocessRunner,
    daemonClient,
    store,
    io,
    registry,
  );
}

function isNoListenerError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED";
}
