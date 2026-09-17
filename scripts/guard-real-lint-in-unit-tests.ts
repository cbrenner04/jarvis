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

/**
 * Real markdown-lint entry points: production functions whose optional `runner` parameter
 * defaults to a real `bun markdownlint-cli2` spawn (`shared/subprocess.ts#realAsyncSubprocessRunner`).
 * A unit-slice test file calling one of these without threading a `runner` identifier through the
 * call reaches the real binary instead of a stub.
 */
const LINT_ENTRY_POINTS: readonly { modulePattern: RegExp; functionName: string }[] = [
  { modulePattern: /markdownlint-repair\.ts$/, functionName: "runMarkdownlintAutofix" },
  { modulePattern: /staged-markdown-lint\.ts$/, functionName: "lintStagedMarkdown" },
  { modulePattern: /intent-stage\.ts$/, functionName: "validateIntentStage" },
  { modulePattern: /intent-stage\.ts$/, functionName: "repairIntentStageContent" },
  { modulePattern: /intent-output\.ts$/, functionName: "landIntentWorkflowOutput" },
  { modulePattern: /workflow-runner-resume\.ts$/, functionName: "recoverPlanStage" },
  { modulePattern: /workflow-runner-resume\.ts$/, functionName: "resumePopulatedIntentPublication" },
  { modulePattern: /write-loop\.ts$/, functionName: "executeWriteLoop" },
];

/**
 * Files that call a lint entry point without an injected runner for reasons outside the
 * intent-landing (00) and staged-lint-resume (01) seams this guard protects: pre-existing
 * real-binary assertions that predate the runner threading. Fixing them is a separate concern.
 */
const ALLOWLISTED_FILES = new Map<string, string>([
  ["shared/intent-stage.test.ts", "pre-existing real-binary landing-repair assertions"],
  ["v2/src/execution/staged-markdown-lint.test.ts", "direct unit coverage of the real binary path"],
  [
    "v2/src/execution/workflow-runner-review.test.ts",
    "pre-existing real-binary review-actuator staged-lint reprompt assertions predating this seam",
  ],
  ["v2/src/daemon/daemon-start-list.test.ts", "pre-existing write-loop calls predate the staged-lint runner seam"],
  [
    "v2/src/execution/write-loop.test.ts",
    "pre-existing write-loop calls predate the staged-lint runner seam; none exercise the lint gate",
  ],
  [
    "v2/src/execution/write-loop-idle-watchdog.test.ts",
    "pre-existing write-loop calls predate the staged-lint runner seam; none exercise the lint gate",
  ],
  [
    "v2/src/execution/write-loop-intent-landing.test.ts",
    "pre-existing write-loop calls predate the staged-lint runner seam; landing-contract checks precede the lint gate",
  ],
  [
    "v2/src/execution/write-loop-session-log.test.ts",
    "pre-existing write-loop calls predate the staged-lint runner seam; none exercise the lint gate",
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

function hasInjectedRunner(argsText: string): boolean {
  return /\brunner\b/.test(stripComments(argsText));
}

function allowedByMarker(lines: readonly string[], line: number): boolean {
  return [lines[line - 1], lines[line - 2]].some((text) => text?.includes(ALLOW_MARKER) === true);
}

export function findRealLintCallViolations(files: readonly SourceFile[]): LintCallViolation[] {
  const violations: LintCallViolation[] = [];
  for (const { file, source } of files) {
    if (!file.endsWith(".test.ts") || isSandboxUnrunnable(file) || ALLOWLISTED_FILES.has(file)) continue;
    const lines = source.split("\n");
    for (const { modulePattern, functionName } of LINT_ENTRY_POINTS) {
      for (const binding of importedBindings(source, functionName, modulePattern)) {
        for (const match of source.matchAll(new RegExp(`(?<![.\\w])${binding}\\s*\\(`, "g"))) {
          const open = match.index + match[0].length - 1;
          const line = lineAt(source, match.index);
          if (!hasInjectedRunner(callArguments(source, open)) && !allowedByMarker(lines, line)) {
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
