import { type Dirent, existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { classifyChangedPaths } from "../../../scripts/ci-test-scope.ts";
import {
  DIRECTIVE_PATTERN,
  selectKeystoneCheckpointCriteria,
  selectMutationCheckpointCriteria,
} from "../../../shared/mutation-checkpoint-criteria.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";

export { DIRECTIVE_PATTERN } from "../../../shared/mutation-checkpoint-criteria.ts";

/**
 * A checkpoint the harness can apply without inference.
 *
 * Authored as a single-line comment in the pinning test file:
 *
 *   // @mutate v2/src/foo.ts "originalText" -> "replacementText"
 *
 * The target is located by exact source text, not by line number, so an
 * unrelated edit above it cannot silently retarget the mutation.
 */
export type MutateDirective = {
  /** Path of the test file the directive was authored in. */
  sourceFile: string;
  /** 1-indexed line of the directive comment within `sourceFile`. */
  sourceLine: number;
  /** Repo-relative path of the production file to mutate. */
  targetPath: string;
  /** Exact text to replace; must occur exactly once in the target. */
  originalText: string;
  /** Text to substitute in. */
  replacementText: string;
  /** Title of the enclosing `test`/`it` block, when one encloses the directive. */
  pinTitle: string | undefined;
  /** Verbatim directive text, for operator-facing diagnostics. */
  raw: string;
};

export type UnparseableDirective = {
  sourceFile: string;
  sourceLine: number;
  raw: string;
  reason:
    | "malformed"
    | "unresolvable_path"
    | "target_absent"
    | "target_ambiguous"
    | "unresolved_pinning_test"
    | "ambiguous_pinning_basename";
  /** Present for pinning-resolution failures: the criterion that named the pinning test. */
  criterionText?: string;
  /** Present for pinning-resolution failures: the backticked pinning reference from the criterion. */
  rawReference?: string;
  /** Present for `ambiguous_pinning_basename`: every repo-relative path that matched the bare basename. */
  candidates?: string[];
};

export type CriterionCheckpoint = {
  criterionText: string;
  kind: "guard" | "keystone";
  reason: "unlinked" | "hollow";
  /** Absent when the criterion linked no directive at all. */
  directive: MutateDirective | undefined;
  detail: string;
  /** Resolved repo-relative pin path. */
  pinPath: string;
};

export type MutationCheckpointReport = {
  hollow: CriterionCheckpoint[];
  inertHeadline: CriterionCheckpoint[];
  keystoneUnlinked: CriterionCheckpoint[];
  unparseable: UnparseableDirective[];
  caught: MutateDirective[];
  /** Directives applied during this verify run and not confirmed restored. */
  unrestored: MutateDirective[];
  /** Pinning test files opened while verifying selected criteria. */
  openedPinningFiles: string[];
};

const UNRESTORED_DIRECTIVES_FILENAME = "jarvis-mutation-unrestored.json";

const EMPTY_MUTATION_CHECKPOINT_REPORT: MutationCheckpointReport = {
  hollow: [],
  inertHeadline: [],
  keystoneUnlinked: [],
  unparseable: [],
  caught: [],
  unrestored: [],
  openedPinningFiles: [],
};

export type ScopedTestRunContext = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type MutationCheckpointSeams = {
  /** Resolves to true when the scoped suites pass. */
  runScopedTests?: (cwd: string, scope: string[], context?: ScopedTestRunContext) => Promise<boolean>;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
  /** Operator-visible sink for unparseable directives. */
  report?: (message: string) => void;
  /** Cooperative cancellation from the write iteration. */
  signal?: AbortSignal;
  /** Remaining write-iteration wall budget in milliseconds. */
  remainingIterationWallMs?: () => number;
  /** Test seam for scoped `bun` subprocess execution. */
  asyncSubprocessRunner?: AsyncSubprocessRunner;
  /** Repo-relative paths from `git diff --name-only <baseRef>`; basename disambiguation when multiple matches. */
  changedPaths?: readonly string[];
};

const COMMENT_DIRECTIVE_LINE = /^\s*\/\/\s*@mutate(?=\s|$)/;
/** Anchors directive-body parsing to the directive-position `@mutate` token, so a malformed body is never rescued by a later well-formed-looking occurrence on the same line. */
const DIRECTIVE_LINE_PATTERN = new RegExp(`^\\s*\\/\\/\\s*${DIRECTIVE_PATTERN.source}`);
const DIRECTIVE_MARKER = "@mutate";
const PIN_TITLE_PATTERN = /^\s*(?:test|it)(?:\.\w+)?\s*\(\s*(["'`])((?:[^\\]|\\.)*?)\1/;
const TEST_EACH_OPENER_PATTERN = /^\s*test\.each\s*\(/;
const CONTINUATION_TITLE_PATTERN = /^\s*\]\)\s*\(\s*(["'`])((?:[^\\]|\\.)*?)\1/;
const EXTENSION_TOLERANT_TEST_SUFFIXES = [".test.ts", ".test.tsx", ".test.js", ".test.jsx"] as const;
const DIRECTIVE_FORM = '// @mutate <path> "<original>" -> "<replacement>"';

function unescapeDirectiveText(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("mutation-checkpoint verification aborted");
}

function restoreSnapshots(
  snapshots: ReadonlyMap<string, string>,
  writeFile: (path: string, content: string) => void,
): void {
  for (const [path, content] of snapshots) writeFile(path, content);
}

/** Occurrences of `needle` in `haystack`, counted without regex escaping concerns. */
function directiveKey(directive: MutateDirective): string {
  return `${directive.sourceFile}:${directive.sourceLine}:${directive.targetPath}`;
}

/** Replacement present without original — stranded mutation content in staged or committed blobs. */
export function isStrandedMutationContent(
  content: string,
  directive: Pick<MutateDirective, "originalText" | "replacementText">,
): boolean {
  return (
    directive.replacementText.length > 0 &&
    content.includes(directive.replacementText) &&
    !content.includes(directive.originalText)
  );
}

export function describeStrandedMutation(directive: MutateDirective): string {
  return `${directive.targetPath}: stranded mutation ${directive.sourceFile}:${directive.sourceLine}: ${directive.raw}`;
}

function resolveGitDirSync(worktreePath: string): string | undefined {
  const dotGit = join(worktreePath, ".git");
  if (!existsSync(dotGit)) return undefined;
  if (statSync(dotGit).isDirectory()) return dotGit;
  const content = readFileSync(dotGit, "utf8").trim();
  const match = /^gitdir:\s*(.+)$/m.exec(content);
  if (match?.[1] === undefined) return undefined;
  const gitdir = match[1].trim();
  return isAbsolute(gitdir) ? gitdir : resolve(worktreePath, gitdir);
}

function unrestoredDirectivesStatePath(worktreePath: string): string | undefined {
  const gitDir = resolveGitDirSync(worktreePath);
  return gitDir === undefined ? undefined : join(gitDir, UNRESTORED_DIRECTIVES_FILENAME);
}

export function persistUnrestoredDirectives(worktreePath: string, unrestored: readonly MutateDirective[]): void {
  const statePath = unrestoredDirectivesStatePath(worktreePath);
  if (statePath === undefined) return;
  if (unrestored.length === 0) {
    try {
      unlinkSync(statePath);
    } catch {
      /* no prior state */
    }
    return;
  }
  writeFileSync(statePath, `${JSON.stringify({ unrestored })}\n`, "utf8");
}

export function loadUnrestoredDirectives(worktreePath: string): MutateDirective[] {
  const statePath = unrestoredDirectivesStatePath(worktreePath);
  if (statePath === undefined || !existsSync(statePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as { unrestored?: MutateDirective[] };
    return parsed.unrestored ?? [];
  } catch {
    return [];
  }
}

export function clearUnrestoredDirectives(worktreePath: string): void {
  persistUnrestoredDirectives(worktreePath, []);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Nearest enclosing pin title above `lineIndex`: adjacent-line forward `test`/`it`, backward `test`/`it`, or opener-anchored `test.each` continuation. */
function enclosingPinTitle(lines: readonly string[], lineIndex: number): string | undefined {
  const forwardMatch = PIN_TITLE_PATTERN.exec(lines[lineIndex + 1] ?? "");
  if (forwardMatch?.[2] !== undefined) return unescapeDirectiveText(forwardMatch[2]);
  for (let i = lineIndex; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    const match = PIN_TITLE_PATTERN.exec(line);
    if (match?.[2] !== undefined) return unescapeDirectiveText(match[2]);
    if (TEST_EACH_OPENER_PATTERN.test(line)) {
      for (let j = i + 1; j <= lineIndex; j += 1) {
        const continuationMatch = CONTINUATION_TITLE_PATTERN.exec(lines[j] ?? "");
        if (continuationMatch?.[2] !== undefined) return unescapeDirectiveText(continuationMatch[2]);
      }
    }
  }
  return undefined;
}

/**
 * Parse every `@mutate` directive in one test file. Syntax is validated here;
 * whether the target resolves is checked against the worktree separately.
 */
export function parseMutateDirectives(
  testFilePath: string,
  content: string,
): { directives: MutateDirective[]; unparseable: UnparseableDirective[] } {
  const directives: MutateDirective[] = [];
  const unparseable: UnparseableDirective[] = [];
  const lines = content.split("\n");

  for (const [index, line] of lines.entries()) {
    if (!COMMENT_DIRECTIVE_LINE.test(line)) continue;
    const raw = line.trim();
    const match = DIRECTIVE_LINE_PATTERN.exec(line);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
      unparseable.push({ sourceFile: testFilePath, sourceLine: index + 1, raw, reason: "malformed" });
      continue;
    }
    const pinTitle = enclosingPinTitle(lines, index);
    directives.push({
      sourceFile: testFilePath,
      sourceLine: index + 1,
      targetPath: match[1],
      originalText: unescapeDirectiveText(match[2]),
      replacementText: unescapeDirectiveText(match[3]),
      pinTitle,
      raw,
    });
  }

  return { directives, unparseable };
}

function isTestFileName(name: string): boolean {
  return name.includes(".test.");
}

/** Files under `root` whose basename matches `target`, skipping heavy directories. */
function findByBasename(root: string, target: string, found: string[] = [], dir = root): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "completed") continue;
      findByBasename(root, target, found, full);
      continue;
    }
    if (entry.name === target) found.push(full);
  }
  return found;
}

/** First backticked path-ish segment in criterion text, when one names a test file. */
export function pinningTestReferenceFromCriterion(criterionText: string): string | undefined {
  const matches = criterionText.matchAll(/`([^`]+)`/g);
  for (const match of matches) {
    const candidate = match[1];
    if (candidate === undefined) continue;
    const name = basename(candidate);
    if (isTestFileName(name)) return candidate;
  }
  return undefined;
}

function normalizeRepoRelativePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
}

type PinningTestResolution =
  | { ok: true; testPath: string }
  | {
      ok: false;
      rawReference: string;
      reason: "unresolved_pinning_test" | "ambiguous_pinning_basename";
      candidates?: string[];
    };

function parentDirectoryOfRepoRelativePath(path: string): string {
  const normalized = normalizeRepoRelativePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? "" : normalized.slice(0, slash);
}

function repoRelativePath(worktreeRoot: string, absolutePath: string): string {
  return normalizeRepoRelativePath(relative(worktreeRoot, absolutePath));
}

function filterMatchesByChangedPathParents(
  worktreeRoot: string,
  matches: readonly string[],
  changedPaths: readonly string[],
): string[] {
  if (changedPaths.length === 0) return [...matches];
  const changedParents = new Set(changedPaths.map(parentDirectoryOfRepoRelativePath));
  return matches.filter((absPath) =>
    changedParents.has(parentDirectoryOfRepoRelativePath(repoRelativePath(worktreeRoot, absPath))),
  );
}

/** Repo-relative changed paths from `git diff --name-only <baseRef> --` (untracked excluded). */
export async function repoRelativeChangedPathsFromBaseRef(
  worktreeRoot: string,
  baseRef: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string[]> {
  if (!existsSync(join(worktreeRoot, ".git"))) return [];
  try {
    const output = await runner.runAsync("git", ["diff", "--name-only", baseRef, "--"], worktreeRoot, {
      maxBuffer: 10 * 1024 * 1024,
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findBareBasenameMatches(worktreeRoot: string, basename: string): string[] {
  const primary = findByBasename(worktreeRoot, basename);
  if (primary.length !== 0) return primary;
  const stemMatch = /^(.+)\.test\.(ts|tsx|js|jsx)$/.exec(basename);
  if (stemMatch?.[1] === undefined) return primary;
  const matches = new Set<string>();
  for (const suffix of EXTENSION_TOLERANT_TEST_SUFFIXES) {
    for (const path of findByBasename(worktreeRoot, `${stemMatch[1]}${suffix}`)) matches.add(path);
  }
  return [...matches];
}

/** Resolve a criterion's pinning test by path-qualified or basename lookup. */
function resolvePinningTestPath(
  worktreeRoot: string,
  criterionText: string,
  changedPaths?: readonly string[],
): PinningTestResolution {
  const rawReference = pinningTestReferenceFromCriterion(criterionText);
  if (rawReference === undefined) {
    return { ok: false, rawReference: "", reason: "unresolved_pinning_test" };
  }

  const normalized = normalizeRepoRelativePath(rawReference);
  if (normalized.includes("/")) {
    const absolutePath = resolve(worktreeRoot, normalized);
    const relativeToRoot = relative(worktreeRoot, absolutePath);
    const escapesRoot = relativeToRoot.startsWith("..");
    if (escapesRoot || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      return { ok: false, rawReference, reason: "unresolved_pinning_test" };
    }
    return { ok: true, testPath: absolutePath };
  }

  const matches = findBareBasenameMatches(worktreeRoot, normalized);
  if (matches.length === 0) {
    return { ok: false, rawReference, reason: "unresolved_pinning_test" };
  }
  if (matches.length === 1) {
    return { ok: true, testPath: matches[0]! };
  }

  const candidates = matches.map((path) => repoRelativePath(worktreeRoot, path)).sort();
  const filtered = filterMatchesByChangedPathParents(worktreeRoot, matches, changedPaths ?? []);
  if (filtered.length === 1) {
    return { ok: true, testPath: filtered[0]! };
  }
  return { ok: false, rawReference, reason: "ambiguous_pinning_basename", candidates };
}

/** Directives whose enclosing pin the criterion names. */
function linkDirectivesToCriterion(criterionText: string, directives: readonly MutateDirective[]): MutateDirective[] {
  return directives.filter(
    (directive) => directive.pinTitle !== undefined && criterionText.includes(directive.pinTitle),
  );
}

function resolveTarget(
  worktreeRoot: string,
  directive: MutateDirective,
  readFile: (path: string) => string,
): { ok: true; absolutePath: string; content: string } | { ok: false; unparseable: UnparseableDirective } {
  const absolutePath = resolve(worktreeRoot, directive.targetPath);
  const relativeToRoot = relative(worktreeRoot, absolutePath);
  const escapesRoot = relativeToRoot.startsWith("..");
  if (escapesRoot || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    return {
      ok: false,
      unparseable: {
        sourceFile: directive.sourceFile,
        sourceLine: directive.sourceLine,
        raw: directive.raw,
        reason: "unresolvable_path",
      },
    };
  }
  const content = readFile(absolutePath);
  const occurrences = countOccurrences(content, directive.originalText);
  if (occurrences === 0 || occurrences > 1) {
    return {
      ok: false,
      unparseable: {
        sourceFile: directive.sourceFile,
        sourceLine: directive.sourceLine,
        raw: directive.raw,
        reason: occurrences === 0 ? "target_absent" : "target_ambiguous",
      },
    };
  }
  return { ok: true, absolutePath, content };
}

/** Scoped suites for one mutated file, matching the ready gate's classification. */
export function scopeForTarget(worktreeRoot: string, absolutePath: string): string[] {
  const relPath = relative(worktreeRoot, absolutePath).replace(/\\/g, "/");
  const scope = classifyChangedPaths([relPath]);
  // "full" names the aggregate script; an empty scope would short-circuit the
  // runner to an unconditional pass and silently disable verification.
  return scope === "full" ? ["test"] : scope;
}

export function blockingUnparseableEntries(report: MutationCheckpointReport): UnparseableDirective[] {
  return report.unparseable.filter(
    (entry) =>
      entry.reason === "unresolved_pinning_test" ||
      entry.reason === "ambiguous_pinning_basename" ||
      report.openedPinningFiles.includes(entry.sourceFile),
  );
}

export function describeUnparseable(directive: UnparseableDirective): string {
  if (
    (directive.reason === "unresolved_pinning_test" || directive.reason === "ambiguous_pinning_basename") &&
    directive.criterionText !== undefined
  ) {
    const reference = directive.rawReference ?? directive.raw;
    const base = `criterion: ${directive.criterionText}; reference: ${reference}; reason: ${directive.reason}`;
    if (directive.reason === "ambiguous_pinning_basename" && directive.candidates !== undefined) {
      return `${base}; candidates: ${directive.candidates.join(", ")}`;
    }
    return base;
  }
  return `${directive.sourceFile}:${directive.sourceLine}: ${directive.reason}: ${directive.raw}`;
}

export function describeCriterionCheckpoint(checkpoint: CriterionCheckpoint): string {
  const prefix = `criterion: ${checkpoint.criterionText}; kind: ${checkpoint.kind}; pin: ${checkpoint.pinPath}; reason: ${checkpoint.reason}`;
  if (checkpoint.directive === undefined) return `${prefix} — ${checkpoint.detail}`;
  const { sourceFile, sourceLine, raw } = checkpoint.directive;
  return `${prefix}; directive: ${sourceFile}:${sourceLine}: ${raw} — ${checkpoint.detail}`;
}

export const describeHollow = describeCriterionCheckpoint;
export const describeInertHeadline = describeCriterionCheckpoint;

function guardCheckpointReason(directive: MutateDirective | undefined): "unlinked" | "hollow" {
  return directive === undefined ? "unlinked" : "hollow";
}

/**
 * Verify every ticked, non-human-only criterion that claims a mutation turns a
 * pin red. A criterion is satisfied only when each linked directive, applied to
 * the real source, turns its scoped suite red.
 */
export async function verifyMutationCheckpoints(
  worktreeRoot: string,
  subspecPath: string,
  seams: MutationCheckpointSeams = {},
): Promise<MutationCheckpointReport> {
  const readFile = seams.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const writeFile = seams.writeFile ?? ((path: string, content: string) => writeFileSync(path, content, "utf8"));
  const runScopedTests =
    seams.runScopedTests ??
    ((cwd, scope, context) => defaultRunScopedTests(cwd, scope, context, seams.asyncSubprocessRunner));
  // Default to stderr, not a no-op: an unparseable directive means verification
  // silently did not happen, which is precisely the state that must not be quiet.
  const report = seams.report ?? ((message: string) => process.stderr.write(`mutation-checkpoint: ${message}\n`));
  const signal = seams.signal;
  const remainingIterationWallMs = seams.remainingIterationWallMs;
  const changedPaths = seams.changedPaths;
  const snapshots = new Map<string, string>();

  if (!existsSync(subspecPath)) return EMPTY_MUTATION_CHECKPOINT_REPORT;

  const subspec = readFile(subspecPath);
  const guardCriteria = selectMutationCheckpointCriteria(subspec, { requireChecked: true });
  const keystoneCriteria = selectKeystoneCheckpointCriteria(subspec, { requireChecked: true });
  if (guardCriteria.length === 0 && keystoneCriteria.length === 0) return EMPTY_MUTATION_CHECKPOINT_REPORT;

  const report_: MutationCheckpointReport = {
    hollow: [],
    inertHeadline: [],
    keystoneUnlinked: [],
    unparseable: [],
    caught: [],
    unrestored: [],
    openedPinningFiles: [],
  };
  const parsedFiles = new Map<string, { directives: MutateDirective[]; unparseable: UnparseableDirective[] }>();
  const unrestored = new Map<string, MutateDirective>();

  try {
    for (const [criteria, role] of [
      [guardCriteria, "guard"],
      [keystoneCriteria, "keystone"],
    ] as const) {
      for (const entry of criteria) {
        throwIfAborted(signal);
        const linked = resolveLinkedDirectives(
          worktreeRoot,
          subspecPath,
          entry.block,
          entry.firstLine,
          parsedFiles,
          readFile,
          report_,
          role,
          changedPaths,
        );
        if (linked === undefined) continue;

        for (const directive of linked) {
          throwIfAborted(signal);
          await applyAndClassify(
            worktreeRoot,
            entry.firstLine,
            directive,
            { readFile, writeFile, runScopedTests },
            report_,
            snapshots,
            unrestored,
            signal,
            remainingIterationWallMs,
            role,
            directive.sourceFile,
          );
        }
      }
    }
  } finally {
    report_.unrestored = [...unrestored.values()];
    persistUnrestoredDirectives(worktreeRoot, report_.unrestored);
  }

  for (const entry of report_.unparseable) report(describeUnparseable(entry));

  return report_;
}

/**
 * Directives linked to one criterion, or `undefined` when the criterion's pinning
 * test cannot be resolved. A resolvable pin with no directive is hollow, not skipped.
 */
function resolveLinkedDirectives(
  worktreeRoot: string,
  subspecPath: string,
  block: string,
  criterionText: string,
  parsedFiles: Map<string, { directives: MutateDirective[]; unparseable: UnparseableDirective[] }>,
  readFile: (path: string) => string,
  report_: MutationCheckpointReport,
  role: "guard" | "keystone",
  changedPaths: readonly string[] | undefined,
): MutateDirective[] | undefined {
  const resolved = resolvePinningTestPath(worktreeRoot, block, changedPaths);
  if (!resolved.ok) {
    report_.unparseable.push({
      sourceFile: subspecPath,
      sourceLine: 0,
      raw: criterionText,
      reason: resolved.reason,
      criterionText,
      rawReference: resolved.rawReference,
      ...(resolved.candidates !== undefined ? { candidates: resolved.candidates } : {}),
    });
    return undefined;
  }
  const testPath = resolved.testPath;
  const pinPath = repoRelativePath(worktreeRoot, testPath);

  if (!report_.openedPinningFiles.includes(pinPath)) {
    report_.openedPinningFiles.push(pinPath);
  }

  let parsed = parsedFiles.get(testPath);
  if (parsed === undefined) {
    parsed = parseMutateDirectives(pinPath, readFile(testPath));
    parsedFiles.set(testPath, parsed);
    report_.unparseable.push(...parsed.unparseable);
  }

  const linked = linkDirectivesToCriterion(block, parsed.directives);
  if (linked.length === 0) {
    // The loophole this contract closes: a prose comment is not evidence.
    const detail = `no ${DIRECTIVE_MARKER} directive linked to this criterion; add ${DIRECTIVE_FORM} on the named pin`;
    if (role === "keystone") {
      report_.keystoneUnlinked.push({
        criterionText,
        kind: "keystone",
        reason: "unlinked",
        directive: undefined,
        detail,
        pinPath,
      });
    } else {
      report_.hollow.push({
        criterionText,
        kind: "guard",
        reason: guardCheckpointReason(undefined),
        directive: undefined,
        detail,
        pinPath,
      });
    }
    return undefined;
  }
  return linked;
}

/** Apply one directive, run its scoped suites, and record caught vs hollow. */
async function applyAndClassify(
  worktreeRoot: string,
  criterionText: string,
  directive: MutateDirective,
  io: {
    readFile: (path: string) => string;
    writeFile: (path: string, content: string) => void;
    runScopedTests: (cwd: string, scope: string[], context?: ScopedTestRunContext) => Promise<boolean>;
  },
  report_: MutationCheckpointReport,
  snapshots: Map<string, string>,
  unrestored: Map<string, MutateDirective>,
  signal: AbortSignal | undefined,
  remainingIterationWallMs: (() => number) | undefined,
  role: "guard" | "keystone",
  pinPath: string,
): Promise<void> {
  const resolved = resolveTarget(worktreeRoot, directive, io.readFile);
  if (!resolved.ok) {
    report_.unparseable.push(resolved.unparseable);
    return;
  }

  unrestored.set(directiveKey(directive), directive);
  if (!snapshots.has(resolved.absolutePath)) snapshots.set(resolved.absolutePath, resolved.content);

  // Splice rather than String.replace: `$&`, `` $` ``, `$'` and `$<n>` in the
  // replacement would otherwise expand, so the applied edit would not be the
  // authored one. The occurrence count is already known to be exactly 1.
  const at = resolved.content.indexOf(directive.originalText);
  const mutated =
    resolved.content.slice(0, at) +
    directive.replacementText +
    resolved.content.slice(at + directive.originalText.length);
  const remaining = remainingIterationWallMs?.();
  const runContext: ScopedTestRunContext = {
    ...(signal !== undefined ? { signal } : {}),
    ...(remaining !== undefined ? { timeoutMs: Math.max(0, remaining) } : {}),
  };
  let settledAbnormally = false;
  let survived: boolean;
  try {
    io.writeFile(resolved.absolutePath, mutated);
    survived = await io.runScopedTests(worktreeRoot, scopeForTarget(worktreeRoot, resolved.absolutePath), runContext);
  } catch (error) {
    settledAbnormally = true;
    restoreSnapshots(snapshots, io.writeFile);
    throw error;
  } finally {
    if (!settledAbnormally) {
      io.writeFile(resolved.absolutePath, resolved.content);
      unrestored.delete(directiveKey(directive));
    }
  }

  if (survived) {
    if (role === "keystone") {
      report_.inertHeadline.push({
        criterionText,
        kind: "keystone",
        reason: "hollow",
        directive,
        detail: "scoped suite stayed green under headline revert",
        pinPath,
      });
    } else {
      report_.hollow.push({
        criterionText,
        kind: "guard",
        reason: guardCheckpointReason(directive),
        directive,
        detail: "scoped suite stayed green under this mutation",
        pinPath,
      });
    }
  } else {
    report_.caught.push(directive);
  }
}

/** True when a scoped subprocess exited non-zero; false for abort, timeout, or kill. */
export function isScopedTestSuiteFailure(error: unknown): boolean {
  return error instanceof AsyncSubprocessError && error.status !== undefined && error.status !== 0;
}

async function defaultRunScopedTests(
  cwd: string,
  scope: string[],
  context: ScopedTestRunContext | undefined,
  runnerOverride?: AsyncSubprocessRunner,
): Promise<boolean> {
  if (scope.length === 0) return true;
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  const runner = runnerOverride ?? realAsyncSubprocessRunner;
  const options = {
    ...(context?.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
    ...(context?.signal !== undefined ? { signal: context.signal } : {}),
  };
  try {
    for (const script of scope) {
      await runner.runAsync("bun", ["run", script], cwd, options);
    }
    return true;
  } catch (error) {
    if (isScopedTestSuiteFailure(error)) return false;
    throw error;
  }
}
