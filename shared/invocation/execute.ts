export type InvocationOk = {
  kind: "ok";
  stdout: string;
  stderr: string;
  usage_source?: "agent" | "estimated" | "unavailable";
  usage?: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
  cost_usd?: number | null;
  cost_source?: "agent" | "computed" | "estimated" | "no-price" | "no-usage";
  warnings?: string[];
};

export type InvocationQuota = {
  kind: "quota";
  stderr: string;
  authFailure?: true;
};

export type InvocationError =
  | {
      kind: "model_config";
      stderr: string;
    }
  | {
      kind: "error";
      exitCode: number;
      stderr: string;
    };

export type InvocationResult = InvocationOk | InvocationQuota | InvocationError;

export type InvocationBinding<T extends InvocationResult = InvocationResult> = {
  id: string;
  invoke: (args: { prompt: string; cwd: string; signal?: AbortSignal }) => Promise<T>;
  shouldAdvance?: (result: T) => boolean;
  metadata?: { agent: string; model: string };
};

export type InvocationAttempt<T extends InvocationResult = InvocationResult> = {
  binding: InvocationBinding<T>;
  result: T;
  invocationId?: string;
};

export type InvocationExecution<T extends InvocationResult = InvocationResult> = {
  attempts: InvocationAttempt<T>[];
  final: InvocationAttempt<T> | null;
  telemetryFailures: InvocationTelemetryFailure[];
};

export type InvocationCompletedRecord = {
  schema_version: 1;
  record_kind: "invocation_completed";
  ts: string;
  operator_session_id: string;
  run_id: string;
  attempt_id: string;
  invocation_id: string;
  project: string;
  workflow: string;
  step_id: string | null;
  role: string;
  agent: string;
  model: string;
  binding_id: string;
  binding_index: number;
  duration_ms: number;
  worktree_path: string;
  branch: string;
  spec_ref: string;
  usage: {
    input_tokens: null;
    output_tokens: null;
    cache_read_input_tokens: null;
    cache_creation_input_tokens: null;
  };
  usage_source: null | "unavailable";
  cost_usd: null;
  cost_source: null | "unavailable";
  exit_kind: InvocationResult["kind"];
  exit_reason: string | null;
};

export type InvocationTelemetrySink = {
  append(record: InvocationCompletedRecord): Promise<void> | void;
};

export type InvocationTelemetryFailure = {
  invocationId: string;
  bindingId: string;
  message: string;
};

export type InvocationTelemetryContext = {
  sink: InvocationTelemetrySink;
  operatorSessionId: string;
  runId: string;
  attemptId: string;
  project: string;
  workflow: string;
  stepId: string | null;
  role: string;
  worktreePath: string;
  branch: string;
  specRef: string;
  invocationIds: readonly string[];
};

/**
 * Run bindings in order, advancing when the binding's `shouldAdvance` predicate
 * returns true (default: `result.kind === "quota"`).
 *
 * Plan/intent inner loops override the predicate to also advance on `error` and
 * `model_config`; patch/review/shrink keep terminal `model_config` and `error`.
 */
export async function executeWithQuotaFallback<T extends InvocationResult = InvocationResult>(args: {
  prompt: string;
  cwd: string;
  bindings: readonly InvocationBinding<T>[];
  signal?: AbortSignal;
  telemetry?: InvocationTelemetryContext;
}): Promise<InvocationExecution<T>> {
  const attempts: InvocationAttempt<T>[] = [];
  const telemetryFailures: InvocationTelemetryFailure[] = [];

  for (const [bindingIndex, binding] of args.bindings.entries()) {
    const startedAt = Date.now();
    const result = await binding.invoke({
      prompt: args.prompt,
      cwd: args.cwd,
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
    });
    const invocationId = args.telemetry?.invocationIds[bindingIndex];
    const attempt = { binding, result, ...(invocationId !== undefined ? { invocationId } : {}) };
    attempts.push(attempt);
    const metadata = binding.metadata;
    if (args.telemetry !== undefined && invocationId !== undefined && metadata !== undefined) {
      const record = createInvocationCompletedRecord({
        telemetry: args.telemetry,
        invocationId,
        metadata,
        bindingId: binding.id,
        bindingIndex,
        result,
        durationMs: Date.now() - startedAt,
      });
      try {
        await args.telemetry.sink.append(record);
      } catch (error) {
        telemetryFailures.push({
          invocationId,
          bindingId: binding.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const shouldAdvance = binding.shouldAdvance ? binding.shouldAdvance(result) : result.kind === "quota";
    if (shouldAdvance) {
      continue;
    }
    return { attempts, final: attempt, telemetryFailures };
  }

  const final = attempts.length === 0 ? null : (attempts[attempts.length - 1] ?? null);
  return {
    attempts,
    final,
    telemetryFailures,
  };
}

function createInvocationCompletedRecord<T extends InvocationResult>(args: {
  telemetry: InvocationTelemetryContext;
  invocationId: string;
  metadata: { agent: string; model: string };
  bindingId: string;
  bindingIndex: number;
  result: T;
  durationMs: number;
}): InvocationCompletedRecord {
  return {
    schema_version: 1,
    record_kind: "invocation_completed",
    ts: new Date().toISOString(),
    operator_session_id: args.telemetry.operatorSessionId,
    run_id: args.telemetry.runId,
    attempt_id: args.telemetry.attemptId,
    invocation_id: args.invocationId,
    project: args.telemetry.project,
    workflow: args.telemetry.workflow,
    step_id: args.telemetry.stepId,
    role: args.telemetry.role,
    agent: args.metadata.agent,
    model: args.metadata.model,
    binding_id: args.bindingId,
    binding_index: args.bindingIndex,
    duration_ms: args.durationMs,
    worktree_path: args.telemetry.worktreePath,
    branch: args.telemetry.branch,
    spec_ref: args.telemetry.specRef,
    usage: {
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    },
    usage_source: "unavailable",
    cost_usd: null,
    cost_source: "unavailable",
    exit_kind: args.result.kind,
    exit_reason:
      args.result.kind === "ok"
        ? null
        : args.result.kind === "error"
          ? `exit_code:${args.result.exitCode}`
          : args.result.stderr,
  };
}
