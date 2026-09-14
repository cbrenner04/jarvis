import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { resolveProductionKillingTests } from "./diff-derived-mutation-verifier.ts";
import {
  type ChangedLine,
  changedPathsFromDiff,
  defaultGitDiff,
  defaultReadFile,
  defaultUntrackedFiles,
  isCodePath,
  isProductionFile,
  parseDiff,
} from "./diff-scan.ts";
import { type CoverageTestScope, coverageTestScope } from "./test-scope.ts";
import { trackProcessGroup, type VerifierProcessGroupRecorder } from "./verifier-process-groups.ts";

/** Wall-clock bound on the advisory's single coverage run; past it the group is killed and the advisory skips. */
export const COVERAGE_ADVISORY_TIMEOUT_MS = 3 * 60_000;

type UncoveredChangedLinesInput = {
  worktreePath: string;
  runBase: string;
  signal?: AbortSignal;
  processGroups?: VerifierProcessGroupRecorder;
};

type UncoveredSite = {
  file: string;
  line: number;
};

/** Set when the coverage run was cut short; the report is then empty. */
export type CoverageRunSkipReason = "timeout" | "aborted";

type UncoveredChangedLinesReport = {
  uncoveredSites: UncoveredSite[];
  reportText: string;
  skipReason?: CoverageRunSkipReason;
};

type CoverageRunOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  processGroups?: VerifierProcessGroupRecorder;
};
type CoverageRunResult = boolean | CoverageRunSkipReason;

type GitDiff = (cwd: string, baseRef: string) => Promise<string>;
type UntrackedFiles = (cwd: string) => Promise<string[]>;
type RunTests = (cwd: string, scope: CoverageTestScope, options: CoverageRunOptions) => Promise<CoverageRunResult>;
type ResolveTests = (productionFile: string, worktreePath: string) => Promise<string[]>;
type ReadFile = (path: string) => Promise<string>;
type DeleteFile = (path: string) => Promise<void>;

type ReporterSeams = {
  gitDiff?: GitDiff;
  untrackedFiles?: UntrackedFiles;
  runTests?: RunTests;
  resolveTests?: ResolveTests;
  readFile?: ReadFile;
  deleteFile?: DeleteFile;
};

/**
 * One bounded `bun test --coverage` over explicit test files: detached process group recorded on
 * the run, killed on timeout or abort. Returns the skip reason instead of `false` for those.
 */
export async function runCoverageTests(
  cwd: string,
  scope: CoverageTestScope,
  options: CoverageRunOptions,
  runner?: AsyncSubprocessRunner,
): Promise<CoverageRunResult> {
  if (scope.length === 0) return true;
  const subprocess = runner ?? (await import("../../../shared/subprocess.ts")).realAsyncSubprocessRunner;
  const tracked = trackProcessGroup(options.processGroups);
  try {
    const args = ["test", "--coverage", "--coverage-reporter=lcov", ...scope];
    await subprocess.runAsync("bun", args, cwd, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      processGroup: tracked.processGroup,
    });
    return true;
  } catch (error) {
    if (options.signal?.aborted) return "aborted";
    if ((error as { code?: unknown } | null)?.code === "ETIMEDOUT") return "timeout";
    return false;
  } finally {
    tracked.settle();
  }
}

/** Coverage scope: resolved killing tests of changed production files, as `./`-anchored file paths, minus sandbox-unrunnable suites. */
export async function resolveCoverageScope(
  changedCodePaths: readonly string[],
  worktreePath: string,
  resolveTests: ResolveTests = resolveProductionKillingTests,
): Promise<CoverageTestScope> {
  const tests = new Set<string>();
  for (const path of changedCodePaths) {
    if (!isProductionFile(path)) continue;
    for (const test of await resolveTests(path, worktreePath)) {
      if (test.endsWith(".test.ts") && !test.endsWith(".sandbox-unrunnable.test.ts")) tests.add(`./${test}`);
    }
  }
  return coverageTestScope([...tests].sort());
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

export async function reportUncoveredChangedLines(
  input: UncoveredChangedLinesInput,
  seams?: ReporterSeams,
): Promise<UncoveredChangedLinesReport> {
  const gitDiff = seams?.gitDiff ?? defaultGitDiff;
  const untrackedFilesFunc = seams?.untrackedFiles ?? ((cwd: string) => defaultUntrackedFiles(cwd, { codeOnly: true }));
  const runTests = seams?.runTests ?? runCoverageTests;
  const resolveTests = seams?.resolveTests ?? resolveProductionKillingTests;
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
    return {
      uncoveredSites: [],
      reportText: "",
    };
  }

  // Run coverage collection
  const coverageDirPath = join(input.worktreePath, ".scratch", "coverage-lcov");
  const coverageFilePath = join(coverageDirPath, "lcov.info");

  try {
    // Create scratch directory
    mkdirSync(coverageDirPath, { recursive: true });

    const scope = await resolveCoverageScope(changedCodePaths, input.worktreePath, resolveTests);
    if (scope.length === 0) return { uncoveredSites: [], reportText: "" };
    const testsResult = await runTests(input.worktreePath, scope, {
      timeoutMs: COVERAGE_ADVISORY_TIMEOUT_MS,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      ...(input.processGroups !== undefined ? { processGroups: input.processGroups } : {}),
    });

    if (testsResult !== true) {
      // Coverage run failed, timed out, or aborted — fail soft, return no report
      return {
        uncoveredSites: [],
        reportText: "",
        ...(testsResult !== false ? { skipReason: testsResult } : {}),
      };
    }

    // Read coverage output
    let lcovContent: string;
    try {
      lcovContent = await readFile(coverageFilePath);
    } catch {
      // Coverage file not found — fail soft
      return {
        uncoveredSites: [],
        reportText: "",
      };
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
    return {
      uncoveredSites: [],
      reportText: "",
    };
  } finally {
    // Clean up coverage output
    try {
      await deleteFile(coverageDirPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
