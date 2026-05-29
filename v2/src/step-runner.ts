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
export type StepRunResult = { invocation: InvocationExecution } & (
  | { kind: "complete"; token: "done" | "no-work" }
  | { kind: "progress"; token: "progress" }
  | { kind: "blocked"; token: "blocked" }
  | {
      kind: "contract_miss";
      token: "done" | "no-work";
      failedContractId: string;
    }
  | { kind: "invalid_token"; tokenText: string }
  | {
      kind: "invocation_failure";
      failureKind: "quota" | "model_config" | "error" | "no_binding";
    }
);

const TOKEN_WORD_PATTERN = new RegExp(
  `\\b(${TERMINAL_TOKENS.join("|")})\\b`,
  "g",
);

function asToken(value: string): StepOutcomeToken | null {
  return TERMINAL_TOKENS.includes(value as StepOutcomeToken)
    ? (value as StepOutcomeToken)
    : null;
}

/**
 * Parse an invocation stdout payload into an accepted terminal outcome token.
 *
 * Real agents emit prose, so we prefer the most explicit signal available: an
 * exact match, then the last line that is itself a bare token, and only then a
 * lenient last-word scan over the whole output.
 */
export function parseStepOutcomeToken(stdout: string): StepOutcomeToken | null {
  const exact = asToken(stdout.trim());
  if (exact !== null) return exact;

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const token = asToken(lines[i] ?? "");
    if (token !== null) return token;
  }

  const matches = [...stdout.matchAll(TOKEN_WORD_PATTERN)];
  const last = matches[matches.length - 1]?.[1];
  return last === undefined ? null : (last as StepOutcomeToken);
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
