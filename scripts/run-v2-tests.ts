import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const SANDBOX_SUFFIX = ".sandbox-unrunnable.test.ts";

export function walkV2TestFiles(root = "v2"): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(join(entry.parentPath, entry.name).replace(/\\/g, "/"));
    }
  }
  return files.sort();
}

export function v2Tests(mode: "agent" | "integration"): string[] {
  const sandbox = (file: string) => file.endsWith(SANDBOX_SUFFIX);
  const all = walkV2TestFiles();
  return mode === "integration" ? all.filter(sandbox) : all.filter((file) => !sandbox(file));
}

if (import.meta.main) {
  const mode = process.argv[2];
  const files = mode === "integration" || mode === "agent" ? v2Tests(mode) : [];

  if (files.length === 0) {
    process.stderr.write(`error: unknown or empty v2 test mode "${mode ?? ""}"\n`);
    process.exit(1);
  }

  const result = spawnSync("bun", ["test", ...files], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
