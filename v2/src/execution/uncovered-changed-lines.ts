import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type ChangedLine, changedPathsFromDiff, defaultGitDiff, isProductionFile, parseDiff } from "./diff-scan.ts";

export type UncoveredChangedLinesInput = {
  worktreePath: string;
  runBase: string;
};

export type UncoveredSite = {
  file: string;
  line: number;
};

export type UncoveredChangedLinesReport = {
  uncoveredSites: UncoveredSite[];
  reportText: string;
};

type GitDiff = (cwd: string, baseRef: string) => Promise<string>;
type UntrackedFiles = (cwd: string) => Promise<string[]>;
type RunTests = (cwd: string, scope: string[]) => Promise<boolean>;
type ReadFile = (path: string) => Promise<string>;
type DeleteFile = (path: string) => Promise<void>;

export type ReporterSeams = {
  gitDiff?: GitDiff;
  untrackedFiles?: UntrackedFiles;
  runTests?: RunTests;
  readFile?: ReadFile;
  deleteFile?: DeleteFile;
};

function isCodePath(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path);
}

async function defaultUntrackedFiles(cwd: string): Promise<string[]> {
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    const output = await realAsyncSubprocessRunner.runAsync("git", ["ls-files", "--others", "--exclude-standard"], cwd);
    return output
      .trim()
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed && isProductionFile(trimmed) && isCodePath(trimmed);
      });
  } catch {
    return [];
  }
}

async function defaultRunTests(cwd: string, scope: string[]): Promise<boolean> {
  if (scope.length === 0) return true;
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    const args = ["test", "--coverage", "--coverage-reporter=lcov", ...scope];
    await realAsyncSubprocessRunner.runAsync("bun", args, cwd);
    return true;
  } catch {
    return false;
  }
}

async function defaultReadFile(path: string): Promise<string> {
  return readFileSync(path, "utf-8");
}

async function defaultDeleteFile(path: string): Promise<void> {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function parseLcov(lcovOutput: string): Map<string, Map<number, number>> {
  const files = new Map<string, Map<number, number>>();
  const lines = lcovOutput.split("\n");

  let currentFile: string | null = null;
  let currentLines: Map<number, number> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("SF:")) {
      currentFile = trimmed.slice(3);
      currentLines = new Map<number, number>();
      files.set(currentFile, currentLines);
    } else if (trimmed.startsWith("DA:")) {
      if (currentLines === null) continue;
      const parts = trimmed.slice(3).split(",");
      const lineNum = parseInt(parts[0] ?? "", 10);
      const executionCount = parseInt(parts[1] ?? "", 10);
      if (!Number.isNaN(lineNum) && !Number.isNaN(executionCount)) {
        currentLines.set(lineNum, executionCount);
      }
    } else if (trimmed === "end_of_record") {
      currentFile = null;
      currentLines = null;
    }
  }

  return files;
}

/** Groups added code lines by file, then flags each as uncovered when coverage records zero (or no) executions. */
function computeUncoveredSites(
  changedLines: ChangedLine[],
  coverageMap: Map<string, Map<number, number>>,
): UncoveredSite[] {
  const changedLinesByFile = new Map<string, ChangedLine[]>();
  for (const line of changedLines) {
    if (line.type === "add" && isCodePath(line.file)) {
      const existing = changedLinesByFile.get(line.file);
      if (existing) existing.push(line);
      else changedLinesByFile.set(line.file, [line]);
    }
  }

  const uncoveredSites: UncoveredSite[] = [];
  for (const [file, fileChangedLines] of changedLinesByFile.entries()) {
    const coverage = coverageMap.get(file);
    for (const line of fileChangedLines) {
      // No coverage record for the file, or a zero execution count, is uncovered.
      const executionCount = coverage?.get(line.lineNumber);
      if (executionCount === undefined || executionCount === 0) {
        uncoveredSites.push({ file, line: line.lineNumber });
      }
    }
  }

  uncoveredSites.sort((a, b) => (a.file !== b.file ? a.file.localeCompare(b.file) : a.line - b.line));
  return uncoveredSites;
}

const EMPTY_REPORT: UncoveredChangedLinesReport = { uncoveredSites: [], reportText: "" };

export async function reportUncoveredChangedLines(
  input: UncoveredChangedLinesInput,
  seams?: ReporterSeams,
): Promise<UncoveredChangedLinesReport> {
  const gitDiff = seams?.gitDiff ?? defaultGitDiff;
  const untrackedFilesFunc = seams?.untrackedFiles ?? defaultUntrackedFiles;
  const runTests = seams?.runTests ?? defaultRunTests;
  const readFile = seams?.readFile ?? defaultReadFile;
  const deleteFile = seams?.deleteFile ?? defaultDeleteFile;

  const diffOutput = await gitDiff(input.worktreePath, input.runBase);
  const changedLines = parseDiff(diffOutput);

  // Collect changed production code files
  const changedPaths = new Set<string>(changedPathsFromDiff(diffOutput));
  const untracked = await untrackedFilesFunc(input.worktreePath);
  for (const file of untracked) {
    changedPaths.add(file);
  }

  // Filter to code files only
  const changedCodePaths = Array.from(changedPaths).filter(isCodePath);
  if (changedCodePaths.length === 0) {
    return EMPTY_REPORT;
  }

  // Run coverage collection
  const coverageDirPath = join(input.worktreePath, ".scratch", "coverage-lcov");
  const coverageFilePath = join(coverageDirPath, "lcov.info");

  try {
    // Create scratch directory
    mkdirSync(coverageDirPath, { recursive: true });

    // Run tests with coverage on directories implied by changed paths
    const testedDirs = new Set<string>();
    for (const path of changedCodePaths) {
      const parts = path.split("/");
      if (parts.length > 0 && parts[0]) {
        // Group by top-level directory (e.g., v1, v2, shared, src)
        testedDirs.add(parts[0]);
      }
    }
    const dirArray = Array.from(testedDirs);
    const testsPassed = await runTests(input.worktreePath, dirArray);

    if (!testsPassed) {
      // Coverage run failed — fail soft, return no report
      return EMPTY_REPORT;
    }

    // Read coverage output
    let lcovContent: string;
    try {
      lcovContent = await readFile(coverageFilePath);
    } catch {
      // Coverage file not found — fail soft
      return EMPTY_REPORT;
    }

    // Parse LCOV output and compute uncovered added lines in code files
    const coverageMap = parseLcov(lcovContent);
    const uncoveredSites = computeUncoveredSites(changedLines, coverageMap);

    // Render report text
    const reportLines = uncoveredSites.map((site) => `${site.file}:${site.line}`);
    const reportText =
      reportLines.length > 0
        ? `Uncovered changed lines (execution count is zero):\n${reportLines.join("\n")}\n\nNote: A line executed by tests may still lack sufficient assertions. The mutation verifier, not coverage, determines whether changes are adequately tested.`
        : "";

    return {
      uncoveredSites,
      reportText,
    };
  } catch {
    // Any error during coverage collection — fail soft
    return EMPTY_REPORT;
  } finally {
    // Clean up coverage output
    try {
      await deleteFile(coverageDirPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
