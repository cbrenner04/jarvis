import { readdirSync } from "node:fs";
import { join } from "node:path";

export const SANDBOX_SUFFIX = ".sandbox-unrunnable.test.ts";

export function isSandboxUnrunnable(file: string): boolean {
  return file.endsWith(SANDBOX_SUFFIX);
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
