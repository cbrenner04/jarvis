import { existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyChangedPaths } from "../../../scripts/ci-test-scope.ts";
import { changedPathsFromDiff, isCodePath, isProductionFile, parseDiff, workingTreeGitDiff } from "./diff-scan.ts";

export type UncoveredChangedLine = {
  file: string;
  line: number;
};

export type UncoveredChangedLinesReport = {
  sites: UncoveredChangedLine[];
  text: string;
};

export type UncoveredChangedLinesInput = {
  worktreePath: string;
  runBase: string;
};

type UncoveredChangedLinesSeams = {
  gitDiff?: (cwd: string, baseRef: string) => Promise<string>;
  untrackedFiles?: (cwd: string) => Promise<string[]>;
  runCoverageTests?: (cwd: string, directories: string[]) => Promise<string>;
  readFile?: (path: string) => Promise<string>;
  readSourceFile?: (path: string) => Promise<string>;
  cleanupCoverage?: (cwd: string) => Promise<void>;
};

const COVERAGE_DIR = ".scratch/coverage";
export const COVERAGE_RUN_TIMEOUT_MS = 120_000;

const emptyReport = (): UncoveredChangedLinesReport => ({ sites: [], text: "" });

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

async function defaultRunCoverageTests(cwd: string, directories: string[]): Promise<string> {
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  if (directories.length === 0) return "";
  try {
    return await realAsyncSubprocessRunner.runAsync(
      "bun",
      ["test", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${COVERAGE_DIR}`, ...directories],
      cwd,
      { timeoutMs: COVERAGE_RUN_TIMEOUT_MS },
    );
  } catch {
    return "";
  }
}

async function defaultCleanupCoverage(cwd: string): Promise<void> {
  const coveragePath = join(cwd, COVERAGE_DIR);
  if (existsSync(coveragePath)) {
    rmSync(coveragePath, { recursive: true, force: true });
  }
}

function parseLcov(lcovContent: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  let currentFile: string | null = null;
  let coveredLines = new Set<number>();

  const flush = (): void => {
    if (currentFile !== null && coveredLines.size > 0) {
      result.set(currentFile, coveredLines);
    }
  };

  for (const line of lcovContent.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("SF:")) {
      flush();
      currentFile = trimmed.slice(3);
      coveredLines = new Set<number>();
    } else if (trimmed.startsWith("DA:")) {
      const parts = trimmed.slice(3).split(",");
      const lineNum = parseInt(parts[0] ?? "0", 10);
      const hitCount = parseInt(parts[1] ?? "0", 10);
      if (hitCount > 0) {
        coveredLines.add(lineNum);
      }
    } else if (trimmed === "end_of_record") {
      flush();
      currentFile = null;
      coveredLines = new Set<number>();
    }
  }

  flush();
  return result;
}

async function addedLinesFromUntrackedFile(
  worktreePath: string,
  file: string,
  readSource: (path: string) => Promise<string>,
): Promise<Array<{ type: "add"; lineNumber: number; content: string; file: string }>> {
  try {
    const content = await readSource(join(worktreePath, file));
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

function uniqueCoverageDirectories(codePaths: string[]): string[] {
  const scope = classifyChangedPaths(codePaths);
  const directories =
    scope === "full"
      ? ["."]
      : codePaths.map((p) => {
          const parts = p.split("/");
          return parts[0] ?? ".";
        });
  return [...new Set(directories)] as string[];
}

async function loadCoverageMap(
  worktreePath: string,
  directories: string[],
  runCoverageTests: (cwd: string, directories: string[]) => Promise<string>,
  readLcov: (path: string) => Promise<string>,
  cleanupCoverage: (cwd: string) => Promise<void>,
): Promise<Map<string, Set<number>> | null> {
  let coverageOutput = "";
  try {
    coverageOutput = await runCoverageTests(worktreePath, directories);
  } catch {
    return null;
  }
  if (!coverageOutput) {
    await cleanupCoverage(worktreePath).catch(() => {});
    return null;
  }

  const lcovPath = join(worktreePath, COVERAGE_DIR, "lcov.info");
  try {
    const lcovContent = await readLcov(lcovPath);
    await cleanupCoverage(worktreePath).catch(() => {});
    return parseLcov(lcovContent);
  } catch {
    await cleanupCoverage(worktreePath).catch(() => {});
    return null;
  }
}

type ChangedLine = { type: "add" | "remove"; lineNumber: number; content: string; file: string };

function uncoveredSites(changedLines: ChangedLine[], coverage: Map<string, Set<number>>): UncoveredChangedLine[] {
  const changedLinesByFile = new Map<string, Set<number>>();
  for (const line of changedLines) {
    if (line.type !== "add" || !isCodePath(line.file) || !isProductionFile(line.file)) continue;
    const added = changedLinesByFile.get(line.file) ?? new Set<number>();
    added.add(line.lineNumber);
    changedLinesByFile.set(line.file, added);
  }

  const sites: UncoveredChangedLine[] = [];
  for (const [file, addedLines] of changedLinesByFile) {
    const coveredLines = coverage.get(file) ?? new Set<number>();
    for (const lineNum of addedLines) {
      if (!coveredLines.has(lineNum)) {
        sites.push({ file, line: lineNum });
      }
    }
  }

  sites.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
  return sites;
}

function formatUncoveredReportText(sites: UncoveredChangedLine[]): string {
  if (sites.length === 0) return "";
  const textLines = ["Uncovered changed lines:"];
  for (const site of sites) {
    textLines.push(`  ${site.file}:${site.line}`);
  }
  textLines.push("");
  textLines.push(
    "Note: an executed line may still be unasserted. The mutation verifier, not coverage, decides adequacy.",
  );
  return textLines.join("\n");
}

export async function reportUncoveredChangedLines(
  input: UncoveredChangedLinesInput,
  seams?: UncoveredChangedLinesSeams,
): Promise<UncoveredChangedLinesReport> {
  const gitDiff = seams?.gitDiff ?? workingTreeGitDiff;
  const untrackedFilesFunc = seams?.untrackedFiles ?? defaultUntrackedFiles;
  const runCoverageTests = seams?.runCoverageTests ?? defaultRunCoverageTests;
  const readLcov = seams?.readFile ?? ((path: string) => readFile(path, "utf-8"));
  const readSource = seams?.readSourceFile ?? ((path: string) => readFile(path, "utf-8"));
  const cleanupCoverage = seams?.cleanupCoverage ?? defaultCleanupCoverage;

  const diffOutput = await gitDiff(input.worktreePath, input.runBase);
  const diffLines = parseDiff(diffOutput);

  const changedPaths = changedPathsFromDiff(diffOutput);
  const untracked = await untrackedFilesFunc(input.worktreePath);
  const allChangedPaths = [...changedPaths, ...untracked];

  const codePaths = allChangedPaths.filter((p) => isCodePath(p));
  if (codePaths.length === 0) {
    return emptyReport();
  }

  const uniqueDirs = uniqueCoverageDirectories(codePaths);

  const untrackedLines = (
    await Promise.all(
      untracked
        .filter((file) => isCodePath(file) && isProductionFile(file))
        .map((file) => addedLinesFromUntrackedFile(input.worktreePath, file, readSource)),
    )
  ).flat();
  const changedLines = [...diffLines, ...untrackedLines];

  const coverage = await loadCoverageMap(input.worktreePath, uniqueDirs, runCoverageTests, readLcov, cleanupCoverage);
  if (coverage === null) {
    return emptyReport();
  }

  const sites = uncoveredSites(changedLines, coverage);
  return {
    sites,
    text: formatUncoveredReportText(sites),
  };
}
