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
type Now = () => number;

type VerifierSeams = {
  gitDiff?: GitDiff;
  untrackedFiles?: UntrackedFiles;
  runScopedTests?: RunScopedTests;
  readFile?: ReadFile;
  writeFile?: WriteFile;
  now?: Now;
};

// Each applied mutation runs the run-base scoped suites once; bounding count
// and wall-clock keeps a large diff from dominating implement iteration time
// (DEFAULT_ITERATION_TIMEOUT_MS in write-loop.ts).
const MAX_APPLIED_MUTATIONS = 25;
const MAX_VERIFICATION_MS = 5 * 60_000;

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

async function defaultRunScopedTests(cwd: string, scope: string[]): Promise<boolean> {
  if (scope.length === 0) return true;
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    // `scope` holds package.json script names (e.g. "test:v2"), not file
    // patterns — each must run via `bun run <script>`, matching how
    // scripts/ready.ts's getReadyCommands invokes the same scoped scripts.
    for (const script of scope) {
      await realAsyncSubprocessRunner.runAsync("bun", ["run", script], cwd);
    }
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

function extractFileFromDiffLine(line: string): string | null {
  const match = line.match(/b\/(.+)$/);
  return match?.[1] ?? null;
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

function parseDiff(diffOutput: string): ChangedLine[] {
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

function deriveGuardMutations(file: string, lineNum: number, content: string, candidates: Candidate[]): void {
  const guardMatches = Array.from(content.matchAll(/(!\s*[a-zA-Z_][a-zA-Z0-9_]*|!(?:\([^)]+\)))/g));
  for (const match of guardMatches) {
    if (match.index === undefined) continue;
    const original = match[0];
    const start = match.index;
    let mutated: string;

    if (original.startsWith("!")) {
      mutated = original.slice(1).trimStart();
    } else {
      mutated = `!${original}`;
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
}

function flipOperator(original: string): string {
  if (original === "===") return "!==";
  if (original === "!==") return "===";
  if (original === "==") return "!=";
  if (original === "!=") return "==";
  if (original === "<") return ">=";
  if (original === ">") return "<=";
  if (original === "<=") return ">";
  if (original === ">=") return "<";
  return original;
}

function deriveOperatorMutations(file: string, lineNum: number, content: string, candidates: Candidate[]): void {
  const comparisonMatches = Array.from(content.matchAll(/([=!><]+)/g));
  for (const match of comparisonMatches) {
    if (match.index === undefined) continue;
    const original = match[0];
    const start = match.index;
    const mutated = flipOperator(original);

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
}

function deriveDestructiveMutations(file: string, lineNum: number, content: string, candidates: Candidate[]): void {
  const destructiveMatches = Array.from(
    content.matchAll(/\b(unlink|rmdir|rm|delete|destroy|remove)(?:Sync|Async)?\s*\(/g),
  );
  for (const match of destructiveMatches) {
    if (match.index === undefined) continue;
    const original = match[0];
    const start = match.index;
    const mutated = `// MUTATED: ${original}`;

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
}

function deriveFromLine(file: string, lineNum: number, content: string): Candidate[] {
  const candidates: Candidate[] = [];

  // Skip comments and empty lines
  if (!content.trim() || content.trim().startsWith("//") || content.trim().startsWith("*")) {
    return candidates;
  }

  deriveGuardMutations(file, lineNum, content, candidates);
  deriveOperatorMutations(file, lineNum, content, candidates);
  deriveDestructiveMutations(file, lineNum, content, candidates);

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

async function buildChangedFiles(
  changedLines: ChangedLine[],
  untrackedFilesFunc: UntrackedFiles,
  worktreePath: string,
): Promise<{ changedFiles: Set<string>; changedLinesByFile: Map<string, ChangedLine[]> }> {
  const changedFiles = new Set<string>();
  const changedLinesByFile = new Map<string, ChangedLine[]>();

  for (const line of changedLines) {
    if (isProductionFile(line.file)) {
      changedFiles.add(line.file);
      if (!changedLinesByFile.has(line.file)) {
        changedLinesByFile.set(line.file, []);
      }
      const lines = changedLinesByFile.get(line.file);
      if (lines) {
        lines.push(line);
      }
    }
  }

  const untracked = await untrackedFilesFunc(worktreePath);
  for (const file of untracked) {
    changedFiles.add(file);
  }

  return { changedFiles, changedLinesByFile };
}

async function testCandidate(
  candidate: Candidate,
  originalContent: string,
  input: DiffDerivedMutationVerifierInput,
  _readFile: ReadFile,
  writeFile: WriteFile,
  runScopedTests: RunScopedTests,
  scopeTests: string[],
): Promise<SurvivingMutationResult | null> {
  const filePath = `${input.worktreePath}/${candidate.file}`;

  try {
    const mutatedContent = applyMutation(originalContent, candidate);
    await writeFile(filePath, mutatedContent);

    try {
      const testsPassed = await runScopedTests(input.worktreePath, scopeTests);
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
      await writeFile(filePath, originalContent);
    }
  } catch {
    try {
      await writeFile(filePath, originalContent);
    } catch {
      // Ignore restoration errors
    }
    throw new Error(`Failed to test candidate for ${candidate.file}:${candidate.line}`);
  }

  return null;
}

export async function verifyDiffDerivedMutations(
  input: DiffDerivedMutationVerifierInput,
  seams?: VerifierSeams,
): Promise<VerificationResult> {
  const gitDiff = seams?.gitDiff ?? defaultGitDiff;
  const untrackedFilesFunc = seams?.untrackedFiles ?? defaultUntrackedFiles;
  const runScopedTests = seams?.runScopedTests ?? defaultRunScopedTests;
  const readFile = seams?.readFile ?? defaultReadFile;
  const writeFile = seams?.writeFile ?? defaultWriteFile;
  const now = seams?.now ?? Date.now;

  const diffOutput = await gitDiff(input.worktreePath, input.runBase);
  const changedLines = parseDiff(diffOutput);

  const { changedFiles, changedLinesByFile } = await buildChangedFiles(
    changedLines,
    untrackedFilesFunc,
    input.worktreePath,
  );

  if (changedFiles.size === 0) {
    return {
      kind: "pass",
      runBase: input.runBase,
      inspectedPaths: [],
      candidateCount: 0,
    };
  }

  const changedPaths = Array.from(changedFiles);
  const scope = classifyChangedPaths(changedPaths);
  // "full" means the aggregate `test` script, not "skip verification" — an
  // empty scopeTests short-circuits defaultRunScopedTests to an unconditional
  // pass, silently disabling mutation verification for full-scope diffs.
  const scopeTests = scope === "full" ? ["test"] : scope;

  const candidates: Candidate[] = [];
  for (const [_file, lines] of changedLinesByFile) {
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

  const verificationStart = now();
  let appliedCount = 0;

  for (const candidate of candidates) {
    if (appliedCount >= MAX_APPLIED_MUTATIONS || now() - verificationStart >= MAX_VERIFICATION_MS) {
      break;
    }

    const filePath = `${input.worktreePath}/${candidate.file}`;
    let originalContent: string;

    try {
      originalContent = await readFile(filePath);
    } catch (_e) {
      continue;
    }

    appliedCount++;
    const result = await testCandidate(
      candidate,
      originalContent,
      input,
      readFile,
      writeFile,
      runScopedTests,
      scopeTests,
    );
    if (result) {
      return result;
    }
  }

  return {
    kind: "pass",
    runBase: input.runBase,
    inspectedPaths: changedPaths,
    candidateCount: appliedCount,
  };
}
