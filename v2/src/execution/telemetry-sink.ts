import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { InvocationTelemetrySink } from "../../../shared/invocation/execute.ts";

export type TelemetrySinkClock = () => Date;

export type TelemetryJsonlAppendOptions = {
  clock?: TelemetrySinkClock;
};

function resolveClock(clock: TelemetrySinkClock | undefined): TelemetrySinkClock {
  return clock ?? (() => new Date());
}

function utcMonthLabel(date: Date): string {
  const month = date.getUTCMonth() + 1;
  return `${date.getUTCFullYear()}-${String(month).padStart(2, "0")}`;
}

function rollTelemetryCurrentFileIfNeeded(sinkPath: string, clock: TelemetrySinkClock): void {
  if (!existsSync(sinkPath)) return;
  const fileMonth = utcMonthLabel(new Date(statSync(sinkPath).mtimeMs));
  const clockMonth = utcMonthLabel(clock());
  if (fileMonth === clockMonth) return;

  const telemetryDir = join(dirname(sinkPath), "telemetry");
  mkdirSync(telemetryDir, { recursive: true });
  const archivePath = join(telemetryDir, `${fileMonth}.jsonl.gz`);
  const tmpPath = `${archivePath}.tmp`;
  writeFileSync(tmpPath, gzipSync(readFileSync(sinkPath)));
  renameSync(tmpPath, archivePath);
  rmSync(sinkPath, { force: true });
}

/** Roll the current sink file when its UTC mtime month differs from `clock`, then append one JSONL line and stamp mtime from `clock`. */
export function appendTelemetryJsonlLine(sinkPath: string, line: string, options?: TelemetryJsonlAppendOptions): void {
  const clock = resolveClock(options?.clock);
  mkdirSync(dirname(sinkPath), { recursive: true });
  rollTelemetryCurrentFileIfNeeded(sinkPath, clock);
  const payload = line.endsWith("\n") ? line : `${line}\n`;
  appendFileSync(sinkPath, payload, "utf8");
  const stampMs = clock().getTime();
  const stampSec = stampMs / 1000;
  utimesSync(sinkPath, stampSec, stampSec);
}

/** JSONL telemetry sink appending to `path`, creating its parent directory as needed. */
export function buildJsonlSink(path: string, options?: TelemetryJsonlAppendOptions): InvocationTelemetrySink {
  return {
    append(record) {
      appendTelemetryJsonlLine(path, JSON.stringify(record), options);
    },
  };
}
