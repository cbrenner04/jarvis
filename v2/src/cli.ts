import packageJson from "../../package.json";
import type { CliDeps } from "./cli/deps.ts";
import { createRuntimeDeps } from "./cli/deps.ts";
import { getInvokingExecutableDigest } from "./cli/dispatch-revision.ts";
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
import { commandTree, levenshteinDistance, renderHelpNode, renderUnknownSegmentError, resolveHelpPath } from "./cli/command-tree.ts";
import type { CommandNode } from "./cli/command-tree.ts";
import { runCleanupCliCommand } from "./commands/cleanup-cli.ts";
import { runConfigCommand } from "./commands/config.ts";
import { runDaemonCommand } from "./commands/daemon.ts";
import { runRunCommand } from "./commands/run.ts";
import { runTuiCommand } from "./commands/tui.ts";
import { exitCodeForWriteResult, parseWriteCliInput, writeStdoutJson } from "./commands/write.ts";
import { resolveWriteLoopBindings } from "./daemon/daemon.ts";
import { applyOperatorSessionId } from "./execution/write-loop.ts";
import { daemonPathsByDigest } from "./paths.ts";

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

function getAncestorUsage(node: CommandNode, path: readonly string[]): string | undefined {
  if (node.usage !== undefined) {
    return node.usage;
  }

  // Walk up the path to find an ancestor with usage
  for (let i = path.length - 1; i >= 0; i--) {
    const ancestorPath = path.slice(0, i);
    const ancestor = resolveHelpPath(commandTree, ancestorPath);
    if (ancestor !== undefined && ancestor.node.usage !== undefined) {
      return ancestor.node.usage;
    }
  }

  return undefined;
}

function renderHelp(out: Io, path: readonly string[]): number {
  const resolved = resolveHelpPath(commandTree, path);

  if (resolved === undefined) {
    // Unknown path - find which segment is unknown
    let current = commandTree;
    let unknownSegment: string | undefined;
    let unknownIndex = -1;

    for (let i = 0; i < path.length; i++) {
      const segment = path[i];
      if (segment === undefined) break;

      const child = current.subcommands?.find((sub) => sub.name === segment);

      if (child === undefined) {
        unknownSegment = segment;
        unknownIndex = i;
        break;
      }

      if (i === path.length - 1) {
        current = child;
      } else {
        current = child;
      }
    }

    if (unknownIndex >= 0 && unknownSegment !== undefined) {
      const pathSoFar = path.slice(0, unknownIndex);
      const parentResolved = resolveHelpPath(commandTree, pathSoFar);

      if (parentResolved !== undefined) {
        const siblings = parentResolved.node.subcommands ?? [];
        out.stderr(renderUnknownSegmentError(unknownSegment, pathSoFar, siblings));
      }
    }

    return 1;
  }

  // If node has no usage, find the ancestor's usage
  let output = "";
  const usage = resolved.node.usage ?? getAncestorUsage(resolved.node, path);
  if (usage !== undefined) {
    output += usage;
  }

  // Only show subcommands if this node has them
  if (resolved.node.subcommands !== undefined && resolved.node.subcommands.length > 0) {
    for (const child of resolved.node.subcommands) {
      output += `${child.name}\t${child.summary}\n`;
    }
  }

  out.stdout(output);
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
    summary: "Show help for commands and subcommands.",
    usage: HELP_USAGE,
    handler: (argv, io) => {
      return Promise.resolve(renderHelp(io, argv));
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


export async function main(argv: readonly string[], io?: Io, deps?: Partial<CliDeps>): Promise<number> {
  const out = io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const digest = deps?.getExecutableDigest ? await deps.getExecutableDigest() : await getInvokingExecutableDigest();
  const keyedPaths = daemonPathsByDigest(digest);
  const runtimeDeps = createRuntimeDeps({
    socketPath: keyedPaths.socketPath,
    pidPath: keyedPaths.pidPath,
    logPath: keyedPaths.logPath,
    ...deps,
  });
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
