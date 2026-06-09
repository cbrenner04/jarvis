import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { enforceDelimiterPolicy } from "../../../../shared/prompts/render.ts";
import { createAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentName, AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { detectBlocker } from "./blocker.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { readGitPorcelainSnapshot } from "./git-porcelain.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";
import { renderTemplate, TemplateRenderingError } from "./template-renderer.ts";

/** Level-2 heading for explicit no-op refine outcome (append-only). */
export const REFINE_SKIP_HEADING = "## Refine skip";
/** Level-2 heading for the refine-owned single living ledger. */
export const REFINE_HEADING = "## Refinement";

export type RefinePhaseOptions = {
  worktreePath: string;
  name: string;
  config: Config;
  refineTurns?: number;
  /** When set, quota rotation emits lines aligned with patch harness wording. */
  stderr?: (s: string) => void;
  planTelemetry?: PlanTelemetryWriter | undefined;
  /**
   * For no-commit specs, the external spec root where the spec is stored.
   * If provided, spec reads/writes happen here instead of under worktreePath/spec/.
   */
  externalSpecRoot?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
  /** Logs the built prompt before invoking the agent (mirrors patch-mode outbound logging). */
  onOutboundPrompt?: (prompt: string) => void;
};

/** Outcome for default CLI reporting after the refine phase completes. */
export type RefineTerminalOutcome = "refined" | "skipped" | "blocker" | "not_run";

/**
 * Build the refine phase prompt by injecting intent.md, spec guidance, and rules.
 */
export function buildRefinePrompt(opts: {
  name: string;
  intent: string;
  specGuidance: string;
  turnsRemaining: number;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
}): string {
  const registry = loadPromptRegistry();
  let template = assemblePromptForStep({
    registry,
    stepPromptId: "plan.prompt.refine",
  });

  const targetDir = opts.targetDir ?? "spec";
  template = template.replaceAll("spec/<NAME>/", `${targetDir}/<NAME>/`);

  enforceDelimiterPolicy({
    value: opts.intent,
    begin: "<<<INTENT_BEGIN>>>",
    end: "<<<INTENT_END>>>",
    placeholderName: "INTENT",
  });
  enforceDelimiterPolicy({
    value: opts.specGuidance,
    begin: "<<<SPEC_GUIDANCE_BEGIN>>>",
    end: "<<<SPEC_GUIDANCE_END>>>",
    placeholderName: "SPEC_GUIDANCE",
  });

  try {
    template = renderTemplate(template, new Set(["WORKDIR", "NAME", "INTENT", "SPEC_GUIDANCE", "TURNS_REMAINING"]), {
      WORKDIR: opts.name,
      NAME: opts.name,
      INTENT: opts.intent,
      SPEC_GUIDANCE: opts.specGuidance,
      TURNS_REMAINING: opts.turnsRemaining.toString(),
    });
  } catch (err) {
    if (err instanceof TemplateRenderingError) {
      throw new Error(`refine prompt configuration error: ${err.details}`);
    }
    throw err;
  }

  return template;
}

export async function runRefineTurn(opts: {
  worktreePath: string;
  name: string;
  config: Config;
  turnNumber: number;
  totalTurns: number;
  stderr?: (s: string) => void;
  planTelemetry?: PlanTelemetryWriter | undefined;
  /**
   * For no-commit specs, the external spec root where the spec is stored.
   * If provided, spec reads/writes happen here instead of under worktreePath/spec/.
   */
  externalSpecRoot?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
  /** Logs the built prompt before invoking the agent (mirrors patch-mode outbound logging). */
  onOutboundPrompt?: (prompt: string) => void;
}): Promise<{
  result: AgentResult;
  agentLabel: string | null;
  continueRefine: boolean;
  blocker?: string | undefined;
}> {
  // Read current intent.md
  const intentPath = opts.externalSpecRoot
    ? join(opts.externalSpecRoot, opts.name, "intent.md")
    : join(opts.worktreePath, opts.targetDir ?? "spec", opts.name, "intent.md");
  const intentBefore = readFileSync(intentPath, "utf8");

  // Read spec guidance
  const docsPath = join(import.meta.dir, "..", "..", "..", "docs", "spec-guidance.md");
  const specGuidance = readFileSync(docsPath, "utf8");

  // Build the prompt
  let prompt: string;
  try {
    prompt = buildRefinePrompt({
      name: opts.name,
      intent: intentBefore,
      specGuidance,
      turnsRemaining: opts.totalTurns - opts.turnNumber + 1,
      ...(opts.targetDir !== undefined ? { targetDir: opts.targetDir } : {}),
    });
  } catch (err) {
    if (err instanceof Error) {
      return {
        result: {
          kind: "model_config",
          stderr: err.message,
        },
        agentLabel: null,
        continueRefine: false,
      };
    }
    throw err;
  }

  opts.onOutboundPrompt?.(prompt);

  // Try each agent in order until one succeeds
  const agentOrder = opts.config.modes.plan.agentOrder;
  let result: AgentResult | null = null;
  let agentLabel: string | null = null;

  for (const entry of agentOrder) {
    const agent = createAgent(entry.agent, entry.model);
    agentLabel = agent.attributionLabel?.() ?? `${entry.agent} (${entry.model})`;

    const porcelainBefore = readGitPorcelainSnapshot(opts.worktreePath);
    const invocationStartedAt = Date.now();
    const spawnResult = await agent.run(prompt, {
      cwd: opts.worktreePath,
    });
    const porcelainAfter = readGitPorcelainSnapshot(opts.worktreePath);
    const noDiskChangeDuringInvocation =
      porcelainBefore !== null && porcelainAfter !== null && porcelainBefore === porcelainAfter;
    result = applyQuotaFallbackWhenAllowed(
      entry.agent,
      spawnResult,
      {
        quotaFallback: opts.config.quotaFallback,
        weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
      },
      noDiskChangeDuringInvocation,
    );
    emitPlanAgentQuotaFallback(opts.stderr, entry.agent, spawnResult, result);

    opts.planTelemetry?.recordAgentAttempt({
      phase: "refine",
      agentCli: entry.agent,
      configuredModel: entry.model,
      durationMs: Date.now() - invocationStartedAt,
      result,
    });

    if (result.kind === "ok") {
      // Agent succeeded; validate the output
      const intentAfter = readFileSync(intentPath, "utf8");

      // Check for blocker
      const blockerDetection = detectBlocker(intentAfter);
      if (blockerDetection.hasBlocker) {
        return {
          result,
          agentLabel,
          continueRefine: false,
          blocker: blockerDetection.body,
        };
      }

      // Explicit non-interactive skip.
      if (isValidRefineSkipAddition(intentBefore, intentAfter)) {
        return {
          result,
          agentLabel,
          continueRefine: false,
        };
      }

      // Check if intent.md was modified
      const wasModified = intentBefore !== intentAfter;

      const hasRefinementSection = hasHeading(intentAfter, REFINE_HEADING);

      if (!wasModified) {
        return {
          result: {
            kind: "error",
            exitCode: 1,
            stderr: `refine: intent.md unchanged on turn ${opts.turnNumber}; write ${REFINE_HEADING}, append ${REFINE_SKIP_HEADING}, or append ## Blocker`,
          },
          agentLabel,
          continueRefine: false,
        };
      }

      if (!hasRefinementSection) {
        if (isFrontmatterOnlyChange(intentBefore, intentAfter)) {
          return {
            result: {
              kind: "error",
              exitCode: 1,
              stderr: `refine: intent.md only changed frontmatter on turn ${opts.turnNumber}; write ${REFINE_HEADING} or append ${REFINE_SKIP_HEADING} to the body`,
            },
            agentLabel,
            continueRefine: false,
          };
        }
        return {
          result: {
            kind: "error",
            exitCode: 1,
            stderr: `refine: invalid intent.md modification on turn ${opts.turnNumber}; expected ${REFINE_HEADING}, ${REFINE_SKIP_HEADING}, or ## Blocker`,
          },
          agentLabel,
          continueRefine: false,
        };
      }

      if (!isValidRefineTurnAddition(intentBefore, intentAfter, opts.turnNumber)) {
        return {
          result: {
            kind: "error",
            exitCode: 1,
            stderr: `refine: invalid intent.md modification on turn ${opts.turnNumber}; preserve the human-authored seed above ${REFINE_HEADING} exactly (except permitted name frontmatter), then consolidate from ${REFINE_HEADING} downward`,
          },
          agentLabel,
          continueRefine: false,
        };
      }

      // Continue the refine phase
      return {
        result,
        agentLabel,
        continueRefine: true,
      };
    }

    if (result.kind === "quota") {
      continue;
    }

    if (result.kind === "model_config") {
      // Model config error is fatal
      return { result, agentLabel, continueRefine: false };
    }
  }

  // All agents exhausted
  if (result === null) {
    return {
      result: {
        kind: "error",
        exitCode: 2,
        stderr: `${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} (no agent invocations)`,
      },
      agentLabel: null,
      continueRefine: false,
    };
  }

  // Last result (could be quota, error, or model_config)
  return { result, agentLabel, continueRefine: false };
}

function stripFrontmatter(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return normalized;
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return normalized;
  }
  const body = normalized.slice(end + 5);
  return body.startsWith("\n") ? body.slice(1) : body;
}

function isFrontmatterOnlyChange(before: string, after: string): boolean {
  return stripFrontmatter(before).trimEnd() === stripFrontmatter(after).trimEnd();
}

function normalizeLines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function hasHeading(text: string, heading: string): boolean {
  return normalizeLines(text)
    .split("\n")
    .some((line) => line === heading);
}

function prefixBeforeHeading(text: string, heading: string): string {
  const normalized = normalizeLines(text);
  const marker = `\n${heading}\n`;
  if (normalized.startsWith(`${heading}\n`)) {
    return "";
  }
  const index = normalized.indexOf(marker);
  if (index === -1) {
    return normalized;
  }
  return normalized.slice(0, index);
}

function ledgerFromHeading(text: string, heading: string): string | null {
  const normalized = normalizeLines(text);
  if (normalized.startsWith(`${heading}\n`)) {
    return normalized;
  }
  const marker = `\n${heading}\n`;
  const index = normalized.indexOf(marker);
  if (index === -1) {
    return null;
  }
  return normalized.slice(index + 1);
}

/**
 * Validate refine consolidation: preserve frozen seed above first ledger heading.
 */
export function isValidRefineTurnAddition(before: string, after: string, _turnNumber: number): boolean {
  const afterLedger = ledgerFromHeading(after, REFINE_HEADING);
  if (afterLedger === null) {
    return false;
  }
  const beforePrefix = prefixBeforeHeading(before, REFINE_HEADING);
  const afterPrefix = prefixBeforeHeading(after, REFINE_HEADING);
  return stripFrontmatter(afterPrefix).trimEnd() === stripFrontmatter(beforePrefix).trimEnd();
}

/**
 * Validate that the only body change is an append-only `## Refine skip` section.
 */
export function isValidRefineSkipAddition(before: string, after: string): boolean {
  const skipHeaderIndex = normalizeLines(after).lastIndexOf(REFINE_SKIP_HEADING);
  if (skipHeaderIndex === -1) {
    return false;
  }
  const afterWithoutSkip = normalizeLines(after).slice(0, skipHeaderIndex).trimEnd();
  const beforeNormalized = normalizeLines(before).trimEnd();

  const beforeLedger = ledgerFromHeading(before, REFINE_HEADING);
  const afterLedger = ledgerFromHeading(afterWithoutSkip, REFINE_HEADING);
  if (beforeLedger !== null || afterLedger !== null) {
    if ((beforeLedger ?? "").trimEnd() !== (afterLedger ?? "").trimEnd()) {
      return false;
    }
  }
  const beforePrefix = prefixBeforeHeading(beforeNormalized, REFINE_HEADING);
  const afterPrefix = prefixBeforeHeading(afterWithoutSkip, REFINE_HEADING);
  return stripFrontmatter(afterPrefix).trimEnd() === stripFrontmatter(beforePrefix).trimEnd();
}

/**
 * Classify persisted intent for reporting and plan commits (blocker wins over skip).
 */
export function classifyRefineIntentOutcome(intent: string): "refined" | "skipped" | "blocker" {
  const blocker = detectBlocker(intent);
  if (blocker.hasBlocker) {
    return "blocker";
  }
  for (const line of intent.replace(/\r\n/g, "\n").split("\n")) {
    if (line === REFINE_SKIP_HEADING) {
      return "skipped";
    }
  }
  if (hasHeading(intent, REFINE_HEADING)) {
    return "refined";
  }
  return "refined";
}

/**
 * Run the complete refine phase.
 */
export async function runRefinePhase(opts: RefinePhaseOptions): Promise<{
  result: AgentResult;
  completedTurns: number;
  agentLabel: string | null;
  blocker?: string | undefined;
  terminalOutcome?: RefineTerminalOutcome | undefined;
}> {
  const budgetTurns = opts.refineTurns ?? 3;

  // If budget is 0, skip entirely
  if (budgetTurns === 0) {
    return {
      result: { kind: "ok", stdout: "", stderr: "" },
      completedTurns: 0,
      agentLabel: null,
      terminalOutcome: "not_run",
    };
  }

  opts.stderr?.("plan: refine phase started\n");

  let completedTurns = 0;
  let agentLabel: string | null = null;

  for (let turn = 1; turn <= budgetTurns; turn += 1) {
    const turnResult = await runRefineTurn({
      worktreePath: opts.worktreePath,
      name: opts.name,
      config: opts.config,
      turnNumber: turn,
      totalTurns: budgetTurns,
      ...(opts.stderr !== undefined ? { stderr: opts.stderr } : {}),
      ...(opts.planTelemetry !== undefined ? { planTelemetry: opts.planTelemetry } : {}),
      ...(opts.externalSpecRoot !== undefined ? { externalSpecRoot: opts.externalSpecRoot } : {}),
      ...(opts.targetDir !== undefined ? { targetDir: opts.targetDir } : {}),
      ...(opts.onOutboundPrompt !== undefined ? { onOutboundPrompt: opts.onOutboundPrompt } : {}),
    });

    // Update agent label (use the most recent non-null one)
    if (turnResult.agentLabel !== null) {
      agentLabel = turnResult.agentLabel;
    }

    // Handle errors
    if (turnResult.result.kind !== "ok") {
      return {
        result: turnResult.result,
        completedTurns,
        agentLabel,
        blocker: turnResult.blocker,
      };
    }

    // Check for blocker
    if (turnResult.blocker !== undefined) {
      return {
        result: turnResult.result,
        completedTurns,
        agentLabel,
        blocker: turnResult.blocker,
        terminalOutcome: "blocker",
      };
    }

    // If agent decided to stop, break
    if (!turnResult.continueRefine) {
      break;
    }

    completedTurns = turn;
  }

  const finalIntentPath = opts.externalSpecRoot
    ? join(opts.externalSpecRoot, opts.name, "intent.md")
    : join(opts.worktreePath, opts.targetDir ?? "spec", opts.name, "intent.md");
  const finalIntent = readFileSync(finalIntentPath, "utf8");
  const terminalOutcome = classifyRefineIntentOutcome(finalIntent);

  return {
    result: { kind: "ok", stdout: "", stderr: "" },
    completedTurns,
    agentLabel,
    terminalOutcome,
  };
}

/**
 * Build a verdict-driven refine prompt that runs one turn based on a review verdict.
 * The verdict becomes the instructions for what the spec needs.
 */
export function buildVerdictRefinePrompt(opts: {
  name: string;
  intent: string;
  specGuidance: string;
  verdict: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
}): string {
  const registry = loadPromptRegistry();
  let template = assemblePromptForStep({
    registry,
    stepPromptId: "plan.prompt.refine",
  });

  const targetDir = opts.targetDir ?? "spec";
  template = template.replaceAll("spec/<NAME>/", `${targetDir}/<NAME>/`);

  enforceDelimiterPolicy({
    value: opts.intent,
    begin: "<<<INTENT_BEGIN>>>",
    end: "<<<INTENT_END>>>",
    placeholderName: "INTENT",
  });
  enforceDelimiterPolicy({
    value: opts.specGuidance,
    begin: "<<<SPEC_GUIDANCE_BEGIN>>>",
    end: "<<<SPEC_GUIDANCE_END>>>",
    placeholderName: "SPEC_GUIDANCE",
  });

  try {
    template = renderTemplate(template, new Set(["WORKDIR", "NAME", "INTENT", "SPEC_GUIDANCE", "TURNS_REMAINING"]), {
      WORKDIR: opts.name,
      NAME: opts.name,
      INTENT: opts.intent,
      SPEC_GUIDANCE: opts.specGuidance,
      TURNS_REMAINING: "1",
    });
  } catch (err) {
    if (err instanceof TemplateRenderingError) {
      throw new Error(`refine prompt configuration error: ${err.details}`);
    }
    throw err;
  }

  // Replace the instructions with the verdict
  const basePrompt = template.replace(
    /## Instructions\s*\n\nRead the intent and repo context\..*?(?=##|$)/s,
    `## Review Verdict\n\nAddress the following required refinements to the spec:\n\n${opts.verdict}`,
  );

  return basePrompt.trim();
}

export type VerdictExecutorOptions = {
  worktreePath: string;
  name: string;
  config: Config;
  verdict: string;
  stderr?: ((s: string) => void) | undefined;
  planTelemetry?: PlanTelemetryWriter | undefined;
  externalSpecRoot?: string | undefined;
  targetDir?: string | undefined;
  onOutboundPrompt?: ((prompt: string) => void) | undefined;
  createAgent?: ((agentName: AgentName, model: string | undefined) => Agent) | undefined;
};

/**
 * Run the verdict executor: apply a review verdict to the spec via one refine turn.
 */
export async function runVerdictExecutor(opts: VerdictExecutorOptions): Promise<void> {
  const intentPath = opts.externalSpecRoot
    ? join(opts.externalSpecRoot, opts.name, "intent.md")
    : join(opts.worktreePath, opts.targetDir ?? "spec", opts.name, "intent.md");
  const intentBefore = readFileSync(intentPath, "utf8");

  const docsPath = join(import.meta.dir, "..", "..", "..", "docs", "spec-guidance.md");
  const specGuidance = readFileSync(docsPath, "utf8");

  let prompt: string;
  try {
    prompt = buildVerdictRefinePrompt({
      name: opts.name,
      intent: intentBefore,
      specGuidance,
      verdict: opts.verdict,
      ...(opts.targetDir !== undefined ? { targetDir: opts.targetDir } : {}),
    });
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`verdict executor prompt error: ${err.message}`);
    }
    throw err;
  }

  opts.onOutboundPrompt?.(prompt);

  // Try each agent in the plan order until one succeeds
  const agentOrder = opts.config.modes.plan.agentOrder;
  let result: AgentResult | null = null;
  let _agentLabel: string | null = null;

  for (const entry of agentOrder) {
    const agent = (opts.createAgent ?? createAgent)(entry.agent, entry.model);
    _agentLabel = agent.attributionLabel?.() ?? `${entry.agent} (${entry.model})`;

    const porcelainBefore = readGitPorcelainSnapshot(opts.worktreePath);
    const invocationStartedAt = Date.now();
    const spawnResult = await agent.run(prompt, {
      cwd: opts.worktreePath,
    });
    const porcelainAfter = readGitPorcelainSnapshot(opts.worktreePath);
    const noDiskChangeDuringInvocation =
      porcelainBefore !== null && porcelainAfter !== null && porcelainBefore === porcelainAfter;
    result = applyQuotaFallbackWhenAllowed(
      entry.agent,
      spawnResult,
      {
        quotaFallback: opts.config.quotaFallback,
        weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
      },
      noDiskChangeDuringInvocation,
    );
    emitPlanAgentQuotaFallback(opts.stderr, entry.agent, spawnResult, result);

    opts.planTelemetry?.recordAgentAttempt({
      phase: "review",
      agentCli: entry.agent,
      configuredModel: entry.model,
      durationMs: Date.now() - invocationStartedAt,
      result,
    });

    if (result.kind === "ok") {
      // Success
      opts.stderr?.(`plan: verdict executor completed\n`);
      return;
    }

    if (result.kind === "quota") {
      // Try next agent
      continue;
    }

    // Error or model config: fail
    throw new Error(`verdict executor error (${result.kind})`);
  }

  // All agents exhausted
  throw new Error(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
}
