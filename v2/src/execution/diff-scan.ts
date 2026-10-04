/** Shared diff plumbing for the completion verifiers (mutation + runtime smoke). */
import { readFileSync } from "node:fs";
import { isTestCodePath } from "../../../scripts/production-files.ts";
import { listUntrackedPaths, runGitArgv } from "../shared/git.ts";
import { realAsyncSubprocessRunner } from "../shared/subprocess.ts";

export async function defaultGitDiff(cwd: string, baseRef: string): Promise<string> {
  try {
    return await runGitArgv(
      cwd,
      ["diff", `${baseRef}...HEAD`, "--no-ext-diff", "--no-color"],
      realAsyncSubprocessRunner,
    );
  } catch {
    return "";
  }
}

const NON_PRODUCTION_PATTERNS = [/^test\//, /^v1\//, /^v2\/spec\//, /^v2\/docs\//];

export function isProductionFile(path: string): boolean {
  if (isTestCodePath(path)) return false;
  return !NON_PRODUCTION_PATTERNS.some((pattern) => pattern.test(path));
}

export function extractFileFromDiffLine(line: string): string | null {
  const match = line.match(/b\/(.+)$/);
  return match?.[1] ?? null;
}

export interface ChangedLine {
  type: "add" | "remove";
  lineNumber: number;
  content: string;
  file: string;
  hunkKey?: string;
}

export type DiffFlipSkipContext = {
  removedLineContentsByHunkKey: Map<string, string[]>;
};

function diffHunkKey(file: string, hunkIndex: number): string {
  return `${file}\u0000${hunkIndex}`;
}

function extractLineNumberFromHunk(line: string): number {
  const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : 1;
}

function processDiffLine(
  line: string,
  currentFile: string,
  currentNewLineNum: number,
  currentHunkKey: string,
  lines: ChangedLine[],
  removedLineContentsByHunkKey: Map<string, string[]>,
): number {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    lines.push({
      type: "add",
      lineNumber: currentNewLineNum,
      content: line.slice(1),
      file: currentFile,
      hunkKey: currentHunkKey,
    });
    return currentNewLineNum + 1;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    const removed = removedLineContentsByHunkKey.get(currentHunkKey) ?? [];
    removed.push(line.slice(1));
    removedLineContentsByHunkKey.set(currentHunkKey, removed);
    return currentNewLineNum;
  }
  if (line.startsWith(" ")) {
    return currentNewLineNum + 1;
  }
  return currentNewLineNum;
}

export function parseDiffWithFlipSkip(diffOutput: string): {
  changedLines: ChangedLine[];
  flipSkip: DiffFlipSkipContext;
} {
  const changedLines: ChangedLine[] = [];
  const removedLineContentsByHunkKey = new Map<string, string[]>();
  const diffLines = diffOutput.split("\n");

  let currentFile: string | null = null;
  let currentNewLineNum = 0;
  let inHunk = false;
  let hunkIndex = -1;
  let currentHunkKey = "";

  for (const line of diffLines) {
    if (line.startsWith("diff --git")) {
      currentFile = extractFileFromDiffLine(line);
      hunkIndex = -1;
    } else if (line.startsWith("@@")) {
      inHunk = true;
      currentNewLineNum = extractLineNumberFromHunk(line);
      if (currentFile !== null) {
        hunkIndex += 1;
        currentHunkKey = diffHunkKey(currentFile, hunkIndex);
      }
    } else if (inHunk && currentFile) {
      currentNewLineNum = processDiffLine(
        line,
        currentFile,
        currentNewLineNum,
        currentHunkKey,
        changedLines,
        removedLineContentsByHunkKey,
      );
      if (!line.startsWith("\\") && line.length > 0 && !line.startsWith("diff") && !line.startsWith("index")) {
        if (!line.startsWith("+") && !line.startsWith("-") && !line.startsWith(" ")) {
          inHunk = false;
        }
      }
    }
  }

  return {
    changedLines,
    flipSkip: { removedLineContentsByHunkKey },
  };
}

export function parseDiff(diffOutput: string): ChangedLine[] {
  return parseDiffWithFlipSkip(diffOutput).changedLines;
}

export function changedPathsFromDiff(diffOutput: string): string[] {
  const paths = new Set<string>();
  for (const line of diffOutput.split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    const path = extractFileFromDiffLine(line);
    if (path !== null && isProductionFile(path)) paths.add(path);
  }
  return [...paths];
}

/** JavaScript/TypeScript source or test path. */
export function isCodePath(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path);
}

export async function defaultReadFile(path: string): Promise<string> {
  return readFileSync(path, "utf-8");
}

/** Untracked production paths under `cwd` (`git ls-files --others --exclude-standard`), optionally code paths only. */
export async function defaultUntrackedFiles(cwd: string, options?: { codeOnly?: boolean }): Promise<string[]> {
  try {
    const paths = await listUntrackedPaths(cwd, realAsyncSubprocessRunner);
    return paths.filter((trimmed) => isProductionFile(trimmed) && (options?.codeOnly !== true || isCodePath(trimmed)));
  } catch {
    return [];
  }
}
