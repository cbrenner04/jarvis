import { type Dirent, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { classifyChangedPaths } from "../../../scripts/ci-test-scope.ts";
import { parseSpec } from "../../../shared/spec-parser.ts";

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
  reason: "malformed" | "unresolvable_path" | "target_absent" | "target_ambiguous" | "unresolved_pinning_test";
};

export type HollowCheckpoint = {
  criterionText: string;
  /** Absent when the criterion linked no directive at all. */
  directive: MutateDirective | undefined;
  detail: string;
};

export type MutationCheckpointReport = {
  hollow: HollowCheckpoint[];
  unparseable: UnparseableDirective[];
  caught: MutateDirective[];
};

export type MutationCheckpointSeams = {
  /** Resolves to true when the scoped suites pass. */
  runScopedTests?: (cwd: string, scope: string[]) => Promise<boolean>;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
  /** Operator-visible sink for unparseable directives. */
  report?: (message: string) => void;
};

/**
 * Matches `@mutate <path> "<original>" -> "<replacement>"`.
 * Quoted segments accept escaped quotes so a directive can target source
 * containing a double quote.
 */
const DIRECTIVE_PATTERN = /@mutate\s+(\S+)\s+"((?:[^"\\]|\\.)*)"\s*->\s*"((?:[^"\\]|\\.)*)"/;
const DIRECTIVE_MARKER = "@mutate";
const PIN_TITLE_PATTERN = /^\s*(?:test|it)(?:\.\w+)?\s*\(\s*(["'`])((?:[^\\]|\\.)*?)\1/;
const CRITERION_MARKER = "Mutation checkpoint:";
const DIRECTIVE_FORM = '// @mutate <path> "<original>" -> "<replacement>"';

function unescapeDirectiveText(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

/** Occurrences of `needle` in `haystack`, counted without regex escaping concerns. */
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

/** Title of the nearest enclosing `test`/`it` block above `lineIndex`, when present. */
function enclosingPinTitle(lines: readonly string[], lineIndex: number): string | undefined {
  for (let i = lineIndex; i >= 0; i -= 1) {
    const match = PIN_TITLE_PATTERN.exec(lines[i] ?? "");
    if (match?.[2] !== undefined) return unescapeDirectiveText(match[2]);
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
    if (!line.includes(DIRECTIVE_MARKER)) continue;
    const raw = line.trim();
    const match = DIRECTIVE_PATTERN.exec(line);
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
      ...(pinTitle !== undefined ? { pinTitle } : { pinTitle: undefined }),
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
export function pinningTestBasenameFromCriterion(criterionText: string): string | undefined {
  const matches = criterionText.matchAll(/`([^`]+)`/g);
  for (const match of matches) {
    const candidate = match[1];
    if (candidate === undefined) continue;
    const name = basename(candidate);
    if (isTestFileName(name)) return name;
  }
  return undefined;
}

/** Directives whose enclosing pin the criterion names; all of them when it names none. */
function linkDirectivesToCriterion(criterionText: string, directives: readonly MutateDirective[]): MutateDirective[] {
  const titled = directives.filter(
    (directive) => directive.pinTitle !== undefined && criterionText.includes(directive.pinTitle),
  );
  return titled.length > 0 ? titled : [...directives];
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
function scopeForTarget(worktreeRoot: string, absolutePath: string): string[] {
  const relPath = relative(worktreeRoot, absolutePath).replace(/\\/g, "/");
  const scope = classifyChangedPaths([relPath]);
  // "full" names the aggregate script; an empty scope would short-circuit the
  // runner to an unconditional pass and silently disable verification.
  return scope === "full" ? ["test"] : scope;
}

export function describeUnparseable(directive: UnparseableDirective): string {
  return `${directive.sourceFile}:${directive.sourceLine}: ${directive.reason}: ${directive.raw}`;
}

export function describeHollow(checkpoint: HollowCheckpoint): string {
  if (checkpoint.directive === undefined) return checkpoint.detail;
  const { sourceFile, sourceLine, raw } = checkpoint.directive;
  return `${sourceFile}:${sourceLine}: ${raw} — ${checkpoint.detail}`;
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
  const runScopedTests = seams.runScopedTests ?? defaultRunScopedTests;
  const report = seams.report ?? (() => {});

  const empty: MutationCheckpointReport = { hollow: [], unparseable: [], caught: [] };
  if (!existsSync(subspecPath)) return empty;

  const criteria = parseSpec(readFile(subspecPath)).acceptanceCriteria.filter(
    (criterion) => criterion.checked && !criterion.humanOnly && criterion.text.includes(CRITERION_MARKER),
  );
  if (criteria.length === 0) return empty;

  const report_: MutationCheckpointReport = { hollow: [], unparseable: [], caught: [] };
  const parsedFiles = new Map<string, { directives: MutateDirective[]; unparseable: UnparseableDirective[] }>();

  for (const criterion of criteria) {
    const linked = resolveLinkedDirectives(worktreeRoot, subspecPath, criterion.text, parsedFiles, readFile, report_);
    if (linked === undefined) continue;

    for (const directive of linked) {
      await applyAndClassify(worktreeRoot, criterion.text, directive, { readFile, writeFile, runScopedTests }, report_);
    }
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
  criterionText: string,
  parsedFiles: Map<string, { directives: MutateDirective[]; unparseable: UnparseableDirective[] }>,
  readFile: (path: string) => string,
  report_: MutationCheckpointReport,
): MutateDirective[] | undefined {
  const unresolved: UnparseableDirective = {
    sourceFile: subspecPath,
    sourceLine: 0,
    raw: criterionText,
    reason: "unresolved_pinning_test",
  };

  const testBasename = pinningTestBasenameFromCriterion(criterionText);
  if (testBasename === undefined) {
    report_.unparseable.push(unresolved);
    return undefined;
  }

  const matches = findByBasename(worktreeRoot, testBasename);
  const testPath = matches.length === 1 ? matches[0] : undefined;
  if (testPath === undefined) {
    report_.unparseable.push(unresolved);
    return undefined;
  }

  let parsed = parsedFiles.get(testPath);
  if (parsed === undefined) {
    parsed = parseMutateDirectives(testPath, readFile(testPath));
    parsedFiles.set(testPath, parsed);
    report_.unparseable.push(...parsed.unparseable);
  }

  const linked = linkDirectivesToCriterion(criterionText, parsed.directives);
  if (linked.length === 0) {
    // The loophole this contract closes: a prose comment is not evidence.
    report_.hollow.push({
      criterionText,
      directive: undefined,
      detail: `no ${DIRECTIVE_MARKER} directive linked to this criterion; add ${DIRECTIVE_FORM} on the named pin`,
    });
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
    runScopedTests: (cwd: string, scope: string[]) => Promise<boolean>;
  },
  report_: MutationCheckpointReport,
): Promise<void> {
  const resolved = resolveTarget(worktreeRoot, directive, io.readFile);
  if (!resolved.ok) {
    report_.unparseable.push(resolved.unparseable);
    return;
  }

  const mutated = resolved.content.replace(directive.originalText, directive.replacementText);
  let survived: boolean;
  try {
    io.writeFile(resolved.absolutePath, mutated);
    survived = await io.runScopedTests(worktreeRoot, scopeForTarget(worktreeRoot, resolved.absolutePath));
  } finally {
    io.writeFile(resolved.absolutePath, resolved.content);
  }

  if (survived) {
    report_.hollow.push({ criterionText, directive, detail: "scoped suite stayed green under this mutation" });
  } else {
    report_.caught.push(directive);
  }
}

async function defaultRunScopedTests(cwd: string, scope: string[]): Promise<boolean> {
  if (scope.length === 0) return true;
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    for (const script of scope) {
      await realAsyncSubprocessRunner.runAsync("bun", ["run", script], cwd);
    }
    return true;
  } catch {
    return false;
  }
}
