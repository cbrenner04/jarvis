import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeAgent } from "../../agents/claude.ts";
import { CodexAgent } from "../../agents/codex.ts";
import { CursorAgent } from "../../agents/cursor.ts";
import { OpencodeAgent } from "../../agents/opencode.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { detectBlocker } from "./blocker.ts";

export type InterviewPhaseOptions = {
  worktreePath: string;
  name: string;
  config: Config;
  interviewTurns?: number;
};

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

/**
 * Instantiate an agent from a config entry.
 */
function createAgent(agentName: AgentName, model: string | undefined): Agent {
  switch (agentName) {
    case "claude":
      return new ClaudeAgent(model ? { model } : {});
    case "codex":
      return new CodexAgent(model ? { model } : {});
    case "cursor":
      return new CursorAgent(model ? { model } : {});
    case "opencode":
      // OpenCode requires model to be set
      if (!model) {
        throw new Error("opencode agent requires model to be configured");
      }
      return new OpencodeAgent({ model });
  }
}

export type InterviewTurnResult = {
  result: AgentResult;
  agentLabel: string;
  completedTurns: number;
  blocker?: string | undefined;
};

/**
 * Run a single interview turn: invoke agent and validate output.
 * Returns whether the interview should continue.
 */
/**
 * Check if the agent output indicates use of the question tool.
 * This is a heuristic check based on stderr content.
 */
function didUseQuestionTool(result: AgentResult): boolean {
  if (result.kind !== "ok") {
    return false;
  }
  // Check stderr for question tool markers. The harness/claude CLI should output
  // some indication of tool usage. We use a simple heuristic here.
  const diagnostics = result.stderr.toLowerCase();
  return diagnostics.includes("question") || diagnostics.includes("tool");
}

export async function runInterviewTurn(opts: {
  worktreePath: string;
  name: string;
  config: Config;
  turnNumber: number;
  totalTurns: number;
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
      `${entry.agent} (${entry.model ?? "default"})`;

    result = await agent.run(prompt, {
      cwd: opts.worktreePath,
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

      // Check if intent.md was modified
      const wasModified = intentBefore !== intentAfter;

      // Check if the expected interview turn section was added
      const expectedTurnHeader = `## Interview turn ${opts.turnNumber}`;
      const hasNewTurnSection = intentAfter.includes(expectedTurnHeader);

      // Check if question tool was used
      const usedQuestionTool = didUseQuestionTool(result);

      if (!wasModified && !hasNewTurnSection) {
        // If the agent didn't modify intent but asked questions, that's an error
        if (usedQuestionTool) {
          return {
            result: {
              kind: "error",
              exitCode: 1,
              stderr: `interview: agent used question tool on turn ${opts.turnNumber} but did not write answers to intent.md`,
            },
            agentLabel,
            continueInterview: false,
          };
        }
        // Agent is done asking
        return {
          result,
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
        stderr: "all agents exhausted (no result produced)",
      },
      agentLabel: null,
      continueInterview: false,
    };
  }

  // Last result (could be quota, error, or model_config)
  return { result, agentLabel, continueInterview: false };
}

/**
 * Validate that the only change to intent.md is appending a new interview turn section.
 */
function isValidInterviewTurnAddition(
  before: string,
  after: string,
  turnNumber: number,
): boolean {
  const expectedTurnHeader = `## Interview turn ${turnNumber}`;

  // Find the turn header in the after version
  const turnHeaderIndex = after.indexOf(expectedTurnHeader);
  if (turnHeaderIndex === -1) {
    return false;
  }

  // Extract everything before the new turn section
  const afterWithoutNewTurn = after.substring(0, turnHeaderIndex).trimEnd();

  // This should match the before content
  return afterWithoutNewTurn === before.trimEnd();
}

/**
 * Run the complete interview phase.
 */
export async function runInterviewPhase(opts: InterviewPhaseOptions): Promise<{
  result: AgentResult;
  completedTurns: number;
  agentLabel: string | null;
  blocker?: string | undefined;
}> {
  const budgetTurns = opts.interviewTurns ?? 3;

  // If budget is 0, skip entirely
  if (budgetTurns === 0) {
    return {
      result: { kind: "ok", stdout: "", stderr: "" },
      completedTurns: 0,
      agentLabel: null,
    };
  }

  let completedTurns = 0;
  let agentLabel: string | null = null;

  for (let turn = 1; turn <= budgetTurns; turn += 1) {
    const turnResult = await runInterviewTurn({
      worktreePath: opts.worktreePath,
      name: opts.name,
      config: opts.config,
      turnNumber: turn,
      totalTurns: budgetTurns,
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
      };
    }

    // If agent decided to stop, break
    if (!turnResult.continueInterview) {
      break;
    }

    completedTurns = turn;
  }

  return {
    result: { kind: "ok", stdout: "", stderr: "" },
    completedTurns,
    agentLabel,
  };
}
