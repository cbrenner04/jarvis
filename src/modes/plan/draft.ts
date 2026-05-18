import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { detectBlocker } from "./blocker.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { readGitPorcelainSnapshot } from "./git-porcelain.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";

export type DraftPhaseOptions = {
  worktreePath: string;
  name: string;
  config: Config;
  intentBefore?: string;
  stderr?: (s: string) => void;
  /** For tests only; defaults to real CLI agents. */
  createAgent?: (agentName: AgentName, model: string | undefined) => Agent;
  planTelemetry?: PlanTelemetryWriter | undefined;
};

export class PlaceholderCollisionError extends Error {
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
  "<CURRENT_SPEC>",
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
 * Build the draft phase prompt by injecting intent.md, spec guidance, and rules.
 */
export function buildDraftPrompt(opts: {
  name: string;
  intent: string;
  specGuidance: string;
}): string {
  const collisionError = validatePlaceholders({
    name: opts.name,
    intent: opts.intent,
    specGuidance: opts.specGuidance,
  });
  if (collisionError !== null) {
    throw collisionError;
  }

  const promptFile = join(import.meta.dir, "prompts", "draft.md");
  let template = readFileSync(promptFile, "utf8");

  template = template.replaceAll("<WORKDIR>", opts.name);
  template = template.replaceAll("<NAME>", opts.name);
  template = template.replaceAll("<INTENT>", opts.intent);
  template = template.replaceAll("<SPEC_GUIDANCE>", opts.specGuidance);

  return template;
}

/**
 * Run the draft phase: invoke an agent to generate the spec tree.
 * Returns the agent result and the number of subspecs generated.
 */
export async function runDraftPhase(opts: DraftPhaseOptions): Promise<{
  result: AgentResult;
  subspecCount: number | null;
  agentLabel: string | null;
}> {
  // Read intent.md
  const intentPath = join(opts.worktreePath, "spec", opts.name, "intent.md");
  const intent = readFileSync(intentPath, "utf8");

  // Read spec guidance from the main checkout
  // Note: using import.meta.dir to find our location, then navigate back to docs/
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
    prompt = buildDraftPrompt({
      name: opts.name,
      intent,
      specGuidance,
    });
  } catch (err) {
    if (err instanceof PlaceholderCollisionError) {
      return {
        result: {
          kind: "model_config",
          stderr: err.message,
        },
        subspecCount: null,
        agentLabel: null,
      };
    }
    throw err;
  }

  // Try each agent in order until one succeeds
  const agentOrder = opts.config.modes.plan.agentOrder;
  let result: AgentResult | null = null;
  let agentLabel: string | null = null;
  const resolveAgent = opts.createAgent ?? defaultCreateAgent;

  for (const entry of agentOrder) {
    const agent = resolveAgent(entry.agent, entry.model);
    agentLabel =
      agent.attributionLabel?.() ?? `${entry.agent} (${entry.model})`;

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
      phase: "draft",
      agentCli: entry.agent,
      configuredModel: entry.model,
      durationMs: Date.now() - invocationStartedAt,
      result,
    });

    if (result.kind === "ok") {
      // Success! Count subspecs and return
      const subspecCount = countSubspecs(opts.worktreePath, opts.name);
      return { result, subspecCount, agentLabel };
    }

    if (result.kind === "quota") {
      continue;
    }

    if (result.kind === "model_config") {
      // Model config error is fatal
      return { result, subspecCount: null, agentLabel };
    }
  }

  // All agents exhausted
  if (result === null) {
    // This shouldn't happen given the loop logic, but be defensive
    return {
      result: {
        kind: "error",
        exitCode: 2,
        stderr: `${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} (no agent invocations)`,
      },
      subspecCount: null,
      agentLabel: null,
    };
  }

  // Last result (could be quota, error, or model_config)
  return { result, subspecCount: null, agentLabel };
}

/**
 * Count the number of subspecs (files matching spec/<name>/NN-*.md).
 */
function countSubspecs(worktreePath: string, name: string): number {
  const specDir = join(worktreePath, "spec", name);
  if (!existsSync(specDir)) {
    return 0;
  }

  const files = readdirSync(specDir);
  return files.filter((f: string) => /^\d{2}-.*\.md$/.test(f)).length;
}

/**
 * Check if intent.md was only modified by appending a ## Blocker section.
 * Returns true if the modification is valid (either unchanged or only blocker added).
 */
function isValidIntentModification(before: string, after: string): boolean {
  if (before === after) {
    return true;
  }

  // Try removing blocker from after and see if it matches before
  const afterLines = after.replace(/\r\n/g, "\n").split("\n");
  let blockerIndex: number | undefined;

  for (let i = 0; i < afterLines.length; i += 1) {
    const line = afterLines[i] ?? "";
    if (line === "## Blocker") {
      blockerIndex = i;
      break;
    }
  }

  if (blockerIndex === undefined) {
    // No blocker section, so any modification is invalid
    return false;
  }

  // Reconstruct the file without the blocker section
  const beforeBlocker = afterLines.slice(0, blockerIndex).join("\n").trim();
  if (beforeBlocker !== before.trim()) {
    return false;
  }

  return readFrontmatter(before) === readFrontmatter(after);
}

function readFrontmatter(text: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return null;
  }
  return normalized.slice(0, end + 5);
}

/**
 * Validate that the agent produced the required spec tree structure.
 */
export function validateDraftOutput(
  worktreePath: string,
  name: string,
  intentBefore?: string,
): { valid: boolean; error: string | null; blocker?: string | undefined } {
  const specDir = join(worktreePath, "spec", name);

  // Check index.md exists
  const indexPath = join(specDir, "index.md");
  if (!existsSync(indexPath)) {
    return { valid: false, error: "index.md was not created" };
  }

  // Check at least one NN-*.md exists
  const files = readdirSync(specDir);
  const hasSubspecs = files.some((f: string) => /^\d{2}-.*\.md$/.test(f));

  // Check if blocker was added to intent.md
  const intentPath = join(specDir, "intent.md");
  const intentAfter = readFileSync(intentPath, "utf8");
  const blockerDetection = detectBlocker(intentAfter);

  if (blockerDetection.hasBlocker) {
    // If blocker exists, we can return early (spec generation doesn't need to have succeeded)
    return {
      valid: true,
      error: null,
      blocker: blockerDetection.body,
    };
  }

  if (!hasSubspecs) {
    return {
      valid: false,
      error: "no numbered subspecs (NN-*.md) were created",
    };
  }

  // Check intent.md was not modified (unless a blocker was added)
  if (intentBefore !== undefined) {
    if (!isValidIntentModification(intentBefore, intentAfter)) {
      return {
        valid: false,
        error:
          "intent.md was modified (only allowed modification is appending ## Blocker; frontmatter is immutable)",
      };
    }
  }

  return { valid: true, error: null };
}
