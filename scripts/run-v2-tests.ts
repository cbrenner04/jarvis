import { spawn as nodeSpawn, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import {
  planTestBatches,
  readTestIsolationClass,
  sliceTestFiles,
  type TestSliceMode,
  walkTestFiles,
} from "./test-slice.ts";

/** Supported budget for the slowest healthy test file under the aggregate suite. */
export const SUPPORTED_HEALTHY_FILE_BUDGET_MS = 180_000;
export const FAILING_TEST_FILE_MARKER = "JARVIS_READY_FAILING_TEST_FILE ";
export const READY_ATTEMPT_ENV = "JARVIS_READY_ATTEMPT_ID";

/** Per-file timeout for test execution; must not undercut the supported healthy file budget. */
const PER_FILE_TIMEOUT_MS = SUPPORTED_HEALTHY_FILE_BUDGET_MS;

/** Validates that a per-file timeout meets or exceeds the supported healthy file budget. */
export function validatePerFileTimeout(timeout: number): void {
  if (timeout < SUPPORTED_HEALTHY_FILE_BUDGET_MS) {
    throw new Error(
      `per-file timeout ${timeout}ms is below supported healthy file budget ${SUPPORTED_HEALTHY_FILE_BUDGET_MS}ms`,
    );
  }
}

export function walkV2TestFiles(root = "v2"): string[] {
  return walkTestFiles(root);
}

export function v2Tests(mode: TestSliceMode): string[] {
  return sliceTestFiles(walkV2TestFiles(), mode);
}

/** Used only by `measure-test-cost.ts`'s own `spawnSync`-based measurement path, which infers timeout from signal/status. */
export function isSpawnTimeout(result: Pick<SpawnSyncReturns<unknown>, "signal" | "status">): boolean {
  return result.signal === "SIGKILL" && result.status === null;
}

export function spawnTimeoutMessage(mode: string, file?: string, label = "v2"): string {
  const prefix = label ? `${label} ` : "";
  const suffix = file === undefined ? "" : ` on file "${file}"`;
  return `error: ${prefix}"${mode}" test run timed out or was killed${suffix}\n`;
}

/** Header line preceding a settled file's contiguous captured-output block. */
export function fileOutputHeader(file: string): string {
  return `--- ${file} ---\n`;
}

/** Machine-readable evidence for one failed file settlement. */
export function failingTestFileRecord(file: string, attemptId: string): string {
  return `${FAILING_TEST_FILE_MARKER}${JSON.stringify({ attemptId, path: file })}\n`;
}

export interface SpawnOutcome {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** Set by the timer that fired the kill, not inferred from signal/status. */
  timedOut: boolean;
}

type Spawn = (command: string, args: string[], options: { timeout: number }) => Promise<SpawnOutcome>;

/** Bound on how long a post-kill "close" wait may run before settling with whatever was captured. */
const POST_KILL_GRACE_MS = 500;

export function defaultSpawn(command: string, args: string[], options: { timeout: number }): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const child = nodeSpawn(command, args);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (outcome: SpawnOutcome) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (graceTimer) {
        clearTimeout(graceTimer);
      }
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      graceTimer = setTimeout(() => {
        settle({ status: null, signal: "SIGKILL", stdout, stderr, timedOut });
      }, POST_KILL_GRACE_MS);
    }, options.timeout);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (status, signal) => {
      settle({ status, signal, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      stderr += `error: failed to spawn "${command}": ${String(err)}\n`;
      settle({ status: 1, signal: null, stdout, stderr, timedOut: false });
    });
  });
}

export interface FileResult {
  file: string;
  timedOut: boolean;
  status: number | null;
}

function classOfTestFile(file: string) {
  if (!existsSync(file)) {
    return undefined;
  }
  return readTestIsolationClass(file, readFileSync(file, "utf8"));
}

/** Concurrency limit derived from available parallelism, reserving headroom (half, floor 1). */
export function defaultConcurrency(parallelism: number): number {
  return Math.max(1, Math.floor(parallelism / 2));
}

/**
 * Resolves the pool's concurrency limit: an explicit override wins over
 * `JARVIS_TEST_CONCURRENCY`, which wins over the derived default. A malformed or `0` env
 * value falls back to the derived default instead of throwing. An explicit override must be a
 * non-negative integer — `0` clamps to serial execution (via the worker-count floor of 1); a
 * non-integer or negative explicit value throws rather than silently producing a zero-worker
 * pool that reports success without running files.
 */
export function resolveConcurrency(
  explicit?: number,
  envValue = process.env.JARVIS_TEST_CONCURRENCY,
  parallelism = availableParallelism(),
): number {
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit < 0) {
      throw new Error(`explicit concurrency must be a non-negative integer, got ${explicit}`);
    }
    return explicit;
  }
  if (envValue !== undefined) {
    const parsed = Number(envValue);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return defaultConcurrency(parallelism);
}

/**
 * Runs files under a bounded pool of at most `concurrency` concurrent workers, each
 * spawning under its own independently-armed per-file timeout. On a timeout, "agent" mode
 * names the file and keeps admitting new files; every other mode stops admitting new files,
 * matching integration mode's existing fail-fast-on-timeout behavior. An ordinary non-zero
 * exit stops every mode from admitting new files, regardless of mode. In both stop cases,
 * files already in flight are awaited and their results reported. Returns one result per
 * file actually run, in settle order (not roster order).
 *
 * Each file's captured stdout/stderr is flushed as one contiguous block, headed by its
 * file name, as soon as that file settles (including output captured before a kill).
 *
 * The declared-class schedule is drained in order. Each batch uses the same bounded pool;
 * load-sensitive files occupy single-file batches.
 */
export async function runV2TestFiles(
  mode: string,
  files: string[],
  spawn: Spawn = defaultSpawn,
  label = "v2",
  concurrency = resolveConcurrency(),
  attemptId = process.env[READY_ATTEMPT_ENV] ?? "standalone",
): Promise<FileResult[]> {
  const results: FileResult[] = [];
  const batches = planTestBatches(files, classOfTestFile);
  let stopAdmitting = false;
  const safeConcurrency = Number.isFinite(concurrency) ? concurrency : 1;
  for (const batch of batches) {
    if (stopAdmitting) {
      break;
    }
    let nextIndex = 0;
    async function worker(): Promise<void> {
      for (;;) {
        if (stopAdmitting || nextIndex >= batch.length) {
          return;
        }
        const file = batch[nextIndex];
        nextIndex += 1;
        if (file === undefined) {
          return;
        }
        const result = await spawn("bun", ["test", file], { timeout: PER_FILE_TIMEOUT_MS });
        process.stdout.write(`${fileOutputHeader(file)}${result.stdout}${result.stderr}`);
        if (result.timedOut || result.status !== 0 || result.signal !== null) {
          process.stderr.write(failingTestFileRecord(file, attemptId));
        }
        results.push({ file, timedOut: result.timedOut, status: result.status });
        if (result.timedOut) {
          process.stderr.write(spawnTimeoutMessage(mode, file, label));
          if (mode !== "agent") {
            stopAdmitting = true;
          }
          continue;
        }
        if (result.status !== 0) {
          stopAdmitting = true;
        }
      }
    }
    const workerCount = Math.max(1, Math.min(safeConcurrency, batch.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  return results;
}

export function aggregateExitCode(results: FileResult[]): number {
  return results.some((r) => r.timedOut || r.status !== 0) ? 1 : 0;
}

if (import.meta.main) {
  const mode = process.argv[2];
  const files = mode === "integration" || mode === "agent" ? v2Tests(mode) : [];

  if (files.length === 0) {
    process.stderr.write(`error: unknown or empty v2 test mode "${mode ?? ""}"\n`);
    process.exit(1);
  }

  const results = await runV2TestFiles(mode ?? "", files);
  process.exit(aggregateExitCode(results));
}
