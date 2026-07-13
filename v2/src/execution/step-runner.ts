import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationResult,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";

const TERMINAL_TOKENS = ["done", "no-work", "blocked", "progress"] as const;
const TOKEN_REPROMPT_PROMPT_ID = "write.token-reprompt";

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

/** The first (token-less) response plus the token-only re-prompt's own invocation. */
export type StepReprompt = { responseText: string; invocation: InvocationExecution };

/** Classified result for one shared step-runner invocation. */
export type StepRunResult = { invocation: InvocationExecution; reprompt?: StepReprompt } & (
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

function buildTokenRepromptPrompt(responseText: string): string {
  const artifact = loadPromptRegistry().getById(TOKEN_REPROMPT_PROMPT_ID);
  const text = responseText.length > 0 ? responseText : "(the previous response was empty)";
  return renderArtifactTemplate(artifact, { RESPONSE_TEXT: text }).trim();
}

function requestTokenReprompt(args: StepRunInput, responseText: string): Promise<InvocationExecution> {
  return executeWithQuotaFallback({
    prompt: buildTokenRepromptPrompt(responseText),
    cwd: args.cwd,
    bindings: args.bindings,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.telemetry !== undefined
      ? { telemetry: { ...args.telemetry, invocationIds: args.bindings.map(() => crypto.randomUUID()) } }
      : {}),
  });
}

type StepTokenResolution =
  | { token: StepOutcomeToken; tokenText?: undefined; reprompt?: StepReprompt }
  | { token: null; tokenText: string; reprompt?: StepReprompt };

type ContractEvalResult = { ok: true } | { ok: false; failedContractId: string; failureReason?: string };

async function evaluateContracts(contracts: readonly StepContract[], cwd: string): Promise<ContractEvalResult> {
  for (const contract of contracts) {
    if (!(await contract.check({ cwd }))) {
      return {
        ok: false,
        failedContractId: contract.id,
        ...(contract.reason !== undefined ? { failureReason: contract.reason } : {}),
      };
    }
  }
  return { ok: true };
}

/** Resolves the terminal token, re-prompting once (token-only) when the first response carries none. */
async function resolveStepToken(args: StepRunInput, stdout: string): Promise<StepTokenResolution> {
  const firstToken = parseStepOutcomeToken(stdout);
  if (firstToken !== null) {
    return { token: firstToken };
  }

  const responseText = stdout.trim();
  const repromptInvocation = await requestTokenReprompt(args, responseText);
  const reprompt: StepReprompt = { responseText, invocation: repromptInvocation };
  const repromptResult = repromptInvocation.final?.result;
  const repromptToken =
    repromptResult !== undefined && repromptResult.kind === "ok" ? asToken(repromptResult.stdout.trim()) : null;

  if (repromptToken === null) {
    return { token: null, tokenText: responseText, reprompt };
  }
  return { token: repromptToken, reprompt };
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

  const resolved = await resolveStepToken(args, result.stdout);
  const repromptField = resolved.reprompt !== undefined ? { reprompt: resolved.reprompt } : {};
  const token = resolved.token;

  if (token === "blocked") {
    return {
      kind: "blocked",
      token,
      invocation,
      ...repromptField,
    };
  }

  if (token === "progress") {
    return {
      kind: "progress",
      token,
      invocation,
      ...repromptField,
    };
  }

  const contractResult = await evaluateContracts(args.contracts, args.cwd);

  if (token === null) {
    if (contractResult.ok) {
      return {
        kind: "complete",
        token: "done",
        invocation,
        ...repromptField,
      };
    }
    return {
      kind: "invalid_token",
      tokenText: resolved.tokenText,
      invocation,
      ...repromptField,
    };
  }

  if (!contractResult.ok) {
    return {
      kind: "contract_miss",
      token,
      failedContractId: contractResult.failedContractId,
      ...(contractResult.failureReason !== undefined ? { failureReason: contractResult.failureReason } : {}),
      invocation,
      ...repromptField,
    };
  }

  return {
    kind: "complete",
    token,
    invocation,
    ...repromptField,
  };
}
