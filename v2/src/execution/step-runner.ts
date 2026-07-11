import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationResult,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";

const TERMINAL_TOKENS = ["done", "no-work", "blocked", "progress"] as const;

type StepOutcomeToken = (typeof TERMINAL_TOKENS)[number];

/** A deterministic, side-effect-free pass/fail check run after a terminal token. */
export type StepContract = {
  id: string;
  reason?: string;
  check: (args: { cwd: string }) => boolean | Promise<boolean>;
};

type StepRunInput = {
  prompt: string;
  cwd: string;
  bindings: readonly InvocationBinding[];
  contracts: readonly StepContract[];
  signal?: AbortSignal;
  telemetry?: InvocationTelemetryContext;
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
      failureReason?: string;
    }
  | { kind: "invalid_token"; tokenText: string }
  | {
      kind: "invocation_failure";
      failureKind: InvocationFailureKind;
    }
);

const TOKEN_WORD_PATTERN = new RegExp(`\\b(${TERMINAL_TOKENS.join("|")})\\b`, "g");

function asToken(value: string): StepOutcomeToken | null {
  return TERMINAL_TOKENS.includes(value as StepOutcomeToken) ? (value as StepOutcomeToken) : null;
}

// Agents emit prose, so prefer the most explicit signal: exact match, then a
// bare-token line, then a lenient last-word scan.
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

/** One invocation pass through the ordered bindings, then classify; no hidden retries. */
export async function runStep(args: StepRunInput): Promise<StepRunResult> {
  const invocation = await executeWithQuotaFallback({
    prompt: args.prompt,
    cwd: args.cwd,
    bindings: args.bindings,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.telemetry !== undefined ? { telemetry: args.telemetry } : {}),
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
        ...(contract.reason !== undefined ? { failureReason: contract.reason } : {}),
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
