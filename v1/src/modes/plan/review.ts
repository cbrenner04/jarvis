import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { loadPromptRegistry } from "../../prompts/registry.ts";
import {
  assemblePromptForStep,
  enforceDelimiterPolicy,
} from "../../prompts/renderer.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { detectBlocker } from "./blocker.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { readGitPorcelainSnapshot } from "./git-porcelain.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";
import { resolvePlanSpecDirPath } from "./spec-dir.ts";
import { renderTemplate, TemplateRenderingError } from "./template-renderer.ts";

export type ReviewPhaseOptions = {
  worktreePath: string;
  name: string;
  specDirPath?: string;
  agentCwd?: string;
  config: Config;
  passNumber?: number;
  totalPasses?: number;
  stderr?: (s: string) => void;
  planTelemetry?: PlanTelemetryWriter | undefined;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
  /** Logs the built prompt before invoking the agent (mirrors patch-mode outbound logging). */
  onOutboundPrompt?: (prompt: string) => void;
};

/**
 * Build the review phase prompt by injecting intent.md, current spec files, and guidance.
 */
export function buildReviewPrompt(opts: {
  name: string;
  intent: string;
  specGuidance: string;
  currentSpec: string;
  passNumber?: number;
  totalPasses?: number;
  flatSpecLayout?: boolean;
  workDirLabel?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
}): string {
  const passNumber = opts.passNumber ?? 1;
  const totalPasses = opts.totalPasses ?? 1;

  const reviewPassContext =
    passNumber === 1
      ? "This is the first review pass. The spec snapshot below is the original draft."
      : `This is review pass ${passNumber} of ${totalPasses}. The spec snapshot below reflects the prior pass.`;

  const registry = loadPromptRegistry();
  let template = assemblePromptForStep({
    registry,
    stepPromptId: "plan.prompt.review",
  });

  const workDir = opts.workDirLabel ?? opts.name;
  const targetDir = opts.targetDir ?? "spec";

  if (opts.flatSpecLayout) {
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
    value: opts.currentSpec,
    begin: "<<<CURRENT_SPEC_BEGIN>>>",
    end: "<<<CURRENT_SPEC_END>>>",
    placeholderName: "CURRENT_SPEC",
  });
  enforceDelimiterPolicy({
    value: opts.specGuidance,
    begin: "<<<SPEC_GUIDANCE_BEGIN>>>",
    end: "<<<SPEC_GUIDANCE_END>>>",
    placeholderName: "SPEC_GUIDANCE",
  });

  try {
    template = renderTemplate(
      template,
      new Set([
        "WORKDIR",
        "NAME",
        "INTENT",
        "SPEC_GUIDANCE",
        "CURRENT_SPEC",
        "REVIEW_PASS_CONTEXT",
      ]),
      {
        WORKDIR: workDir,
        NAME: opts.name,
        INTENT: opts.intent,
        SPEC_GUIDANCE: opts.specGuidance,
        CURRENT_SPEC: opts.currentSpec,
        REVIEW_PASS_CONTEXT: reviewPassContext,
      },
    );
  } catch (err) {
    if (err instanceof TemplateRenderingError) {
      throw new Error(`review prompt configuration error: ${err.details}`);
    }
    throw err;
  }

  return template;
}

/**
 * Snapshot all current spec files into a string for prompt injection.
 */
export function snapshotSpecFiles(
  worktreePath: string,
  name: string,
  specDirPath?: string,
  targetDir?: string,
): string {
  const specDir = resolvePlanSpecDirPath(
    worktreePath,
    name,
    specDirPath,
    targetDir,
  );
  if (!existsSync(specDir)) {
    return "(spec directory does not exist)";
  }

  const files = readdirSync(specDir);
  // Exclude intent.md and non-markdown files
  const specFiles = files.filter((f) => f.endsWith(".md") && f !== "intent.md");

  // Sort deterministically using locale-independent string comparison
  const collator = new Intl.Collator("en", { sensitivity: "variant" });
  specFiles.sort((a, b) => collator.compare(a, b));

  const lines: string[] = [];
  for (const file of specFiles) {
    const filePath = join(specDir, file);
    const content = readFileSync(filePath, "utf8");
    lines.push(`<<<FILE name="${file}" BEGIN>>>\n${content}\n<<<FILE END>>>`);
  }

  return lines.length > 0 ? lines.join("\n\n") : "(no spec files found)";
}

/**
 * Run a single review pass: invoke an agent to critique and refine the spec.
 * Returns the agent result.
 */
export async function runReviewPass(
  opts: ReviewPhaseOptions,
): Promise<{ result: AgentResult; agentLabel: string | null }> {
  const specDirPath = resolvePlanSpecDirPath(
    opts.worktreePath,
    opts.name,
    opts.specDirPath,
    opts.targetDir,
  );
  const flatSpecLayout = opts.specDirPath !== undefined;
  const agentCwd = opts.agentCwd ?? opts.worktreePath;

  // Read intent.md
  const intentPath = join(specDirPath, "intent.md");
  const intent = readFileSync(intentPath, "utf8");

  // Read spec guidance from the main checkout
  const docsPath = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "docs",
    "spec-guidance.md",
  );
  const specGuidance = readFileSync(docsPath, "utf8");

  // Snapshot all current spec files
  const currentSpec = snapshotSpecFiles(
    opts.worktreePath,
    opts.name,
    opts.specDirPath,
    opts.targetDir,
  );

  // Build the prompt
  let prompt: string;
  try {
    const promptOpts: {
      name: string;
      intent: string;
      specGuidance: string;
      currentSpec: string;
      passNumber?: number;
      totalPasses?: number;
      flatSpecLayout?: boolean;
      workDirLabel?: string;
      targetDir?: string;
    } = {
      name: opts.name,
      intent,
      specGuidance,
      currentSpec,
      ...(flatSpecLayout
        ? { flatSpecLayout: true, workDirLabel: specDirPath }
        : {}),
      ...(opts.targetDir !== undefined ? { targetDir: opts.targetDir } : {}),
    };
    if (opts.passNumber !== undefined) {
      promptOpts.passNumber = opts.passNumber;
    }
    if (opts.totalPasses !== undefined) {
      promptOpts.totalPasses = opts.totalPasses;
    }
    prompt = buildReviewPrompt(promptOpts);
  } catch (err) {
    if (err instanceof Error) {
      return {
        result: {
          kind: "model_config",
          stderr: err.message,
        },
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

  for (const entry of agentOrder) {
    const agent = createAgent(entry.agent, entry.model);
    agentLabel =
      agent.attributionLabel?.() ?? `${entry.agent} (${entry.model})`;

    const porcelainBefore = readGitPorcelainSnapshot(opts.worktreePath);
    const invocationStartedAt = Date.now();
    const spawnResult = await agent.run(prompt, {
      cwd: agentCwd,
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
      phase: "review",
      agentCli: entry.agent,
      configuredModel: entry.model,
      durationMs: Date.now() - invocationStartedAt,
      result,
    });

    if (result.kind === "ok") {
      return { result, agentLabel };
    }

    if (result.kind === "quota") {
      continue;
    }

    if (result.kind === "model_config") {
      // Model config error is fatal
      return { result, agentLabel };
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
    };
  }

  // Last result (could be quota, error, or model_config)
  return { result, agentLabel };
}

/**
 * Check if the worktree has uncommitted changes using git status --porcelain.
 */
export function hasWorkingTreeChanges(worktreePath: string): boolean {
  try {
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    return porcelain.trim().length > 0;
  } catch (err) {
    throw new Error(`could not check git status: ${(err as Error).message}`);
  }
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
 * Validate the review output: check that intent.md was not modified (unless blocker added) and index.md still exists.
 * Returns validation result and any blocker found.
 */
export function validateReviewOutput(
  worktreePath: string,
  name: string,
  intentBefore: string,
  specDirPath?: string,
  targetDir?: string,
): { valid: boolean; error: string | null; blocker?: string | undefined } {
  const specDir = resolvePlanSpecDirPath(
    worktreePath,
    name,
    specDirPath,
    targetDir,
  );
  const indexPath = join(specDir, "index.md");
  const intentPath = join(specDir, "intent.md");

  // Check index.md still exists
  if (!existsSync(indexPath)) {
    return { valid: false, error: "index.md was deleted" };
  }

  // Check intent.md was not modified (unless a blocker was added)
  const intentAfter = readFileSync(intentPath, "utf8");

  // Check if blocker was added
  const blockerDetection = detectBlocker(intentAfter);
  if (blockerDetection.hasBlocker) {
    // Valid if only blocker was added
    if (isValidIntentModification(intentBefore, intentAfter)) {
      return {
        valid: true,
        error: null,
        blocker: blockerDetection.body,
      };
    }
    // Otherwise it's an error: blocker was added but so was other content
    return {
      valid: false,
      error:
        "intent.md was modified beyond adding a ## Blocker section (frontmatter is immutable)",
    };
  }

  // No blocker, so intent.md must be exactly the same
  if (intentAfter !== intentBefore) {
    return {
      valid: false,
      error: "intent.md was modified (not allowed)",
    };
  }

  return { valid: true, error: null };
}
