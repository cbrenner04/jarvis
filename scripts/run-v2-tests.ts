import { spawn as nodeSpawn, type SpawnSyncReturns } from "node:child_process";
import { availableParallelism } from "node:os";
import { isLoadSensitive, sliceTestFiles, type TestSliceMode, walkTestFiles } from "./test-slice.ts";

/** Supported budget for the slowest healthy test file; `v1/test/run.test.ts` runs ~120s under the aggregate suite. */
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
 * Load-sensitive files (`isLoadSensitive`) are excluded from the pool and instead run one at a
 * time after the pool has fully drained, with no co-runners in either direction. The same mode
 * semantics (agent keeps admitting past a timeout, every other mode stops on either a timeout
 * or a plain failure) apply to the isolated phase.
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
  const poolable = files.filter((file) => !isLoadSensitive(file));
  const isolated = files.filter((file) => isLoadSensitive(file));
  let nextIndex = 0;
  let stopAdmitting = false;

  async function worker(): Promise<void> {
    for (;;) {
      if (stopAdmitting || nextIndex >= poolable.length) {
        return;
      }
      const file = poolable[nextIndex];
      nextIndex += 1;
      if (file === undefined) {
        return;
      }
      const result = await spawn("bun", ["test", file], { timeout: PER_FILE_TIMEOUT_MS });
      process.stdout.write(`${fileOutputHeader(file)}${result.stdout}${result.stderr}`);
      if (result.timedOut || result.status !== 0 || result.signal !== null) {
        process.stderr.write(failingTestFileRecord(file, attemptId));
      }
      if (result.timedOut) {
        process.stderr.write(spawnTimeoutMessage(mode, file, label));
        results.push({ file, timedOut: true, status: result.status });
        if (mode !== "agent") {
          stopAdmitting = true;
        }
        continue;
      }
      results.push({ file, timedOut: false, status: result.status });
      if (result.status !== 0) {
        stopAdmitting = true;
      }
    }
  }

  const safeConcurrency = Number.isFinite(concurrency) ? concurrency : 1;
  const workerCount = Math.max(1, Math.min(safeConcurrency, poolable.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  for (const file of isolated) {
    if (stopAdmitting) {
      break;
    }
    const result = await spawn("bun", ["test", file], { timeout: PER_FILE_TIMEOUT_MS });
    process.stdout.write(`${fileOutputHeader(file)}${result.stdout}${result.stderr}`);
    if (result.timedOut || result.status !== 0 || result.signal !== null) {
      process.stderr.write(failingTestFileRecord(file, attemptId));
    }
    if (result.timedOut) {
      process.stderr.write(spawnTimeoutMessage(mode, file, label));
      results.push({ file, timedOut: true, status: result.status });
      if (mode !== "agent") {
        stopAdmitting = true;
      }
    } else {
      results.push({ file, timedOut: false, status: result.status });
      if (result.status !== 0) {
        stopAdmitting = true;
      }
    }
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
