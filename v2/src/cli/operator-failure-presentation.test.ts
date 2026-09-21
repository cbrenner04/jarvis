import { describe, expect, test } from "bun:test";
import type { OperatorFailureRecord } from "../../../shared/operator-failure-record.ts";
import { formatOperatorFailureBlock } from "./operator-failure-presentation.ts";

function record(overrides: Partial<OperatorFailureRecord> = {}): OperatorFailureRecord {
  return { expectation: "exp", observation: "obs", retryable: true, referencedPaths: [], ...overrides };
}

describe("formatOperatorFailureBlock", () => {
  test("no-candidate and unmatched-near-miss records keep distinct observations; only the latter renders the near miss", () => {
    const none = formatOperatorFailureBlock(record({ observation: "no candidate found" }));
    const near = formatOperatorFailureBlock(
      record({ observation: "candidate did not match", nearMiss: "docs/plan.md" }),
    );
    expect(none).toEqual([
      "failure:",
      "  expectation: exp",
      "  observation: no candidate found",
      "  reissue can help: yes",
    ]);
    expect(near).toEqual([
      "failure:",
      "  expectation: exp",
      "  observation: candidate did not match",
      "  near miss: docs/plan.md",
      "  reissue can help: yes",
    ]);
  });

  test("path origins are labeled from the recorded origin, not the path spelling, in record order", () => {
    const lines = formatOperatorFailureBlock(
      record({
        referencedPaths: [
          { path: "/repo/v2/src/x.ts", origin: "harness-internal" },
          { path: "prompts/implement/rules.md", origin: "operator-repository" },
          { path: "~/.jarvis/config.json", origin: "harness-internal" },
        ],
      }),
    );
    expect(lines.slice(-3)).toEqual([
      "  path (harness-internal): /repo/v2/src/x.ts",
      "  path (operator-repository): prompts/implement/rules.md",
      "  path (harness-internal): ~/.jarvis/config.json",
    ]);
  });

  test("block boundary and retryability", () => {
    const yes = formatOperatorFailureBlock(record({ retryable: true, nearMiss: "n" }));
    const no = formatOperatorFailureBlock(record({ retryable: false }));
    for (const lines of [yes, no]) {
      expect(lines[0]).toBe("failure:");
      for (const line of lines.slice(1)) expect(line.startsWith("  ")).toBe(true);
      expect(lines.includes("")).toBe(false);
    }
    expect(yes).toContain("  reissue can help: yes");
    expect(no).toContain("  reissue can help: no");
  });

  test("control characters and backslashes in every text field are escaped without mutating the input", () => {
    const raw = "a\tb\nc\rd\\e\u001bf\u007fg\u0000h";
    const escaped = "a\\tb\\nc\\rd\\\\e\\u001bf\\u007fg\\u0000h";
    const input = record({
      expectation: raw,
      observation: raw,
      nearMiss: raw,
      referencedPaths: [{ path: raw, origin: "operator-repository" }],
    });
    const snapshot = structuredClone(input);
    const lines = formatOperatorFailureBlock(input);
    expect(lines).toEqual([
      "failure:",
      `  expectation: ${escaped}`,
      `  observation: ${escaped}`,
      `  near miss: ${escaped}`,
      "  reissue can help: yes",
      `  path (operator-repository): ${escaped}`,
    ]);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting no raw control character survives.
    expect(lines.join("")).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(input).toEqual(snapshot);
  });
});
