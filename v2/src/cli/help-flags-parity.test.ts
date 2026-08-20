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
import { helpFlagsParityGaps, missingParserFlagsInHelp, parserAcceptedLongFlags } from "./help-flags-parity.ts";

function writeParserLongFlags(): string[] {
  return Object.keys(WRITE_PARSE_ARG_OPTIONS).map((key) => `--${key}`);
}

describe("help flag parser parity", () => {
  test("every guarded path lists all parser-accepted flags", () => {
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
    const fullParserFlags = parserAcceptedLongFlags(["write"]);
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
