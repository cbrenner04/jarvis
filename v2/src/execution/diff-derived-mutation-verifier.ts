import { readFileSync, writeFileSync } from "node:fs";
import { classifyChangedPaths } from "../../../scripts/ci-test-scope.ts";

export type DiffDerivedMutationVerifierInput = {
  worktreePath: string;
  runBase: string;
};

export type PassResult = {
  kind: "pass";
  runBase: string;
  inspectedPaths: string[];
  candidateCount: number;
};

export type SurvivingMutationResult = {
  kind: "surviving-mutation";
  mutation: string;
  sourceSite: {
    file: string;
    line: number;
  };
};

export type VerificationResult = PassResult | SurvivingMutationResult;

export type Candidate = {
  file: string;
  line: number;
  columnStart: number;
  columnEnd: number;
  originalText: string;
  mutatedText: string;
  mutation: string;
};

type GitDiff = (cwd: string, baseRef: string) => Promise<string>;
type UntrackedFiles = (cwd: string) => Promise<string[]>;
type RunScopedTests = (cwd: string, scope: string[]) => Promise<boolean>;
type ReadFile = (path: string) => Promise<string>;
type WriteFile = (path: string, content: string) => Promise<void>;

type VerifierSeams = {
  gitDiff?: GitDiff;
  untrackedFiles?: UntrackedFiles;
  runScopedTests?: RunScopedTests;
  readFile?: ReadFile;
  writeFile?: WriteFile;
};

async function defaultGitDiff(cwd: string, baseRef: string): Promise<string> {
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    return await realAsyncSubprocessRunner.runAsync(
      "git",
      ["diff", `${baseRef}...HEAD`, "--no-ext-diff", "--no-color"],
      cwd,
    );
  } catch {
    return "";
  }
}

async function defaultUntrackedFiles(cwd: string): Promise<string[]> {
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
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

async function defaultRunScopedTests(cwd: string, scope: string[]): Promise<boolean> {
  if (scope.length === 0) return true;
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    await realAsyncSubprocessRunner.runAsync("bun", ["test", "--parallel", ...scope], cwd);
    return true;
  } catch {
    return false;
  }
}

async function defaultReadFile(path: string): Promise<string> {
  return readFileSync(path, "utf-8");
}

async function defaultWriteFile(path: string, content: string): Promise<void> {
  writeFileSync(path, content);
}

function isProductionFile(path: string): boolean {
  const NON_PRODUCTION_PATTERNS = [
    /\.test\.ts$/,
    /\.test\.js$/,
    /^test\//,
    /^v1\/spec\//,
    /^v2\/spec\//,
    /^v1\/docs\//,
    /^v2\/docs\//,
  ];
  return !NON_PRODUCTION_PATTERNS.some((pattern) => pattern.test(path));
}

interface ChangedLine {
  type: "add" | "remove";
  lineNumber: number;
  content: string;
  file: string;
}

function parseDiff(diffOutput: string): ChangedLine[] {
  const lines: ChangedLine[] = [];
  const diffLines = diffOutput.split("\n");

  let currentFile: string | null = null;
  let currentNewLineNum = 0;
  let inHunk = false;

  for (const line of diffLines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/b\/(.+)$/);
      currentFile = match && match[1] ? match[1] : null;
    } else if (line.startsWith("@@")) {
      inHunk = true;
      // Parse the new file line number from the hunk header
      // Format: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      if (match && match[1]) {
        currentNewLineNum = parseInt(match[1], 10);
      } else {
        currentNewLineNum = 1;
      }
    } else if (inHunk && currentFile) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lines.push({
          type: "add",
          lineNumber: currentNewLineNum,
          content: line.slice(1),
          file: currentFile,
        });
        currentNewLineNum++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        // Removed lines: don't increment new line number, don't add to changed lines
      } else if (line.startsWith(" ")) {
        // Context line: increment line number
        currentNewLineNum++;
      } else if (!line.startsWith("\\")) {
        // End of hunk or special line
        if (line.length > 0 && !line.startsWith("diff") && !line.startsWith("index")) {
          inHunk = false;
        }
      }
    }
  }

  return lines;
}

function deriveFromLine(file: string, lineNum: number, content: string): Candidate[] {
  const candidates: Candidate[] = [];

  // Skip comments and empty lines
  if (!content.trim() || content.trim().startsWith("//") || content.trim().startsWith("*")) {
    return candidates;
  }

  // Derive fail-closed guard mutations (negation flips)
  const guardMatches = Array.from(content.matchAll(/(\!\s*[a-zA-Z_][a-zA-Z0-9_]*|\!(?:\([^)]+\)))/g));
  for (const match of guardMatches) {
    if (match.index === undefined) continue;
    const original = match[0];
    const start = match.index;
    let mutated: string;

    if (original.startsWith("!")) {
      mutated = original.slice(1).trimStart();
    } else {
      mutated = "!" + original;
    }

    if (mutated !== original) {
      candidates.push({
        file,
        line: lineNum,
        columnStart: start,
        columnEnd: start + original.length,
        originalText: original,
        mutatedText: mutated,
        mutation: `guard-flip: ${original} → ${mutated}`,
      });
    }
  }

  // Derive comparison operator mutations
  const comparisonMatches = Array.from(content.matchAll(/([=!><]+)/g));
  for (const match of comparisonMatches) {
    if (match.index === undefined) continue;
    const original = match[0];
    const start = match.index;
    let mutated = original;

    // Simple operator flips
    if (original === "===") mutated = "!==";
    else if (original === "!==") mutated = "===";
    else if (original === "==") mutated = "!=";
    else if (original === "!=") mutated = "==";
    else if (original === "<") mutated = ">=";
    else if (original === ">") mutated = "<=";
    else if (original === "<=") mutated = ">";
    else if (original === ">=") mutated = "<";

    if (mutated !== original) {
      candidates.push({
        file,
        line: lineNum,
        columnStart: start,
        columnEnd: start + original.length,
        originalText: original,
        mutatedText: mutated,
        mutation: `operator-flip: ${original} → ${mutated}`,
      });
    }
  }

  // Derive destructive-operation safety mutations
  const destructiveMatches = Array.from(
    content.matchAll(/\b(unlink|rmdir|rm|delete|destroy|remove)(?:Sync|Async)?\s*\(/g),
  );
  for (const match of destructiveMatches) {
    if (match.index === undefined) continue;
    const original = match[0];
    const start = match.index;
    const mutated = "// MUTATED: " + original;

    candidates.push({
      file,
      line: lineNum,
      columnStart: start,
      columnEnd: start + original.length,
      originalText: original,
      mutatedText: mutated,
      mutation: `skip-destructive: ${original}`,
    });
  }

  return candidates;
}

function applyMutation(fileContent: string, candidate: Candidate): string {
  const lines = fileContent.split("\n");
  const lineIndex = candidate.line - 1;

  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new Error(`Line ${candidate.line} out of bounds`);
  }

  const line = lines[lineIndex];
  if (line === undefined) {
    throw new Error(`Line ${candidate.line} is undefined`);
  }
  const newLine = line.replace(candidate.originalText, candidate.mutatedText);

  if (newLine === line) {
    throw new Error(`Failed to apply mutation: ${candidate.originalText} not found in line ${candidate.line}`);
  }

  lines[lineIndex] = newLine;
  return lines.join("\n");
}

export async function verifyDiffDerivedMutations(
  input: DiffDerivedMutationVerifierInput,
  seams?: VerifierSeams,
): Promise<VerificationResult> {
  const gitDiff = seams?.gitDiff ?? defaultGitDiff;
  const untrackedFiles = seams?.untrackedFiles ?? defaultUntrackedFiles;
  const runScopedTests = seams?.runScopedTests ?? defaultRunScopedTests;
  const readFile = seams?.readFile ?? defaultReadFile;
  const writeFile = seams?.writeFile ?? defaultWriteFile;

  // Get the diff
  const diffOutput = await gitDiff(input.worktreePath, input.runBase);
  const changedLines = parseDiff(diffOutput);

  // Collect production files that changed
  const changedFiles = new Set<string>();
  const changedLinesByFile = new Map<string, ChangedLine[]>();

  for (const line of changedLines) {
    if (isProductionFile(line.file)) {
      changedFiles.add(line.file);
      if (!changedLinesByFile.has(line.file)) {
        changedLinesByFile.set(line.file, []);
      }
      changedLinesByFile.get(line.file)!.push(line);
    }
  }

  // Add untracked production files
  const untracked = await untrackedFiles(input.worktreePath);
  for (const file of untracked) {
    changedFiles.add(file);
  }

  if (changedFiles.size === 0) {
    return {
      kind: "pass",
      runBase: input.runBase,
      inspectedPaths: [],
      candidateCount: 0,
    };
  }

  // Determine scoped tests
  const changedPaths = Array.from(changedFiles);
  const scope = classifyChangedPaths(changedPaths);
  const scopeTests = scope === "full" ? [] : scope;

  // Derive mutation candidates from changed lines
  const candidates: Candidate[] = [];
  for (const [file, lines] of changedLinesByFile) {
    for (const line of lines) {
      const mutations = deriveFromLine(line.file, line.lineNumber, line.content);
      candidates.push(...mutations);
    }
  }

  if (candidates.length === 0) {
    return {
      kind: "pass",
      runBase: input.runBase,
      inspectedPaths: changedPaths,
      candidateCount: 0,
    };
  }

  // Apply and test each candidate
  for (const candidate of candidates) {
    const filePath = `${input.worktreePath}/${candidate.file}`;
    let originalContent: string;

    try {
      originalContent = await readFile(filePath);
    } catch (e) {
      // File doesn't exist or can't be read
      continue;
    }

    try {
      const mutatedContent = applyMutation(originalContent, candidate);

      // Apply mutation
      await writeFile(filePath, mutatedContent);

      try {
        // Run tests
        const testsPassed = await runScopedTests(input.worktreePath, scopeTests);

        // If tests passed, the mutation survived
        if (testsPassed) {
          return {
            kind: "surviving-mutation",
            mutation: candidate.mutation,
            sourceSite: {
              file: candidate.file,
              line: candidate.line,
            },
          };
        }
      } finally {
        // Always restore file
        await writeFile(filePath, originalContent);
      }
    } catch (e) {
      // Attempt to restore on error
      try {
        await writeFile(filePath, originalContent);
      } catch {
        // Ignore restoration errors
      }
      throw e;
    }
  }

  // All mutations were caught
  return {
    kind: "pass",
    runBase: input.runBase,
    inspectedPaths: changedPaths,
    candidateCount: candidates.length,
  };
}
