import packageJson from "../../package.json";
import {
  commandTree,
  findUnknownSegment,
  levenshteinDistance,
  renderHelpNode,
  renderUnknownSegmentError,
} from "./cli/command-tree.ts";
import type { CliDeps } from "./cli/deps.ts";
import { createRuntimeDeps } from "./cli/deps.ts";
import { getInvokingExecutableDigest } from "./cli/dispatch-revision.ts";
import type { Io } from "./cli/io.ts";
import { WRITE_USAGE } from "./cli/usage.ts";
import { runCleanupCliCommand } from "./commands/cleanup-cli.ts";
import { runPipelineCommand } from "./commands/pipeline.ts";
import { runConfigCommand } from "./commands/config.ts";
import { runDaemonCommand } from "./commands/daemon.ts";
import { runRunCommand } from "./commands/run.ts";
import { runTuiCommand } from "./commands/tui.ts";
import { exitCodeForWriteResult, parseWriteCliInput, writeStdoutJson } from "./commands/write.ts";
import { resolveWriteLoopBindings, runWithWriteLoopMachineConfigPath } from "./daemon/daemon.ts";
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

  const resolved = runWithWriteLoopMachineConfigPath(runtimeDeps.machineConfigPath, () =>
    resolveWriteLoopBindings(parsed.input),
  );
  if (!resolved.ok) {
    out.stderr(`${resolved.message}\n`);
    return 1;
  }

  const loopResult = await runtimeDeps.executeWriteLoop(applyOperatorSessionId(resolved.input, operatorSessionId));

  out.stdout(`${writeStdoutJson(loopResult)}\n`);

  return exitCodeForWriteResult(loopResult.kind);
}

function renderHelp(out: Io, path: readonly string[]): number {
  const rendered = renderHelpNode(commandTree, path);
  if (rendered !== undefined) {
    out.stdout(rendered);
    return 0;
  }

  const unknown = findUnknownSegment(commandTree, path);
  if (unknown !== undefined) {
    out.stderr(renderUnknownSegmentError(unknown.segment, unknown.pathSoFar, unknown.siblings));
  }
  return 1;
}

export function resolveHelpFlagAlias(argv: readonly string[]): readonly string[] | undefined {
  const dashIndex = argv.findIndex((token) => token.startsWith("-"));
  if (dashIndex === -1) return undefined;

  const flag = argv[dashIndex];
  if (flag !== "--help" && flag !== "-h") return undefined;

  const candidate = argv.slice(0, dashIndex).filter((token) => !token.startsWith("-"));
  if (candidate.length === 0) return [];

  const unknown = findUnknownSegment(commandTree, candidate);
  if (unknown === undefined || unknown.pathSoFar.length === 0) return candidate;
  return unknown.pathSoFar;
}

/** Composes a registry entry from its command-tree node plus its handler, so name, summary, and
 * usage have a single home. A registered name absent from the tree is a build-time error. */
function commandEntry(name: string, handler: CommandHandler): CommandEntry {
  const node = commandTree.subcommands?.find((sub) => sub.name === name);
  if (node?.usage === undefined) throw new Error(`command tree is missing a usage line for \`${name}\``);
  return { name, summary: node.summary, usage: node.usage, handler };
}

const commandEntries: readonly CommandEntry[] = [
  commandEntry("write", runWriteCommand),
  commandEntry("daemon", runDaemonCommand),
  commandEntry("config", runConfigCommand),
  commandEntry("run", runRunCommand),
  commandEntry("tui", runTuiCommand),
  commandEntry("pipeline", runPipelineCommand),
  commandEntry("cleanup", runCleanupCliCommand),
  commandEntry("help", (argv, io) => Promise.resolve(renderHelp(io, argv))),
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

  const helpAliasPath = resolveHelpFlagAlias(argv);
  if (helpAliasPath !== undefined) {
    return renderHelp(out, helpAliasPath);
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
