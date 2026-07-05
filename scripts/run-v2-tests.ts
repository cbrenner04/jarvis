import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { sliceTestFiles, type TestSliceMode, walkTestFiles } from "./test-slice.ts";

const PER_FILE_TIMEOUT_MS = 60_000;
const AGENT_MODE_TIMEOUT_MS = 300_000;

export function walkV2TestFiles(root = "v2"): string[] {
  return walkTestFiles(root);
}

export function v2Tests(mode: TestSliceMode): string[] {
  return sliceTestFiles(walkV2TestFiles(), mode);
}

export function isSpawnTimeout(result: Pick<SpawnSyncReturns<unknown>, "signal" | "status">): boolean {
  return result.signal === "SIGKILL" && result.status === null;
}

export function spawnTimeoutMessage(mode: string, file?: string): string {
  const suffix = file === undefined ? "" : ` on file "${file}"`;
  return `error: v2 "${mode}" test run timed out or was killed${suffix}\n`;
}

if (import.meta.main) {
  const mode = process.argv[2];
  const files = mode === "integration" || mode === "agent" ? v2Tests(mode) : [];

  if (files.length === 0) {
    process.stderr.write(`error: unknown or empty v2 test mode "${mode ?? ""}"\n`);
    process.exit(1);
  }

  if (mode === "agent") {
    const result = spawnSync("bun", ["test", "--parallel", ...files], {
      stdio: "inherit",
      timeout: AGENT_MODE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (isSpawnTimeout(result)) {
      process.stderr.write(spawnTimeoutMessage("agent"));
      process.exit(1);
    }
    process.exit(result.status ?? 1);
  }

  for (const file of files) {
    const result = spawnSync("bun", ["test", file], {
      stdio: "inherit",
      timeout: PER_FILE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (isSpawnTimeout(result)) {
      process.stderr.write(spawnTimeoutMessage(mode ?? "", file));
      process.exit(1);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
  process.exit(0);
}
