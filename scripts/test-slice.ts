import { readdirSync } from "node:fs";
import { join } from "node:path";

export const SANDBOX_SUFFIX = ".sandbox-unrunnable.test.ts";

export function isSandboxUnrunnable(file: string): boolean {
  return file.endsWith(SANDBOX_SUFFIX);
}

/**
 * Explicit load-sensitive files that don't match the `.sandbox-unrunnable.test.ts` suffix
 * convention. Each entry names the observed failure that made it flake under concurrent load.
 */
const LOAD_SENSITIVE_FILES: readonly string[] = [
  // "eagerly provisions the managed worktree before dispatch for a linked implement step"
  // asserted 3 provisioning calls, got 2 under load; 26/26 pass idle (2026-07-26).
  "v2/src/daemon/daemon-workflow-start.test.ts",
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
