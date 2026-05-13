import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type TelemetryKind =
  | "ok"
  | "quota"
  | "model_config"
  | "error"
  | "blocked"
  | "timeout";

export type TelemetryRecord = {
  ts: string;
  namespace: string;
  agent: string;
  iteration: number;
  duration_ms: number;
  kind: TelemetryKind;
  exit_reason: string;
};

export function appendTelemetryLine(
  telemetryPath: string | null,
  record: TelemetryRecord,
): void {
  if (telemetryPath === null) {
    return;
  }
  mkdirSync(dirname(telemetryPath), { recursive: true });
  appendFileSync(telemetryPath, `${JSON.stringify(record)}\n`, "utf8");
}
