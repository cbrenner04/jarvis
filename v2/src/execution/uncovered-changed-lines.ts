import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { classifyChangedPaths, type ScopedTests } from "../../../scripts/ci-test-scope.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import {
  workingTreeDiff,
  isProductionFile,
  isCodePath,
  parseDiff,
  changedPathsFromDiff,
  type ChangedLine,
} from "./diff-scan.ts";

export type UncoveredChangedLinesReport = {
  uncoveredSites: Array<{ file: string; line: number }>;
  reportText: string;
};

type UncoveredChangedLinesSeams = {
  gitDiff?: (cwd: string, baseRef: string) => Promise<string>;
  untrackedFiles?: (cwd: string) => Promise<string[]>;
  runCoverage?: (cwd: string, scope: string[]) => Promise<string>;
  readFile?: (path: string) => Promise<string>;
};

const EMPTY_REPORT: UncoveredChangedLinesReport = {
  uncoveredSites: [],
  reportText: "",
};

async function defaultReadFile(path: string): Promise<string> {
  return readFileSync(path, "utf-8");
}

async function defaultUntrackedFiles(cwd: string): Promise<string[]> {
  try {
    const output = await realAsyncSubprocessRunner.runAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      cwd,
    );
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

export function coverageDirectoriesFromScope(scope: ScopedTests): string[] {
  if (scope === "full") {
    return ["./v1/", "./v2/", "./shared/", "./test/"];
  }
  if (scope.length === 0) {
    return [];
  }

  const dirs = new Set<string>();
  for (const script of scope) {
    if (script.includes(":v1")) dirs.add("./v1/");
    if (script.includes(":v2")) dirs.add("./v2/");
    if (script.includes(":shared")) {
      dirs.add("./shared/");
      dirs.add("./test/");
    }
  }
  return [...dirs];
}

async function defaultRunCoverage(cwd: string, scope: string[]): Promise<string> {
  const scratchDir = join(cwd, ".scratch");
  const lcovPath = join(scratchDir, "coverage.lcov");

  if (!existsSync(scratchDir)) {
    mkdirSync(scratchDir, { recursive: true });
  }

  await realAsyncSubprocessRunner.runAsync(
    "bun",
    ["test", "--coverage", "--coverage-reporter=lcov", ...scope],
    cwd,
    { env: { ...process.env, COVERAGE_DIR: scratchDir } },
  );

  const lcovOutput = readFileSync(lcovPath, "utf-8");

  try {
    rmSync(lcovPath);
  } catch {
    // Ignore cleanup errors
  }

  return lcovOutput;
}

export function parseLcov(lcovOutput: string): Map<string, Map<number, number>> {
  const records = new Map<string, Map<number, number>>();
  let currentLines: Map<number, number> | undefined;

  for (const line of lcovOutput.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("SF:")) {
      currentLines = new Map();
      records.set(trimmed.slice(3), currentLines);
    } else if (trimmed.startsWith("DA:") && currentLines) {
      const [lineNumStr, hitCountStr] = trimmed.slice(3).split(",");
      const lineNum = parseInt(lineNumStr ?? "", 10);
      const hitCount = parseInt(hitCountStr ?? "", 10);
      if (!Number.isNaN(lineNum) && !Number.isNaN(hitCount)) {
        currentLines.set(lineNum, hitCount);
      }
    } else if (trimmed === "end_of_record") {
      currentLines = undefined;
    }
  }

  return records;
}

async function addedLinesFromUntrackedFile(
  worktreePath: string,
  file: string,
  readFile: (path: string) => Promise<string>,
): Promise<ChangedLine[]> {
  try {
    const content = await readFile(join(worktreePath, file));
    return content.split("\n").map((lineContent, index) => ({
      type: "add" as const,
      lineNumber: index + 1,
      content: lineContent,
      file,
    }));
  } catch {
    return [];
  }
}

export async function reportUncoveredChangedLines(
  worktreePath: string,
  runBase: string,
  seams?: UncoveredChangedLinesSeams,
): Promise<UncoveredChangedLinesReport> {
  const gitDiff = seams?.gitDiff ?? workingTreeDiff;
  const untrackedFiles = seams?.untrackedFiles ?? defaultUntrackedFiles;
  const runCoverage = seams?.runCoverage ?? defaultRunCoverage;
  const readFile = seams?.readFile ?? defaultReadFile;

  try {
    const diffOutput = await gitDiff(worktreePath, runBase);
    const untracked = await untrackedFiles(worktreePath);
    const changedPaths = [...new Set([...changedPathsFromDiff(diffOutput), ...untracked])];

    if (changedPaths.length === 0) {
      return {
        uncoveredSites: [],
        reportText: "No changed production files.",
      };
    }

    const diffLines = parseDiff(diffOutput);
    const diffFiles = new Set(diffLines.map((line) => line.file));
    const untrackedLines: ChangedLine[] = [];
    for (const file of untracked) {
      if (isProductionFile(file) && isCodePath(file) && !diffFiles.has(file)) {
        untrackedLines.push(...(await addedLinesFromUntrackedFile(worktreePath, file, readFile)));
      }
    }

    const changedLines = [...diffLines, ...untrackedLines];
    const changedCodeFiles = changedPaths.filter(isCodePath);
    if (changedCodeFiles.length === 0) {
      return {
        uncoveredSites: [],
        reportText: "No changed code files.",
      };
    }

    const coverageDirs = coverageDirectoriesFromScope(classifyChangedPaths(changedPaths));
    if (coverageDirs.length === 0) {
      return EMPTY_REPORT;
    }

    let lcovOutput: string;
    try {
      lcovOutput = await runCoverage(worktreePath, coverageDirs);
    } catch {
      return EMPTY_REPORT;
    }

    if (!lcovOutput.includes("SF:") || !lcovOutput.includes("end_of_record")) {
      return EMPTY_REPORT;
    }

    const coverageRecords = parseLcov(lcovOutput);
    const uncoveredSites: Array<{ file: string; line: number }> = [];

    for (const file of changedCodeFiles) {
      const addedLines = changedLines.filter((line) => line.file === file && line.type === "add");
      const record = coverageRecords.get(file);

      if (!record) {
        for (const line of addedLines) {
          uncoveredSites.push({ file, line: line.lineNumber });
        }
        continue;
      }

      for (const line of addedLines) {
        const hitCount = record.get(line.lineNumber);
        if (hitCount === undefined || hitCount === 0) {
          uncoveredSites.push({ file, line: line.lineNumber });
        }
      }
    }

    uncoveredSites.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.line - b.line;
    });

    if (uncoveredSites.length === 0) {
      return {
        uncoveredSites,
        reportText: "All changed code lines are covered.",
      };
    }

    let reportText =
      "Uncovered changed lines (note: executed ≠ asserted; the mutation verifier decides adequacy):\n";
    for (const site of uncoveredSites) {
      reportText += `${site.file}:${site.line}\n`;
    }

    return {
      uncoveredSites,
      reportText,
    };
  } catch {
    return EMPTY_REPORT;
  }
}
