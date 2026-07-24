import {
  DAEMON_LOG_USAGE,
  DAEMON_USAGE,
  CONFIG_USAGE,
  RUN_USAGE,
  RUN_LIST_USAGE,
  TUI_USAGE,
  TUI_LOG_USAGE,
  WRITE_USAGE,
  WORKFLOW_USAGE,
  WORKFLOW_INTENT_USAGE,
  WORKFLOW_PLAN_USAGE,
  WORKFLOW_IMPLEMENT_USAGE,
  CLEANUP_USAGE,
  HELP_USAGE,
} from "./usage.ts";

export interface CommandNode {
  name: string;
  summary: string;
  usage?: string;
  subcommands?: readonly CommandNode[];
}

export const commandTree: CommandNode = {
  name: "jarvis",
  summary: "Jarvis coding-agent harness.",
  subcommands: [
    {
      name: "write",
      summary: "Run an in-process write loop.",
      usage: WRITE_USAGE,
    },
    {
      name: "daemon",
      summary: "Manage the background daemon.",
      usage: DAEMON_USAGE,
      subcommands: [
        {
          name: "start",
          summary: "Start the daemon.",
          usage: WRITE_USAGE,
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
        },
        {
          name: "list",
          summary: "List runs.",
          usage: RUN_LIST_USAGE,
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
            },
            {
              name: "plan",
              summary: "Create an implementation plan.",
              usage: WORKFLOW_PLAN_USAGE,
            },
            {
              name: "implement",
              summary: "Implement a plan.",
              usage: WORKFLOW_IMPLEMENT_USAGE,
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

export interface ResolveResult {
  node: CommandNode;
  remainingSegments: string[];
}

export function resolveHelpPath(node: CommandNode, segments: readonly string[]): ResolveResult | undefined {
  if (segments.length === 0) {
    return { node, remainingSegments: [] };
  }

  const [head, ...tail] = segments;
  const child = node.subcommands?.find((sub) => sub.name === head);

  if (child === undefined) {
    return undefined;
  }

  if (tail.length === 0) {
    return { node: child, remainingSegments: [] };
  }

  return resolveHelpPath(child, tail);
}

export function renderHelpNode(node: CommandNode, path: readonly string[]): string {
  let output = "";

  if (node.usage !== undefined) {
    output += `${node.usage}`;
  }

  if (node.subcommands !== undefined && node.subcommands.length > 0) {
    if (node.usage !== undefined) {
      // Add no extra line before subcommands if usage was already present
    }
    for (const child of node.subcommands) {
      output += `${child.name}\t${child.summary}\n`;
    }
  } else if (node.usage !== undefined) {
    // Leaf node with usage: just the usage line
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
