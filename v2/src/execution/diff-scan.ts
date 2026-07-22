/** Shared diff plumbing for the completion verifiers (mutation + runtime smoke). */

async function gitDiff(cwd: string, range: string): Promise<string> {
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    return await realAsyncSubprocessRunner.runAsync(
      "git",
      ["diff", range, "--no-ext-diff", "--no-color"],
      cwd,
    );
  } catch {
    return "";
  }
}

export async function defaultGitDiff(cwd: string, baseRef: string): Promise<string> {
  return gitDiff(cwd, `${baseRef}...HEAD`);
}

export async function workingTreeDiff(cwd: string, baseRef: string): Promise<string> {
  return gitDiff(cwd, baseRef);
}

const NON_PRODUCTION_PATTERNS = [
  /\.test\.ts$/,
  /\.test\.js$/,
  /^test\//,
  /^v1\/spec\//,
  /^v2\/spec\//,
  /^v1\/docs\//,
  /^v2\/docs\//,
];

export function isProductionFile(path: string): boolean {
  return !NON_PRODUCTION_PATTERNS.some((pattern) => pattern.test(path));
}

export function extractFileFromDiffLine(line: string): string | null {
  const match = line.match(/b\/(.+)$/);
  return match?.[1] ?? null;
}

export function isCodePath(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path);
}

export interface ChangedLine {
  type: "add" | "remove";
  lineNumber: number;
  content: string;
  file: string;
}

function extractLineNumberFromHunk(line: string): number {
  const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : 1;
}

function processDiffLine(
  line: string,
  currentFile: string | null,
  currentNewLineNum: number,
  lines: ChangedLine[],
): number {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    lines.push({
      type: "add",
      lineNumber: currentNewLineNum,
      content: line.slice(1),
      file: currentFile as string,
    });
    return currentNewLineNum + 1;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return currentNewLineNum;
  }
  if (line.startsWith(" ")) {
    return currentNewLineNum + 1;
  }
  return currentNewLineNum;
}

export function parseDiff(diffOutput: string): ChangedLine[] {
  const lines: ChangedLine[] = [];
  const diffLines = diffOutput.split("\n");

  let currentFile: string | null = null;
  let currentNewLineNum = 0;
  let inHunk = false;

  for (const line of diffLines) {
    if (line.startsWith("diff --git")) {
      currentFile = extractFileFromDiffLine(line);
    } else if (line.startsWith("@@")) {
      inHunk = true;
      currentNewLineNum = extractLineNumberFromHunk(line);
    } else if (inHunk && currentFile) {
      currentNewLineNum = processDiffLine(line, currentFile, currentNewLineNum, lines);
      if (!line.startsWith("\\") && line.length > 0 && !line.startsWith("diff") && !line.startsWith("index")) {
        if (!line.startsWith("+") && !line.startsWith("-") && !line.startsWith(" ")) {
          inHunk = false;
        }
      }
    }
  }

  return lines;
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
