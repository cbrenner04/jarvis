import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { InvocationTelemetrySink } from "../shared/invocation/execute.ts";

type TelemetryJsonlAppendOptions = {
  clock?: () => Date;
  /** Test seam: the rename that stages the current file (and claims orphaned staging files). */
  renameSync?: (from: string, to: string) => void;
  /** Test seam: the stat that reads the current file's mtime before deciding to roll. */
  statSync?: (path: string) => { mtimeMs: number };
};

const STAGING_INFIX = ".rolling-";

function utcMonthLabel(ms: number): string {
  const d = new Date(ms);
  const month = d.getUTCMonth() + 1;
  return `${d.getUTCFullYear()}-${String(month).padStart(2, "0")}`;
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function stagingPath(sinkPath: string): string {
  return `${sinkPath}${STAGING_INFIX}${process.pid}-${randomBytes(6).toString("hex")}`;
}

/** Atomically move `from` to `to`; false when `from` is already gone (another process won). */
function tryStage(rename: (from: string, to: string) => void, from: string, to: string): boolean {
  try {
    rename(from, to);
    return true;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return false;
    throw error;
  }
}

/** Publish `tmpPath` at the first free `<month>[.<n>].jsonl.gz`; `linkSync` fails EEXIST, so an archive is never overwritten. */
function publishArchiveNoClobber(telemetryDir: string, month: string, tmpPath: string): void {
  for (let n = 0; ; n++) {
    const archivePath = join(telemetryDir, n === 0 ? `${month}.jsonl.gz` : `${month}.${n}.jsonl.gz`);
    try {
      linkSync(tmpPath, archivePath);
      return;
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") throw error;
    }
  }
}

/** Gzip a staged file (owned exclusively by this process) into the archive under its mtime month, then drop it. */
function archiveStagedFile(sinkPath: string, stagedPath: string): void {
  const month = utcMonthLabel(statSync(stagedPath).mtimeMs);
  const telemetryDir = join(dirname(sinkPath), "telemetry");
  mkdirSync(telemetryDir, { recursive: true });
  const tmpPath = join(telemetryDir, `.${month}.jsonl.gz.tmp-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    writeFileSync(tmpPath, gzipSync(readFileSync(stagedPath)));
    publishArchiveNoClobber(telemetryDir, month, tmpPath);
  } finally {
    rmSync(tmpPath, { force: true });
  }
  rmSync(stagedPath, { force: true });
}

function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) return false; // sync roll: own leftovers cannot be in flight
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) === "EPERM";
  }
}

/** Recover staging files left by a roller that died mid-roll (its pid no longer alive). */
function sweepOrphanedStagingFiles(sinkPath: string, rename: (from: string, to: string) => void): void {
  const prefix = `${basename(sinkPath)}${STAGING_INFIX}`;
  for (const name of readdirSync(dirname(sinkPath))) {
    if (!name.startsWith(prefix)) continue;
    const pid = Number.parseInt(name.slice(prefix.length), 10);
    if (Number.isFinite(pid) && isProcessAlive(pid)) continue;
    const claimed = stagingPath(sinkPath);
    if (tryStage(rename, join(dirname(sinkPath), name), claimed)) archiveStagedFile(sinkPath, claimed);
  }
}

/** Current file's mtime, or undefined when a concurrent roller already staged it away. */
function currentMtimeMs(sinkPath: string, stat: (path: string) => { mtimeMs: number }): number | undefined {
  try {
    return stat(sinkPath).mtimeMs;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function rollTelemetryCurrentFileIfNeeded(
  sinkPath: string,
  clock: () => Date,
  rename: (from: string, to: string) => void,
  stat: (path: string) => { mtimeMs: number },
): void {
  const mtimeMs = currentMtimeMs(sinkPath, stat);
  if (mtimeMs !== undefined && utcMonthLabel(mtimeMs) === utcMonthLabel(clock().getTime())) return;
  // Only when the file is absent or due to roll: orphans exist only after a roll died mid-flight.
  sweepOrphanedStagingFiles(sinkPath, rename);
  if (mtimeMs === undefined) return;
  const staged = stagingPath(sinkPath);
  if (!tryStage(rename, sinkPath, staged)) return;
  archiveStagedFile(sinkPath, staged);
}

export function appendTelemetryJsonlLine(sinkPath: string, line: string, options?: TelemetryJsonlAppendOptions): void {
  const clock = options?.clock ?? (() => new Date());
  mkdirSync(dirname(sinkPath), { recursive: true });
  rollTelemetryCurrentFileIfNeeded(sinkPath, clock, options?.renameSync ?? renameSync, options?.statSync ?? statSync);
  appendFileSync(sinkPath, line.endsWith("\n") ? line : `${line}\n`, "utf8");
  const stampSec = clock().getTime() / 1000;
  try {
    utimesSync(sinkPath, stampSec, stampSec);
  } catch (error) {
    // A concurrent roller staged the file after our append; the line travels with the staged file.
    if (errnoCode(error) !== "ENOENT") throw error;
  }
}

/** JSONL telemetry sink appending to `path`, creating its parent directory as needed. */
export function buildJsonlSink(path: string, options?: TelemetryJsonlAppendOptions): InvocationTelemetrySink {
  return {
    append(record) {
      appendTelemetryJsonlLine(path, JSON.stringify(record), options);
    },
  };
}
