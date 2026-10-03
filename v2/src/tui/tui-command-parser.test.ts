import { describe, expect, test } from "bun:test";
import { parseTuiCommand, type TuiCommandErrorCode, tokenizeTuiCommand } from "./tui-command-parser.ts";

function expectCode(input: string, code: TuiCommandErrorCode): void {
  expect(parseTuiCommand(input)).toMatchObject({ kind: "error", code });
}

describe("parseTuiCommand", () => {
  test("parses CLI-aligned pipeline steering verbs", () => {
    expect(parseTuiCommand("pipeline approve")).toEqual({ kind: "approve" });
    expect(parseTuiCommand("pipeline reject")).toEqual({ kind: "reject" });
    expect(parseTuiCommand("pipeline resume")).toEqual({ kind: "resume" });
  });

  test("parses CLI-aligned run steering verbs", () => {
    expect(parseTuiCommand("run kill")).toEqual({ kind: "kill" });
    expect(parseTuiCommand("run resume")).toEqual({ kind: "resume-run" });
    expect(parseTuiCommand("run log")).toEqual({ kind: "log" });
  });

  test("parses pipeline start with CLI prefix", () => {
    expect(parseTuiCommand("pipeline start jarvis --seed v2/spec/seeds/foo.md")).toEqual({
      kind: "start",
      project: "jarvis",
      seed: { mode: "path", value: "v2/spec/seeds/foo.md" },
    });
    expect(parseTuiCommand('pipeline start jarvis --seed-text "ship it"')).toEqual({
      kind: "start",
      project: "jarvis",
      seed: { mode: "text", value: "ship it" },
    });
    expectCode("start jarvis --seed v2/spec/seeds/foo.md", "unknown_verb");
  });

  test("pipeline start accepts and ignores --detach", () => {
    const expected = {
      kind: "start" as const,
      project: "jarvis",
      seed: { mode: "path" as const, value: "path" },
    };
    expect(parseTuiCommand("pipeline start jarvis --detach --seed path")).toEqual(expected);
    expect(parseTuiCommand("pipeline start jarvis --seed path --detach")).toEqual(expected);
  });

  test("selection-scoped steering rejects trailing positionals", () => {
    expectCode("pipeline approve foo", "unexpected_arguments");
    expectCode("run kill run-1", "unexpected_arguments");
  });

  test("legacy bare verbs are hard-cut", () => {
    expectCode("approve", "unknown_verb");
    expectCode("kill", "unknown_verb");
    expectCode("resume-run", "unknown_verb");
    expectCode("start jarvis --seed x", "unknown_verb");
  });

  test.each([
    [
      "pipeline start jarvis --seed v2/spec/seeds/foo.md",
      { kind: "start", project: "jarvis", seed: { mode: "path", value: "v2/spec/seeds/foo.md" } },
    ],
    [
      'pipeline start jarvis --seed-text "ship it"',
      { kind: "start", project: "jarvis", seed: { mode: "text", value: "ship it" } },
    ],
    ["expand", { kind: "expand" }],
    ["collapse", { kind: "collapse" }],
  ] as const)("parses %s", (input, expected) => {
    expect(parseTuiCommand(input)).toEqual(expected);
  });

  test.each([
    ["pipeline start jarvis --seed=value", "unknown_option"],
    ["pipeline start jarvis --seed a --seed b", "duplicate_seed_flag"],
    ["pipeline start jarvis --seed-text a --seed-text b", "duplicate_seed_flag"],
    ["pipeline start jarvis --seed a --seed-text b", "both_seed_flags"],
    ["pipeline start jarvis --", "unknown_option"],
    ["pipeline start jarvis --wat value", "unknown_option"],
    ["pipeline start jarvis -x", "unknown_option"],
    ["pipeline start jarvis --seed --seed-text", "missing_seed_value"],
    ["pipeline start jarvis --seed -x", "missing_seed_value"],
    ["pipeline start --seed value", "extra_positional"],
  ] as const)("enforces canonical start grammar: %s", (input, code) => {
    expectCode(input, code);
  });

  test.each([
    ['pipeline start pro"ject name" --seed value', { project: "project name", seed: { mode: "path", value: "value" } }],
    ['pipeline start "" --seed ""', { project: "", seed: { mode: "path", value: "" } }],
    ['pipeline start jar"vis" --seed-text ship" it"', { project: "jarvis", seed: { mode: "text", value: "ship it" } }],
    [
      'pipeline start jar\\ vis --seed-text say\\ \\"hi\\"\\\\ok',
      {
        project: "jar vis",
        seed: { mode: "text", value: 'say "hi"\\ok' },
      },
    ],
    ["pipeline start jar\\q --seed-text ship\\q", { project: "jar\\q", seed: { mode: "text", value: "ship\\q" } }],
    ["pipeline start jarvis --seed path\\", { project: "jarvis", seed: { mode: "path", value: "path\\" } }],
  ] as const)("preserves tokenizer payload for %s", (input, expected) => {
    expect(parseTuiCommand(input)).toEqual({ kind: "start", ...expected });
  });

  test("tokenizer emits empty and adjacent tokens without syntax", () => {
    expect(tokenizeTuiCommand('one "" two" three"')).toEqual({
      kind: "tokens",
      tokens: ["one", "", "two three"],
    });
  });

  test.each([
    ["", "malformed_input"],
    [" \t\n", "malformed_input"],
    ['pipeline start jarvis --seed "open', "unterminated_quote"],
    ["wat", "unknown_verb"],
    ["pipeline start", "missing_project"],
    ["pipeline start jarvis", "missing_seed_choice"],
    ["pipeline start jarvis --seed", "missing_seed_value"],
    ["pipeline start jarvis --seed a --seed-text b", "both_seed_flags"],
    ["pipeline start jarvis --seed a --seed b", "duplicate_seed_flag"],
    ["pipeline start jarvis --unknown", "unknown_option"],
    ["pipeline start jarvis stray", "extra_positional"],
    ["expand stray", "unexpected_arguments"],
  ] as const)("returns %s as %s", (input, code) => {
    expectCode(input, code);
  });

  test.each([
    ['pipeline approve "', "unterminated_quote"],
    ["pipeline start jarvis stray --unknown", "extra_positional"],
    ["pipeline start jarvis --unknown stray", "unknown_option"],
    ["pipeline start jarvis --seed --unknown stray", "missing_seed_value"],
    ["pipeline start jarvis --seed a --seed b --seed-text c", "duplicate_seed_flag"],
    ["pipeline start jarvis --seed-text a --seed b --seed-text c", "duplicate_seed_flag"],
  ] as const)("pins error precedence for %s", (input, code) => {
    expectCode(input, code);
  });

  test.each([
    "expand operand",
    "expand --all",
    'expand ""',
    "collapse operand",
    "collapse --all",
    'collapse ""',
    "pipeline approve foo",
    "pipeline reject foo",
    "pipeline resume foo",
  ])("rejects trailing expand/collapse token: %s", (input) => {
    expectCode(input, "unexpected_arguments");
  });

  test("pause is no longer a dock verb", () => {
    expectCode("pause", "unknown_verb");
    expectCode("run pause", "unknown_verb");
  });

  test.each([
    "run kill foo",
    "run resume foo",
    "run kill ignored --tokens",
    "run resume ignored --tokens",
  ])("rejects trailing run-steering tokens: %s", (input) => {
    expectCode(input, "unexpected_arguments");
  });

  test.each(["run log run-123", "run log ignored --tokens"])("rejects trailing log tokens: %s", (input) => {
    expectCode(input, "unexpected_arguments");
  });

  test.each(["constructor", "toString", "__proto__"])("rejects inherited unavailable-map property: %s", (verb) => {
    expect(parseTuiCommand(verb)).toEqual({ kind: "error", code: "unknown_verb" });
  });

  test("pins every parser guard", () => {
    expectCode("unknown", "unknown_verb");
  });
});
