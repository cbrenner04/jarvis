/**
 * Merge-base parity guard for write-loop tests moved into write-loop*.test.ts siblings.
 * Anchors merge-base `write-loop.test.ts` leaf titles only; asserts missing-only preservation
 * across owned co-located destinations (surplus allowed). Unrelated stems (write-loop-input,
 * write-loop-intent-landing, …) stay out of the destination scan.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  locateParseOnlyInventoryArrayBody,
  PARSE_ONLY_INVENTORY_MARKER_COMMENT,
} from "../shared/structural-test-locator.ts";

const EXECUTION_DIR = import.meta.dir;
const REPO_ROOT = join(EXECUTION_DIR, "..", "..");
const INVENTORY_FILE = "write-loop-test-inventory.test.ts";
const INVENTORY_REPO_PATH = "src/execution/write-loop-test-inventory.test.ts";

type WriteLoopInventoryAnchor = {
  label: string;
  repoPath: string;
};

// jarvis:parse-only-inventory
const _WRITE_LOOP_INVENTORY_ANCHORS: WriteLoopInventoryAnchor[] = [
  { label: "write-loop.test.ts", repoPath: "src/execution/write-loop.test.ts" },
];

const OWNED_DESTINATION_LEAF_TEST_CAP = 120;

const MOVED_WRITE_LOOP_DESCRIBE_TITLES = [
  "coverage advisory on implement write completion",
  "per-iteration git commit on progress",
] as const;

const EXCLUDED_DESTINATION_STEMS = new Set([
  "write-loop-input",
  "write-loop-intent-landing",
  "write-loop-draft-reprompt",
  "write-loop-idle-watchdog",
  "write-loop-session-log",
  "write-loop-staged-markdown-lint",
  "write-loop-gate-budget",
  "write-loop-lane-republish",
  "write-loop-test-inventory",
]);

function parseWriteLoopInventoryAnchorBlock(block: string): WriteLoopInventoryAnchor {
  const label = block.match(/label:\s*"([^"]+)"/)?.[1];
  const repoPath = block.match(/repoPath:\s*"([^"]+)"/)?.[1];
  if (label === undefined || repoPath === undefined) {
    throw new Error(`malformed write-loop inventory anchor: ${block.trim()}`);
  }
  return { label, repoPath };
}

function parseWriteLoopInventoryAnchorsFromArrayBody(arrayBody: string): WriteLoopInventoryAnchor[] {
  const anchors: WriteLoopInventoryAnchor[] = [];
  let index = 0;
  while (index < arrayBody.length) {
    const open = arrayBody.indexOf("{", index);
    if (open === -1) break;
    const close = findMatchingDelimiter(arrayBody, open, "{", "}");
    if (close === -1) {
      throw new Error("unclosed write-loop inventory anchor object");
    }
    anchors.push(parseWriteLoopInventoryAnchorBlock(arrayBody.slice(open, close + 1)));
    index = close + 1;
  }
  if (anchors.length === 0) {
    throw new Error("write-loop inventory anchors array is empty");
  }
  return anchors;
}

function parseWriteLoopInventoryAnchors(inventorySource: string): WriteLoopInventoryAnchor[] {
  const arrayBody = locateParseOnlyInventoryArrayBody(inventorySource, "WRITE_LOOP_INVENTORY_ANCHORS");
  return parseWriteLoopInventoryAnchorsFromArrayBody(arrayBody);
}

function discoverWriteLoopInventoryAnchors(mergeBase: string): WriteLoopInventoryAnchor[] {
  const gitSource = loadAtRef(mergeBase, INVENTORY_REPO_PATH);
  if (gitSource === undefined || !gitSource.includes(PARSE_ONLY_INVENTORY_MARKER_COMMENT)) {
    return parseWriteLoopInventoryAnchors(readFileSync(join(EXECUTION_DIR, INVENTORY_FILE), "utf8"));
  }
  return parseWriteLoopInventoryAnchors(gitSource);
}

const BASE_REF_CANDIDATES = ["main", "origin/main", "refs/remotes/origin/main"] as const;

function resolveMergeBase(): string {
  const failures: string[] = [];
  for (const ref of BASE_REF_CANDIDATES) {
    try {
      const output = execFileSync("git", ["merge-base", "HEAD", ref], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (output.length > 0) return output;
      failures.push(`${ref}: empty output`);
    } catch (error) {
      failures.push(`${ref}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`merge-base resolution failed for every candidate base ref — ${failures.join("; ")}`);
}

function loadAtRef(ref: string, repoPath: string): string | undefined {
  // The base ref may predate the `v2/` → top-level move; read the pre-move path when the new one is absent.
  for (const candidate of [repoPath, `v2/${repoPath}`]) {
    try {
      return execFileSync("git", ["show", `${ref}:${candidate}`], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function readQuotedString(source: string, start: number): { value: string; end: number } | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return null;
  }
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) {
      return { value: source.slice(start + 1, index), end: index + 1 };
    }
    index += 1;
  }
  return null;
}

function skipNonCode(source: string, start: number): number {
  if (source.startsWith("//", start)) {
    let index = start + 2;
    while (index < source.length && source[index] !== "\n") {
      index += 1;
    }
    return index;
  }
  if (source.startsWith("/*", start)) {
    const end = source.indexOf("*/", start + 2);
    return end === -1 ? source.length : end + 2;
  }
  const quoted = readQuotedString(source, start);
  return quoted?.end ?? start;
}

function findMatchingDelimiter(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const skipped = skipNonCode(source, index);
    if (skipped > index) {
      index = skipped;
      continue;
    }
    const char = source[index];
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index += 1;
  }
  return -1;
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }
  return index;
}

function skipTypeAssertion(source: string, start: number): number {
  let index = skipWhitespace(source, start);
  if (source.startsWith("as ", index)) {
    index += 3;
    index = skipWhitespace(source, index);
    if (source[index] === "const") {
      index += 5;
    } else {
      while (index < source.length && /[\w$]/.test(source[index] ?? "")) {
        index += 1;
      }
    }
    index = skipWhitespace(source, index);
  }
  return index;
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let index = 0;
  while (index < source.length) {
    const skipped = skipNonCode(source, index);
    if (skipped > index) {
      current += source.slice(index, skipped);
      index = skipped;
      continue;
    }
    const char = source[index];
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      current += char;
      index += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      current += char;
      index += 1;
      continue;
    }
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

function parseLiteralValue(raw: string): unknown {
  const trimmed = raw.trim();
  const quoted = readQuotedString(trimmed, 0);
  if (quoted && quoted.end === trimmed.length) {
    return quoted.value;
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return parseEachRows(trimmed.slice(1, -1));
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const record: Record<string, unknown> = {};
    for (const entry of splitTopLevel(trimmed.slice(1, -1))) {
      const colon = entry.indexOf(":");
      if (colon === -1) {
        continue;
      }
      const keyToken = entry.slice(0, colon).trim();
      const keyQuoted = readQuotedString(keyToken, 0);
      const key = keyQuoted?.value ?? keyToken.replace(/['"]/g, "");
      record[key] = parseLiteralValue(entry.slice(colon + 1));
    }
    return record;
  }
  return trimmed;
}

function parseEachRows(arrayBody: string): unknown[] {
  return splitTopLevel(arrayBody).map((part) => parseLiteralValue(part));
}

function expandEachTitle(template: string, row: unknown): string {
  if (Array.isArray(row)) {
    let index = 0;
    return template.replace(/%s/g, () => String(row[index++]));
  }
  if (typeof row === "object" && row !== null) {
    return template.replace(/\$([a-zA-Z_][\w]*)/g, (_, key: string) =>
      String((row as Record<string, unknown>)[key] ?? ""),
    );
  }
  return template.replace(/%s/g, String(row));
}

function leafTitle(describeChain: readonly string[], testTitle: string): string {
  return [...describeChain, testTitle].join(" > ");
}

function parseCallTitle(source: string, openParenIndex: number): { title: string; end: number } | null {
  const index = skipWhitespace(source, openParenIndex + 1);
  const quoted = readQuotedString(source, index);
  if (!quoted) {
    return null;
  }
  return { title: quoted.value, end: quoted.end };
}

function describeKeywordLength(source: string, index: number): number | null {
  if (source.startsWith("describe(", index)) {
    return "describe".length;
  }
  if (source.startsWith("describe.serial(", index)) {
    return "describe.serial".length;
  }
  if (source.startsWith("describe.skip(", index)) {
    return "describe.skip".length;
  }
  return null;
}

function parseTestEach(source: string, start: number): { titles: string[]; end: number } | null {
  const arrayStart = skipWhitespace(source, start + "test.each(".length);
  if (source[arrayStart] !== "[") {
    return null;
  }
  const arrayEnd = findMatchingDelimiter(source, arrayStart, "[", "]");
  if (arrayEnd === -1) {
    return null;
  }
  const rows = parseEachRows(source.slice(arrayStart + 1, arrayEnd));
  let index = skipTypeAssertion(source, arrayEnd + 1);
  if (source[index] === ")") {
    index = skipWhitespace(source, index + 1);
  }
  if (source[index] !== "(") {
    return null;
  }
  const template = parseCallTitle(source, index);
  if (!template) {
    return null;
  }
  const closeParen = findMatchingDelimiter(source, index, "(", ")");
  if (closeParen === -1) {
    return null;
  }
  return {
    titles: rows.map((row) => expandEachTitle(template.title, row)),
    end: closeParen + 1,
  };
}

function collectFromBlock(
  source: string,
  start: number,
  end: number,
  describeChain: string[],
  results: string[],
): void {
  let index = start;
  while (index < end) {
    const skipped = skipNonCode(source, index);
    if (skipped > index) {
      index = skipped;
      continue;
    }

    const describeKeyword = describeKeywordLength(source, index);
    if (describeKeyword !== null) {
      const title = parseCallTitle(source, index + describeKeyword);
      if (!title) {
        index += 1;
        continue;
      }
      const bodyOpen = skipWhitespace(source, title.end);
      if (source[bodyOpen] !== ",") {
        index += 1;
        continue;
      }
      const callbackStart = skipWhitespace(source, bodyOpen + 1);
      const braceStart = source.indexOf("{", callbackStart);
      if (braceStart === -1 || braceStart >= end) {
        index += 1;
        continue;
      }
      const braceEnd = findMatchingDelimiter(source, braceStart, "{", "}");
      if (braceEnd === -1 || braceEnd >= end) {
        index += 1;
        continue;
      }
      const nextChain = [...describeChain, title.title];
      collectFromBlock(source, braceStart + 1, braceEnd, nextChain, results);
      index = braceEnd + 1;
      continue;
    }

    if (source.startsWith("test.each(", index)) {
      const parsed = parseTestEach(source, index);
      if (parsed) {
        for (const title of parsed.titles) {
          results.push(leafTitle(describeChain, title));
        }
        index = parsed.end;
        continue;
      }
    }

    if (source.startsWith("test.skip(", index)) {
      const title = parseCallTitle(source, index + "test.skip".length);
      if (title) {
        results.push(leafTitle(describeChain, title.title));
      }
      index += 1;
      continue;
    }

    if (source.startsWith("test(", index) && !source.startsWith("test.each(", index)) {
      const title = parseCallTitle(source, index + "test".length);
      if (title) {
        results.push(leafTitle(describeChain, title.title));
      }
      index += 1;
      continue;
    }

    index += 1;
  }
}

function collectLeafTitles(source: string): string[] {
  const results: string[] = [];
  collectFromBlock(source, 0, source.length, [], results);
  return results;
}

function isOwnedDestinationFile(name: string): boolean {
  if (name === INVENTORY_FILE) {
    return false;
  }
  if (name.includes(".sandbox-unrunnable.")) {
    return false;
  }
  if (name === "write-loop.test.ts") {
    return true;
  }
  if (!name.startsWith("write-loop-") || !name.endsWith(".test.ts")) {
    return false;
  }
  const stem = name.slice(0, -".test.ts".length);
  return !EXCLUDED_DESTINATION_STEMS.has(stem);
}

function collectDestinationLeafTitles(): string[] {
  const titles: string[] = [];
  for (const name of readdirSync(EXECUTION_DIR)) {
    if (!isOwnedDestinationFile(name)) {
      continue;
    }
    titles.push(...collectLeafTitles(readFileSync(join(EXECUTION_DIR, name), "utf8")));
  }
  return titles;
}

function collectOwnedDestinationLeafCounts(): Array<{ file: string; count: number }> {
  const counts: Array<{ file: string; count: number }> = [];
  for (const name of readdirSync(EXECUTION_DIR)) {
    if (!isOwnedDestinationFile(name)) {
      continue;
    }
    counts.push({
      file: name,
      count: collectLeafTitles(readFileSync(join(EXECUTION_DIR, name), "utf8")).length,
    });
  }
  return counts;
}

function sourceDeclaresDescribeTitle(source: string, title: string): boolean {
  return source.includes(`describe("${title}"`);
}

function collectExpectedTitles(anchor: WriteLoopInventoryAnchor, mergeBase: string): string[] {
  const source = loadAtRef(mergeBase, anchor.repoPath);
  if (source === undefined) {
    throw new Error(`merge-base source missing for ${anchor.repoPath}`);
  }
  return collectLeafTitles(source);
}

function multisetMissingOnly(expected: string[], destination: string[]): string[] {
  const destinationCounts = new Map<string, number>();
  for (const title of destination) {
    destinationCounts.set(title, (destinationCounts.get(title) ?? 0) + 1);
  }

  const expectedCounts = new Map<string, number>();
  for (const title of expected) {
    expectedCounts.set(title, (expectedCounts.get(title) ?? 0) + 1);
  }

  const missing: string[] = [];
  for (const [title, need] of expectedCounts) {
    const have = destinationCounts.get(title) ?? 0;
    if (have < need) {
      for (let index = 0; index < need - have; index += 1) {
        missing.push(title);
      }
    }
  }
  return missing;
}

describe("write-loop test title scanner", () => {
  test("expands test.each string rows into leaf titles", () => {
    const source = `
      describe("outer", () => {
        test.each(["blocked", "unsettled"] as const)("mutation repair %s stops", async () => {});
      });
    `;
    expect(collectLeafTitles(source)).toEqual([
      "outer > mutation repair blocked stops",
      "outer > mutation repair unsettled stops",
    ]);
  });

  test("counts leaf titles under describe.serial", () => {
    const source = `
      describe.serial("write loop", () => {
        test("smoke", async () => {});
      });
    `;
    expect(collectLeafTitles(source)).toEqual(["write loop > smoke"]);
  });

  test("parses write-loop inventory anchors from inventory test source", () => {
    const arrayBody = `{ label: "write-loop.test.ts", repoPath: "src/execution/write-loop.test.ts" },`;
    expect(parseWriteLoopInventoryAnchorsFromArrayBody(arrayBody)).toEqual([
      { label: "write-loop.test.ts", repoPath: "src/execution/write-loop.test.ts" },
    ]);
  });

  test("missing-only multiset flags absent merge-base copies", () => {
    expect(multisetMissingOnly(["a", "b"], ["a"])).toEqual(["b"]);
    expect(multisetMissingOnly(["a"], ["a", "a"])).toEqual([]);
  });
});

describe("write-loop test inventory", () => {
  test("module inventory carries shared parse-only marker immediately before anchors", () => {
    const source = readFileSync(join(EXECUTION_DIR, INVENTORY_FILE), "utf8");
    const declaration = "const _WRITE_LOOP_INVENTORY_ANCHORS";
    const anchorsIndex = source.indexOf(declaration);
    const markerIndex = source.lastIndexOf(PARSE_ONLY_INVENTORY_MARKER_COMMENT, anchorsIndex);
    expect(markerIndex).toBeGreaterThan(-1);
    expect(source.slice(markerIndex + PARSE_ONLY_INVENTORY_MARKER_COMMENT.length, anchorsIndex)).toMatch(/^\s*$/);
  });

  test("resolves merge-base against the first available base ref", () => {
    expect(resolveMergeBase()).toMatch(/^[0-9a-f]{40}$/);
  });

  test("owned write-loop split destinations have at most 120 leaf tests", () => {
    const overCap = collectOwnedDestinationLeafCounts().filter(
      (entry) => entry.count > OWNED_DESTINATION_LEAF_TEST_CAP,
    );
    expect(overCap).toEqual([]);
  });

  test("write-loop.test.ts retains only the five core smoke cases", () => {
    const source = readFileSync(join(EXECUTION_DIR, "write-loop.test.ts"), "utf8");
    expect(collectLeafTitles(source)).toEqual([
      "write loop > calls executeWrite repeatedly until terminal",
      "write loop > progress loops again and artifact contract not checked mid-loop",
      "write loop > done with passing artifact contract ends loop successfully",
      "write loop > no-work with passing artifact contract ends loop successfully",
      "write loop > done/no-work with failing contract appends blocker and stops",
    ]);
  });

  test("coverage and iteration-commit describe groups run only from write-loop-coverage-and-iteration-commit.test.ts", () => {
    const coverageFile = "write-loop-coverage-and-iteration-commit.test.ts";
    const coverageSource = readFileSync(join(EXECUTION_DIR, coverageFile), "utf8");
    for (const title of MOVED_WRITE_LOOP_DESCRIBE_TITLES) {
      expect(sourceDeclaresDescribeTitle(coverageSource, title)).toBe(true);
    }

    for (const name of readdirSync(EXECUTION_DIR)) {
      if (!isOwnedDestinationFile(name) || name === coverageFile) {
        continue;
      }
      const source = readFileSync(join(EXECUTION_DIR, name), "utf8");
      for (const title of MOVED_WRITE_LOOP_DESCRIBE_TITLES) {
        expect(sourceDeclaresDescribeTitle(source, title)).toBe(false);
      }
    }
  });

  test("preserves merge-base write-loop.test.ts leaf titles in owned destinations", () => {
    const mergeBase = resolveMergeBase();
    const destinationTitles = collectDestinationLeafTitles();
    const anchors = discoverWriteLoopInventoryAnchors(mergeBase);
    expect(anchors.length).toBe(_WRITE_LOOP_INVENTORY_ANCHORS.length);

    for (const anchor of anchors) {
      const expected = collectExpectedTitles(anchor, mergeBase);
      const missing = multisetMissingOnly(expected, destinationTitles);
      expect({
        bucket: anchor.label,
        preservedCount: expected.length - missing.length,
        expectedCount: expected.length,
        missing,
      }).toEqual({
        bucket: anchor.label,
        preservedCount: expected.length,
        expectedCount: expected.length,
        missing: [],
      });
    }
  });
});
