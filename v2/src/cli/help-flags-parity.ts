import {
  IMPLEMENT_WORKFLOW_PARSE_OPTIONS,
  INTENT_WORKFLOW_PARSE_OPTIONS,
  PLAN_WORKFLOW_PARSE_OPTIONS,
} from "../commands/workflow-args.ts";
import {
  CLEANUP_PARSE_ARG_OPTIONS,
  DAEMON_LOG_PARSE_ARG_OPTIONS,
  PIPELINE_START_PARSE_ARG_OPTIONS,
  parityFlagsFromParseOptions,
  RUN_LIST_PARSE_ARG_OPTIONS,
  WRITE_PARSE_ARG_OPTIONS,
} from "./command-help-flags.ts";
import { type CommandFlag, type CommandNode, commandTree, resolveHelpPath } from "./command-tree.ts";

const PARITY_PATHS = [
  ["write"],
  ["run", "start"],
  ["cleanup"],
  ["run", "list"],
  ["daemon", "log"],
  ["pipeline", "start"],
  ["run", "workflow", "intent"],
  ["run", "workflow", "plan"],
  ["run", "workflow", "implement"],
] as const;

function parseOptionKeysToLongFlags(keys: readonly string[]): readonly string[] {
  return keys.map((key) => `--${key}`);
}

export function parserAcceptedLongFlags(path: readonly string[]): readonly string[] {
  const key = path.join(" ");
  switch (key) {
    case "write":
    case "run start":
      return parseOptionKeysToLongFlags(Object.keys(WRITE_PARSE_ARG_OPTIONS));
    case "cleanup":
      return parityFlagsFromParseOptions(CLEANUP_PARSE_ARG_OPTIONS);
    case "run list":
      return parseOptionKeysToLongFlags(Object.keys(RUN_LIST_PARSE_ARG_OPTIONS));
    case "daemon log":
      return parseOptionKeysToLongFlags(Object.keys(DAEMON_LOG_PARSE_ARG_OPTIONS));
    case "pipeline start":
      return parityFlagsFromParseOptions(PIPELINE_START_PARSE_ARG_OPTIONS);
    case "run workflow intent":
      return parseOptionKeysToLongFlags(Object.keys(INTENT_WORKFLOW_PARSE_OPTIONS));
    case "run workflow plan":
      return parseOptionKeysToLongFlags(Object.keys(PLAN_WORKFLOW_PARSE_OPTIONS));
    case "run workflow implement":
      return parseOptionKeysToLongFlags(Object.keys(IMPLEMENT_WORKFLOW_PARSE_OPTIONS));
    default:
      throw new Error(`help-flags-parity: no parser surface for ${key}`);
  }
}

export function missingParserFlagsInHelp(
  parserFlags: readonly string[],
  registeredFlags: readonly CommandFlag[],
): string[] {
  const registeredNames = new Set(registeredFlags.map((flag) => flag.name));
  return parserFlags.filter((name) => !registeredNames.has(name));
}

function nodeAtPath(path: readonly string[]): CommandNode {
  const chain = resolveHelpPath(commandTree, path);
  if (chain === undefined) {
    throw new Error(`help-flags-parity: unknown help path ${path.join(" ")}`);
  }
  return chain[chain.length - 1] ?? commandTree;
}

export function helpFlagsParityGaps(): Array<{ path: string; missing: string[] }> {
  const gaps: Array<{ path: string; missing: string[] }> = [];
  for (const path of PARITY_PATHS) {
    const node = nodeAtPath(path);
    const missing = missingParserFlagsInHelp(parserAcceptedLongFlags(path), node.flags ?? []);
    if (missing.length > 0) {
      gaps.push({ path: path.join(" "), missing });
      continue;
    }
    for (const flag of node.flags ?? []) {
      if (flag.description.trim().length === 0) {
        gaps.push({ path: path.join(" "), missing: [`${flag.name} (empty description)`] });
      }
    }
  }
  return gaps;
}
