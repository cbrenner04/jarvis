import { describe, expect, it } from "bun:test";
import { planTestBatches, readTestIsolationClass } from "./test-slice.ts";

describe("test isolation declarations", () => {
  it("reads a top-level declaration", () => {
    expect(readTestIsolationClass("poll.test.ts", 'export const TEST_ISOLATION_CLASS = "poll-until-done";')).toBe(
      "poll-until-done",
    );
  });

  it("preserves escaped template newlines before a declaration", () => {
    for (const newline of ["\n", "\r"]) {
      const source = `const template = \`escaped \\${newline}\`export const TEST_ISOLATION_CLASS = "poll-until-done";`;

      expect(readTestIsolationClass("poll.test.ts", source)).toBe("poll-until-done");
    }
  });

  it("ignores declarations in comments, literals, templates, and nested blocks", () => {
    const source = [
      '// export const TEST_ISOLATION_CLASS = "network-heavy";',
      "/*",
      'export const TEST_ISOLATION_CLASS = "network-heavy";',
      "*/",
      "function nested() {",
      "  const single = 'escaped \\' quote }';",
      '  const double = "escaped \\" quote }";',
      "  const template = `escaped \\n text }`;",
      '  export const TEST_ISOLATION_CLASS = "network-heavy";',
      "}",
      'export const TEST_ISOLATION_CLASS = "subprocess-spawning";',
    ].join("\n");

    expect(readTestIsolationClass("spawn.test.ts", source)).toBe("subprocess-spawning");
  });

  it("rejects unknown and conflicting top-level declarations", () => {
    expect(() =>
      readTestIsolationClass("unknown.test.ts", 'export const TEST_ISOLATION_CLASS = "network-heavy";'),
    ).toThrow("unrecognized TEST_ISOLATION_CLASS");
    expect(() =>
      readTestIsolationClass(
        "both.test.ts",
        [
          'export const TEST_ISOLATION_CLASS = "poll-until-done";',
          'export const TEST_ISOLATION_CLASS = "subprocess-spawning";',
        ].join("\n"),
      ),
    ).toThrow("multiple TEST_ISOLATION_CLASS declarations");
  });
});

describe("test batch planning", () => {
  it("orders pooled, subprocess, and load-sensitive batches", () => {
    const classes = new Map([
      ["poll.test.ts", "poll-until-done" as const],
      ["spawn.test.ts", "subprocess-spawning" as const],
      ["isolated.sandbox-unrunnable.test.ts", "subprocess-spawning" as const],
    ]);

    expect(
      planTestBatches(
        ["spawn.test.ts", "plain.test.ts", "isolated.sandbox-unrunnable.test.ts", "poll.test.ts"],
        (file) => classes.get(file),
      ),
    ).toEqual([["plain.test.ts", "poll.test.ts"], ["spawn.test.ts"], ["isolated.sandbox-unrunnable.test.ts"]]);
  });
});
