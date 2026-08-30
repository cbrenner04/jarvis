import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { guarded } from "../../../scripts/guard-deterministic-daemon-tests.ts";
import { resolveRenderObserverTests } from "../../../shared/prompts/render-observer-tests.ts";
import { type ChangedLine, changedPathsFromDiff, defaultGitDiff, isProductionFile, parseDiff } from "./diff-scan.ts";

export type DiffDerivedMutationVerifierInput = {
  worktreePath: string;
  runBase: string;
};

export type AcceptedSite = {
  file: string;
  line: number;
  mutation: string;
  reason: string;
};

export type PassResult = {
  kind: "pass";
  runBase: string;
  inspectedPaths: string[];
  candidateCount: number;
  acceptedSites: AcceptedSite[];
};

export type SurvivingMutationResult = {
  kind: "surviving-mutation";
  mutation: string;
  sourceSite: {
    file: string;
    line: number;
  };
  dualConstraint?: true;
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
type RegisteredPromptPaths = (cwd: string, baseRef: string) => Promise<string[]>;
type ListDir = (dir: string) => string[];

type VerifierSeams = {
  gitDiff?: GitDiff;
  untrackedFiles?: UntrackedFiles;
  runScopedTests?: RunScopedTests;
  readFile?: ReadFile;
  writeFile?: WriteFile;
  registeredPromptPaths?: RegisteredPromptPaths;
  listDir?: ListDir;
  now?: () => number;
};

/** Verification bounds: hitting either ends the run as a pass over the candidates inspected so far. */
export const MAX_INSPECTED_MUTATIONS = 25;
export const MAX_PROMPT_RENDER_VERIFICATIONS = 5;
export const MAX_VERIFICATION_MS = 5 * 60_000;
export const MAX_CONCURRENT_VERIFIER_TEST_RUNS = 4;

let peakConcurrentVerifierTestRuns = 0;
let currentConcurrentVerifierTestRuns = 0;
let verifierTestRunSemaphore: VerifierTestRunSemaphore | undefined;

export function resetVerifierTestRunTrackingForTest(): void {
  peakConcurrentVerifierTestRuns = 0;
  currentConcurrentVerifierTestRuns = 0;
  verifierTestRunSemaphore = undefined;
}

export function peakVerifierTestRuns(): number {
  return peakConcurrentVerifierTestRuns;
}

class VerifierTestRunSemaphore {
  private inFlight = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inFlight >= this.limit) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }
    this.inFlight += 1;
    currentConcurrentVerifierTestRuns += 1;
    if (currentConcurrentVerifierTestRuns > peakConcurrentVerifierTestRuns) {
      peakConcurrentVerifierTestRuns = currentConcurrentVerifierTestRuns;
    }
    try {
      return await fn();
    } finally {
      this.inFlight -= 1;
      currentConcurrentVerifierTestRuns -= 1;
      const next = this.queue.shift();
      if (next !== undefined) next();
    }
  }
}

function getVerifierTestRunSemaphore(): VerifierTestRunSemaphore {
  if (verifierTestRunSemaphore === undefined) {
    verifierTestRunSemaphore = new VerifierTestRunSemaphore(MAX_CONCURRENT_VERIFIER_TEST_RUNS);
  }
  return verifierTestRunSemaphore;
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
  return runDiffDerivedScopedTests(cwd, scope);
}

type ScopedTestRunner = {
  runAsync: (command: string, args: string[], cwd: string) => Promise<string>;
};

export async function runDiffDerivedScopedTests(
  cwd: string,
  scope: string[],
  runner?: ScopedTestRunner,
): Promise<boolean> {
  if (scope.length === 0) return true;
  const subprocess = runner ?? (await import("../../../shared/subprocess.ts")).realAsyncSubprocessRunner;
  const semaphore = getVerifierTestRunSemaphore();
  try {
    await Promise.all(
      scope.map((testPath) =>
        semaphore.run(async () => {
          await subprocess.runAsync("bun", ["test", testPath], cwd);
        }),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

async function defaultReadFile(path: string): Promise<string> {
  return readFileSync(path, "utf-8");
}

function defaultListDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

async function defaultWriteFile(path: string, content: string): Promise<void> {
  writeFileSync(path, content);
}

function registeredPromptPaths(manifest: string): string[] {
  return manifest
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => `prompts/${path}`);
}

async function defaultRegisteredPromptPaths(cwd: string, baseRef: string): Promise<string[]> {
  const paths = new Set<string>();
  try {
    for (const path of registeredPromptPaths(readFileSync(`${cwd}/prompts/registry.txt`, "utf-8"))) paths.add(path);
  } catch {
    // A deleted manifest can still have registered artifacts at the base.
  }
  try {
    const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
    const manifest = await realAsyncSubprocessRunner.runAsync("git", ["show", `${baseRef}:prompts/registry.txt`], cwd);
    for (const path of registeredPromptPaths(manifest)) paths.add(path);
  } catch {
    // The current registry remains enough when the base cannot be resolved.
  }
  return [...paths];
}

function deriveGuardMutations(
  file: string,
  lineNum: number,
  content: string,
  masked: string,
  candidates: Candidate[],
): void {
  const guardMatches = Array.from(masked.matchAll(/(!\s*[a-zA-Z_][a-zA-Z0-9_]*|!(?:\([^)]+\)))/g));
  for (const match of guardMatches) {
    if (match.index === undefined) continue;
    const start = match.index;
    // Matching happens on the masked line, but the mutation is applied to the
    // real file: a guard span may enclose a masked string (`!("k" in o)`), so
    // the candidate's text has to come from the original line.
    const original = content.slice(start, start + match[0].length);
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

function deriveOperatorMutations(
  file: string,
  lineNum: number,
  content: string,
  masked: string,
  candidates: Candidate[],
): void {
  const comparisonMatches = Array.from(masked.matchAll(/([=!><]+)/g));
  for (const match of comparisonMatches) {
    if (match.index === undefined) continue;
    const start = match.index;
    const original = content.slice(start, start + match[0].length);
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

function deriveDestructiveMutations(
  file: string,
  lineNum: number,
  content: string,
  masked: string,
  candidates: Candidate[],
): void {
  const destructiveMatches = Array.from(
    masked.matchAll(/\b(unlink|rmdir|rm|delete|destroy|remove)(?:Sync|Async)?\s*\(/g),
  );
  for (const match of destructiveMatches) {
    if (match.index === undefined) continue;
    const start = match.index;
    const original = content.slice(start, start + match[0].length);
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

/** Masks from an opening delimiter at `i` through its matching `closeChar`, honoring backslash escapes. Returns the index past the close (or end of line if unterminated). */
function maskDelimitedSpan(masked: string[], i: number, closeChar: string): number {
  masked[i] = " ";
  i++;
  while (i < masked.length) {
    if (masked[i] === "\\" && i + 1 < masked.length) {
      masked[i] = " ";
      masked[i + 1] = " ";
      i += 2;
    } else if (masked[i] === closeChar) {
      masked[i] = " ";
      i++;
      break;
    } else {
      masked[i] = " ";
      i++;
    }
  }
  return i;
}

// Masks a block comment opening at `i` through its close delimiter. Returns the
// index past the close, or end of line when the comment does not close here.
function maskBlockComment(masked: string[], i: number): number {
  masked[i] = " ";
  masked[i + 1] = " ";
  i += 2;
  while (i < masked.length) {
    if (masked[i] === "*" && i + 1 < masked.length && masked[i + 1] === "/") {
      masked[i] = " ";
      masked[i + 1] = " ";
      i += 2;
      return i;
    }
    masked[i] = " ";
    i++;
  }
  return i;
}

export function maskNonCodeSpans(line: string): string {
  const masked = line.split("");
  let i = 0;

  while (i < masked.length) {
    const char = masked[i];

    if (char === "/" && i + 1 < masked.length && masked[i + 1] === "/") {
      masked.fill(" ", i);
      break;
    }

    if (char === "/" && i + 1 < masked.length && masked[i + 1] === "*") {
      i = maskBlockComment(masked, i);
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      i = maskDelimitedSpan(masked, i, char);
      continue;
    }

    i++;
  }

  return masked.join("");
}

function deriveFromLine(file: string, lineNum: number, content: string): Candidate[] {
  const candidates: Candidate[] = [];

  // Skip comments and empty lines
  if (!content.trim() || content.trim().startsWith("//") || content.trim().startsWith("*")) {
    return candidates;
  }

  const maskedContent = maskNonCodeSpans(content);

  deriveGuardMutations(file, lineNum, content, maskedContent, candidates);
  deriveOperatorMutations(file, lineNum, content, maskedContent, candidates);
  deriveDestructiveMutations(file, lineNum, content, maskedContent, candidates);

  return candidates;
}

function isCodePath(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path);
}

export function resolveCoLocatedKillingTest(productionPath: string): string | null {
  if (!isCodePath(productionPath)) return null;
  const basename = productionPath.split("/").pop() ?? "";
  if (basename.includes(".test.")) return null;
  const match = productionPath.match(/^(.+)\.[cm]?[jt]sx?$/);
  if (match?.[1] === undefined) return null;
  return `${match[1]}.test.ts`;
}

/**
 * Sibling co-located killing tests for a changed production file: existing `<stem>-*.test.ts` files
 * in the same directory (NOT the exact-stem `<stem>.test.ts`, which callers resolve separately). A
 * large source file whose tests are split across siblings (no exact-stem file — e.g.
 * `workflow-runner.ts` with `workflow-runner-*.test.ts`) resolves its killing tests here instead of
 * reporting `missing-killing-test`. Returns worktree-relative paths, sorted; `[]` when none exist.
 */
export function resolveSiblingKillingTests(
  productionPath: string,
  worktreePath: string,
  listDir: ListDir = defaultListDir,
): string[] {
  if (resolveCoLocatedKillingTest(productionPath) === null) return [];
  const slash = productionPath.lastIndexOf("/");
  const dir = slash >= 0 ? productionPath.slice(0, slash) : "";
  const stem = productionPath.slice(slash + 1).match(/^(.+)\.[cm]?[jt]sx?$/)?.[1] ?? "";
  const matches = listDir(dir ? `${worktreePath}/${dir}` : worktreePath)
    .filter((entry) => entry.startsWith(`${stem}-`) && entry.endsWith(".test.ts"))
    .sort();
  return matches.map((entry) => (dir ? `${dir}/${entry}` : entry));
}

function mutateRenderedPrompt(content: string, changedLines: ChangedLine[]): string | null {
  const bodyStart = content.indexOf("\n---\n");
  if (bodyStart < 0) return null;
  const body = content.slice(bodyStart + 5);
  const changedBody = changedLines
    .filter((line) => line.type === "add" && line.content.trim().length > 0 && body.includes(line.content))
    .map((line) => line.content);
  const original = changedBody[0] ?? body.split("\n").find((line) => line.trim().length > 0);
  if (original === undefined) return null;
  return `${content.slice(0, bodyStart + 5)}${body.replace(original, "__JARVIS_PROMPT_RENDER_COVERAGE_MUTATION__")}`;
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

  const slice = line.slice(candidate.columnStart, candidate.columnEnd);
  if (slice !== candidate.originalText) {
    throw new Error(
      `Failed to apply mutation: expected "${candidate.originalText}" at ${candidate.columnStart}-${candidate.columnEnd} but found "${slice}"`,
    );
  }

  const newLine = line.slice(0, candidate.columnStart) + candidate.mutatedText + line.slice(candidate.columnEnd);

  lines[lineIndex] = newLine;
  return lines.join("\n");
}

async function buildChangedFiles(
  diffOutput: string,
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

  for (const file of changedPathsFromDiff(diffOutput)) changedFiles.add(file);

  const untracked = await untrackedFilesFunc(worktreePath);
  for (const file of untracked) {
    changedFiles.add(file);
  }

  return { changedFiles, changedLinesByFile };
}

async function verifyPromptRenderCoverage(
  promptPath: string,
  changedLines: ChangedLine[],
  input: DiffDerivedMutationVerifierInput,
  readFile: ReadFile,
  writeFile: WriteFile,
  runScopedTests: RunScopedTests,
  observerTests: readonly string[],
): Promise<boolean> {
  const filePath = `${input.worktreePath}/${promptPath}`;
  let original: string;
  try {
    original = await readFile(filePath);
  } catch {
    return false;
  }
  const mutated = mutateRenderedPrompt(original, changedLines);
  if (mutated === null) return false;
  try {
    await writeFile(filePath, mutated);
    return !(await runScopedTests(input.worktreePath, [...observerTests]));
  } finally {
    await writeFile(filePath, original);
  }
}

const TIMER_CALL_PATTERN = /\b(?:setTimeout|setInterval)\s*\(/g;

function scanToClosingParen(lines: string[], startLine: number, startCol: number): { endLine: number } | null {
  let parenDepth = 1;
  let currentLine = startLine;
  let currentCol = startCol;

  while (currentLine < lines.length && parenDepth > 0) {
    const scanLine = lines[currentLine];
    if (scanLine === undefined) return null;

    for (; currentCol < scanLine.length; currentCol++) {
      const char = scanLine[currentCol];
      if (char === "(") parenDepth++;
      else if (char === ")") {
        parenDepth--;
        if (parenDepth === 0) return { endLine: currentLine };
      }
    }

    currentLine++;
    currentCol = 0;
  }

  return null;
}

function timerCallOnLineContainsTarget(lines: string[], lineIndex: number, targetLineNum: number): boolean {
  const line = lines[lineIndex];
  if (line === undefined) return false;

  for (const match of line.matchAll(TIMER_CALL_PATTERN)) {
    const startCol = (match.index ?? 0) + (match[0]?.length ?? 0);
    const closed = scanToClosingParen(lines, lineIndex, startCol);
    if (closed !== null && closed.endLine >= targetLineNum) return true;
  }

  return false;
}

function isInsideTimerCallback(content: string, lineNum: number): boolean {
  const lines = content.split("\n");
  if (lineNum < 1 || lineNum > lines.length) return false;

  for (let i = lineNum - 1; i >= 0; i--) {
    if (timerCallOnLineContainsTarget(lines, i, lineNum)) return true;
  }

  return false;
}

export function isInsideTimerCallbackForTest(content: string, lineNum: number): boolean {
  return isInsideTimerCallback(content, lineNum);
}

async function testCandidate(
  candidate: Candidate,
  originalContent: string,
  input: DiffDerivedMutationVerifierInput,
  writeFile: WriteFile,
  runScopedTests: RunScopedTests,
  killingTestPaths: string[],
): Promise<SurvivingMutationResult | null> {
  const filePath = `${input.worktreePath}/${candidate.file}`;

  try {
    const mutatedContent = applyMutation(originalContent, candidate);
    await writeFile(filePath, mutatedContent);

    try {
      // Killed if ANY co-located test fails under the mutation; runScopedTests returns false on the first failure.
      const testsPassed = await runScopedTests(input.worktreePath, killingTestPaths);
      if (testsPassed) {
        const result: SurvivingMutationResult = {
          kind: "surviving-mutation",
          mutation: candidate.mutation,
          sourceSite: {
            file: candidate.file,
            line: candidate.line,
          },
        };

        if (
          isInsideTimerCallback(originalContent, candidate.line) &&
          guarded(candidate.file.replace(/\.ts$/, ".test.ts"))
        ) {
          result.dualConstraint = true;
        }

        return result;
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

function missingRenderCoverage(promptPath: string): SurvivingMutationResult {
  return {
    kind: "surviving-mutation",
    mutation: "missing-render-coverage",
    sourceSite: { file: promptPath, line: 1 },
  };
}

function missingKillingTest(candidate: Candidate): SurvivingMutationResult {
  return {
    kind: "surviving-mutation",
    mutation: "missing-killing-test",
    sourceSite: { file: candidate.file, line: candidate.line },
  };
}

async function verifyChangedPrompts(
  changedPaths: string[],
  changedLinesByFile: Map<string, ChangedLine[]>,
  input: DiffDerivedMutationVerifierInput,
  registeredPromptPaths: RegisteredPromptPaths,
  readFile: ReadFile,
  writeFile: WriteFile,
  runScopedTests: RunScopedTests,
  now: () => number,
  deadline: number,
): Promise<SurvivingMutationResult | null> {
  const registeredPrompts = new Set(await registeredPromptPaths(input.worktreePath, input.runBase));
  const changedPrompts = changedPaths.filter((path) => registeredPrompts.has(path));
  for (const [index, promptPath] of changedPrompts.entries()) {
    if (index >= MAX_PROMPT_RENDER_VERIFICATIONS || now() >= deadline) return missingRenderCoverage(promptPath);
    const observerTests = resolveRenderObserverTests(promptPath);
    if (observerTests === undefined || observerTests.length === 0) return missingRenderCoverage(promptPath);
    const renderedOutputObserved = await verifyPromptRenderCoverage(
      promptPath,
      changedLinesByFile.get(promptPath) ?? [],
      input,
      readFile,
      writeFile,
      runScopedTests,
      observerTests,
    );
    if (!renderedOutputObserved) return missingRenderCoverage(promptPath);
  }
  return null;
}

function deriveCandidates(changedLinesByFile: Map<string, ChangedLine[]>): Candidate[] {
  const candidates: Candidate[] = [];
  for (const lines of changedLinesByFile.values()) {
    for (const line of lines) {
      if (isCodePath(line.file)) candidates.push(...deriveFromLine(line.file, line.lineNumber, line.content));
    }
  }
  return candidates;
}

/**
 * The co-located killing tests to run against a candidate's mutation: the exact-stem
 * `<file>.test.ts` when it exists on disk, plus every existing sibling `<file>-*.test.ts`.
 */
const EQUIVALENT_MUTATION_DIRECTIVE_PREFIX = " @mutate-equivalent mutation=";

/** Index just past a `/* … *\/` block comment opening at `start`, or end of line if unterminated. */
function skipBlockComment(line: string, start: number): number {
  let i = start + 2;
  while (i < line.length) {
    if (line[i] === "*" && i + 1 < line.length && line[i + 1] === "/") return i + 2;
    i++;
  }
  return i;
}

/** Index just past a string literal opened by `close` at `start`, honoring backslash escapes. */
function skipStringLiteral(line: string, start: number, close: string): number {
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === "\\" && i + 1 < line.length) {
      i += 2;
      continue;
    }
    if (line[i] === close) return i + 1;
    i++;
  }
  return i;
}

function findLineCommentStart(line: string): number {
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (char === "/" && line[i + 1] === "/") return i;
    if (char === "/" && line[i + 1] === "*") {
      i = skipBlockComment(line, i);
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      i = skipStringLiteral(line, i, char);
      continue;
    }
    i++;
  }
  return -1;
}

function parseLeadingJsonString(input: string): { value: string; consumed: number } | null {
  if (!input.startsWith('"')) return null;
  for (let end = 1; end <= input.length; end++) {
    if (input[end - 1] !== '"') continue;
    let valid = true;
    for (let j = 1; j < end - 1; j++) {
      if (input[j] === "\\") {
        j++;
        continue;
      }
      if (input[j] === '"') {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    try {
      const parsed: unknown = JSON.parse(input.slice(0, end));
      if (typeof parsed !== "string") continue;
      return { value: parsed, consumed: end };
    } catch {}
  }
  return null;
}

export function parseEquivalentMutationDirective(line: string): { mutation: string; reason: string } | null {
  const commentStart = findLineCommentStart(line);
  if (commentStart === -1) return null;
  const body = line.slice(commentStart + 2);
  if (!body.startsWith(EQUIVALENT_MUTATION_DIRECTIVE_PREFIX)) return null;

  const mutationPart = body.slice(EQUIVALENT_MUTATION_DIRECTIVE_PREFIX.length);
  const mutationParsed = parseLeadingJsonString(mutationPart);
  if (mutationParsed === null) return null;

  const afterMutation = mutationPart.slice(mutationParsed.consumed);
  if (!afterMutation.startsWith(" reason=")) return null;

  const reasonPart = afterMutation.slice(" reason=".length);
  const reasonParsed = parseLeadingJsonString(reasonPart);
  if (reasonParsed === null) return null;
  if (reasonPart.slice(reasonParsed.consumed).length > 0) return null;
  if (!/\S/.test(reasonParsed.value)) return null;

  return { mutation: mutationParsed.value, reason: reasonParsed.value };
}

function recordAcceptedSite(acceptedSites: AcceptedSite[], candidate: Candidate, reason: string): void {
  if (
    acceptedSites.some(
      (site) => site.file === candidate.file && site.line === candidate.line && site.mutation === candidate.mutation,
    )
  ) {
    return;
  }
  acceptedSites.push({
    file: candidate.file,
    line: candidate.line,
    mutation: candidate.mutation,
    reason,
  });
}

async function coLocatedKillingTests(
  candidateFile: string,
  exactStemTest: string,
  worktreePath: string,
  readFile: ReadFile,
  listDir: ListDir,
): Promise<string[]> {
  const killingTests: string[] = [];
  try {
    await readFile(`${worktreePath}/${exactStemTest}`);
    killingTests.push(exactStemTest);
  } catch {
    // exact-stem test file absent; fall back to sibling <stem>-*.test.ts files
  }
  for (const sibling of resolveSiblingKillingTests(candidateFile, worktreePath, listDir)) {
    if (!killingTests.includes(sibling)) killingTests.push(sibling);
  }
  return killingTests;
}

async function verifyCandidates(
  candidates: Candidate[],
  input: DiffDerivedMutationVerifierInput,
  readFile: ReadFile,
  writeFile: WriteFile,
  runScopedTests: RunScopedTests,
  listDir: ListDir,
  now: () => number,
  deadline: number,
): Promise<{ result: SurvivingMutationResult | null; inspected: number; acceptedSites: AcceptedSite[] }> {
  let inspected = 0;
  let survivingResult: SurvivingMutationResult | null = null;
  const acceptedSites: AcceptedSite[] = [];
  const fileCache = new Map<string, string>();
  const fileChains = new Map<string, Promise<void>>();

  async function getFileContent(file: string): Promise<string | null> {
    const cached = fileCache.get(file);
    if (cached !== undefined) return cached;
    try {
      const content = await readFile(`${input.worktreePath}/${file}`);
      fileCache.set(file, content);
      return content;
    } catch {
      return null;
    }
  }

  for (const candidate of candidates) {
    if (inspected >= MAX_INSPECTED_MUTATIONS || now() >= deadline) break;
    if (survivingResult !== null) break;
    inspected += 1;

    const originalContent = await getFileContent(candidate.file);
    if (originalContent !== null) {
      const sourceLine = originalContent.split("\n")[candidate.line - 1];
      if (sourceLine !== undefined) {
        const directive = parseEquivalentMutationDirective(sourceLine);
        if (directive !== null && directive.mutation === candidate.mutation) {
          recordAcceptedSite(acceptedSites, candidate, directive.reason);
          continue;
        }
      }
    }

    const killingTest = resolveCoLocatedKillingTest(candidate.file);
    if (killingTest === null) {
      return { result: missingKillingTest(candidate), inspected, acceptedSites };
    }

    const previous = fileChains.get(candidate.file) ?? Promise.resolve();
    fileChains.set(
      candidate.file,
      previous.then(async () => {
        if (survivingResult !== null || now() >= deadline) return;
        const content = await getFileContent(candidate.file);
        if (content === null) return;
        const killingTests = await coLocatedKillingTests(
          candidate.file,
          killingTest,
          input.worktreePath,
          readFile,
          listDir,
        );
        if (killingTests.length === 0) {
          if (survivingResult === null) survivingResult = missingKillingTest(candidate);
          return;
        }
        const result = await testCandidate(candidate, content, input, writeFile, runScopedTests, killingTests);
        if (result !== null && survivingResult === null) survivingResult = result;
      }),
    );
  }

  await Promise.all(fileChains.values());
  return { result: survivingResult, inspected, acceptedSites };
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
  const registeredPromptPaths = seams?.registeredPromptPaths ?? defaultRegisteredPromptPaths;
  const listDir = seams?.listDir ?? defaultListDir;

  const diffOutput = await gitDiff(input.worktreePath, input.runBase);
  const changedLines = parseDiff(diffOutput);

  const { changedFiles, changedLinesByFile } = await buildChangedFiles(
    diffOutput,
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
      acceptedSites: [],
    };
  }

  const changedPaths = Array.from(changedFiles);

  const now = seams?.now ?? Date.now;
  const deadline = now() + MAX_VERIFICATION_MS;
  const promptResult = await verifyChangedPrompts(
    changedPaths,
    changedLinesByFile,
    input,
    registeredPromptPaths,
    readFile,
    writeFile,
    runScopedTests,
    now,
    deadline,
  );
  if (promptResult) return promptResult;

  const candidates = deriveCandidates(changedLinesByFile);

  if (candidates.length === 0) {
    return {
      kind: "pass",
      runBase: input.runBase,
      inspectedPaths: changedPaths,
      candidateCount: 0,
      acceptedSites: [],
    };
  }

  const { result, inspected, acceptedSites } = await verifyCandidates(
    candidates,
    input,
    readFile,
    writeFile,
    runScopedTests,
    listDir,
    now,
    deadline,
  );
  if (result) return result;

  return {
    kind: "pass",
    runBase: input.runBase,
    inspectedPaths: changedPaths,
    candidateCount: inspected,
    acceptedSites,
  };
}
