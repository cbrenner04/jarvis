import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationResult,
} from "../../shared/invocation/execute.ts";

const TERMINAL_TOKENS = ["done", "no-work", "blocked", "progress"] as const;

/** Agent-declared terminal outcome tokens accepted by the shared step runner. */
export type StepOutcomeToken = (typeof TERMINAL_TOKENS)[number];

/**
 * Deterministic contract primitive evaluated by the shared step runner.
 *
 * Contracts must not mutate state. They return a boolean pass/fail signal for
 * the current workspace state.
 */
export type StepContract = {
  id: string;
  check: (args: { cwd: string }) => boolean | Promise<boolean>;
};

/**
 * Runner-owned input bundle.
 *
 * The behavior prompt and terminal contracts are caller input; token parsing,
 * invocation fallback dispatch, and result classification are runner-owned.
 */
export type StepRunInput = {
  prompt: string;
  cwd: string;
  bindings: readonly InvocationBinding[];
  contracts: readonly StepContract[];
  signal?: AbortSignal;
};

/** Classified result for one shared step-runner invocation. */
export type StepRunResult =
  | {
      kind: "complete";
      token: "done" | "no-work";
      invocation: InvocationExecution;
    }
  | {
      kind: "progress";
      token: "progress";
      invocation: InvocationExecution;
    }
  | {
      kind: "blocked";
      token: "blocked";
      invocation: InvocationExecution;
    }
  | {
      kind: "contract_miss";
      token: "done" | "no-work";
      failedContractId: string;
      invocation: InvocationExecution;
    }
  | {
      kind: "invalid_token";
      tokenText: string;
      invocation: InvocationExecution;
    }
  | {
      kind: "invocation_failure";
      failureKind: "quota" | "model_config" | "error" | "no_binding";
      invocation: InvocationExecution;
    };

/** Parse an invocation stdout payload into an accepted terminal outcome token. */
export function parseStepOutcomeToken(stdout: string): StepOutcomeToken | null {
  const trimmed = stdout.trim();
  if (TERMINAL_TOKENS.includes(trimmed as StepOutcomeToken)) {
    return trimmed as StepOutcomeToken;
  }

  const matches = [...trimmed.matchAll(/\b(done|no-work|blocked|progress)\b/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1]?.[1];
  if (last === undefined) return null;
  return last as StepOutcomeToken;
}

/**
 * Run one behavior step over shared invocation fallback and classify the result.
 *
 * This function performs exactly one invocation pass through the ordered
 * bindings and never performs hidden retries on contract misses.
 */
export async function runStep(args: StepRunInput): Promise<StepRunResult> {
  const invocation = await executeWithQuotaFallback({
    prompt: args.prompt,
    cwd: args.cwd,
    bindings: args.bindings,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  });

  const final = invocation.final;
  if (final === null) {
    return {
      kind: "invocation_failure",
      failureKind: "no_binding",
      invocation,
    };
  }

  const result: InvocationResult = final.result;
  if (result.kind !== "ok") {
    return {
      kind: "invocation_failure",
      failureKind: result.kind,
      invocation,
    };
  }

  const token = parseStepOutcomeToken(result.stdout);
  if (token === null) {
    return {
      kind: "invalid_token",
      tokenText: result.stdout.trim(),
      invocation,
    };
  }

  if (token === "blocked") {
    return {
      kind: "blocked",
      token,
      invocation,
    };
  }

  if (token === "progress") {
    return {
      kind: "progress",
      token,
      invocation,
    };
  }

  for (const contract of args.contracts) {
    if (!(await contract.check({ cwd: args.cwd }))) {
      return {
        kind: "contract_miss",
        token,
        failedContractId: contract.id,
        invocation,
      };
    }
  }

  return {
    kind: "complete",
    token,
    invocation,
  };
}
