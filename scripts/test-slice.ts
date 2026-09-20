import { readdirSync } from "node:fs";
import { join } from "node:path";

export const SANDBOX_SUFFIX = ".sandbox-unrunnable.test.ts";

export type TestIsolationClass = "poll-until-done" | "subprocess-spawning";

const TEST_ISOLATION_DECLARATION = /^\s*export const TEST_ISOLATION_CLASS\s*=\s*"([^"\r\n]+)";?\s*$/gm;

function topLevelCode(source: string): string {
  let result = "";
  let braceDepth = 0;
  let state: "code" | "line-comment" | "block-comment" | "single-quote" | "double-quote" | "template" = "code";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    const preserveNewline = character === "\n" || character === "\r";

    if (state === "line-comment") {
      result += preserveNewline ? character : " ";
      if (preserveNewline) {
        state = "code";
      }
      continue;
    }
    if (state === "block-comment") {
      result += preserveNewline ? character : " ";
      if (character === "*" && next === "/") {
        result += " ";
        index += 1;
        state = "code";
      }
      continue;
    }
    if (state === "single-quote" || state === "double-quote") {
      result += character;
      const quote = state === "single-quote" ? "'" : '"';
      if (character === "\\") {
        result += next;
        index += 1;
      } else if (character === quote) {
        state = "code";
      }
      continue;
    }
    if (state === "template") {
      result += preserveNewline ? character : " ";
      if (character === "\\") {
        result += next === "\n" || next === "\r" ? next : " ";
        index += 1;
      } else if (character === "`") {
        state = "code";
      }
      continue;
    }

    if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else if (character === "'") {
      result += character;
      state = "single-quote";
    } else if (character === '"') {
      result += character;
      state = "double-quote";
    } else if (character === "`") {
      result += " ";
      state = "template";
    } else if (character === "{") {
      braceDepth += 1;
      result += " ";
    } else if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      result += " ";
    } else {
      result += braceDepth === 0 ? character : preserveNewline ? character : " ";
    }
  }

  return result;
}

export function readTestIsolationClass(file: string, source: string): TestIsolationClass | undefined {
  let isolationClass: TestIsolationClass | undefined;
  for (const match of topLevelCode(source).matchAll(TEST_ISOLATION_DECLARATION)) {
    const declaration = match[1];
    if (declaration !== "poll-until-done" && declaration !== "subprocess-spawning") {
      throw new Error(`unrecognized TEST_ISOLATION_CLASS in ${file}: ${declaration ?? ""}`);
    }
    if (isolationClass !== undefined && isolationClass !== declaration) {
      throw new Error(`multiple TEST_ISOLATION_CLASS declarations in ${file}`);
    }
    isolationClass = declaration;
  }
  return isolationClass;
}

export function isSandboxUnrunnable(file: string): boolean {
  return file.endsWith(SANDBOX_SUFFIX);
}

/**
 * Explicit load-sensitive files that don't match the `.sandbox-unrunnable.test.ts` suffix
 * convention. Each entry names the observed failure that made it flake under concurrent load.
 */
export const LOAD_SENSITIVE_FILES: readonly string[] = [
  // "eagerly provisions the managed worktree before dispatch for a linked implement step"
  // asserted 3 provisioning calls, got 2 under load; 26/26 pass idle (2026-07-26).
  "v2/src/daemon/daemon-workflow-start.test.ts",
  // Real git/bun/daemon subprocess probes exceed the 10s runtime-smoke wall clock when co-runners
  // load the machine; isolated, the same file finishes in ~12s (2026-07-27).
  "v2/src/execution/runtime-smoke-verifier.test.ts",
  // Passes 0-fail across four straight isolated runs (~6s) but produced 106 failures / 354 when
  // co-run with the execution-loop workflow-runner test under load (2026-08-17).
  "v2/src/daemon/daemon-resume.test.ts",
  // The former ~216-test workflow-runner.test.ts monolith was split into concern-grouped
  // workflow-runner-*.test.ts files (durable #2181 fix); each is well under the per-file budget, so
  // they run pooled. Isolate a specific split file here (with dated loaded-red/idle-green evidence) if
  // one proves load-sensitive.
];

/**
 * Load-sensitive files must run with no co-runners: every `.sandbox-unrunnable.test.ts` file by
 * convention, plus explicit-list entries for files outside that suffix set. Distinct from
 * `isSandboxUnrunnable`, which is the slice-partition key (which `test:*` script runs a file), not
 * a scheduling signal.
 */
export function isLoadSensitive(file: string): boolean {
  return isSandboxUnrunnable(file) || LOAD_SENSITIVE_FILES.includes(file);
}

export function planTestBatches(
  files: string[],
  classOf: (file: string) => TestIsolationClass | undefined,
): string[][] {
  const firstBatch: string[] = [];
  const subprocessBatch: string[] = [];
  const isolatedBatches: string[][] = [];
  for (const file of files) {
    const isolationClass = classOf(file);
    if (isLoadSensitive(file)) {
      isolatedBatches.push([file]);
    } else if (isolationClass === "subprocess-spawning") {
      subprocessBatch.push(file);
    } else {
      firstBatch.push(file);
    }
  }
  return [firstBatch, subprocessBatch, ...isolatedBatches].filter((batch) => batch.length > 0);
}

export function walkTestFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx"))) {
      files.push(join(entry.parentPath, entry.name).replace(/\\/g, "/"));
    }
  }
  return files.sort();
}

export function partitionTestFiles(files: string[]): { agent: string[]; integration: string[] } {
  const agent: string[] = [];
  const integration: string[] = [];
  for (const file of files) {
    (isSandboxUnrunnable(file) ? integration : agent).push(file);
  }
  return { agent, integration };
}

export type TestSliceMode = "agent" | "integration";

export function sliceTestFiles(files: string[], mode: TestSliceMode): string[] {
  const { agent, integration } = partitionTestFiles(files);
  return mode === "integration" ? integration : agent;
}
