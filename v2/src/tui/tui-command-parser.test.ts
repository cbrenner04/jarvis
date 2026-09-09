import { describe, expect, test } from "bun:test";
import { parseTuiCommand, type TuiCommandErrorCode, tokenizeTuiCommand } from "./tui-command-parser.ts";

function expectCode(input: string, code: TuiCommandErrorCode): void {
  expect(parseTuiCommand(input)).toMatchObject({ kind: "error", code });
}

describe("parseTuiCommand", () => {
  test.each([
    [
      "start jarvis --seed v2/spec/seeds/foo.md",
      { kind: "start", project: "jarvis", seed: { mode: "path", value: "v2/spec/seeds/foo.md" } },
    ],
    [
      'start jarvis --seed-text "ship it"',
      { kind: "start", project: "jarvis", seed: { mode: "text", value: "ship it" } },
    ],
    ["expand", { kind: "expand" }],
    ["collapse", { kind: "collapse" }],
    ["approve", { kind: "approve" }],
    ["reject", { kind: "reject" }],
    ["resume", { kind: "resume" }],
  ] as const)("parses %s", (input, expected) => {
    expect(parseTuiCommand(input)).toEqual(expected);
  });

  test.each([
    ["start jarvis --seed=value", "unknown_option"],
    ["start jarvis --seed a --seed b", "duplicate_seed_flag"],
    ["start jarvis --seed-text a --seed-text b", "duplicate_seed_flag"],
    ["start jarvis --seed a --seed-text b", "both_seed_flags"],
    ["start jarvis --", "unknown_option"],
    ["start jarvis --wat value", "unknown_option"],
    ["start jarvis -x", "unknown_option"],
    ["start jarvis --seed --seed-text", "missing_seed_value"],
    ["start jarvis --seed -x", "missing_seed_value"],
    ["start --seed value", "extra_positional"],
  ] as const)("enforces canonical start grammar: %s", (input, code) => {
    expectCode(input, code);
  });

  test.each([
    ['start pro"ject name" --seed value', { project: "project name", seed: { mode: "path", value: "value" } }],
    ['start "" --seed ""', { project: "", seed: { mode: "path", value: "" } }],
    ['start jar"vis" --seed-text ship" it"', { project: "jarvis", seed: { mode: "text", value: "ship it" } }],
    [
      'start jar\\ vis --seed-text say\\ \\"hi\\"\\\\ok',
      {
        project: "jar vis",
        seed: { mode: "text", value: 'say "hi"\\ok' },
      },
    ],
    ["start jar\\q --seed-text ship\\q", { project: "jar\\q", seed: { mode: "text", value: "ship\\q" } }],
    ["start jarvis --seed path\\", { project: "jarvis", seed: { mode: "path", value: "path\\" } }],
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
    ['start jarvis --seed "open', "unterminated_quote"],
    ["wat", "unknown_verb"],
    ["start", "missing_project"],
    ["start jarvis", "missing_seed_choice"],
    ["start jarvis --seed", "missing_seed_value"],
    ["start jarvis --seed a --seed-text b", "both_seed_flags"],
    ["start jarvis --seed a --seed b", "duplicate_seed_flag"],
    ["start jarvis --unknown", "unknown_option"],
    ["start jarvis stray", "extra_positional"],
    ["expand stray", "unexpected_arguments"],
  ] as const)("returns %s as %s", (input, code) => {
    expectCode(input, code);
  });

  test.each([
    ['approve "', "unterminated_quote"],
    ["start jarvis stray --unknown", "extra_positional"],
    ["start jarvis --unknown stray", "unknown_option"],
    ["start jarvis --seed --unknown stray", "missing_seed_value"],
    ["start jarvis --seed a --seed b --seed-text c", "duplicate_seed_flag"],
    ["start jarvis --seed-text a --seed b --seed-text c", "duplicate_seed_flag"],
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
    "approve foo",
    "reject foo",
    "resume foo",
  ])("rejects trailing expand/collapse token: %s", (input) => {
    expectCode(input, "unexpected_arguments");
  });

  test("parses resume-run as a run-steering verb", () => {
    expect(parseTuiCommand("resume-run")).toEqual({ kind: "resume-run" });
  });

  test("parses kill and pause as run-steering verbs", () => {
    expect(parseTuiCommand("kill")).toEqual({ kind: "kill" });
    expect(parseTuiCommand("pause")).toEqual({ kind: "pause" });
  });

  test.each([
    "kill foo",
    "pause foo",
    "resume-run foo",
    "kill ignored --tokens",
    "pause ignored --tokens",
    "resume-run ignored --tokens",
  ])("rejects trailing run-steering tokens: %s", (input) => {
    expectCode(input, "unexpected_arguments");
  });

  test("parses log as a dock verb", () => {
    expect(parseTuiCommand("log")).toEqual({ kind: "log" });
  });

  test.each(["log run-123", "log ignored --tokens"])("rejects trailing log tokens: %s", (input) => {
    expectCode(input, "unexpected_arguments");
  });

  test.each(["constructor", "toString", "__proto__"])("rejects inherited unavailable-map property: %s", (verb) => {
    expect(parseTuiCommand(verb)).toEqual({ kind: "error", code: "unknown_verb" });
  });

  test("pins every parser guard", () => {
    expectCode("unknown", "unknown_verb");
  });
});
