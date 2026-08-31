import type { AgentName, AgentResult } from "../../agents/types.ts";
import {
  appendTelemetryLine,
  type PlanStepOutcome,
  type PlanTelemetryPhase,
  type TelemetryKind,
} from "../../telemetry.ts";
import { extractUsageAndCost } from "../../telemetry-enrichment.ts";

type LivePlanTelemetryPhase = "draft" | "review";

function requireLivePlanTelemetryPhase(phase: unknown): LivePlanTelemetryPhase {
  if (phase === "draft" || phase === "review") return phase;
  throw new Error("invalid plan telemetry phase");
}

function telemetryKindForResult(r: AgentResult): TelemetryKind {
  switch (r.kind) {
    case "ok":
      return "ok";
    case "quota":
      return "quota";
    case "model_config":
      return "model_config";
    case "error":
      return "error";
  }
}

function exitReasonForPlanAttempt(phase: LivePlanTelemetryPhase, r: AgentResult): string {
  switch (r.kind) {
    case "quota":
      return "quota-fallback";
    case "model_config":
      return "model-config";
    case "error":
      return "agent-error";
    case "ok":
      break;
  }
  return `plan-${phase}-ok`;
}

export type PlanTelemetryWriter = {
  recordAgentAttempt: (opts: {
    phase: PlanTelemetryPhase;
    agentCli: AgentName;
    configuredModel: string | undefined;
    durationMs: number;
    result: AgentResult;
    /**Intent/refine terminal state; omit on failed attempts.*/
    outcome?: PlanStepOutcome | undefined;
  }) => void;
  hasAgentInvocationWrites: () => boolean;
};

export function createPlanTelemetryWriter(args: {
  telemetryPath: string | null;
  namespace: string;
}): PlanTelemetryWriter {
  let seq = 1;
  let wroteInvocation = false;

  return {
    recordAgentAttempt(opts: {
      phase: PlanTelemetryPhase;
      agentCli: AgentName;
      configuredModel: string | undefined;
      durationMs: number;
      result: AgentResult;
      outcome?: PlanStepOutcome | undefined;
    }): void {
      const phase = requireLivePlanTelemetryPhase(opts.phase);
      const kind = telemetryKindForResult(opts.result);
      const base = {
        ts: new Date().toISOString(),
        namespace: args.namespace,
        agent: opts.agentCli,
        iteration: seq,
        duration_ms: opts.durationMs,
        kind,
        exit_reason: exitReasonForPlanAttempt(phase, opts.result),
        mode: "plan" as const,
        plan_phase: phase,
        ...(opts.outcome !== undefined ? { outcome: opts.outcome } : {}),
        ...(opts.configuredModel !== undefined ? { configured_model: opts.configuredModel } : {}),
      };
      seq += 1;

      if (opts.result.kind === "ok") {
        const enriched = extractUsageAndCost(opts.result, opts.agentCli, opts.configuredModel);
        appendTelemetryLine(args.telemetryPath, {
          ...base,
          ...enriched,
          ...(opts.result.warnings !== undefined && opts.result.warnings.length > 0
            ? { warnings: opts.result.warnings }
            : {}),
        });
      } else {
        appendTelemetryLine(args.telemetryPath, base);
      }
      wroteInvocation = true;
    },
    hasAgentInvocationWrites(): boolean {
      return wroteInvocation;
    },
  };
}
