export type InvocationOk = {
  kind: "ok";
  stdout: string;
  stderr: string;
};

export type InvocationQuota = {
  kind: "quota";
  stderr: string;
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
};

export type InvocationAttempt<T extends InvocationResult = InvocationResult> = {
  binding: InvocationBinding<T>;
  result: T;
};

export type InvocationExecution<T extends InvocationResult = InvocationResult> = {
  attempts: InvocationAttempt<T>[];
  final: InvocationAttempt<T> | null;
};

/**
 * Run bindings in order, advancing to the next only on `quota`.
 *
 * Fallback is quota-only by design: `model_config` and `error` are terminal and
 * stop the chain, since a misconfigured or crashing agent is not something the
 * next agent can paper over. Mirrors v1 fallback semantics.
 */
export async function executeWithQuotaFallback<T extends InvocationResult = InvocationResult>(args: {
  prompt: string;
  cwd: string;
  bindings: readonly InvocationBinding<T>[];
  signal?: AbortSignal;
}): Promise<InvocationExecution<T>> {
  const attempts: InvocationAttempt<T>[] = [];

  for (const binding of args.bindings) {
    const result = await binding.invoke({
      prompt: args.prompt,
      cwd: args.cwd,
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
    });
    const attempt = { binding, result };
    attempts.push(attempt);
    const shouldAdvance = binding.shouldAdvance ? binding.shouldAdvance(result) : result.kind === "quota";
    if (shouldAdvance) {
      continue;
    }
    return { attempts, final: attempt };
  }

  const final = attempts.length === 0 ? null : (attempts[attempts.length - 1] ?? null);
  return {
    attempts,
    final,
  };
}
