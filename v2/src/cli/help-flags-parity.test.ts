import { describe, expect, test } from "bun:test";
import { WRITE_HELP_FLAGS, WRITE_PARSE_ARG_OPTIONS } from "./command-help-flags.ts";
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

  test("excluding a parser flag from the comparison set fails the guard", () => {
    const fullParserFlags = parserAcceptedLongFlags(["write"]);
    const helpWithoutArtifact = WRITE_HELP_FLAGS.filter((flag) => flag.name !== "--artifact");
    const staleParserFlags = fullParserFlags.filter((flag) => flag !== "--artifact");

    expect(missingParserFlagsInHelp(staleParserFlags, helpWithoutArtifact)).toEqual([]);
    expect(missingParserFlagsInHelp(fullParserFlags, helpWithoutArtifact)).toEqual(["--artifact"]);
  });
});
