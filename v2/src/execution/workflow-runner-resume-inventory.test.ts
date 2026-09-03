/**
 * Merge-base parity guard for resume-path tests moved into workflow-runner-resume*.test.ts.
 * Inventories merge-base cases from workflow-runner-resume.test.ts (full file),
 * workflow-runner-plan.test.ts (describe("recoverPlanStage") only),
 * recover-review-failed-plan-draft.test.ts (describe("recoverPlanStage review-failed admission") in full),
 * and the zero-case workflow-runner-publication.test.ts bucket; compares leaf titles to co-located destinations.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXECUTION_DIR = import.meta.dir;
const REPO_ROOT = join(EXECUTION_DIR, "..", "..", "..");
const INVENTORY_FILE = "workflow-runner-resume-inventory.test.ts";

type ScanOptions = {
  rootDescribe?: string;
};

type SourceBucket = {
  label: string;
  repoPath: string;
  options?: ScanOptions;
};

const SOURCE_BUCKETS: SourceBucket[] = [
  { label: "workflow-runner-resume.test.ts", repoPath: "v2/src/execution/workflow-runner-resume.test.ts" },
  {
    label: "workflow-runner-plan.test.ts:recoverPlanStage",
    repoPath: "v2/src/execution/workflow-runner-plan.test.ts",
    options: { rootDescribe: "recoverPlanStage" },
  },
  {
    label: "recover-review-failed-plan-draft.test.ts:recoverPlanStage review-failed admission",
    repoPath: "v2/src/execution/recover-review-failed-plan-draft.test.ts",
    options: { rootDescribe: "recoverPlanStage review-failed admission" },
  },
  {
    label: "workflow-runner-publication.test.ts",
    repoPath: "v2/src/execution/workflow-runner-publication.test.ts",
  },
];

/**
 * CI checks out a detached HEAD without a local `main`, so try each candidate base ref
 * in turn. Fails with every attempt named rather than only the last, so a genuine
 * inventory regression is never mistaken for a missing ref.
 */
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

/**
 * Returns undefined when the path does not exist at `ref`. A bucket whose source file
 * is absent at the merge base has no titles to preserve — notably once the file has been
 * deleted by the co-location work this inventory guards, at which point the merge base is
 * a commit that no longer carries it.
 */
function loadAtRef(ref: string, repoPath: string): string | undefined {
  try {
    return execFileSync("git", ["show", `${ref}:${repoPath}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return undefined;
  }
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
  collecting: boolean,
  results: string[],
  options?: ScanOptions,
): void {
  let index = start;
  while (index < end) {
    const skipped = skipNonCode(source, index);
    if (skipped > index) {
      index = skipped;
      continue;
    }

    if (source.startsWith("describe(", index)) {
      const title = parseCallTitle(source, index + "describe".length);
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
      const nextCollecting =
        collecting ||
        (options?.rootDescribe !== undefined && options.rootDescribe === title.title && describeChain.length === 0);
      collectFromBlock(source, braceStart + 1, braceEnd, nextChain, nextCollecting, results, options);
      index = braceEnd + 1;
      continue;
    }

    if (collecting && source.startsWith("test.each(", index)) {
      const parsed = parseTestEach(source, index);
      if (parsed) {
        for (const title of parsed.titles) {
          results.push(leafTitle(describeChain, title));
        }
        index = parsed.end;
        continue;
      }
    }

    if (collecting && source.startsWith("test.skip(", index)) {
      const title = parseCallTitle(source, index + "test.skip".length);
      if (title) {
        results.push(leafTitle(describeChain, title.title));
      }
      index += 1;
      continue;
    }

    if (collecting && source.startsWith("test(", index) && !source.startsWith("test.each(", index)) {
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

function collectLeafTitles(source: string, options?: ScanOptions): string[] {
  const results: string[] = [];
  const collecting = options?.rootDescribe === undefined;
  collectFromBlock(source, 0, source.length, [], collecting, results, options);
  return results;
}

function collectDestinationLeafTitles(): string[] {
  const titles: string[] = [];
  for (const name of readdirSync(EXECUTION_DIR)) {
    if (!name.startsWith("workflow-runner-resume") || !name.endsWith(".test.ts") || name === INVENTORY_FILE) {
      continue;
    }
    titles.push(...collectLeafTitles(readFileSync(join(EXECUTION_DIR, name), "utf8")));
  }
  return titles;
}

function hasResumeModuleImport(source: string): boolean {
  return /from\s+["']\.\/workflow-runner-resume(?:\.ts)?["']/.test(source);
}

function collectExpectedTitles(bucket: SourceBucket, mergeBase: string): string[] {
  const source = loadAtRef(mergeBase, bucket.repoPath);
  if (source === undefined) {
    return [];
  }
  if (!hasResumeModuleImport(source)) {
    return [];
  }
  return collectLeafTitles(source, bucket.options);
}

function missingFromDestination(expected: string[], destination: string[]): string[] {
  const counts = new Map<string, number>();
  for (const title of destination) {
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  const missing: string[] = [];
  for (const title of expected) {
    const remaining = counts.get(title) ?? 0;
    if (remaining === 0) {
      missing.push(title);
      continue;
    }
    counts.set(title, remaining - 1);
  }
  return missing;
}

describe("resume test title scanner", () => {
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

  test("scopes collection to a root describe block", () => {
    const source = `
      describe("other", () => {
        test("ignored", async () => {});
      });
      describe("recoverPlanStage", () => {
        test("kept", async () => {});
        describe("nested", () => {
          test("also kept", async () => {});
        });
      });
    `;
    expect(collectLeafTitles(source, { rootDescribe: "recoverPlanStage" })).toEqual([
      "recoverPlanStage > kept",
      "recoverPlanStage > nested > also kept",
    ]);
  });
});

describe("workflow-runner resume test inventory", () => {
  test("resolves merge-base against the first available base ref", () => {
    expect(resolveMergeBase()).toMatch(/^[0-9a-f]{40}$/);
  });

  test("preserves merge-base resume-path leaf titles in workflow-runner-resume*.test.ts destinations", () => {
    const mergeBase = resolveMergeBase();
    const destinationTitles = collectDestinationLeafTitles();

    for (const bucket of SOURCE_BUCKETS) {
      const expected = collectExpectedTitles(bucket, mergeBase);
      const missing = missingFromDestination(expected, destinationTitles);
      expect({ bucket: bucket.label, expectedCount: expected.length, missing }).toEqual({
        bucket: bucket.label,
        expectedCount: expected.length,
        missing: [],
      });
    }
  });
});
