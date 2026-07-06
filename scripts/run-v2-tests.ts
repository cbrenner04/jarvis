import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { sliceTestFiles, type TestSliceMode, walkTestFiles } from "./test-slice.ts";

const PER_FILE_TIMEOUT_MS = 60_000;

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

type Spawn = (
  command: string,
  args: string[],
  options: { stdio: "inherit"; timeout: number; killSignal: "SIGKILL" },
) => SpawnSyncReturns<unknown>;

export interface FileResult {
  file: string;
  timedOut: boolean;
  status: number | null;
}

/**
 * Runs each file serially under its own per-file timeout. On a timeout, "agent" mode
 * names the file and continues to the next one; every other mode stops the run, matching
 * integration mode's existing fail-fast-on-timeout behavior. An ordinary non-zero exit
 * always stops the run. Returns one result per file actually run.
 */
export function runV2TestFiles(mode: string, files: string[], spawn: Spawn = spawnSync): FileResult[] {
  const results: FileResult[] = [];
  for (const file of files) {
    const result = spawn("bun", ["test", file], {
      stdio: "inherit",
      timeout: PER_FILE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (isSpawnTimeout(result)) {
      process.stderr.write(spawnTimeoutMessage(mode, file));
      results.push({ file, timedOut: true, status: result.status });
      if (mode !== "agent") {
        return results;
      }
      continue;
    }
    results.push({ file, timedOut: false, status: result.status });
    if (result.status !== 0) {
      return results;
    }
  }
  return results;
}

export function aggregateExitCode(results: FileResult[]): number {
  const last = results.at(-1);
  if (last === undefined) {
    return 0;
  }
  if (last.timedOut || last.status !== 0) {
    return last.status ?? 1;
  }
  return results.some((r) => r.timedOut) ? 1 : 0;
}

if (import.meta.main) {
  const mode = process.argv[2];
  const files = mode === "integration" || mode === "agent" ? v2Tests(mode) : [];

  if (files.length === 0) {
    process.stderr.write(`error: unknown or empty v2 test mode "${mode ?? ""}"\n`);
    process.exit(1);
  }

  process.exit(aggregateExitCode(runV2TestFiles(mode ?? "", files)));
}
