import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type TelemetryKind = "ok" | "quota" | "model_config" | "error" | "blocked" | "timeout";

export type TelemetryUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
};

export type UsageSource = "agent" | "estimated" | "unavailable" | null;
export type CostSource = "computed" | "agent" | "estimated" | "no-price" | "no-usage" | null;

/**Invocation JSONL rows carry agent/session results; terminal rows describe run exit without duplicating usage.*/
export type TelemetryRecordRole = "invocation" | "run_terminal";

export type TelemetryMode = "patch" | "plan";

/**Present on plan-mode invocation rows so summaries can attribute usage to a phase.*/
export type PlanTelemetryPhase = "refine" | "name-only" | "draft" | "review";
export type PatchTelemetryPhase = "implementation" | "review";

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
  /** Omit from aggregated summary totals (`run_terminal` rows duplicate exit state only).*/
  record_role?: TelemetryRecordRole;
  configured_model?: string;
  /** Discriminator so patch and plan sessions can share one JSONL file safely.*/
  mode?: TelemetryMode;
  plan_phase?: PlanTelemetryPhase;
  patch_phase?: PatchTelemetryPhase;
  watchdog_pgid?: number;
};

export function appendTelemetryLine(telemetryPath: string | null, record: TelemetryRecord): void {
  if (telemetryPath === null) {
    return;
  }
  mkdirSync(dirname(telemetryPath), { recursive: true });
  appendFileSync(telemetryPath, `${JSON.stringify(record)}\n`, "utf8");
}
