import {
  CLEANUP_HELP_FLAGS,
  DAEMON_LOG_HELP_FLAGS,
  RUN_LIST_HELP_FLAGS,
  WORKFLOW_IMPLEMENT_HELP_FLAGS,
  WORKFLOW_INTENT_HELP_FLAGS,
  WORKFLOW_PLAN_HELP_FLAGS,
  WRITE_HELP_FLAGS,
} from "./command-help-flags.ts";
import {
  CLEANUP_USAGE,
  CONFIG_USAGE,
  DAEMON_LOG_USAGE,
  DAEMON_USAGE,
  HELP_USAGE,
  RUN_LIST_USAGE,
  RUN_USAGE,
  TUI_LOG_USAGE,
  TUI_USAGE,
  WORKFLOW_IMPLEMENT_USAGE,
  WORKFLOW_INTENT_USAGE,
  WORKFLOW_PLAN_USAGE,
  WORKFLOW_USAGE,
  WRITE_USAGE,
} from "./usage.ts";

export interface CommandFlag {
  name: string;
  argumentShape: string;
  description: string;
}

export interface CommandNode {
  name: string;
  summary: string;
  usage?: string;
  flags?: readonly CommandFlag[];
  subcommands?: readonly CommandNode[];
}

export function formatCommandFlagHelpLine(flag: CommandFlag): string {
  return `${flag.name}\t${flag.argumentShape}\t${flag.description}`;
}

export const commandTree: CommandNode = {
  name: "jarvis",
  summary: "Jarvis coding-agent harness.",
  subcommands: [
    {
      name: "write",
      summary: "Run an in-process write loop.",
      usage: WRITE_USAGE,
      flags: WRITE_HELP_FLAGS,
    },
    {
      name: "daemon",
      summary: "Manage the background daemon.",
      usage: DAEMON_USAGE,
      subcommands: [
        {
          name: "start",
          summary: "Start the daemon.",
        },
        {
          name: "stop",
          summary: "Stop the daemon.",
        },
        {
          name: "status",
          summary: "Show daemon status.",
        },
        {
          name: "log",
          summary: "Stream daemon logs.",
          usage: DAEMON_LOG_USAGE,
          flags: DAEMON_LOG_HELP_FLAGS,
        },
      ],
    },
    {
      name: "config",
      summary: "Show or update machine configuration.",
      usage: CONFIG_USAGE,
      subcommands: [
        {
          name: "show",
          summary: "Show current machine configuration.",
        },
        {
          name: "path",
          summary: "Show configuration file path.",
        },
        {
          name: "set-agents",
          summary: "Set agent fallback order.",
        },
      ],
    },
    {
      name: "run",
      summary: "Manage daemon-backed runs.",
      usage: RUN_USAGE,
      subcommands: [
        {
          name: "start",
          summary: "Start a new run.",
          usage: WRITE_USAGE,
          flags: WRITE_HELP_FLAGS,
        },
        {
          name: "list",
          summary: "List runs.",
          usage: RUN_LIST_USAGE,
          flags: RUN_LIST_HELP_FLAGS,
        },
        {
          name: "log",
          summary: "Stream run logs.",
        },
        {
          name: "pause",
          summary: "Pause a run.",
        },
        {
          name: "resume",
          summary: "Resume a paused run.",
        },
        {
          name: "kill",
          summary: "Kill a run.",
        },
        {
          name: "wait",
          summary: "Wait for a run to complete.",
        },
        {
          name: "workflow",
          summary: "Run workflow presets.",
          usage: WORKFLOW_USAGE,
          subcommands: [
            {
              name: "intent",
              summary: "Create a spec seed.",
              usage: WORKFLOW_INTENT_USAGE,
              flags: WORKFLOW_INTENT_HELP_FLAGS,
            },
            {
              name: "plan",
              summary: "Create an implementation plan.",
              usage: WORKFLOW_PLAN_USAGE,
              flags: WORKFLOW_PLAN_HELP_FLAGS,
            },
            {
              name: "implement",
              summary: "Implement a plan.",
              usage: WORKFLOW_IMPLEMENT_USAGE,
              flags: WORKFLOW_IMPLEMENT_HELP_FLAGS,
            },
          ],
        },
      ],
    },
    {
      name: "tui",
      summary: "Open the interactive run monitor.",
      usage: TUI_USAGE,
      subcommands: [
        {
          name: "log",
          summary: "Stream run logs in interactive view.",
          usage: TUI_LOG_USAGE,
        },
      ],
    },
    {
      name: "cleanup",
      summary: "Retire completed worktrees and specs.",
      usage: CLEANUP_USAGE,
      flags: CLEANUP_HELP_FLAGS,
    },
    {
      name: "help",
      summary: "Show help for commands and subcommands.",
      usage: HELP_USAGE,
    },
  ],
};

export function levenshteinDistance(left: string, right: string): number {
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

/** Walks `node` along `segments`, returning the chain from `node` down to the target, or
 * `undefined` when a segment does not resolve. The chain carries the ancestors so callers can fall
 * back to the nearest usage line. */
export function resolveHelpPath(node: CommandNode, segments: readonly string[]): readonly CommandNode[] | undefined {
  const chain: CommandNode[] = [node];
  let current = node;
  for (const segment of segments) {
    const child = current.subcommands?.find((sub) => sub.name === segment);
    if (child === undefined) return undefined;
    current = child;
    chain.push(child);
  }
  return chain;
}

export interface UnknownSegment {
  segment: string;
  pathSoFar: readonly string[];
  siblings: readonly CommandNode[];
}

/** Walks `root` along `path`; returns where it breaks, or `undefined` when the whole path resolves. */
export function findUnknownSegment(root: CommandNode, path: readonly string[]): UnknownSegment | undefined {
  let current = root;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (segment === undefined) break;
    const child = current.subcommands?.find((sub) => sub.name === segment);
    if (child === undefined) {
      return { segment, pathSoFar: path.slice(0, index), siblings: current.subcommands ?? [] };
    }
    current = child;
  }
  return undefined;
}

/** Renders `root` resolved along `path`, falling back to the nearest ancestor's usage line.
 * Returns `undefined` when `path` does not resolve, so an unknown segment can never render a
 * partially-resolved node. */
export function renderHelpNode(root: CommandNode, path: readonly string[]): string | undefined {
  const chain = resolveHelpPath(root, path);
  if (chain === undefined) return undefined;

  const node = chain[chain.length - 1] ?? root;
  let usage: string | undefined;
  for (const ancestor of chain) {
    if (ancestor.usage !== undefined) usage = ancestor.usage;
  }

  let output = usage ?? "";
  for (const flag of node.flags ?? []) {
    output += `${formatCommandFlagHelpLine(flag)}\n`;
  }
  for (const child of node.subcommands ?? []) {
    output += `${child.name}\t${child.summary}\n`;
  }
  return output;
}

export function renderUnknownSegmentError(
  segment: string,
  path: readonly string[],
  siblings: readonly CommandNode[],
): string {
  let output = `unknown command: ${segment}\n`;

  const closeMatches = siblings.filter((sibling) => levenshteinDistance(segment, sibling.name) <= 2);
  if (closeMatches.length === 1) {
    const suggestion = closeMatches[0];
    if (suggestion !== undefined) {
      output += `did you mean ${suggestion.name}?\n`;
    }
  }

  if (path.length === 0) {
    output += "run `jarvis help` for available commands\n";
  } else {
    output += `run \`jarvis help ${path.join(" ")}\` for available commands\n`;
  }

  return output;
}
