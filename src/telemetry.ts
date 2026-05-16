import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type TelemetryKind =
  | "ok"
  | "quota"
  | "model_config"
  | "error"
  | "blocked"
  | "timeout";

export type TelemetryUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
};

export type UsageSource = "agent" | "unavailable" | null;
export type CostSource = "computed" | "agent" | "no-price" | "no-usage" | null;

export type TelemetryRecord = {
  ts: string;
  namespace: string;
  agent: string;
  iteration: number;
  duration_ms: number;
  kind: TelemetryKind;
  exit_reason: string;
  usage?: TelemetryUsage;
  usage_source?: UsageSource;
  cost_usd?: number | null;
  cost_source?: CostSource;
  warnings?: string[];
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
