import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { enforceDelimiterPolicy } from "../../../../shared/prompts/render.ts";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import type { Agent, AgentName } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { resolveReviewPasses } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { runReview } from "../review/run.ts";
import type { ReviewAdapter, ReviewAttemptContext, ReviewTelemetryEvent } from "../review/types.ts";
import { detectBlocker } from "./blocker.ts";
import {
  appendBoundaryBlocker,
  assertNoCommitExternalSpecBoundary,
  assertPlanWriteBoundary,
  assertTargetRepoPlanBoundary,
  type BoundaryCheckResult,
  revertPaths,
} from "./boundary.ts";
import { commitPlanBlocker, commitPlanReview } from "./commits.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";
import { hasSpecDirChanges, resolvePlanSpecDirPath, snapshotSpecDirFiles } from "./spec-dir.ts";
import { renderTemplate, TemplateRenderingError } from "./template-renderer.ts";

export type ReviewPhaseOptions = {
  worktreePath: string;
  name: string;
  specDirPath?: string;
  passNumber?: number;
  totalPasses?: number;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
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
      new Set(["WORKDIR", "NAME", "INTENT", "SPEC_GUIDANCE", "CURRENT_SPEC", "REVIEW_PASS_CONTEXT"]),
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
  const specDir = resolvePlanSpecDirPath(worktreePath, name, specDirPath, targetDir);
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
  const specDir = resolvePlanSpecDirPath(worktreePath, name, specDirPath, targetDir);
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
      error: "intent.md was modified beyond adding a ## Blocker section (frontmatter is immutable)",
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

class PlanReviewTerminalError extends Error {
  readonly exitCode: number;
  readonly blocker?: string | undefined;

  constructor(message: string, exitCode: number, blocker?: string) {
    super(message);
    this.exitCode = exitCode;
    this.blocker = blocker;
  }
}

/** Result of the plan review phase routed through the shared review runner. */
export type PlanReviewPhaseResult = {
  exitCode: number;
  blocker?: string | undefined;
  interrupted?: boolean;
};

/** Options for plan review routed through the shared review runner. */
export type PlanReviewPhaseOptions = {
  worktreePath: string;
  name: string;
  specDirBasename: string;
  config: Config;
  reviewPassesOverride?: number;
  startPassNumber?: number;
  subjectSuffix?: string;
  targetDir?: string;
  specDirPath?: string;
  agentCwd?: string;
  commit: boolean;
  checkBoundary?: boolean;
  logNoChangeSkip?: boolean;
  externalSpecRoot?: string;
  projectRoot?: string;
  stderr?: (s: string) => void;
  planTelemetry?: PlanTelemetryWriter | undefined;
  onOutboundPrompt?: (prompt: string) => void;
  isInterrupted?: () => boolean;
  updatePrBody?: () => Promise<void>;
  createAgent?: (agentName: AgentName, model: string | undefined) => Agent;
  onPassStart?: (displayPassNumber: number, displayTotalPasses: number) => void;
};

function firstNonEmptyLine(text: string): string {
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (line !== "") {
      return line;
    }
  }
  return "";
}

function countSpecFiles(specDirPath: string): number {
  if (!existsSync(specDirPath)) {
    return 0;
  }
  return readdirSync(specDirPath).filter((f) => /^\d{2}-.*\.md$/.test(f)).length;
}

function resolveFinalSpecPath(opts: PlanReviewPhaseOptions): string {
  if (opts.specDirPath !== undefined) {
    return opts.specDirPath;
  }
  const targetDir = opts.targetDir ?? "spec";
  return join(opts.worktreePath, targetDir, opts.specDirBasename);
}

function passHasChanges(
  opts: PlanReviewPhaseOptions,
  finalSpecPath: string,
  specSnapshotBefore: Set<string> | null,
): boolean {
  if (opts.commit) {
    return hasWorkingTreeChanges(opts.worktreePath);
  }
  return specSnapshotBefore !== null && hasSpecDirChanges(finalSpecPath, specSnapshotBefore);
}

function createPlanReviewAdapter(args: {
  opts: PlanReviewPhaseOptions;
  displayPassNumber: number;
  displayTotalPasses: number;
  intentBefore: string;
  finalSpecPath: string;
  specSnapshotBefore: Set<string> | null;
  onBlocker: (blocker: string) => void;
}): ReviewAdapter {
  const { opts, displayPassNumber, displayTotalPasses, intentBefore, finalSpecPath, specSnapshotBefore, onBlocker } =
    args;
  const targetDir = opts.targetDir ?? "spec";
  const flatSpecLayout = opts.specDirPath !== undefined;

  const checkBoundaries = (): BoundaryCheckResult => {
    const boundaryCheck = opts.commit
      ? assertPlanWriteBoundary(opts.worktreePath, opts.specDirBasename, targetDir)
      : assertTargetRepoPlanBoundary(opts.projectRoot ?? opts.worktreePath);
    const externalBoundaryCheck: BoundaryCheckResult =
      !opts.commit && opts.externalSpecRoot
        ? assertNoCommitExternalSpecBoundary(opts.externalSpecRoot, opts.specDirBasename)
        : { ok: true };
    if (boundaryCheck.ok && externalBoundaryCheck.ok) {
      return { ok: true };
    }
    const offendingPaths = [
      ...(boundaryCheck.ok ? [] : boundaryCheck.offendingPaths),
      ...(externalBoundaryCheck.ok ? [] : externalBoundaryCheck.offendingPaths),
    ];
    return { ok: false, offendingPaths };
  };

  const handleBoundaryViolation = async (ctx: ReviewAttemptContext, context: "blocker" | "review"): Promise<never> => {
    const boundary = checkBoundaries();
    if (boundary.ok) {
      throw new Error(`plan review boundary check failed unexpectedly during ${context}`);
    }
    opts.stderr?.(`plan: boundary violation detected before review ${context} commit\n`);
    if (opts.commit) {
      revertPaths(opts.worktreePath, boundary.offendingPaths);
    }
    appendBoundaryBlocker(finalSpecPath, opts.specDirBasename, boundary.offendingPaths, targetDir);
    for (const path of boundary.offendingPaths) {
      opts.stderr?.(`  - ${path}\n`);
    }
    if (opts.commit) {
      commitPlanBlocker({
        worktreePath: opts.worktreePath,
        specDirBasename: opts.specDirBasename,
        agentLabel: ctx.agentLabel,
        reason: "write boundary violation",
        specFilesCount: countSpecFiles(finalSpecPath),
        ...(opts.subjectSuffix !== undefined ? { subjectSuffix: opts.subjectSuffix } : {}),
        targetDir,
      });
      opts.stderr?.(`plan: blocker commit pushed\n`);
      await opts.updatePrBody?.();
    }
    opts.stderr?.(`plan: blocked\n`);
    throw new PlanReviewTerminalError("write boundary violation", 1);
  };

  return {
    buildPrompt: async () => {
      const specDirPath = resolvePlanSpecDirPath(opts.worktreePath, opts.name, opts.specDirPath, targetDir);
      const intentPath = join(specDirPath, "intent.md");
      const intent = readFileSync(intentPath, "utf8");
      const docsPath = join(import.meta.dir, "..", "..", "..", "docs", "spec-guidance.md");
      const specGuidance = readFileSync(docsPath, "utf8");
      const currentSpec = snapshotSpecFiles(opts.worktreePath, opts.name, opts.specDirPath, targetDir);

      try {
        const prompt = buildReviewPrompt({
          name: opts.name,
          intent,
          specGuidance,
          currentSpec,
          passNumber: displayPassNumber,
          totalPasses: displayTotalPasses,
          ...(flatSpecLayout ? { flatSpecLayout: true, workDirLabel: specDirPath } : {}),
          ...(opts.targetDir !== undefined ? { targetDir: opts.targetDir } : {}),
        });
        opts.onOutboundPrompt?.(prompt);
        return prompt;
      } catch (err) {
        if (err instanceof TemplateRenderingError || err instanceof Error) {
          throw new PlanReviewTerminalError(
            err instanceof Error ? err.message : "review prompt configuration error",
            3,
          );
        }
        throw err;
      }
    },
    enforceWriteBoundary: async () => {},
    readBlocker: async (ctx) => {
      if (!passHasChanges(opts, finalSpecPath, specSnapshotBefore)) {
        return null;
      }
      const validation = validateReviewOutput(
        opts.worktreePath,
        opts.specDirBasename,
        intentBefore,
        opts.specDirPath,
        targetDir,
      );
      if (!validation.valid) {
        opts.stderr?.(`plan: review pass ${displayPassNumber} validation failed: ${validation.error}\n`);
        throw new PlanReviewTerminalError(validation.error ?? "validation failed", 1);
      }
      if (validation.blocker !== undefined) {
        if (opts.checkBoundary) {
          const boundary = checkBoundaries();
          if (!boundary.ok) {
            await handleBoundaryViolation(ctx, "blocker");
          }
        }
        return validation.blocker;
      }
      return null;
    },
    handleBlocker: async (ctx) => {
      if (opts.commit) {
        commitPlanBlocker({
          worktreePath: opts.worktreePath,
          specDirBasename: opts.specDirBasename,
          agentLabel: ctx.agentLabel,
          reason: firstNonEmptyLine(ctx.blocker),
          specFilesCount: countSpecFiles(finalSpecPath),
          ...(opts.subjectSuffix !== undefined ? { subjectSuffix: opts.subjectSuffix } : {}),
          targetDir,
        });
        opts.stderr?.(`plan: blocker commit pushed\n`);
        await opts.updatePrBody?.();
      }
      opts.stderr?.(`plan: blocked\n`);
      onBlocker(ctx.blocker);
      return 1;
    },
    commitPass: async (ctx) => {
      if (!passHasChanges(opts, finalSpecPath, specSnapshotBefore)) {
        if (opts.logNoChangeSkip) {
          opts.stderr?.(`plan: review pass ${displayPassNumber} made no changes; skipping commit\n`);
        }
        return;
      }
      if (opts.checkBoundary) {
        const boundary = checkBoundaries();
        if (!boundary.ok) {
          await handleBoundaryViolation(ctx, "review");
        }
      }
      if (opts.commit) {
        commitPlanReview({
          worktreePath: opts.worktreePath,
          specDirBasename: opts.specDirBasename,
          passNumber: displayPassNumber,
          agentLabel: ctx.agentLabel,
          ...(opts.subjectSuffix !== undefined ? { subjectSuffix: opts.subjectSuffix } : {}),
          targetDir,
        });
        opts.stderr?.(`plan: review pass ${displayPassNumber} committed and pushed\n`);
        await opts.updatePrBody?.();
      }
    },
    recordTelemetry: async (event: ReviewTelemetryEvent) => {
      opts.planTelemetry?.recordAgentAttempt({
        phase: "review",
        agentCli: event.agentEntry.agent,
        configuredModel: event.agentEntry.model,
        durationMs: event.durationMs,
        result: event.result,
      });
    },
  };
}

/** Run plan review passes through the shared review runner. */
export async function runPlanReviewPhase(opts: PlanReviewPhaseOptions): Promise<PlanReviewPhaseResult> {
  const totalPasses = resolveReviewPasses(opts.config, opts.reviewPassesOverride);
  const startPassNumber = opts.startPassNumber ?? 1;
  const displayTotalPasses = startPassNumber + totalPasses - 1;
  const resolveAgent = opts.createAgent ?? defaultCreateAgent;
  const finalSpecPath = resolveFinalSpecPath(opts);

  for (let runnerPass = 1; runnerPass <= totalPasses; runnerPass += 1) {
    if (opts.isInterrupted?.()) {
      return { exitCode: 130, interrupted: true };
    }

    const displayPassNumber = startPassNumber + runnerPass - 1;
    opts.onPassStart?.(displayPassNumber, displayTotalPasses);

    const intentPath = join(finalSpecPath, "intent.md");
    const intentBefore = readFileSync(intentPath, "utf8");
    const specSnapshotBefore = opts.commit ? null : snapshotSpecDirFiles(finalSpecPath);

    let detectedBlocker: string | undefined;
    const adapter = createPlanReviewAdapter({
      opts,
      displayPassNumber,
      displayTotalPasses,
      intentBefore,
      finalSpecPath,
      specSnapshotBefore,
      onBlocker: (blocker) => {
        detectedBlocker = blocker;
      },
    });

    try {
      const exitCode = await runReview({
        config: opts.config,
        cwd: opts.agentCwd ?? opts.worktreePath,
        adapter,
        reviewPassesOverride: 1,
        loadAgent: ({ name, model }) => resolveAgent(name as AgentName, model),
        onAllAgentsQuotaExhausted: (message) => {
          opts.stderr?.(`plan: ${message}\n`);
        },
      });

      if (exitCode === 2) {
        return { exitCode: 2 };
      }
      if (exitCode === 3) {
        opts.stderr?.(`plan: model configuration error\n`);
        return { exitCode: 3 };
      }
      if (exitCode !== 0) {
        if (detectedBlocker !== undefined) {
          return { exitCode, blocker: detectedBlocker };
        }
        opts.stderr?.(`plan: review pass ${displayPassNumber} failed\n`);
        return { exitCode };
      }
    } catch (err) {
      if (err instanceof PlanReviewTerminalError) {
        return {
          exitCode: err.exitCode,
          ...(err.blocker !== undefined ? { blocker: err.blocker } : {}),
        };
      }
      opts.stderr?.(`plan: review pass ${displayPassNumber} error: ${(err as Error).message}\n`);
      return { exitCode: 1 };
    }

    if (opts.isInterrupted?.()) {
      return { exitCode: 130, interrupted: true };
    }
  }

  return { exitCode: 0 };
}
