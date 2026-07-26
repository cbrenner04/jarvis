import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { aggregateTestFiles } from "./run-tests.ts";
import { isSpawnTimeout, SUPPORTED_HEALTHY_FILE_BUDGET_MS } from "./run-v2-tests.ts";

/** One `bun test <file>` invocation's raw outcome, before any parsing. */
export interface SpawnFileResult {
  file: string;
  wallClockMs: number;
  output: string;
  timedOut: boolean;
  status: number | null;
}

export type FileCostStatus = "ok" | "unparsed" | "timedOut";

export interface FileCostResult {
  file: string;
  wallClockMs: number;
  inFileMs: number | undefined;
  residualMs: number | undefined;
  status: FileCostStatus;
}

export interface CostTotals {
  totalWallClockMs: number;
  totalInFileMs: number;
  totalResidualMs: number;
  excludedWallClockMs: number;
}

const SUMMARY_LINE_RE = /Ran \d+ tests? across \d+ files?\.\s*\[(\d+(?:\.\d+)?)(ms|s)\]/;

/**
 * Extracts the in-file execution time from a `bun test` summary line
 * (e.g. "Ran 5 tests across 1 files. [35.00ms]" / "[1.20s]"). Matches any
 * numeric duration in either unit, not an enumerated set of known-good values.
 */
export function parseInFileMs(output: string): number | undefined {
  const match = output.match(SUMMARY_LINE_RE);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  return match[2] === "s" ? value * 1000 : value;
}

/** Turns one raw spawn result into a per-file cost row. Pure over its input. */
export function summarizeFileResult(result: SpawnFileResult): FileCostResult {
  if (result.timedOut) {
    return {
      file: result.file,
      wallClockMs: result.wallClockMs,
      inFileMs: undefined,
      residualMs: undefined,
      status: "timedOut",
    };
  }

  const inFileMs = parseInFileMs(result.output);
  if (inFileMs === undefined) {
    return {
      file: result.file,
      wallClockMs: result.wallClockMs,
      inFileMs: undefined,
      residualMs: undefined,
      status: "unparsed",
    };
  }

  return {
    file: result.file,
    wallClockMs: result.wallClockMs,
    inFileMs,
    residualMs: result.wallClockMs - inFileMs,
    status: "ok",
  };
}

/**
 * Rolls per-file rows into roster totals. Wall clock sums every file (a
 * timed-out or unparsed file's time is real and still counts); in-file and
 * residual totals are summed only from "ok" files' own figures, so an
 * excluded file's wall clock (e.g. a 180s timeout) never leaks into the
 * residual total. Excluded files' wall clock is reported separately.
 */
export function summarizeTotals(files: FileCostResult[]): CostTotals {
  const totalWallClockMs = files.reduce((sum, f) => sum + f.wallClockMs, 0);
  const okFiles = files.filter((f) => f.status === "ok");
  const totalInFileMs = okFiles.reduce((sum, f) => sum + (f.inFileMs ?? 0), 0);
  const totalResidualMs = okFiles.reduce((sum, f) => sum + (f.residualMs ?? 0), 0);
  const excludedWallClockMs = files
    .filter((f) => f.status !== "ok")
    .reduce((sum, f) => sum + f.wallClockMs, 0);
  return {
    totalWallClockMs,
    totalInFileMs,
    totalResidualMs,
    excludedWallClockMs,
  };
}

/** Output buffer large enough for real `bun test` output; keeps a stdout-heavy file from being killed and mistaken for a timeout. */
const OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;

/** Node/Bun report an exceeded `maxBuffer` as a spawn error, not as the SIGKILL/status:null shape a real timeout leaves. */
function isBufferOverflow(result: Pick<SpawnSyncReturns<unknown>, "error">): boolean {
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOBUFS" || code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
}

/** Spawns `bun test <file>` under a per-file timeout, capturing combined output. */
export function spawnMeasureFile(file: string, timeoutMs: number): SpawnFileResult {
  const start = performance.now();
  const result = spawnSync("bun", ["test", file], {
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    encoding: "utf8",
    maxBuffer: OUTPUT_BUFFER_BYTES,
  });
  const wallClockMs = performance.now() - start;
  return {
    file,
    wallClockMs,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    timedOut: !isBufferOverflow(result) && isSpawnTimeout(result),
    status: result.status,
  };
}

function formatMs(ms: number | undefined): string {
  return ms === undefined ? "-" : `${ms.toFixed(0)}ms`;
}

if (import.meta.main) {
  const argFiles = process.argv.slice(2);
  const files =
    argFiles.length > 0
      ? argFiles
      : (() => {
          const { agent, integration } = aggregateTestFiles();
          return [...agent, ...integration];
        })();

  const rows = files.map((file) => summarizeFileResult(spawnMeasureFile(file, SUPPORTED_HEALTHY_FILE_BUDGET_MS)));
  const totals = summarizeTotals(rows);

  for (const row of rows) {
    process.stdout.write(
      `${row.status.padEnd(8)} wall=${formatMs(row.wallClockMs)} inFile=${formatMs(row.inFileMs)} residual=${formatMs(row.residualMs)} ${row.file}\n`,
    );
  }
  process.stdout.write(
    `\ntotal    wall=${formatMs(totals.totalWallClockMs)} inFile=${formatMs(totals.totalInFileMs)} residual=${formatMs(totals.totalResidualMs)} excludedWall=${formatMs(totals.excludedWallClockMs)}\n`,
  );
}
