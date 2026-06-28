import { readdirSync } from "node:fs";
import { join } from "node:path";

export const V2_ROOT = "v2";
export const SANDBOX_UNRUNNABLE_SUFFIX = ".sandbox-unrunnable.test.ts";

export function isSandboxUnrunnableTest(path: string): boolean {
  return path.endsWith(SANDBOX_UNRUNNABLE_SUFFIX);
}

export function walkV2TestFiles(root = V2_ROOT): string[] {
  const files: string[] = [];

  const walk = (current: string, prefix: string) => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        walk(fullPath, `${rel}/`);
      } else if (entry.name.endsWith(".test.ts")) {
        files.push(`${root}/${rel}`);
      }
    }
  };

  walk(root, "");
  return files.sort();
}

export function agentRunnableV2Tests(): string[] {
  return walkV2TestFiles().filter((file) => !isSandboxUnrunnableTest(file));
}

export function integrationV2Tests(): string[] {
  return walkV2TestFiles().filter((file) => isSandboxUnrunnableTest(file));
}
