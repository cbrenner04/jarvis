import { join } from "node:path";
import { collectSourceFiles, type SourceFile } from "./production-files.ts";
import { isSandboxUnrunnable } from "./test-slice.ts";

export type LintCallViolation = { file: string; line: number; functionName: string };

/**
 * Escape hatch for a call site that never reaches the real spawn (e.g. an error branch that returns
 * before the lint step runs): `// guard-real-lint-in-unit-tests: <reason>` on the call's own line or
 * the line above.
 */
export const ALLOW_MARKER = "guard-real-lint-in-unit-tests:";

/** Where an entry point accepts its runner: an object-literal property key, or a positional argument index. */
type RunnerInjection = { property: string } | { position: number };

const RUNNER_PROPERTY: RunnerInjection = { property: "runner" };

/**
 * Real markdown-lint entry points: production functions whose optional runner dependency
 * defaults to a real `bun markdownlint-cli2` spawn (`shared/subprocess.ts#realAsyncSubprocessRunner`).
 * A unit-slice test file calling one of these without the entry point's specific injection
 * reaches the real binary instead of a stub.
 */
const LINT_ENTRY_POINTS: readonly { modulePattern: RegExp; functionName: string; injection: RunnerInjection }[] = [
  { modulePattern: /markdownlint-repair\.ts$/, functionName: "runMarkdownlintAutofix", injection: RUNNER_PROPERTY },
  { modulePattern: /staged-markdown-lint\.ts$/, functionName: "lintStagedMarkdown", injection: RUNNER_PROPERTY },
  { modulePattern: /intent-stage\.ts$/, functionName: "validateIntentStage", injection: { position: 4 } },
  { modulePattern: /intent-stage\.ts$/, functionName: "repairIntentStageContent", injection: { position: 3 } },
  { modulePattern: /intent-output\.ts$/, functionName: "landIntentWorkflowOutput", injection: RUNNER_PROPERTY },
  { modulePattern: /workflow-runner-resume\.ts$/, functionName: "recoverPlanStage", injection: RUNNER_PROPERTY },
  {
    modulePattern: /workflow-runner-resume\.ts$/,
    functionName: "resumePopulatedIntentPublication",
    injection: RUNNER_PROPERTY,
  },
  {
    modulePattern: /write-loop\.ts$/,
    functionName: "executeWriteLoop",
    injection: { property: "stagedMarkdownLintRunner" },
  },
];

/**
 * Files exempt from the call-site check. Entries without real-binary assertions were verified by a
 * spawn trap (default runners made to throw): the file never reaches the real binary. The guard
 * does not re-check them, so a new lint-reaching call in one of these files goes unflagged.
 */
const ALLOWLISTED_FILES = new Map<string, string>([
  ["shared/intent-stage.test.ts", "direct real-binary landing-repair (autofix) assertions"],
  ["v2/src/execution/staged-markdown-lint.test.ts", "direct real-binary violation/clean assertions"],
  ["v2/src/daemon/daemon-start-list.test.ts", "write-loop stages contain no .md files; never spawns (trap-verified)"],
  [
    "v2/src/execution/write-loop.test.ts",
    "runLoop helpers inject a clean stub runner; other executeWriteLoop calls stage no .md files (trap-verified)",
  ],
  [
    "v2/src/execution/write-loop-idle-watchdog.test.ts",
    "write-loop stages contain no .md files; never spawns (trap-verified)",
  ],
  [
    "v2/src/execution/write-loop-session-log.test.ts",
    "write-loop stages contain no .md files; never spawns (trap-verified)",
  ],
]);

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Text of the balanced call argument list starting at `openIndex` (the `(`). */
function callArguments(source: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  return source.slice(openIndex);
}

/** Local binding names a test file imports for `functionName` from a module matching `modulePattern`. */
function importedBindings(source: string, functionName: string, modulePattern: RegExp): Set<string> {
  const bindings = new Set<string>();
  for (const match of source.matchAll(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s+from\s*["']([^"']+)["']/g)) {
    if (!modulePattern.test(match[2] ?? "")) continue;
    for (const raw of (match[1] ?? "").split(",")) {
      const spec = raw.trim();
      if (spec.length === 0 || spec.startsWith("type ")) continue;
      const [name, alias] = spec.split(/\s+as\s+/).map((part) => part.trim());
      if (name === functionName) bindings.add(alias ?? name);
    }
  }
  return bindings;
}

/** Top-level comma-separated arguments of a `(...)` argument list (lexical; brackets inside strings are not special-cased). */
function splitTopLevelArguments(argsText: string): string[] {
  const inner = argsText.slice(1, -1);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index] ?? "";
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(inner.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * True when the call injects the entry point's runner: the named property key (shorthand or
 * `key: value`) in an object literal in the arguments, or the positional argument. An explicit
 * `undefined` value does not count.
 */
function hasInjectedRunner(argsText: string, injection: RunnerInjection): boolean {
  const text = stripComments(argsText);
  if ("position" in injection) {
    const arg = splitTopLevelArguments(text)[injection.position];
    return arg !== undefined && arg !== "undefined";
  }
  return new RegExp(`(?<=[{,]\\s*)${injection.property}\\s*(?:[,}]|:\\s*(?!undefined\\b)[^\\s,}])`).test(text);
}

function allowedByMarker(lines: readonly string[], line: number): boolean {
  return [lines[line - 1], lines[line - 2]].some((text) => text?.includes(ALLOW_MARKER) === true);
}

export function findRealLintCallViolations(files: readonly SourceFile[]): LintCallViolation[] {
  const violations: LintCallViolation[] = [];
  for (const { file, source } of files) {
    if (!file.endsWith(".test.ts") || isSandboxUnrunnable(file) || ALLOWLISTED_FILES.has(file)) continue;
    const lines = source.split("\n");
    for (const { modulePattern, functionName, injection } of LINT_ENTRY_POINTS) {
      for (const binding of importedBindings(source, functionName, modulePattern)) {
        for (const match of source.matchAll(new RegExp(`(?<![.\\w])${binding}\\s*\\(`, "g"))) {
          const open = match.index + match[0].length - 1;
          const line = lineAt(source, match.index);
          if (!hasInjectedRunner(callArguments(source, open), injection) && !allowedByMarker(lines, line)) {
            violations.push({ file, line, functionName });
          }
        }
      }
    }
  }
  return violations;
}

export function exitCodeForLintCallViolations(violations: readonly LintCallViolation[]): number {
  return violations.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  const cwd = process.cwd();
  const files = [...collectSourceFiles(join(cwd, "v2"), cwd), ...collectSourceFiles(join(cwd, "shared"), cwd)];
  const violations = findRealLintCallViolations(files);
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}: unit-slice test reaches real ${violation.functionName} without an injected runner`,
    );
  }
  process.exitCode = exitCodeForLintCallViolations(violations);
}
