import { readFileSync } from "node:fs";
import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationResult,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import type { SessionLog } from "../../../shared/invocation/session-log.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";
import { extractBlockerBody, hasGenuineBlocker } from "../../../shared/spec-parser.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";

const TERMINAL_TOKENS = ["done", "no-work", "blocked", "progress"] as const;
const TOKEN_REPROMPT_PROMPT_ID = "write.token-reprompt";
const BLOCKER_REPROMPT_PROMPT_ID = "write.blocker-reprompt";

type StepOutcomeToken = (typeof TERMINAL_TOKENS)[number];

/** A deterministic, side-effect-free pass/fail check run after a terminal token. */
export type StepContract = {
  id: string;
  reason?: string;
  check: (args: { cwd: string }) => boolean | Promise<boolean>;
};

/** Before/after check that a blocked token appended a new non-empty `## Blocker` to the spec file. */
export type BlockerTextContract = {
  id: string;
  specPath: string;
  specBefore: string;
};

type StepRunInput = {
  prompt: string;
  cwd: string;
  bindings: readonly InvocationBinding[];
  contracts: readonly StepContract[];
  blockerTextContract?: BlockerTextContract;
  signal?: AbortSignal;
  telemetry?: InvocationTelemetryContext;
  sessionLog?: SessionLog;
  onInvocationOutputProgress?: () => void;
  idleOutputMs?: number;
  joinProcessOnIdleStall?: boolean;
};

/** The first (token-less) response plus the token-only re-prompt's own invocation. */
export type StepReprompt = { responseText: string; invocation: InvocationExecution };

/** The blocker-text re-prompt's own invocation when a `blocked` token missed the blocker contract. */
export type BlockerReprompt = { responseText: string; invocation: InvocationExecution };

/** Classified result for one shared step-runner invocation. */
export type StepRunResult = {
  invocation: InvocationExecution;
  reprompt?: StepReprompt;
  blockerReprompt?: BlockerReprompt;
} & (
  | { kind: "complete"; token: "done" | "no-work" }
  | { kind: "progress"; token: "progress" }
  | { kind: "blocked"; token: "blocked"; blockerText?: string }
  | {
      kind: "contract_miss";
      token: "done" | "no-work";
      failedContractId: string;
      failureReason?: string;
    }
  | { kind: "invalid_token"; tokenText: string }
  | { kind: "missing_blocker"; token: "blocked"; responseText: string }
  | {
      kind: "invocation_failure";
      failureKind: InvocationFailureKind;
    }
  | {
      kind: "stall";
      boundMs?: number;
      agent?: string;
      model?: string;
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

/** signal/sessionLog/onOutputProgress extras shared by every `executeWithQuotaFallback` call site. */
function sharedInvocationExtras(args: StepRunInput) {
  return {
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.sessionLog !== undefined ? { sessionLog: args.sessionLog } : {}),
    ...(args.onInvocationOutputProgress !== undefined ? { onOutputProgress: args.onInvocationOutputProgress } : {}),
    ...(args.idleOutputMs !== undefined ? { idleOutputMs: args.idleOutputMs } : {}),
    ...(args.joinProcessOnIdleStall === true ? { joinProcessOnIdleStall: true } : {}),
  };
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
    ...sharedInvocationExtras(args),
    ...(args.telemetry !== undefined
      ? { telemetry: { ...args.telemetry, invocationIds: args.bindings.map(() => crypto.randomUUID()) } }
      : {}),
  });
}

function buildBlockerRepromptPrompt(): string {
  return loadPromptRegistry().getById(BLOCKER_REPROMPT_PROMPT_ID).body.trim();
}

function requestBlockerReprompt(args: StepRunInput): Promise<InvocationExecution> {
  return executeWithQuotaFallback({
    prompt: buildBlockerRepromptPrompt(),
    cwd: args.cwd,
    bindings: args.bindings,
    ...sharedInvocationExtras(args),
    ...(args.telemetry !== undefined
      ? { telemetry: { ...args.telemetry, invocationIds: args.bindings.map(() => crypto.randomUUID()) } }
      : {}),
  });
}

/** Classifies a stalled reprompt invocation the same way the primary step invocation is classified. */
function repromptStallResult(
  originalInvocation: InvocationExecution,
  stalledInvocation: InvocationExecution,
  args: StepRunInput,
  extra: { reprompt?: StepReprompt; blockerReprompt?: BlockerReprompt },
): StepRunResult {
  const stalledBinding = stalledInvocation.final?.binding;
  return {
    kind: "stall",
    invocation: originalInvocation,
    ...extra,
    ...(args.idleOutputMs !== undefined ? { boundMs: args.idleOutputMs } : {}),
    ...(stalledBinding?.metadata?.agent !== undefined ? { agent: stalledBinding.metadata.agent } : {}),
    ...(stalledBinding?.metadata?.model !== undefined ? { model: stalledBinding.metadata.model } : {}),
  };
}

function evaluateBlockerTextContract(contract: BlockerTextContract): { satisfied: boolean; blockerText?: string } {
  let specAfter: string;
  try {
    specAfter = readFileSync(contract.specPath, "utf8");
  } catch {
    return { satisfied: false };
  }
  if (!hasGenuineBlocker(contract.specBefore, specAfter)) {
    return { satisfied: false };
  }
  const blockerText = extractBlockerBody(specAfter)?.body;
  return { satisfied: true, ...(blockerText !== undefined ? { blockerText } : {}) };
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

async function resolveBlockedResult(
  args: StepRunInput,
  invocation: InvocationExecution,
  repromptField: { reprompt?: StepReprompt },
): Promise<StepRunResult> {
  const contract = args.blockerTextContract;
  if (contract === undefined) {
    return {
      kind: "blocked",
      token: "blocked",
      invocation,
      ...repromptField,
    };
  }

  const firstEval = evaluateBlockerTextContract(contract);
  if (firstEval.satisfied) {
    return {
      kind: "blocked",
      token: "blocked",
      invocation,
      ...repromptField,
      ...(firstEval.blockerText !== undefined ? { blockerText: firstEval.blockerText } : {}),
    };
  }

  const blockerRepromptInvocation = await requestBlockerReprompt(args);
  const repromptResult = blockerRepromptInvocation.final?.result;
  const responseText = repromptResult?.kind === "ok" ? repromptResult.stdout.trim() : "";
  const blockerReprompt: BlockerReprompt = { responseText, invocation: blockerRepromptInvocation };

  if (repromptResult?.kind === "stall") {
    return repromptStallResult(invocation, blockerRepromptInvocation, args, { ...repromptField, blockerReprompt });
  }

  const secondEval = evaluateBlockerTextContract(contract);
  if (secondEval.satisfied) {
    return {
      kind: "blocked",
      token: "blocked",
      invocation,
      ...repromptField,
      blockerReprompt,
      ...(secondEval.blockerText !== undefined ? { blockerText: secondEval.blockerText } : {}),
    };
  }

  return {
    kind: "missing_blocker",
    token: "blocked",
    responseText,
    invocation,
    ...repromptField,
    blockerReprompt,
  };
}

/** One invocation pass through the ordered bindings, then classify; no hidden retries. */
export async function runStep(args: StepRunInput): Promise<StepRunResult> {
  const invocation = await executeWithQuotaFallback({
    prompt: args.prompt,
    cwd: args.cwd,
    bindings: args.bindings,
    ...sharedInvocationExtras(args),
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
  if (result.kind === "stall") {
    return repromptStallResult(invocation, invocation, args, {});
  }
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

  if (resolved.reprompt?.invocation.final?.result.kind === "stall") {
    return repromptStallResult(invocation, resolved.reprompt.invocation, args, repromptField);
  }

  if (token === "blocked") {
    return resolveBlockedResult(args, invocation, repromptField);
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
