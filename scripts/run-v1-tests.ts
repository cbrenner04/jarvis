import { spawnSync } from "node:child_process";
import { type TestSliceMode, sliceTestFiles, walkTestFiles } from "./test-slice.ts";

export function walkV1TestFiles(root = "v1"): string[] {
  return walkTestFiles(root);
}

export function v1Tests(mode: TestSliceMode): string[] {
  return sliceTestFiles(walkV1TestFiles(), mode);
}

if (import.meta.main) {
  const mode = process.argv[2];
  const files = mode === "integration" || mode === "agent" ? v1Tests(mode) : [];

  if (files.length === 0) {
    process.stderr.write(`error: unknown or empty v1 test mode "${mode ?? ""}"\n`);
    process.exit(1);
  }

  if (mode === "agent") {
    process.exit(spawnSync("bun", ["test", "--parallel", ...files], { stdio: "inherit" }).status ?? 1);
  }

  for (const file of files) {
    const result = spawnSync("bun", ["test", file], { stdio: "inherit" });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
  process.exit(0);
}
