import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { detectBlocker } from "./blocker.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { readGitPorcelainSnapshot } from "./git-porcelain.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";

/** Level-2 heading for explicit no-op interview outcome (append-only). */
export const INTERVIEW_SKIP_HEADING = "## Interview skip";

export type InterviewPhaseOptions = {
  worktreePath: string;
  name: string;
  config: Config;
  interviewTurns?: number;
  /** When set, quota rotation emits lines aligned with patch harness wording. */
  stderr?: (s: string) => void;
  planTelemetry?: PlanTelemetryWriter | undefined;
};

/** Outcome for default CLI reporting after the interview phase completes. */
export type InterviewTerminalOutcome =
  | "refined"
  | "skipped"
  | "blocker"
  | "not_run";

class PlaceholderCollisionError extends Error {
  constructor(
    public field: string,
    public token: string,
  ) {
    super(
      `${field} contains the literal token \`${token}\`; this would corrupt the prompt`,
    );
    this.name = "PlaceholderCollisionError";
  }
}

const PLACEHOLDER_TOKENS = [
  "<INTENT>",
  "<SPEC_GUIDANCE>",
  "<NAME>",
  "<WORKDIR>",
  "<TURNS_REMAINING>",
];

function validatePlaceholders(
  values: Record<string, string>,
): PlaceholderCollisionError | null {
  for (const [field, value] of Object.entries(values)) {
    for (const token of PLACEHOLDER_TOKENS) {
      if (value.includes(token)) {
        return new PlaceholderCollisionError(field, token);
      }
    }
  }
  return null;
}

/**
 * Build the interview phase prompt by injecting intent.md, spec guidance, and rules.
 */
export function buildInterviewPrompt(opts: {
  name: string;
  intent: string;
  specGuidance: string;
  turnsRemaining: number;
}): string {
  const collisionError = validatePlaceholders({
    name: opts.name,
    intent: opts.intent,
    specGuidance: opts.specGuidance,
    turnsRemaining: opts.turnsRemaining.toString(),
  });
  if (collisionError !== null) {
    throw collisionError;
  }

  const promptFile = join(import.meta.dir, "prompts", "interview.md");
  let template = readFileSync(promptFile, "utf8");

  template = template.replaceAll("<WORKDIR>", opts.name);
  template = template.replaceAll("<NAME>", opts.name);
  template = template.replaceAll("<INTENT>", opts.intent);
  template = template.replaceAll("<SPEC_GUIDANCE>", opts.specGuidance);
  template = template.replaceAll(
    "<TURNS_REMAINING>",
    opts.turnsRemaining.toString(),
  );

  return template;
}

export async function runInterviewTurn(opts: {
  worktreePath: string;
  name: string;
  config: Config;
  turnNumber: number;
  totalTurns: number;
  stderr?: (s: string) => void;
  planTelemetry?: PlanTelemetryWriter | undefined;
}): Promise<{
  result: AgentResult;
  agentLabel: string | null;
  continueInterview: boolean;
  blocker?: string | undefined;
}> {
  // Read current intent.md
  const intentPath = join(opts.worktreePath, "spec", opts.name, "intent.md");
  const intentBefore = readFileSync(intentPath, "utf8");

  // Read spec guidance
  const docsPath = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "docs",
    "spec-guidance.md",
  );
  const specGuidance = readFileSync(docsPath, "utf8");

  // Build the prompt
  let prompt: string;
  try {
    prompt = buildInterviewPrompt({
      name: opts.name,
      intent: intentBefore,
      specGuidance,
      turnsRemaining: opts.totalTurns - opts.turnNumber + 1,
    });
  } catch (err) {
    if (err instanceof PlaceholderCollisionError) {
      return {
        result: {
          kind: "model_config",
          stderr: err.message,
        },
        agentLabel: null,
        continueInterview: false,
      };
    }
    throw err;
  }

  // Try each agent in order until one succeeds
  const agentOrder = opts.config.modes.plan.agentOrder;
  let result: AgentResult | null = null;
  let agentLabel: string | null = null;

  for (const entry of agentOrder) {
    const agent = createAgent(entry.agent, entry.model);
    agentLabel =
      agent.attributionLabel?.() ??
      `${entry.agent} (${entry.model})`;

    const porcelainBefore = readGitPorcelainSnapshot(opts.worktreePath);
    const invocationStartedAt = Date.now();
    const spawnResult = await agent.run(prompt, {
      cwd: opts.worktreePath,
    });
    const porcelainAfter = readGitPorcelainSnapshot(opts.worktreePath);
    const noDiskChangeDuringInvocation =
      porcelainBefore !== null &&
      porcelainAfter !== null &&
      porcelainBefore === porcelainAfter;
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
      phase: "interview",
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
          continueInterview: false,
          blocker: blockerDetection.body,
        };
      }

      // Explicit non-interactive skip (append-only ## Interview skip)
      if (isValidInterviewSkipAddition(intentBefore, intentAfter)) {
        return {
          result,
          agentLabel,
          continueInterview: false,
        };
      }

      // Check if intent.md was modified
      const wasModified = intentBefore !== intentAfter;

      // Check if the expected interview turn section was added
      const expectedTurnHeader = `## Interview turn ${opts.turnNumber}`;
      const hasNewTurnSection = intentAfter.includes(expectedTurnHeader);

      if (!wasModified) {
        return {
          result: {
            kind: "error",
            exitCode: 1,
            stderr: `interview: intent.md unchanged on turn ${opts.turnNumber}; append ${INTERVIEW_SKIP_HEADING}, ## Interview turn ${opts.turnNumber}, or ## Blocker`,
          },
          agentLabel,
          continueInterview: false,
        };
      }

      if (wasModified && !hasNewTurnSection) {
        if (isFrontmatterOnlyChange(intentBefore, intentAfter)) {
          return {
            result: {
              kind: "error",
              exitCode: 1,
              stderr: `interview: intent.md only changed frontmatter on turn ${opts.turnNumber}; append ${INTERVIEW_SKIP_HEADING} or ## Interview turn ${opts.turnNumber} to the body`,
            },
            agentLabel,
            continueInterview: false,
          };
        }
        return {
          result: {
            kind: "error",
            exitCode: 1,
            stderr: `interview: invalid intent.md modification on turn ${opts.turnNumber}; expected append-only ## Interview turn ${opts.turnNumber} or ${INTERVIEW_SKIP_HEADING}`,
          },
          agentLabel,
          continueInterview: false,
        };
      }

      // If intent was modified, validate that it's a valid modification
      if (wasModified) {
        // Check if the modification is valid: only new turn section added, nothing else modified
        if (
          !isValidInterviewTurnAddition(
            intentBefore,
            intentAfter,
            opts.turnNumber,
          )
        ) {
          return {
            result: {
              kind: "error",
              exitCode: 1,
              stderr: `interview: invalid intent.md modification on turn ${opts.turnNumber}; only appending ## Interview turn N section is allowed`,
            },
            agentLabel,
            continueInterview: false,
          };
        }
      }

      // Continue the interview
      return {
        result,
        agentLabel,
        continueInterview: true,
      };
    }

    if (result.kind === "quota") {
      continue;
    }

    if (result.kind === "model_config") {
      // Model config error is fatal
      return { result, agentLabel, continueInterview: false };
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
      continueInterview: false,
    };
  }

  // Last result (could be quota, error, or model_config)
  return { result, agentLabel, continueInterview: false };
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
  return (
    stripFrontmatter(before).trimEnd() === stripFrontmatter(after).trimEnd()
  );
}

/**
 * Validate that the only change to intent.md is appending a new interview turn section.
 */
export function isValidInterviewTurnAddition(
  before: string,
  after: string,
  turnNumber: number,
): boolean {
  const expectedTurnHeader = `## Interview turn ${turnNumber}`;

  // Find the appended turn header in the after version. Use the last
  // occurrence so user-supplied seed text can mention the heading literally.
  const turnHeaderIndex = after.lastIndexOf(expectedTurnHeader);
  if (turnHeaderIndex === -1) {
    return false;
  }

  // Extract everything before the new turn section
  const afterWithoutNewTurn = after.substring(0, turnHeaderIndex).trimEnd();

  // This should match the previous content, allowing only the leading
  // frontmatter naming update that the interview prompt permits.
  return (
    stripFrontmatter(afterWithoutNewTurn).trimEnd() ===
    stripFrontmatter(before).trimEnd()
  );
}

/**
 * Validate that the only body change is an append-only `## Interview skip` section.
 */
export function isValidInterviewSkipAddition(
  before: string,
  after: string,
): boolean {
  const skipHeaderIndex = after.lastIndexOf(INTERVIEW_SKIP_HEADING);
  if (skipHeaderIndex === -1) {
    return false;
  }
  const afterWithoutSkip = after.substring(0, skipHeaderIndex).trimEnd();
  return (
    stripFrontmatter(afterWithoutSkip).trimEnd() ===
    stripFrontmatter(before).trimEnd()
  );
}

/**
 * Classify persisted intent for reporting and plan commits (blocker wins over skip).
 */
export function classifyInterviewIntentOutcome(
  intent: string,
): "refined" | "skipped" | "blocker" {
  const blocker = detectBlocker(intent);
  if (blocker.hasBlocker) {
    return "blocker";
  }
  for (const line of intent.replace(/\r\n/g, "\n").split("\n")) {
    if (line === INTERVIEW_SKIP_HEADING) {
      return "skipped";
    }
  }
  return "refined";
}

/**
 * Run the complete interview phase.
 */
export async function runInterviewPhase(opts: InterviewPhaseOptions): Promise<{
  result: AgentResult;
  completedTurns: number;
  agentLabel: string | null;
  blocker?: string | undefined;
  terminalOutcome?: InterviewTerminalOutcome | undefined;
}> {
  const budgetTurns = opts.interviewTurns ?? 3;

  // If budget is 0, skip entirely
  if (budgetTurns === 0) {
    return {
      result: { kind: "ok", stdout: "", stderr: "" },
      completedTurns: 0,
      agentLabel: null,
      terminalOutcome: "not_run",
    };
  }

  opts.stderr?.("plan: interview phase started\n");

  let completedTurns = 0;
  let agentLabel: string | null = null;

  for (let turn = 1; turn <= budgetTurns; turn += 1) {
    const turnResult = await runInterviewTurn({
      worktreePath: opts.worktreePath,
      name: opts.name,
      config: opts.config,
      turnNumber: turn,
      totalTurns: budgetTurns,
      ...(opts.stderr !== undefined ? { stderr: opts.stderr } : {}),
      ...(opts.planTelemetry !== undefined
        ? { planTelemetry: opts.planTelemetry }
        : {}),
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
    if (!turnResult.continueInterview) {
      break;
    }

    completedTurns = turn;
  }

  const finalIntentPath = join(
    opts.worktreePath,
    "spec",
    opts.name,
    "intent.md",
  );
  const finalIntent = readFileSync(finalIntentPath, "utf8");
  const terminalOutcome = classifyInterviewIntentOutcome(finalIntent);

  return {
    result: { kind: "ok", stdout: "", stderr: "" },
    completedTurns,
    agentLabel,
    terminalOutcome,
  };
}
