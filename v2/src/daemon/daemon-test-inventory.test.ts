/**
 * Merge-base parity guard for daemon co-located unit tests under v2/src/daemon.
 * For each daemon test file present on merge-base, compares per-file test()/test.skip() title
 * counts and multisets between merge-base and the worktree. Net-new co-located test files are
 * out of scope.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DAEMON_DIR = import.meta.dir;
const REPO_ROOT = join(DAEMON_DIR, "..", "..", "..");
const DAEMON_TEST_GLOB_PREFIX = "v2/src/daemon/";
const INVENTORY_REPO_PATH = `${DAEMON_TEST_GLOB_PREFIX}daemon-test-inventory.test.ts`;

/**
 * CI checks out a detached HEAD without a local `main`, so try each candidate base ref in
 * turn and name every attempt on failure — a missing ref must never read as an inventory
 * regression.
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

function listDaemonTestFilesAtRef(ref: string): string[] {
  const output = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", "v2/src/daemon"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(DAEMON_TEST_GLOB_PREFIX) && line.endsWith(".test.ts"))
    .filter((line) => line !== INVENTORY_REPO_PATH);
}

/** Returns undefined when the path is absent at `ref`; a file that is not there has no titles to preserve. */
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

function parseCallTitle(source: string, openParenIndex: number): string | null {
  let index = openParenIndex + 1;
  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }
  const quoted = readQuotedString(source, index);
  return quoted?.value ?? null;
}

/** Collects first-argument titles from top-level test(...) and test.skip(...) calls only. */
export function collectTestTitles(source: string): string[] {
  const titles: string[] = [];
  let index = 0;
  while (index < source.length) {
    const skipped = skipNonCode(source, index);
    if (skipped > index) {
      index = skipped;
      continue;
    }

    if (source.startsWith("test.skip(", index)) {
      const title = parseCallTitle(source, index + "test.skip".length);
      if (title !== null) {
        titles.push(title);
      }
      index += 1;
      continue;
    }

    if (source.startsWith("test(", index) && !source.startsWith("test.each(", index)) {
      const title = parseCallTitle(source, index + "test".length);
      if (title !== null) {
        titles.push(title);
      }
      index += 1;
      continue;
    }

    index += 1;
  }
  return titles;
}

function titleMultiset(titles: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const title of titles) {
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return counts;
}

function multisetDiff(expected: readonly string[], actual: readonly string[]): string[] {
  const remaining = titleMultiset(actual);
  const missing: string[] = [];
  for (const title of expected) {
    const count = remaining.get(title) ?? 0;
    if (count === 0) {
      missing.push(title);
      continue;
    }
    if (count === 1) {
      remaining.delete(title);
    } else {
      remaining.set(title, count - 1);
    }
  }
  return missing;
}

describe("daemon test title scanner", () => {
  test("collects test and test.skip titles while ignoring test.each", () => {
    const source = `
      describe("outer", () => {
        test("kept", async () => {});
        test.skip("skipped", async () => {});
        test.each(["a", "b"])("expanded %s", async () => {});
      });
    `;
    expect(collectTestTitles(source)).toEqual(["kept", "skipped"]);
  });

  test("ignores test titles inside comments and strings", () => {
    const source = `
      // test("commented out")
      const note = "test(\\"string literal\\")";
      test("real", async () => {});
    `;
    expect(collectTestTitles(source)).toEqual(["real"]);
  });
});

describe("daemon test inventory", () => {
  test("resolves merge-base against the first available base ref", () => {
    expect(resolveMergeBase()).toMatch(/^[0-9a-f]{40}$/);
  });

  test("preserves merge-base test()/test.skip() titles per daemon test file", () => {
    const mergeBase = resolveMergeBase();
    const repoPaths = listDaemonTestFilesAtRef(mergeBase);

    for (const repoPath of repoPaths) {
      const mergeBaseSource = loadAtRef(mergeBase, repoPath);
      // Enumerated from the merge-base tree, so absence here means the file was removed
      // between listing and reading; nothing to preserve.
      if (mergeBaseSource === undefined) continue;
      const expectedTitles = collectTestTitles(mergeBaseSource);
      const actualTitles = collectTestTitles(readFileSync(join(REPO_ROOT, repoPath), "utf8"));
      const missing = multisetDiff(expectedTitles, actualTitles);

      expect({
        file: repoPath,
        expectedCount: expectedTitles.length,
        actualCount: actualTitles.length,
        missing,
      }).toEqual({
        file: repoPath,
        expectedCount: actualTitles.length,
        actualCount: actualTitles.length,
        missing: [],
      });
    }
  });
});
