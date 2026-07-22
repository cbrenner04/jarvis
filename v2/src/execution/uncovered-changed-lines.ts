import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultGitDiff, isProductionFile, parseDiff, changedPathsFromDiff } from "./diff-scan.ts";

export type UncoveredSite = {
  file: string;
  line: number;
};

export type UncoveredChangedLinesReport = {
  uncoveredSites: UncoveredSite[];
  renderedText: string;
};

type GitDiff = (cwd: string, baseRef: string) => Promise<string>;
type UntrackedFiles = (cwd: string) => Promise<string[]>;
type CollectCoverage = (cwd: string, scope: string[]) => Promise<string>;

type ReporterSeams = {
  gitDiff?: GitDiff;
  untrackedFiles?: UntrackedFiles;
  collectCoverage?: CollectCoverage;
};

async function defaultUntrackedFiles(cwd: string): Promise<string[]> {
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    const output = await realAsyncSubprocessRunner.runAsync("git", ["ls-files", "--others", "--exclude-standard"], cwd);
    return output
      .trim()
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed && isProductionFile(trimmed);
      });
  } catch {
    return [];
  }
}

async function defaultCollectCoverage(cwd: string, scope: string[]): Promise<string> {
  if (scope.length === 0) return "";
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");

  try {
    const dirs = Array.from(new Set(scope.map((s) => s.split("/")[0] ?? s)));
    // Run scoped coverage collection
    // bun test --coverage writes to .coverage/lcov.info by default
    await realAsyncSubprocessRunner.runAsync(
      "bun",
      [
        "test",
        "--coverage",
        "--coverage-reporter=lcov",
        ...dirs,
      ],
      cwd,
    );

    // Read lcov output from bun's default location
    const lcovPath = join(cwd, ".coverage", "lcov.info");
    try {
      return readFileSync(lcovPath, "utf-8");
    } catch {
      return "";
    }
  } catch {
    return "";
  }
}

function isCodePath(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path);
}

function parseLcovOutput(lcovContent: string): Map<string, Map<number, number>> {
  const records = new Map<string, Map<number, number>>();
  let currentFile: string | null = null;
  let currentLines = new Map<number, number>();

  for (const line of lcovContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("SF:")) {
      if (currentFile !== null) {
        records.set(currentFile, currentLines);
      }
      currentFile = trimmed.slice(3);
      currentLines = new Map<number, number>();
    } else if (trimmed.startsWith("DA:")) {
      const [lineNumStr, hitCountStr] = trimmed.slice(3).split(",");
      if (lineNumStr !== undefined && hitCountStr !== undefined) {
        const lineNum = parseInt(lineNumStr, 10);
        const hitCount = parseInt(hitCountStr, 10);
        if (!isNaN(lineNum) && !isNaN(hitCount)) {
          currentLines.set(lineNum, hitCount);
        }
      }
    } else if (trimmed === "end_of_record" && currentFile !== null) {
      records.set(currentFile, currentLines);
      currentFile = null;
      currentLines = new Map<number, number>();
    }
  }

  if (currentFile !== null) {
    records.set(currentFile, currentLines);
  }

  return records;
}

export type UncoveredChangedLinesInput = {
  worktreePath: string;
  runBase: string;
};

export async function reportUncoveredChangedLines(
  input: UncoveredChangedLinesInput,
  seams?: ReporterSeams,
): Promise<UncoveredChangedLinesReport> {
  const gitDiff = seams?.gitDiff ?? defaultGitDiff;
  const untrackedFiles = seams?.untrackedFiles ?? defaultUntrackedFiles;
  const collectCoverage = seams?.collectCoverage ?? defaultCollectCoverage;

  try {
    const diffOutput = await gitDiff(input.worktreePath, input.runBase);
    const changedLines = parseDiff(diffOutput);

    // Collect all changed production files
    const changedFiles = new Set<string>();
    for (const line of changedLines) {
      if (isProductionFile(line.file) && isCodePath(line.file)) {
        changedFiles.add(line.file);
      }
    }

    for (const file of changedPathsFromDiff(diffOutput)) {
      if (isCodePath(file)) {
        changedFiles.add(file);
      }
    }

    const untracked = await untrackedFiles(input.worktreePath);
    for (const file of untracked) {
      if (isCodePath(file)) {
        changedFiles.add(file);
      }
    }

    if (changedFiles.size === 0) {
      return {
        uncoveredSites: [],
        renderedText: "",
      };
    }

    const changedPaths = Array.from(changedFiles);

    // Collect coverage data
    let coverageOutput = "";
    try {
      coverageOutput = await collectCoverage(input.worktreePath, changedPaths);
    } catch {
      // Coverage collection failed; return soft fail
      return {
        uncoveredSites: [],
        renderedText: "",
      };
    }

    // Parse coverage data (empty output is valid - no files in coverage)
    const lcovData = parseLcovOutput(coverageOutput);

    // Identify uncovered lines
    const uncoveredSites: UncoveredSite[] = [];

    for (const line of changedLines) {
      if (line.type === "add" && isCodePath(line.file)) {
        const record = lcovData.get(line.file);
        if (record === undefined) {
          // File not in coverage data = fully uncovered
          uncoveredSites.push({ file: line.file, line: line.lineNumber });
        } else {
          // File has coverage data; check if line was executed
          const hitCount = record.get(line.lineNumber);
          if (hitCount === undefined || hitCount === 0) {
            uncoveredSites.push({ file: line.file, line: line.lineNumber });
          }
        }
      }
    }

    // Render text
    let renderedText = "";
    if (uncoveredSites.length > 0) {
      renderedText = "Uncovered changed lines (test did not execute):\n";
      for (const site of uncoveredSites) {
        renderedText += `${site.file}:${site.line}\n`;
      }
      renderedText += "\nNote: executed does not imply asserted; the mutation verifier, not coverage, decides adequacy.\n";
    }

    return {
      uncoveredSites,
      renderedText,
    };
  } catch {
    // Fail soft on any unexpected error
    return {
      uncoveredSites: [],
      renderedText: "",
    };
  }
}
