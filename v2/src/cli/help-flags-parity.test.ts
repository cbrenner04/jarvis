import { describe, expect, test } from "bun:test";
import {
  INIT_HELP_FLAGS,
  INIT_PARSE_ARG_OPTIONS,
  PIPELINE_LIST_PARSE_ARG_OPTIONS,
  RUN_KILL_HELP_FLAGS,
  RUN_KILL_PARSE_ARG_OPTIONS,
  WRITE_HELP_FLAGS,
  WRITE_PARSE_ARG_OPTIONS,
} from "./command-help-flags.ts";
import { type CommandNode, commandTree, resolveHelpPath } from "./command-tree.ts";
import {
  helpFlagsParityGaps,
  missingParserFlagsInHelp,
  parserAcceptedLongFlags,
  parityGuardedPaths,
} from "./help-flags-parity.ts";

/** Pre-fix hand-maintained list; vacuous when commandTree gains guarded leaves without a matching edit. */
const HAND_MAINTAINED_PARITY_PATHS = [
  ["init"],
  ["run", "start"],
  ["cleanup"],
  ["run", "list"],
  ["run", "kill"],
  ["daemon", "log"],
  ["pipeline", "start"],
  ["pipeline", "list"],
  ["run", "workflow", "intent"],
  ["run", "workflow", "plan"],
  ["run", "workflow", "implement"],
] as const;

function writeParserLongFlags(): string[] {
  return Object.keys(WRITE_PARSE_ARG_OPTIONS).map((key) => `--${key}`);
}

function commandTreeLeafPaths(node: CommandNode, prefix: readonly string[] = []): readonly (readonly string[])[] {
  const children = node.subcommands ?? [];
  if (children.length === 0) {
    return prefix.length > 0 ? [prefix] : [];
  }
  return children.flatMap((child) => commandTreeLeafPaths(child, [...prefix, child.name]));
}

function parityGuardedPathsFromCommandTree(root: CommandNode): readonly (readonly string[])[] {
  return commandTreeLeafPaths(root).filter((path) => {
    const chain = resolveHelpPath(root, path);
    if (chain === undefined) {
      throw new Error(`help-flags-parity test: unknown help path ${path.join(" ")}`);
    }
    const node = chain[chain.length - 1];
    if ((node?.flags?.length ?? 0) === 0) {
      return false;
    }
    try {
      parserAcceptedLongFlags(path);
      return true;
    } catch {
      return false;
    }
  });
}

function pathKeys(paths: readonly (readonly string[])[]): string[] {
  return paths.map((path) => path.join(" "));
}

describe("help flag parser parity", () => {
  test("every guarded path lists all parser-accepted flags", () => {
    const discovered = parityGuardedPaths();
    expect(discovered).toEqual(parityGuardedPathsFromCommandTree(commandTree));
    expect(pathKeys(discovered)).not.toEqual(pathKeys(HAND_MAINTAINED_PARITY_PATHS.slice(0, -1)));
    expect(helpFlagsParityGaps()).toEqual([]);
  });

  test("dropping a registered flag from help metadata is a parity gap", () => {
    const parserFlags = writeParserLongFlags();
    const registered = WRITE_HELP_FLAGS.filter((flag) => flag.name !== "--spec");
    expect(missingParserFlagsInHelp(parserFlags, registered)).toEqual(["--spec"]);
  });

  test("pipeline list parser flags match its registered help flags", () => {
    expect(parserAcceptedLongFlags(["pipeline", "list"])).toEqual(
      Object.keys(PIPELINE_LIST_PARSE_ARG_OPTIONS).map((key) => `--${key}`),
    );
  });

  test("excluding a parser flag from the comparison set fails the guard", () => {
    const fullParserFlags = parserAcceptedLongFlags(["run", "start"]);
    const helpWithoutArtifact = WRITE_HELP_FLAGS.filter((flag) => flag.name !== "--artifact");
    const staleParserFlags = fullParserFlags.filter((flag) => flag !== "--artifact");

    expect(missingParserFlagsInHelp(staleParserFlags, helpWithoutArtifact)).toEqual([]);
    expect(missingParserFlagsInHelp(fullParserFlags, helpWithoutArtifact)).toEqual(["--artifact"]);
  });

  test("init parser and help flags stay aligned", () => {
    const parserFlags = parserAcceptedLongFlags(["init"]);
    expect(parserFlags).toEqual(Object.keys(INIT_PARSE_ARG_OPTIONS).map((key) => `--${key}`));
    expect(missingParserFlagsInHelp(parserFlags, INIT_HELP_FLAGS)).toEqual([]);

    const missingScaffold = INIT_HELP_FLAGS.filter((flag) => flag.name !== "--scaffold");
    expect(missingParserFlagsInHelp(parserFlags, missingScaffold)).toEqual(["--scaffold"]);
  });

  test("run kill parser and help flags stay aligned", () => {
    const parserFlags = parserAcceptedLongFlags(["run", "kill"]);
    expect(parserFlags).toEqual(["--force"]);
    expect(parserFlags).toEqual(Object.keys(RUN_KILL_PARSE_ARG_OPTIONS).map((key) => `--${key}`));
    // @mutate v2/src/cli/command-help-flags.ts "name: \"--force\"," -> "name: \"--not-force\","
    expect(missingParserFlagsInHelp(parserFlags, RUN_KILL_HELP_FLAGS)).toEqual([]);
  });
});
