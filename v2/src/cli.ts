import packageJson from "../../package.json";
import type { CliDeps } from "./cli/deps.ts";
import { createRuntimeDeps } from "./cli/deps.ts";
import type { Io } from "./cli/io.ts";
import {
  CLEANUP_USAGE,
  CONFIG_USAGE,
  DAEMON_USAGE,
  HELP_USAGE,
  RUN_USAGE,
  TUI_USAGE,
  WRITE_USAGE,
} from "./cli/usage.ts";
import { runCleanupCliCommand } from "./commands/cleanup-cli.ts";
import { runConfigCommand } from "./commands/config.ts";
import { runDaemonCommand } from "./commands/daemon.ts";
import { runRunCommand } from "./commands/run.ts";
import { runTuiCommand } from "./commands/tui.ts";
import { exitCodeForWriteResult, parseWriteCliInput, writeStdoutJson } from "./commands/write.ts";
import { resolveWriteLoopBindings } from "./daemon/daemon.ts";
import { applyOperatorSessionId } from "./execution/write-loop.ts";
import { daemonPathsForDigest } from "./paths.ts";

type CommandHandler = (argv: readonly string[], io: Io, deps: CliDeps, operatorSessionId: string) => Promise<number>;

export type CommandEntry = {
  name: string;
  summary: string;
  usage: string;
  handler: CommandHandler;
};

async function runWriteCommand(
  argv: readonly string[],
  out: Io,
  runtimeDeps: CliDeps,
  operatorSessionId: string,
): Promise<number> {
  const parsed = parseWriteCliInput(argv, runtimeDeps);
  if (!parsed.ok) {
    if (parsed.message !== undefined) out.stderr(parsed.message);
    out.stderr(WRITE_USAGE);
    return 1;
  }

  const resolved = resolveWriteLoopBindings(parsed.input);
  if (!resolved.ok) {
    out.stderr(`${resolved.message}\n`);
    return 1;
  }

  const loopResult = await runtimeDeps.executeWriteLoop(applyOperatorSessionId(resolved.input, operatorSessionId));

  out.stdout(`${writeStdoutJson(loopResult)}\n`);

  return exitCodeForWriteResult(loopResult.kind);
}

function renderHelp(out: Io): number {
  out.stdout(
    `${enumerateCommands()
      .map(({ name, summary }) => `${name}\t${summary}`)
      .join("\n")}\n`,
  );
  return 0;
}

const commandEntries: readonly CommandEntry[] = [
  { name: "write", summary: "Run an in-process write loop.", usage: WRITE_USAGE, handler: runWriteCommand },
  { name: "daemon", summary: "Manage the background daemon.", usage: DAEMON_USAGE, handler: runDaemonCommand },
  { name: "config", summary: "Show or update machine configuration.", usage: CONFIG_USAGE, handler: runConfigCommand },
  { name: "run", summary: "Manage daemon-backed runs.", usage: RUN_USAGE, handler: runRunCommand },
  { name: "tui", summary: "Open the interactive run monitor.", usage: TUI_USAGE, handler: runTuiCommand },
  {
    name: "cleanup",
    summary: "Retire completed worktrees and specs.",
    usage: CLEANUP_USAGE,
    handler: runCleanupCliCommand,
  },
  {
    name: "help",
    summary: "List top-level commands.",
    usage: HELP_USAGE,
    handler: (argv, io) => {
      if (argv.length !== 0) {
        io.stderr(HELP_USAGE);
        return Promise.resolve(1);
      }
      return Promise.resolve(renderHelp(io));
    },
  },
];

/** The single source of truth for top-level command dispatch and discovery. */
export function enumerateCommands(): readonly CommandEntry[] {
  return commandEntries;
}

export function findCommand(name: string): CommandEntry | undefined {
  return commandEntries.find((entry) => entry.name === name);
}

function levenshteinDistance(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  let previous = Array.from({ length: rightCharacters.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= leftCharacters.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= rightCharacters.length; rightIndex += 1) {
      current.push(
        Math.min(
          (current[rightIndex - 1] ?? 0) + 1,
          (previous[rightIndex] ?? 0) + 1,
          (previous[rightIndex - 1] ?? 0) + Number(leftCharacters[leftIndex - 1] !== rightCharacters[rightIndex - 1]),
        ),
      );
    }
    previous = current;
  }

  return previous[rightCharacters.length] ?? 0;
}

export async function main(argv: readonly string[], io?: Io, deps?: Partial<CliDeps>): Promise<number> {
  const out = io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const baseDeps = createRuntimeDeps(deps);
  const daemonPaths = daemonPathsForDigest(await baseDeps.getExecutableDigest());
  const runtimeDeps: CliDeps = {
    ...baseDeps,
    socketPath: deps?.socketPath ?? daemonPaths.socketPath,
    pidPath: deps?.pidPath ?? daemonPaths.pidPath,
    logPath: deps?.logPath ?? daemonPaths.logPath,
    statePath: deps?.statePath ?? daemonPaths.statePath,
    logsPath: deps?.logsPath ?? daemonPaths.logsPath,
  };
  const command = argv[0];
  const operatorSessionId = crypto.randomUUID();

  if (argv.length === 1 && command === "--version") {
    out.stdout(`${packageJson.version}\n`);
    return 0;
  }

  if (command === undefined) {
    out.stdout("v2 not ready\n");
    return 0;
  }

  const entry = findCommand(command);
  if (entry !== undefined) return entry.handler(argv.slice(1), out, runtimeDeps, operatorSessionId);

  const closeMatches = enumerateCommands().filter((entry) => levenshteinDistance(command, entry.name) <= 2);
  const closeCommand = closeMatches.length === 1 ? closeMatches[0] : undefined;
  out.stderr(`unknown command: ${command}\n`);
  if (closeCommand !== undefined) out.stderr(`did you mean ${closeCommand.name}?\n`);
  out.stderr("run `jarvis help` for available commands\n");
  return 1;
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
