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

type TelemetryJsonlAppendOptions = {
  clock?: () => Date;
};

function utcMonthLabel(ms: number): string {
  const d = new Date(ms);
  const month = d.getUTCMonth() + 1;
  return `${d.getUTCFullYear()}-${String(month).padStart(2, "0")}`;
}

function rollTelemetryCurrentFileIfNeeded(sinkPath: string, clock: () => Date): void {
  if (!existsSync(sinkPath)) return;
  const fileMonth = utcMonthLabel(statSync(sinkPath).mtimeMs);
  const clockMonth = utcMonthLabel(clock().getTime());
  if (fileMonth === clockMonth) return;

  const telemetryDir = join(dirname(sinkPath), "telemetry");
  mkdirSync(telemetryDir, { recursive: true });
  const archivePath = join(telemetryDir, `${fileMonth}.jsonl.gz`);
  const tmpPath = `${archivePath}.tmp`;
  writeFileSync(tmpPath, gzipSync(readFileSync(sinkPath)));
  renameSync(tmpPath, archivePath);
  rmSync(sinkPath, { force: true });
}

export function appendTelemetryJsonlLine(sinkPath: string, line: string, options?: TelemetryJsonlAppendOptions): void {
  const clock = options?.clock ?? (() => new Date());
  mkdirSync(dirname(sinkPath), { recursive: true });
  rollTelemetryCurrentFileIfNeeded(sinkPath, clock);
  appendFileSync(sinkPath, line.endsWith("\n") ? line : `${line}\n`, "utf8");
  const stampSec = clock().getTime() / 1000;
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
