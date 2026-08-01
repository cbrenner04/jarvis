import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { classifyChangedPaths } from "../../../scripts/ci-test-scope.ts";
import { parseSpec } from "../../../shared/spec-parser.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import { truncateLogText } from "../persistence/log-stream.ts";
import { applyMutation, type Candidate, deriveFromLine } from "./diff-derived-mutation-verifier.ts";

/** Scoped-test wall clock for mutation-checkpoint verification; aligned with diff-derived bounds. */
export const MUTATION_CHECKPOINT_SCOPED_TEST_TIMEOUT_MS = 5 * 60_000;

const CHECKPOINT_MARKER = "Mutation checkpoint:";

export type HollowCheckpoint = {
  path: string;
  line: number;
  comment: string;
};

export type UnparseableCheckpoint = {
  path: string;
  line: number;
  comment: string;
  reason: string;
};

export type MutationCheckpointVerificationResult = { ok: true } | { ok: false; hollow: HollowCheckpoint[] };

export type MutationCheckpointReportSink = {
  reportUnparseable: (entry: UnparseableCheckpoint) => void;
};

export type MutationCheckpointVerifierSeams = {
  runScopedTests?: (cwd: string, scope: string[]) => Promise<boolean>;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
  reportSink?: MutationCheckpointReportSink;
};

type CheckpointComment = {
  file: string;
  line: number;
  comment: string;
};

type ProductionCheckpoint = CheckpointComment & {
  relPath: string;
};

type PinBlock = {
  title: string;
  startLine: number;
  content: string;
};

function defaultReadFile(path: string): Promise<string> {
  return Promise.resolve(readFileSync(path, "utf8"));
}

function defaultWriteFile(path: string, content: string): Promise<void> {
  writeFileSync(path, content, "utf8");
  return Promise.resolve();
}

function isTestFile(path: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(path);
}

function isCodeFile(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path);
}

function walkCodeFiles(root: string, dir = root): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkCodeFiles(root, full));
    } else if (isCodeFile(entry)) {
      files.push(full);
    }
  }
  return files;
}

function extractFirstBacktickBasename(text: string): string | undefined {
  const match = text.match(/`([^`]+)`/);
  if (!match?.[1]) return undefined;
  const segment = match[1].trim();
  return basename(segment);
}

function resolveByBasename(worktreeRoot: string, basenameName: string): string[] {
  return walkCodeFiles(worktreeRoot).filter((path) => basename(path) === basenameName);
}

function extractCheckpointComments(content: string, filePath: string): CheckpointComment[] {
  const lines = content.split("\n");
  const comments: CheckpointComment[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const idx = line.indexOf(CHECKPOINT_MARKER);
    if (idx < 0) continue;
    const comment = line.slice(idx + CHECKPOINT_MARKER.length).trim();
    comments.push({ file: filePath, line: i + 1, comment });
  }
  return comments;
}

function parsePinBlocks(content: string): PinBlock[] {
  const lines = content.split("\n");
  const blocks: PinBlock[] = [];
  const pinPattern = /^\s*(?:test|it)\s*\(\s*["'`]([^"'`]+)["'`]/;

  for (let i = 0; i < lines.length; i++) {
    const match = (lines[i] ?? "").match(pinPattern);
    if (!match?.[1]) continue;
    const title = match[1];
    let depth = 0;
    let started = false;
    let endLine = i + 1;
    for (let j = i; j < lines.length; j++) {
      const line = lines[j] ?? "";
      for (const char of line) {
        if (char === "{") {
          depth += 1;
          started = true;
        } else if (char === "}") {
          depth -= 1;
        }
      }
      endLine = j + 1;
      if (started && depth === 0) break;
    }
    blocks.push({
      title,
      startLine: i + 1,
      content: lines.slice(i, endLine).join("\n"),
    });
    i = endLine - 1;
  }
  return blocks;
}

function tokenizeCheckpointComment(comment: string): string[] {
  const tokens = new Set<string>();
  for (const match of comment.matchAll(/`([^`]+)`/g)) {
    const value = match[1]?.trim();
    if (value) tokens.add(value);
  }
  for (const match of comment.matchAll(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g)) {
    const value = match[0];
    if (
      value.length > 2 &&
      !["must", "turn", "this", "pin", "RED", "the", "and", "for", "when", "with"].includes(value)
    ) {
      tokens.add(value);
    }
  }
  return [...tokens];
}

function scoreCheckpointMatch(testComment: string, candidateComment: string): number {
  const testTokens = tokenizeCheckpointComment(testComment);
  if (testTokens.length === 0) return 0;
  const candidateLower = candidateComment.toLowerCase();
  let score = 0;
  for (const token of testTokens) {
    if (candidateLower.includes(token.toLowerCase())) score += 1;
  }
  return score;
}

function findProductionCheckpoint(worktreeRoot: string, testComment: string): ProductionCheckpoint | undefined {
  const candidates: ProductionCheckpoint[] = [];
  for (const file of walkCodeFiles(worktreeRoot)) {
    if (isTestFile(file)) continue;
    const relPath = relative(worktreeRoot, file);
    const content = readFileSync(file, "utf8");
    for (const comment of extractCheckpointComments(content, file)) {
      candidates.push({ ...comment, relPath });
    }
  }
  let best: ProductionCheckpoint | undefined;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreCheckpointMatch(testComment, candidate.comment);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= 2 ? best : undefined;
}

function findCodeSiteFromTestComment(worktreeRoot: string, testComment: string): ProductionCheckpoint | undefined {
  const dropMatch = testComment.match(/dropping\s+`?([a-zA-Z_][a-zA-Z0-9_]*)/i);
  const fileMatch = testComment.match(/\bin\s+([a-zA-Z0-9_.-]+\.tsx?)\b/i);
  const searchTarget =
    dropMatch?.[1] ??
    (/withMeasuredTerminal|terminalColumns|terminalRows/i.test(testComment) ? "withMeasuredTerminal" : undefined) ??
    (/selection-driven list collapse/i.test(testComment) ? "selectPreviousRun" : undefined);
  if (!searchTarget) return undefined;

  const basename = fileMatch?.[1] ?? "tui-entry.tsx";
  const files = resolveByBasename(worktreeRoot, basename);
  if (files.length !== 1) return undefined;
  const file = files[0]!;
  const lines = readFileSync(file, "utf8").split("\n");
  if (searchTarget === "selectPreviousRun") {
    let inBody = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.includes("selectPreviousRun()")) inBody = true;
      if (!inBody) continue;
      if (/^\s*if\s*\(/.test(line)) {
        return {
          file,
          line: i + 1,
          comment: testComment,
          relPath: relative(worktreeRoot, file),
        };
      }
    }
    return undefined;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.includes(searchTarget)) continue;
    if (searchTarget === "withMeasuredTerminal" && !line.includes("=")) continue;
    return {
      file,
      line: i + 1,
      comment: testComment,
      relPath: relative(worktreeRoot, file),
    };
  }
  return undefined;
}

function guardLineAfterComment(lines: string[], commentLine: number): { lineNum: number; content: string } | undefined {
  for (let i = commentLine; i < Math.min(lines.length, commentLine + 6); i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    return { lineNum: i + 1, content: line };
  }
  return undefined;
}

function pickCandidate(comment: string, candidates: Candidate[]): Candidate | undefined {
  if (candidates.length === 0) return undefined;
  const negatingMatch = comment.match(/negating\s+`([^`]+)`/i);
  if (negatingMatch?.[1]) {
    const target = negatingMatch[1];
    const match = candidates.find((c) => c.originalText.includes(target) || c.mutation.includes(target));
    if (match) return match;
  }
  const returnFlip = comment.match(/return\s+(\w+)\s*→\s*return\s+(\w+)/i);
  if (returnFlip?.[1] && returnFlip[2]) {
    const from = returnFlip[1];
    const to = returnFlip[2];
    const match = candidates.find((c) => c.originalText.includes(from) && c.mutatedText.includes(to));
    if (match) return match;
  }
  return candidates[0];
}

function skipGuardMutation(file: string, lineNum: number, line: string): Candidate | undefined {
  const ifMatch = line.match(/^(\s*)if\s*\((.*)\)(\s*.*)$/);
  if (!ifMatch) return undefined;
  const indent = ifMatch[1] ?? "";
  const condition = ifMatch[2] ?? "";
  const rest = ifMatch[3] ?? "";
  const mutated = `${indent}if (false /* MUTATED */ && (${condition}))${rest}`;
  return {
    file,
    line: lineNum,
    columnStart: 0,
    columnEnd: line.length,
    originalText: line,
    mutatedText: mutated,
    mutation: `skip-guard: ${line.trimStart()}`,
  };
}

export async function defaultRunScopedTestsForMutationCheckpoints(
  cwd: string,
  scope: string[],
  timeoutMs: number = MUTATION_CHECKPOINT_SCOPED_TEST_TIMEOUT_MS,
): Promise<boolean> {
  if (scope.length === 0) return true;
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    for (const script of scope) {
      await realAsyncSubprocessRunner.runAsync("bun", ["run", script], cwd, {
        timeoutMs,
      });
    }
    return true;
  } catch {
    return false;
  }
}

export function createLogSinkMutationCheckpointReportSink(
  logSink: LogSink,
  runId: string,
  attemptId: string,
): MutationCheckpointReportSink {
  return {
    reportUnparseable: (entry) => {
      logSink.append(runId, {
        kind: "mutation_checkpoint_unparseable",
        attemptId,
        path: entry.path,
        line: entry.line,
        comment: truncateLogText(entry.comment),
        reason: entry.reason,
      });
    },
  };
}

function dropCallMutation(file: string, lineNum: number, line: string, target: string): Candidate | undefined {
  const callMatch = line.match(new RegExp(`${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\([^)]*\\)`));
  if (!callMatch || callMatch.index === undefined) return undefined;
  const start = callMatch.index;
  const original = callMatch[0];
  const inner = original.slice(target.length + 1, -1);
  return {
    file,
    line: lineNum,
    columnStart: start,
    columnEnd: start + original.length,
    originalText: original,
    mutatedText: inner.trim(),
    mutation: `drop-call: ${original}`,
  };
}

function replacingAssignmentMutation(
  file: string,
  lineNum: number,
  line: string,
  from: string,
  to: string,
): Candidate | undefined {
  const pattern = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const match = line.match(pattern);
  if (!match || match.index === undefined) return undefined;
  const start = match.index;
  const original = match[0];
  return {
    file,
    line: lineNum,
    columnStart: start,
    columnEnd: start + original.length,
    originalText: original,
    mutatedText: to,
    mutation: `replace: ${original} → ${to}`,
  };
}

function resolveInversion(
  production: ProductionCheckpoint,
  testComment: string,
  fileContent: string,
): Candidate | undefined {
  const lines = fileContent.split("\n");
  const comment = `${production.comment} ${testComment}`;
  const lineAtSite = lines[production.line - 1];
  const guardLine =
    lineAtSite !== undefined && !lineAtSite.trim().startsWith("//")
      ? { lineNum: production.line, content: lineAtSite }
      : guardLineAfterComment(lines, production.line);
  if (!guardLine) return undefined;

  if (/skipping|short-circuiting/i.test(comment)) {
    return skipGuardMutation(production.relPath, guardLine.lineNum, guardLine.content);
  }

  const dropMatch = comment.match(/dropping\s+`?([a-zA-Z_][a-zA-Z0-9_.]*)/i);
  if (
    dropMatch?.[1] ||
    /withMeasuredTerminal|withLeftPaneTreeScrollFollow|terminalColumns|terminalRows/i.test(comment)
  ) {
    const target =
      dropMatch?.[1] ??
      (/withMeasuredTerminal|terminalColumns|terminalRows/i.test(comment)
        ? "withMeasuredTerminal"
        : "withLeftPaneTreeScrollFollow");
    const dropped = dropCallMutation(production.relPath, guardLine.lineNum, guardLine.content, target);
    if (dropped) return dropped;
  }

  const replaceMatch = comment.match(/replacing\s+`([^`]+)`\s+with\s+([a-zA-Z_][a-zA-Z0-9_.]*)/i);
  if (replaceMatch?.[1] && replaceMatch[2]) {
    return replacingAssignmentMutation(
      production.relPath,
      guardLine.lineNum,
      guardLine.content,
      replaceMatch[1],
      replaceMatch[2],
    );
  }

  const candidates = deriveFromLine(production.relPath, guardLine.lineNum, guardLine.content);
  return pickCandidate(comment, candidates);
}

function scopeTestsForChangedPaths(changedPaths: string[]): string[] {
  const scope = classifyChangedPaths(changedPaths);
  return scope === "full" ? ["test"] : scope.length === 0 ? ["test"] : scope;
}

export function formatMutationCheckpointFailureReason(
  result: MutationCheckpointVerificationResult,
): string | undefined {
  if (result.ok) return undefined;
  const lines = result.hollow.map((h) => `${h.path}:${h.line}: ${h.comment}`);
  return `Hollow mutation checkpoint(s):\n${lines.join("\n")}`;
}

export function getTickedMutationCheckpointCriteria(subspecContent: string): string[] {
  const parsed = parseSpec(subspecContent);
  return parsed.acceptanceCriteria
    .filter((c) => c.checked && !c.humanOnly && c.text.includes(CHECKPOINT_MARKER))
    .map((c) => c.text);
}

function reportUnparseable(reportSink: MutationCheckpointReportSink | undefined, entry: UnparseableCheckpoint): void {
  reportSink?.reportUnparseable(entry);
}

async function verifyCheckpointComment(
  worktreeRoot: string,
  testFile: string,
  testComment: CheckpointComment,
  seams: Required<Pick<MutationCheckpointVerifierSeams, "runScopedTests" | "readFile" | "writeFile">> & {
    reportSink?: MutationCheckpointReportSink;
  },
): Promise<{ hollow?: HollowCheckpoint }> {
  const production =
    findProductionCheckpoint(worktreeRoot, testComment.comment) ??
    findCodeSiteFromTestComment(worktreeRoot, testComment.comment);
  if (!production) {
    reportUnparseable(seams.reportSink, {
      path: relative(worktreeRoot, testFile),
      line: testComment.line,
      comment: testComment.comment,
      reason: "no matching production checkpoint",
    });
    return {};
  }

  const filePath = production.file;
  let originalContent: string;
  try {
    originalContent = await seams.readFile(filePath);
  } catch {
    reportUnparseable(seams.reportSink, {
      path: relative(worktreeRoot, testFile),
      line: testComment.line,
      comment: testComment.comment,
      reason: "production file unreadable",
    });
    return {};
  }

  const candidate = resolveInversion(production, testComment.comment, originalContent);
  if (!candidate) {
    reportUnparseable(seams.reportSink, {
      path: relative(worktreeRoot, testFile),
      line: testComment.line,
      comment: testComment.comment,
      reason: "cannot mechanically apply inversion",
    });
    return {};
  }

  const relProduction = production.relPath;
  const scopeTests = scopeTestsForChangedPaths([relProduction]);

  try {
    const mutated = applyMutation(originalContent, candidate);
    await seams.writeFile(filePath, mutated);
    try {
      const testsPassed = await seams.runScopedTests(worktreeRoot, scopeTests);
      if (testsPassed) {
        return {
          hollow: {
            path: relative(worktreeRoot, testFile),
            line: testComment.line,
            comment: testComment.comment,
          },
        };
      }
    } finally {
      await seams.writeFile(filePath, originalContent);
    }
  } catch {
    try {
      await seams.writeFile(filePath, originalContent);
    } catch {
      // ignore restore errors
    }
    const entry: UnparseableCheckpoint = {
      path: relative(worktreeRoot, testFile),
      line: testComment.line,
      comment: testComment.comment,
      reason: "inversion application failed",
    };
    reportUnparseable(seams.reportSink, entry);
    return {};
  }

  return {};
}

export async function verifyTickedMutationCheckpoints(
  worktreeRoot: string,
  subspecContent: string,
  seams?: MutationCheckpointVerifierSeams,
): Promise<MutationCheckpointVerificationResult> {
  const runScopedTests = seams?.runScopedTests ?? defaultRunScopedTestsForMutationCheckpoints;
  const readFile = seams?.readFile ?? defaultReadFile;
  const writeFile = seams?.writeFile ?? defaultWriteFile;
  const reportSink = seams?.reportSink;

  const criteria = getTickedMutationCheckpointCriteria(subspecContent);
  if (criteria.length === 0) return { ok: true };

  const hollow: HollowCheckpoint[] = [];
  const seamBundle = {
    runScopedTests,
    readFile,
    writeFile,
    ...(reportSink !== undefined ? { reportSink } : {}),
  };

  for (const criterionText of criteria) {
    const testBasename = extractFirstBacktickBasename(criterionText);
    if (!testBasename) {
      reportUnparseable(reportSink, {
        path: "(criterion)",
        line: 0,
        comment: criterionText,
        reason: "missing pinning test path",
      });
      continue;
    }

    const matches = resolveByBasename(worktreeRoot, testBasename);
    if (matches.length !== 1) {
      reportUnparseable(reportSink, {
        path: testBasename,
        line: 0,
        comment: criterionText,
        reason: matches.length === 0 ? "pinning test file not found" : "ambiguous pinning test file",
      });
      continue;
    }

    const testFile = matches[0]!;
    const testContent = readFileSync(testFile, "utf8");
    const pins = parsePinBlocks(testContent).filter((pin) => criterionText.includes(pin.title));
    if (pins.length === 0) {
      reportUnparseable(reportSink, {
        path: relative(worktreeRoot, testFile),
        line: 0,
        comment: criterionText,
        reason: "named pin not found in pinning test",
      });
      continue;
    }

    for (const pin of pins) {
      const comments = extractCheckpointComments(pin.content, testFile);
      if (comments.length === 0) {
        reportUnparseable(reportSink, {
          path: relative(worktreeRoot, testFile),
          line: pin.startLine,
          comment: criterionText,
          reason: "no Mutation checkpoint comment on named pin",
        });
        continue;
      }

      for (const comment of comments) {
        const result = await verifyCheckpointComment(worktreeRoot, testFile, comment, seamBundle);
        if (result.hollow) hollow.push(result.hollow);
      }
    }
  }

  if (hollow.length > 0) return { ok: false, hollow };
  return { ok: true };
}
