import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { enforceDelimiterPolicy } from "../../../../shared/prompts/render.ts";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { detectBlocker, hasGenuineBlocker } from "./blocker.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { readGitPorcelainSnapshot } from "./git-porcelain.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";
import { resolvePlanSpecDirPath } from "./spec-dir.ts";
import { renderTemplate, TemplateRenderingError } from "./template-renderer.ts";

export type DraftPhaseOptions = {
  worktreePath: string;
  name: string;
  /** When set (no-commit external storage), spec files live here instead of `spec/<name>/`. */
  specDirPath?: string;
  /** Agent working directory; defaults to `worktreePath`. */
  agentCwd?: string;
  config: Config;
  intentBefore?: string;
  stderr?: (s: string) => void;
  /** For tests only; defaults to real CLI agents. */
  createAgent?: (agentName: AgentName, model: string | undefined) => Agent;
  planTelemetry?: PlanTelemetryWriter | undefined;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
  /** Logs the built prompt before invoking the agent (mirrors patch-mode outbound logging). */
  onOutboundPrompt?: (prompt: string) => void;
};

/**
 * Build the draft phase prompt by injecting intent.md, spec guidance, and rules.
 */
export function buildDraftPrompt(opts: {
  name: string;
  intent: string;
  specGuidance: string;
  /** External no-commit layout: files live in the working directory, not `spec/<name>/`. */
  flatSpecLayout?: boolean;
  workDirLabel?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
}): string {
  const registry = loadPromptRegistry();
  let template = assemblePromptForStep({
    registry,
    stepPromptId: "plan.prompt.draft",
  });

  const workDir = opts.workDirLabel ?? opts.name;
  const targetDir = opts.targetDir ?? "spec";
  if (opts.flatSpecLayout) {
    template = template.replace(
      "- **Only write files under `spec/<NAME>/`.**",
      "- **Only write files in the working directory.** Do not create `spec/` subdirectories or other parent paths.",
    );
    template = template.replaceAll("spec/<NAME>/intent.md", "intent.md");
  } else {
    // For commit specs, replace the placeholder with the actual committed root
    template = template.replaceAll("spec/<NAME>/", `${targetDir}/<NAME>/`);
  }

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
    template = renderTemplate(template, new Set(["WORKDIR", "NAME", "INTENT", "SPEC_GUIDANCE"]), {
      WORKDIR: workDir,
      NAME: opts.name,
      INTENT: opts.intent,
      SPEC_GUIDANCE: opts.specGuidance,
    });
  } catch (err) {
    if (err instanceof TemplateRenderingError) {
      throw new Error(`draft prompt configuration error: ${err.details}`);
    }
    throw err;
  }

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
  const specDirPath = resolvePlanSpecDirPath(opts.worktreePath, opts.name, opts.specDirPath, opts.targetDir);
  const flatSpecLayout = opts.specDirPath !== undefined;
  const agentCwd = opts.agentCwd ?? opts.worktreePath;

  // Read intent.md
  const intentPath = join(specDirPath, "intent.md");
  const intent = opts.intentBefore ?? readFileSync(intentPath, "utf8");

  // Read spec guidance from the main checkout
  // Note: using import.meta.dir to find our location, then navigate back to docs/
  const docsPath = join(import.meta.dir, "..", "..", "..", "docs", "spec-guidance.md");
  const specGuidance = readFileSync(docsPath, "utf8");

  // Build the prompt
  let prompt: string;
  try {
    prompt = buildDraftPrompt({
      name: opts.name,
      intent,
      specGuidance,
      ...(flatSpecLayout ? { flatSpecLayout: true, workDirLabel: specDirPath } : {}),
      ...(opts.targetDir !== undefined ? { targetDir: opts.targetDir } : {}),
    });
  } catch (err) {
    if (err instanceof Error) {
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

  opts.onOutboundPrompt?.(prompt);

  // Try each agent in order until one succeeds
  const agentOrder = opts.config.modes.plan.agentOrder;
  let result: AgentResult | null = null;
  let agentLabel: string | null = null;
  const resolveAgent = opts.createAgent ?? defaultCreateAgent;

  for (const entry of agentOrder) {
    const agent = resolveAgent(entry.agent, entry.model);
    agentLabel = agent.attributionLabel?.() ?? `${entry.agent} (${entry.model})`;

    const porcelainBefore = readGitPorcelainSnapshot(opts.worktreePath);
    const invocationStartedAt = Date.now();
    const spawnResult = await agent.run(prompt, {
      cwd: agentCwd,
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
      phase: "draft",
      agentCli: entry.agent,
      configuredModel: entry.model,
      durationMs: Date.now() - invocationStartedAt,
      result,
    });

    if (result.kind === "ok") {
      // Success! Count subspecs and return
      const subspecCount = countSubspecs(specDirPath);
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
function countSubspecs(specDirPath: string): number {
  if (!existsSync(specDirPath)) {
    return 0;
  }

  const files = readdirSync(specDirPath);
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
  specDirPath?: string,
  targetDir?: string,
): { valid: boolean; error: string | null; blocker?: string | undefined } {
  const specDir = resolvePlanSpecDirPath(worktreePath, name, specDirPath, targetDir);

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

  if (hasGenuineBlocker(intentAfter)) {
    const blockerDetection = detectBlocker(intentAfter);
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
        error: "intent.md was modified (only allowed modification is appending ## Blocker; frontmatter is immutable)",
      };
    }
  }

  return { valid: true, error: null };
}
