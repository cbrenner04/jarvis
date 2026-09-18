import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { resolveHarnessRoot } from "../../../shared/markdownlint-repair.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { trackProcessGroup, type VerifierProcessGroupRecorder } from "./verifier-process-groups.ts";

/** Wall-clock bound on one markdownlint run; a timeout fails closed as `invocation_error`. */
export const STAGED_MARKDOWN_LINT_TIMEOUT_MS = 60_000;

export type StagedMarkdownLintResult =
  | { kind: "clean" }
  | { kind: "violation"; ruleId: string; filePath: string; message: string }
  | { kind: "invocation_error"; message: string };

export type LintStagedMarkdownDeps = {
  harnessRootOverride?: string | null;
  runner?: AsyncSubprocessRunner;
  worktreePath?: string;
  signal?: AbortSignal;
  processGroups?: VerifierProcessGroupRecorder;
};

const MARKDOWNLINT_VIOLATION_PATTERN = /^(.+?):(\d+)(?::\d+)?\s+(MD\d+)\/\S+\s+(.+)$/;

function isIgnoredStagedMarkdownFile(fileName: string): boolean {
  return /^verdict-.*\.md$/i.test(fileName);
}

function listStagedMarkdownFiles(stagingRoot: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".md") && !isIgnoredStagedMarkdownFile(entry.name)) {
        files.push(path);
      }
    }
  }
  walk(stagingRoot);
  return files.sort();
}

function parseMarkdownlintViolations(output: string): Array<{
  filePath: string;
  line: number;
  ruleId: string;
  message: string;
}> {
  const violations: Array<{ filePath: string; line: number; ruleId: string; message: string }> = [];
  for (const line of output.split("\n")) {
    const match = MARKDOWNLINT_VIOLATION_PATTERN.exec(line.trim());
    if (match === null) continue;
    violations.push({
      filePath: match[1] ?? "",
      line: Number(match[2]),
      ruleId: match[3] ?? "",
      message: match[4] ?? "",
    });
  }
  return violations;
}

function toRepoRelativePath(filePath: string, worktreePath: string, harnessRoot: string): string {
  const absolutePath = resolve(harnessRoot, filePath);
  const relativeToWorktree = relative(worktreePath, absolutePath);
  if (relativeToWorktree.length > 0 && !relativeToWorktree.startsWith("..")) {
    return relativeToWorktree;
  }
  return relative(harnessRoot, absolutePath);
}

function selectFirstViolation(
  violations: Array<{ filePath: string; line: number; ruleId: string; message: string }>,
  walkOrder: string[],
  worktreePath: string,
  harnessRoot: string,
): { ruleId: string; filePath: string; message: string } | undefined {
  const byFile = new Map<string, Array<{ line: number; ruleId: string; message: string }>>();
  for (const violation of violations) {
    const absoluteViolationPath = resolve(harnessRoot, violation.filePath);
    const bucket = byFile.get(absoluteViolationPath) ?? [];
    bucket.push({ line: violation.line, ruleId: violation.ruleId, message: violation.message });
    byFile.set(absoluteViolationPath, bucket);
  }

  for (const stagedFile of walkOrder) {
    const bucket = byFile.get(resolve(stagedFile));
    if (bucket === undefined || bucket.length === 0) continue;
    bucket.sort((left, right) => left.line - right.line);
    const first = bucket[0];
    if (first === undefined) continue;
    return {
      ruleId: first.ruleId,
      filePath: toRepoRelativePath(violationPathForStagedFile(stagedFile, harnessRoot), worktreePath, harnessRoot),
      message: first.message,
    };
  }
  return undefined;
}

function violationPathForStagedFile(stagedFile: string, harnessRoot: string): string {
  return relative(harnessRoot, stagedFile);
}

function linterOutputFromError(err: unknown): string {
  if (err instanceof AsyncSubprocessError) {
    return `${err.stdout}\n${err.stderr}`;
  }
  return "";
}

function invocationErrorMessage(err: unknown): string {
  if (err instanceof AsyncSubprocessError) {
    const detail = err.stderr.trim() || err.stdout.trim() || err.message;
    return detail.length > 0 ? detail : "markdownlint invocation failed";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function missingLintAsset(binaryPath: string, configPath: string): string | undefined {
  if (!existsSync(binaryPath)) return "markdownlint binary not found";
  if (!existsSync(configPath)) return "markdownlint config not found";
  return undefined;
}

export async function lintStagedMarkdown(
  stagingRoot: string,
  deps?: LintStagedMarkdownDeps,
): Promise<StagedMarkdownLintResult> {
  const worktreePath = resolve(deps?.worktreePath ?? process.cwd());
  const absStagingRoot = resolve(worktreePath, stagingRoot);
  if (!existsSync(absStagingRoot)) {
    return { kind: "clean" };
  }

  const stagedFiles = listStagedMarkdownFiles(absStagingRoot);
  if (stagedFiles.length === 0) {
    return { kind: "clean" };
  }

  // An injected runner owns the spawn, so the real binary and config need not exist on disk.
  const injectedRunner = deps?.runner;
  const harnessRoot =
    resolveHarnessRoot(deps?.harnessRootOverride) ?? (injectedRunner !== undefined ? worktreePath : null);
  if (harnessRoot === null) {
    return { kind: "invocation_error", message: "could not locate markdownlint harness root" };
  }

  const binaryPath = join(harnessRoot, "node_modules", "markdownlint-cli2", "markdownlint-cli2.js");
  const configPath = join(harnessRoot, ".markdownlint-cli2.jsonc");
  const missing = injectedRunner === undefined ? missingLintAsset(binaryPath, configPath) : undefined;
  if (missing !== undefined) {
    return { kind: "invocation_error", message: missing };
  }

  const runner = injectedRunner ?? realAsyncSubprocessRunner;
  // `--fix` repairs what markdownlint can (blank-line runs, code-span spacing) before reporting; only what
  // survives the autofix reaches the reprompt.
  const lintArgs = [binaryPath, "--fix", "--no-globs", "--config", configPath, ...stagedFiles];

  const tracked = trackProcessGroup(deps?.processGroups);
  try {
    const output = await runner.runAsync("bun", lintArgs, harnessRoot, {
      timeoutMs: STAGED_MARKDOWN_LINT_TIMEOUT_MS,
      signal: deps?.signal,
      processGroup: tracked.processGroup,
    });
    const violations = parseMarkdownlintViolations(output);
    if (violations.length === 0) {
      return { kind: "clean" };
    }
    const first = selectFirstViolation(violations, stagedFiles, worktreePath, harnessRoot);
    return first === undefined ? { kind: "clean" } : { kind: "violation", ...first };
  } catch (err) {
    const violations = parseMarkdownlintViolations(linterOutputFromError(err));
    if (violations.length > 0) {
      const first = selectFirstViolation(violations, stagedFiles, worktreePath, harnessRoot);
      if (first !== undefined) {
        return { kind: "violation", ...first };
      }
    }
    if (err instanceof AsyncSubprocessError) {
      return { kind: "invocation_error", message: invocationErrorMessage(err) };
    }
    return { kind: "invocation_error", message: invocationErrorMessage(err) };
  } finally {
    tracked.settle();
  }
}
