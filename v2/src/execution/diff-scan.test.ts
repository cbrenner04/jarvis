import { describe, expect, test } from "bun:test";
import { parseDiff, parseDiffWithFlipSkip } from "./diff-scan.ts";

const TWO_FILE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "-const x = a || b;",
  "+const x =",
  "+  a || b;",
  "@@ -10,1 +11,1 @@",
  "-old();",
  "+next();",
  "diff --git a/src/b.ts b/src/b.ts",
  "index 3333333..4444444 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -5,1 +5,1 @@",
  "-gone();",
  "+fresh();",
  "",
].join("\n");

describe("parseDiffWithFlipSkip", () => {
  test("keys added lines and removed contents by per-file hunk index", () => {
    const { changedLines, flipSkip } = parseDiffWithFlipSkip(TWO_FILE_DIFF);

    expect(changedLines.map((line) => [line.file, line.lineNumber, line.content, line.hunkKey])).toEqual([
      ["src/a.ts", 2, "const x =", "src/a.ts\u00000"],
      ["src/a.ts", 3, "  a || b;", "src/a.ts\u00000"],
      ["src/a.ts", 11, "next();", "src/a.ts\u00001"],
      ["src/b.ts", 5, "fresh();", "src/b.ts\u00000"],
    ]);
    expect([...flipSkip.removedLineContentsByHunkKey]).toEqual([
      ["src/a.ts\u00000", ["const x = a || b;"]],
      ["src/a.ts\u00001", ["old();"]],
      ["src/b.ts\u00000", ["gone();"]],
    ]);
  });

  test("accumulates multiple removed lines within one hunk", () => {
    const diff = ["diff --git a/src/a.ts b/src/a.ts", "@@ -1,2 +1,1 @@", "-if (a ||", "-  b) {", "+if (a || b) {"].join(
      "\n",
    );

    expect(parseDiffWithFlipSkip(diff).flipSkip.removedLineContentsByHunkKey.get("src/a.ts\u00000")).toEqual([
      "if (a ||",
      "  b) {",
    ]);
  });

  test("parseDiff returns the same changed lines", () => {
    expect(parseDiff(TWO_FILE_DIFF)).toEqual(parseDiffWithFlipSkip(TWO_FILE_DIFF).changedLines);
  });
});
