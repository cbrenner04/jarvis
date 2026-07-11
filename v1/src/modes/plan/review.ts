import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { enforceDelimiterPolicy } from "../../../../shared/prompts/render.ts";
import { detectBlocker, parseSpec } from "../../../../shared/spec-parser.ts";
import { realSubprocessRunner, type SubprocessRunner } from "../../../../shared/subprocess.ts";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import type { Agent, AgentName } from "../../agents/types.ts";
import type { AgentEntry, Config } from "../../config.ts";
import { evaluateIdleWatchdog, sampleFileActivityIfNeeded } from "../patch/idle-watchdog.ts";
import { recoverImmutableCopyOverreach } from "../review/immutable-copy-overreach.ts";
import { runReview } from "../review/run.ts";
import {
  type ReviewAdapter,
  type ReviewAttemptContext,
  type ReviewTelemetryEvent,
  ReviewTerminalError,
} from "../review/types.ts";
import {
  appendBoundaryBlocker,
  assertPlanWriteBoundary,
  assertTargetRepoPlanBoundary,
  type BoundaryCheckResult,
  revertPaths,
} from "./boundary.ts";
import { commitPlanBlocker, commitPlanReview, type PlanCommitGitOps, realPlanCommitGitOps } from "./commits.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";
import {
  hasSpecDirChanges,
  listSpecDirChanges,
  resolvePlanSpecDirPath,
  restoreSpecDirSnapshot,
  type SpecDirSnapshot,
  snapshotSpecDirFiles,
} from "./spec-dir.ts";
import { renderTemplate, TemplateRenderingError } from "./template-renderer.ts";
import { runVerdictActuator } from "./verdict-actuator.ts";

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
  /** Review role: adversary, advocate, or adjudicator. */
  role?: "adversary" | "advocate" | "adjudicator";
  /** Prior role's artifact (e.g., adversary findings for advocate). */
  priorArtifact?: string;
}): string {
  const passNumber = opts.passNumber ?? 1;
  const totalPasses = opts.totalPasses ?? 1;
  const role = opts.role ?? "adversary";

  const reviewPassContext =
    passNumber === 1
      ? "This is the first review pass. The spec snapshot below is the original draft."
      : `This is review pass ${passNumber} of ${totalPasses}. The spec snapshot below reflects the prior pass.`;

  const registry = loadPromptRegistry();

  // Select role-specific prompt template
  const promptId =
    role === "adjudicator"
      ? "plan.prompt.review.adjudicator"
      : role === "advocate"
        ? "plan.prompt.review.advocate"
        : "plan.prompt.review.adversary";

  let template = assemblePromptForStep({
    registry,
    stepPromptId: promptId,
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

  const values: Record<string, string> = {
    WORKDIR: workDir,
    NAME: opts.name,
    INTENT: opts.intent,
    SPEC_GUIDANCE: opts.specGuidance,
    CURRENT_SPEC: opts.currentSpec,
    REVIEW_PASS_CONTEXT: reviewPassContext,
  };

  // Add role-specific values for advocate and adjudicator
  if (role === "advocate") {
    enforceDelimiterPolicy({
      value: opts.priorArtifact || "(no prior findings)",
      begin: "<<<ADVERSARY_BEGIN>>>",
      end: "<<<ADVERSARY_END>>>",
      placeholderName: "ADVERSARY_FINDINGS",
    });
    values.ADVERSARY_FINDINGS = opts.priorArtifact || "(no prior findings)";
  }

  if (role === "adjudicator") {
    enforceDelimiterPolicy({
      value: opts.priorArtifact || "(no advocate response)",
      begin: "<<<ADVOCATE_BEGIN>>>",
      end: "<<<ADVOCATE_END>>>",
      placeholderName: "ADVOCATE_RESPONSE",
    });
    values.ADVOCATE_RESPONSE = opts.priorArtifact || "(no advocate response)";
  }

  try {
    const placeholderSet = new Set([
      "WORKDIR",
      "NAME",
      "INTENT",
      "SPEC_GUIDANCE",
      "CURRENT_SPEC",
      "REVIEW_PASS_CONTEXT",
    ]);
    if (role === "advocate") placeholderSet.add("ADVERSARY_FINDINGS");
    if (role === "adjudicator") placeholderSet.add("ADVOCATE_RESPONSE");

    template = renderTemplate(template, placeholderSet, values);
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
export function hasWorkingTreeChanges(worktreePath: string, runner: SubprocessRunner = realSubprocessRunner): boolean {
  try {
    const porcelain = runner.run("git", ["status", "--porcelain"], worktreePath);
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

function splitItems(content: string, heading: "Tasks" | "Acceptance criteria"): string[] {
  if (heading === "Acceptance criteria") {
    return parseSpec(content).acceptanceCriteria.map((criterion) =>
      `${criterion.checked ? "x" : " "}:${criterion.text}`,
    );
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf("## Tasks");
  if (start === -1) {
    return [];
  }
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    const match = line.match(/^\s*-\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (match) {
      items.push(`${match[1] === undefined ? "-" : match[1].toLowerCase()}:${(match[2] ?? "").trim()}`);
    }
  }
  return items;
}

function splitSubspecFiles(snapshot: SpecDirSnapshot): Map<string, string> {
  return new Map(
    [...snapshot].filter(([name]) => name.endsWith(".md") && name !== "index.md" && name !== "intent.md" && name !== "verdict-plan.md"),
  );
}

function validateSplitIntegrity(before: SpecDirSnapshot, specDir: string): string | null {
  const original = splitSubspecFiles(before);
  const current = splitSubspecFiles(snapshotSpecDirFiles(specDir));
  const removed = [...original.keys()].filter((name) => !current.has(name));
  const replacements = [...current.keys()].filter((name) => !original.has(name));
  if (removed.length === 0 || replacements.length === 0) {
    return "split verdict did not replace the original subspec";
  }

  const index = readFileSync(join(specDir, "index.md"), "utf8");
  for (const replacement of replacements) {
    if (!new RegExp(`\\]\\((?:\\./)?${replacement.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\)`).test(index)) {
      return `split replacement is not linked from index.md: ${replacement}`;
    }
  }

  const expected = removed.flatMap((name) => {
    const content = original.get(name) ?? "";
    return [...splitItems(content, "Tasks"), ...splitItems(content, "Acceptance criteria")];
  });
  const actual = replacements.flatMap((name) => {
    const content = current.get(name) ?? "";
    return [...splitItems(content, "Tasks"), ...splitItems(content, "Acceptance criteria")];
  });
  for (const item of expected) {
    if (actual.filter((candidate) => candidate === item).length !== 1) {
      return `split did not preserve exactly once: ${item.slice(2)}`;
    }
  }
  return null;
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
  reviewAgentOrder?: AgentEntry[];
  reviewPassesOverride?: number;
  startPassNumber?: number;
  subjectSuffix?: string;
  targetDir?: string;
  specDirPath?: string;
  agentCwd?: string;
  commit: boolean;
  gitEnabled?: boolean;
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
  /** Additional read directories passed to agent (for external spec storage). */
  additionalReadDirs?: string[];
  /** Plan worktree directory for idle watchdog file-activity scanning. */
  planWorktreeDir?: string;
  /** Idle output timeout in milliseconds (0 to disable). */
  idleOutputTimeoutMs?: number | undefined;
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
  specSnapshotBefore: SpecDirSnapshot | null,
  runner: SubprocessRunner,
): boolean {
  if (opts.commit) {
    return hasWorkingTreeChanges(opts.worktreePath, runner);
  }
  return specSnapshotBefore !== null && hasSpecDirChanges(finalSpecPath, specSnapshotBefore);
}

function getRoleArtifactPath(storageRoot: string, role: string, passNumber: number): string {
  return join(storageRoot, `.jarvis-review-plan-${role}-${passNumber}`);
}

function hasCommittablePlanReviewChanges(worktreePath: string, runner: SubprocessRunner): boolean {
  const porcelain = runner.run("git", ["status", "--porcelain"], worktreePath);
  return porcelain
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim())
    .some((file) => !file.startsWith(".jarvis-review-plan-"));
}

function detectSpecTreeEdits(specDir: string, cwd: string, runner: SubprocessRunner): string[] {
  try {
    const output = runner.run("git", ["status", "--porcelain"], cwd);

    const specRelPath = relative(cwd, specDir);
    return output
      .split("\n")
      .filter((line: string) => line.length > 3)
      .map((line: string) => line.slice(3).trim())
      .filter((file: string) => file === specRelPath || file.startsWith(`${specRelPath}/`));
  } catch {
    return [];
  }
}

function revertSpecTreeEdits(specDir: string, cwd: string, runner: SubprocessRunner): void {
  const editedFiles = detectSpecTreeEdits(specDir, cwd, runner);
  if (editedFiles.length === 0) {
    return;
  }

  try {
    for (const file of editedFiles) {
      try {
        runner.run("git", ["checkout", "HEAD", "--", file], cwd);
      } catch {
        // Untracked file: nothing to restore from HEAD; clean handles it below.
      }
    }
    const relPath = relative(cwd, specDir);
    runner.run("git", ["clean", "-fd", "--", relPath], cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to revert spec-tree edits: ${message}`);
  }
}

function createPlanReviewAdapter(args: {
  opts: PlanReviewPhaseOptions;
  displayPassNumber: number;
  displayTotalPasses: number;
  intentBefore: string;
  finalSpecPath: string;
  specSnapshotBefore: SpecDirSnapshot | null;
  runner: SubprocessRunner;
  gitOps: PlanCommitGitOps;
  onBlocker: (blocker: string) => void;
  onAgentFailure: (passNumber: number, stderr: string) => void;
}): ReviewAdapter {
  const {
    opts,
    displayPassNumber,
    displayTotalPasses,
    intentBefore,
    finalSpecPath,
    specSnapshotBefore,
    runner,
    gitOps,
    onBlocker,
    onAgentFailure,
  } = args;
  const targetDir = opts.targetDir ?? "spec";
  const flatSpecLayout = opts.specDirPath !== undefined;

  const checkBoundaries = (): BoundaryCheckResult => {
    const boundaryCheck: BoundaryCheckResult = opts.commit
      ? assertPlanWriteBoundary(opts.worktreePath, opts.specDirBasename, targetDir, runner)
      : opts.gitEnabled === false
        ? { ok: true }
        : assertTargetRepoPlanBoundary(opts.projectRoot ?? opts.worktreePath, runner);
    if (boundaryCheck.ok) {
      return { ok: true };
    }
    return { ok: false, offendingPaths: boundaryCheck.offendingPaths };
  };

  const handleBoundaryViolation = async (ctx: ReviewAttemptContext, context: "blocker" | "review"): Promise<never> => {
    const boundary = checkBoundaries();
    if (boundary.ok) {
      throw new Error(`plan review boundary check failed unexpectedly during ${context}`);
    }
    opts.stderr?.(`plan: boundary violation detected before review ${context} commit\n`);
    if (opts.commit) {
      revertPaths(opts.worktreePath, boundary.offendingPaths, runner);
    }
    appendBoundaryBlocker(finalSpecPath, opts.specDirBasename, boundary.offendingPaths, targetDir);
    for (const path of boundary.offendingPaths) {
      opts.stderr?.(`  - ${path}\n`);
    }
    if (opts.commit) {
      commitPlanBlocker(
        {
          worktreePath: opts.worktreePath,
          specDirBasename: opts.specDirBasename,
          agentLabel: ctx.agentLabel,
          reason: "write boundary violation",
          specFilesCount: countSpecFiles(finalSpecPath),
          ...(opts.subjectSuffix !== undefined ? { subjectSuffix: opts.subjectSuffix } : {}),
          targetDir,
        },
        gitOps,
      );
      opts.stderr?.(`plan: blocker commit pushed\n`);
      await opts.updatePrBody?.();
    }
    opts.stderr?.(`plan: blocked\n`);
    throw new ReviewTerminalError("write boundary violation", 1);
  };

  return {
    buildPrompt: async (ctx) => {
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
          ...(ctx.role ? { role: ctx.role } : {}),
          ...(ctx.priorArtifact ? { priorArtifact: ctx.priorArtifact } : {}),
        });
        opts.onOutboundPrompt?.(prompt);
        return prompt;
      } catch (err) {
        if (err instanceof Error) {
          throw new ReviewTerminalError(err.message, 3);
        }
        throw err;
      }
    },
    enforceWriteBoundary: async (ctx) => {
      // Reviewer roles (adversary, advocate, adjudicator) are read-only on spec; revert any spec edits.
      if (ctx.role && ["adversary", "advocate", "adjudicator"].includes(ctx.role)) {
        const editedSpecFiles = opts.commit
          ? detectSpecTreeEdits(finalSpecPath, opts.worktreePath, runner)
          : specSnapshotBefore === null
            ? []
            : listSpecDirChanges(finalSpecPath, specSnapshotBefore);
        if (editedSpecFiles.length > 0) {
          const validation = validateReviewOutput(
            opts.worktreePath,
            opts.specDirBasename,
            intentBefore,
            opts.specDirPath,
            targetDir,
          );
          if (validation.valid && validation.blocker !== undefined) {
            return;
          }
          opts.stderr?.(
            `plan: review pass ${ctx.passNumber} (${ctx.role}) edited spec files (reverting): ${editedSpecFiles.join(", ")}\n`,
          );
          try {
            if (opts.commit) {
              revertSpecTreeEdits(finalSpecPath, opts.worktreePath, runner);
            } else if (specSnapshotBefore !== null) {
              restoreSpecDirSnapshot(finalSpecPath, specSnapshotBefore);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            opts.stderr?.(`plan: revert failed: ${message}\n`);
            throw new ReviewTerminalError(message, 1);
          }
        }
      }
    },
    readBlocker: async (ctx) => {
      if (!passHasChanges(opts, finalSpecPath, specSnapshotBefore, runner)) {
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
        throw new ReviewTerminalError(validation.error ?? "validation failed", 1);
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
        commitPlanBlocker(
          {
            worktreePath: opts.worktreePath,
            specDirBasename: opts.specDirBasename,
            agentLabel: ctx.agentLabel,
            reason: firstNonEmptyLine(ctx.blocker),
            specFilesCount: countSpecFiles(finalSpecPath),
            ...(opts.subjectSuffix !== undefined ? { subjectSuffix: opts.subjectSuffix } : {}),
            targetDir,
          },
          gitOps,
        );
        opts.stderr?.(`plan: blocker commit pushed\n`);
        await opts.updatePrBody?.();
      }
      opts.stderr?.(`plan: blocked\n`);
      onBlocker(ctx.blocker);
      return 1;
    },
    commitPass: async (ctx) => {
      // Store role artifact before committing (for next role or actuator)
      if (ctx.result.kind === "ok" && ctx.role) {
        const artifactPath = getRoleArtifactPath(
          opts.commit ? opts.worktreePath : finalSpecPath,
          ctx.role,
          ctx.passNumber,
        );
        try {
          writeFileSync(artifactPath, ctx.result.stdout, "utf8");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          opts.stderr?.(`plan: failed to store ${ctx.role} artifact: ${message}\n`);
        }
      }

      const hasChanges = opts.commit
        ? hasCommittablePlanReviewChanges(opts.worktreePath, runner)
        : passHasChanges(opts, finalSpecPath, specSnapshotBefore, runner);
      if (!hasChanges) {
        if (opts.logNoChangeSkip) {
          opts.stderr?.(
            `plan: review pass ${displayPassNumber}${ctx.role ? ` (${ctx.role})` : ""} made no changes; skipping commit\n`,
          );
        }
        if (ctx.role) {
          rmSync(getRoleArtifactPath(opts.commit ? opts.worktreePath : finalSpecPath, ctx.role, ctx.passNumber), {
            force: true,
          });
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
        // Use role-specific commit message for reviewer roles
        const roleLabel =
          ctx.role && ["adversary", "advocate", "adjudicator"].includes(ctx.role)
            ? `review: ${ctx.role}`
            : `review: pass ${displayPassNumber}`;

        commitPlanReview(
          {
            worktreePath: opts.worktreePath,
            specDirBasename: opts.specDirBasename,
            passNumber: displayPassNumber,
            agentLabel: ctx.agentLabel,
            ...(opts.subjectSuffix !== undefined ? { subjectSuffix: opts.subjectSuffix } : {}),
            targetDir,
            ...(ctx.role ? { reviewLabel: roleLabel } : {}),
          },
          gitOps,
        );
        opts.stderr?.(
          `plan: review pass ${displayPassNumber}${ctx.role ? ` (${ctx.role})` : ""} committed and pushed\n`,
        );
        await opts.updatePrBody?.();
      }

      // Clean up temp artifact files (don't commit them)
      if (ctx.role) {
        const artifactPath = getRoleArtifactPath(
          opts.commit ? opts.worktreePath : finalSpecPath,
          ctx.role,
          ctx.passNumber,
        );
        try {
          if (opts.commit) {
            runner.run("git", ["reset", "HEAD", "--", artifactPath], opts.worktreePath);
          }
          rmSync(artifactPath, { force: true });
        } catch {
          // best-effort
        }
      }
    },
    recordTelemetry: async (event: ReviewTelemetryEvent) => {
      if (event.outcome === "error" || event.outcome === "model_config") {
        onAgentFailure(event.passNumber, event.result.stderr);
      }
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

function withPlanReviewIdleWatchdog(
  agent: Agent,
  opts: {
    idleOutputTimeoutMs?: number;
    config: Config;
    planWorktreeDir?: string;
    stderr?: (s: string) => void;
  },
): Agent {
  return {
    name: agent.name,
    attributionLabel: () => agent.attributionLabel(),
    run: async (prompt: string, runOpts) => {
      const reviewController = new AbortController();
      const lastOutputAtMs = { current: null as number | null };
      let lastFileActivityAtMs: number | null = null;
      let idleTimeoutHandle: NodeJS.Timeout | null = null;

      // Arm idle watchdog if configured
      const armedAt = Date.now();
      const idleOutputTimeoutMs =
        opts.idleOutputTimeoutMs !== undefined ? opts.idleOutputTimeoutMs : (opts.config.idleOutputTimeoutMs ?? 600000);
      const worktreeDir = opts.planWorktreeDir ?? (typeof runOpts.cwd === "string" ? runOpts.cwd : process.cwd());
      if (idleOutputTimeoutMs > 0) {
        const scheduleIdleCheck = () => {
          idleTimeoutHandle = setTimeout(() => {
            const snapshotAt = Date.now();
            const lastOutputAgeMs = lastOutputAtMs.current === null ? null : snapshotAt - lastOutputAtMs.current;

            const sampledFileActivityAt = sampleFileActivityIfNeeded({
              lastOutputAgeMs,
              idleOutputTimeoutMs,
              now: snapshotAt,
              armedAt,
              workingDir: worktreeDir,
            });

            if (sampledFileActivityAt !== null) {
              lastFileActivityAtMs = sampledFileActivityAt;
            }

            const { shouldFire } = evaluateIdleWatchdog({
              now: snapshotAt,
              lastOutputAt: lastOutputAtMs.current,
              lastFileActivityAt: lastFileActivityAtMs,
              armedAt,
              idleOutputTimeoutMs,
            });

            if (shouldFire) {
              opts.stderr?.(`[watchdog] idle timeout fired after ${idleOutputTimeoutMs}ms; killing agent\n`);
              reviewController.abort("idle-timeout");
            } else {
              scheduleIdleCheck();
            }
          }, 100);
          idleTimeoutHandle?.unref?.();
        };
        scheduleIdleCheck();
      }

      try {
        return await agent.run(prompt, {
          ...runOpts,
          signal: reviewController.signal,
          lastOutputAtMs,
        });
      } finally {
        if (idleTimeoutHandle !== null) {
          clearTimeout(idleTimeoutHandle);
        }
      }
    },
  };
}

/** Run plan review passes through the shared review runner. */
export async function runPlanReviewPhase(
  opts: PlanReviewPhaseOptions,
  gitDeps: { runner?: SubprocessRunner; gitOps?: PlanCommitGitOps } = {},
): Promise<PlanReviewPhaseResult> {
  const runner = gitDeps.runner ?? realSubprocessRunner;
  const gitOps = gitDeps.gitOps ?? realPlanCommitGitOps;
  const resolveAgent = (agentName: AgentName, model: string | undefined): Agent => {
    if (opts.createAgent) {
      return opts.createAgent(agentName, model);
    }
    if (model === undefined) {
      throw new Error(`missing model for ${agentName}`);
    }
    return defaultCreateAgent(agentName, model);
  };
  const finalSpecPath = resolveFinalSpecPath(opts);
  let detectedBlocker: string | undefined;
  let agentFailure: { passNumber: number; stderr: string } | undefined;

  const targetDir = opts.targetDir ?? "spec";

  // Create actuator that applies the verdict to generated spec files.
  const createActuator = () => {
    return async (verdict: string, ctx: { passNumber: number }): Promise<void> => {
      if (!verdict?.trim()) {
        // Empty verdict: skip actuator invocation (existing no-change path)
        opts.stderr?.(`plan: verdict is empty; skipping actuator\n`);
        return;
      }

      opts.stderr?.(`plan: actuator running with verdict\n`);

      const intentBefore = readFileSync(join(finalSpecPath, "intent.md"), "utf8");
      const specBeforeActuation = snapshotSpecDirFiles(finalSpecPath);

      // Write verdict to durable doc next to the spec
      const verdictPath = join(finalSpecPath, "verdict-plan.md");
      try {
        writeFileSync(verdictPath, verdict, "utf8");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.stderr?.(`plan: failed to write verdict: ${message}\n`);
        throw new ReviewTerminalError(message, 1);
      }

      // Run the verdict actuator against the generated spec files.
      try {
        await runVerdictActuator({
          worktreePath: opts.worktreePath,
          name: opts.name,
          config: opts.config,
          verdict,
          stderr: opts.stderr,
          planTelemetry: opts.planTelemetry,
          externalSpecRoot: opts.externalSpecRoot,
          specDirPath: opts.specDirPath,
          targetDir,
          onOutboundPrompt: opts.onOutboundPrompt,
          createAgent: resolveAgent,
          ...(opts.planWorktreeDir !== undefined ? { planWorktreeDir: opts.planWorktreeDir } : {}),
          ...(opts.idleOutputTimeoutMs !== undefined ? { idleOutputTimeoutMs: opts.idleOutputTimeoutMs } : {}),
          ...(opts.additionalReadDirs !== undefined ? { additionalReadDirs: opts.additionalReadDirs } : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.stderr?.(`plan: verdict actuator failed: ${message}\n`);
        throw new ReviewTerminalError(message, 1);
      }

      const revalidateActuatorOutput = () =>
        validateReviewOutput(opts.worktreePath, opts.specDirBasename, intentBefore, opts.specDirPath, targetDir);

      const validation = recoverImmutableCopyOverreach({
        copies: [
          {
            relativePath: "intent.md",
            snapshot: intentBefore,
            isRecoverableDrift: (_snapshot, current) =>
              !detectBlocker(current).hasBlocker || isValidIntentModification(intentBefore, current),
          },
        ],
        readCurrent: (relativePath) => readFileSync(join(finalSpecPath, relativePath), "utf8"),
        writeSnapshot: (relativePath, bytes) => writeFileSync(join(finalSpecPath, relativePath), bytes, "utf8"),
        validation: revalidateActuatorOutput(),
        revalidate: revalidateActuatorOutput,
        verdict,
        noticePrefix: "plan: actuator reverted immutable-copy overreach:",
        emitNotice: (text) => opts.stderr?.(text),
      });
      if (!validation.valid) {
        opts.stderr?.(`plan: actuator validation failed: ${validation.error}\n`);
        throw new ReviewTerminalError(validation.error ?? "validation failed", 1);
      }

      if (/\bsplit\b/i.test(verdict)) {
        const splitError = validateSplitIntegrity(specBeforeActuation, finalSpecPath);
        if (splitError !== null) {
          opts.stderr?.(`plan: actuator split validation failed: ${splitError}\n`);
          throw new ReviewTerminalError(splitError, 1);
        }
      }

      if (!opts.commit) {
        return;
      }

      if (opts.checkBoundary) {
        const boundary = assertPlanWriteBoundary(opts.worktreePath, opts.specDirBasename, targetDir, runner);
        if (!boundary.ok) {
          opts.stderr?.(`plan: actuator boundary violation detected before commit\n`);
          revertPaths(opts.worktreePath, boundary.offendingPaths, runner);
          for (const path of boundary.offendingPaths) {
            opts.stderr?.(`  - ${path}\n`);
          }
          throw new ReviewTerminalError("write boundary violation", 1);
        }
      }

      // Commit actuator changes
      try {
        runner.run("git", ["add", "-A"], opts.worktreePath);
        const porcelain = runner.run("git", ["status", "--porcelain"], opts.worktreePath).trim();

        if (porcelain !== "") {
          commitPlanReview(
            {
              worktreePath: opts.worktreePath,
              specDirBasename: opts.specDirBasename,
              passNumber: ctx.passNumber,
              agentLabel: "plan-review-actuator",
              ...(opts.subjectSuffix !== undefined ? { subjectSuffix: opts.subjectSuffix } : {}),
              targetDir,
              reviewLabel: "review: actuator",
            },
            gitOps,
          );
          opts.stderr?.(`plan: actuator committed and pushed\n`);
          await opts.updatePrBody?.();
        } else {
          opts.stderr?.(`plan: actuator made no changes\n`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.stderr?.(`plan: actuator commit failed: ${message}\n`);
        throw new ReviewTerminalError(message, 1);
      }
    };
  };

  try {
    const exitCode = await runReview({
      config: opts.config,
      cwd: opts.agentCwd ?? opts.worktreePath,
      ...(opts.reviewAgentOrder !== undefined ? { reviewAgentOrder: opts.reviewAgentOrder } : {}),
      ...(opts.reviewPassesOverride !== undefined ? { reviewPassesOverride: opts.reviewPassesOverride } : {}),
      ...(opts.startPassNumber !== undefined ? { startPassNumber: opts.startPassNumber } : {}),
      ...(opts.isInterrupted !== undefined ? { isInterrupted: opts.isInterrupted } : {}),
      ...(opts.onPassStart !== undefined ? { onPassStart: opts.onPassStart } : {}),
      ...(opts.additionalReadDirs !== undefined ? { additionalReadDirs: opts.additionalReadDirs } : {}),
      adapterForPass: ({ passNumber, totalPasses }) => {
        const intentBefore = readFileSync(join(finalSpecPath, "intent.md"), "utf8");
        const specSnapshotBefore = opts.commit ? null : snapshotSpecDirFiles(finalSpecPath);
        return createPlanReviewAdapter({
          opts,
          displayPassNumber: passNumber,
          displayTotalPasses: totalPasses,
          intentBefore,
          finalSpecPath,
          specSnapshotBefore,
          runner,
          gitOps,
          onBlocker: (blocker) => {
            detectedBlocker = blocker;
          },
          onAgentFailure: (passNumber, stderr) => {
            agentFailure = { passNumber, stderr };
          },
        });
      },
      loadAgent: ({ name, model }) => {
        const agent = resolveAgent(name as AgentName, model);
        return withPlanReviewIdleWatchdog(agent, {
          ...(opts.idleOutputTimeoutMs !== undefined ? { idleOutputTimeoutMs: opts.idleOutputTimeoutMs } : {}),
          config: opts.config,
          ...(opts.planWorktreeDir !== undefined ? { planWorktreeDir: opts.planWorktreeDir } : {}),
          ...(opts.stderr !== undefined ? { stderr: opts.stderr } : {}),
        });
      },
      onAllAgentsQuotaExhausted: (message) => {
        opts.stderr?.(`plan: ${message}\n`);
      },
      onQuotaRotation: (agent, spawnResult, classified) => {
        emitPlanAgentQuotaFallback(opts.stderr, agent, spawnResult, classified);
      },
      actuator: createActuator(),
    });

    if (exitCode === 130) {
      return { exitCode: 130, interrupted: true };
    }
    if (exitCode === 3) {
      const detail = agentFailure?.stderr;
      opts.stderr?.(`plan: model configuration error${detail ? `: ${detail}` : ""}\n`);
      return { exitCode: 3 };
    }
    if (exitCode !== 0) {
      if (detectedBlocker !== undefined) {
        return { exitCode, blocker: detectedBlocker };
      }
      if (agentFailure !== undefined) {
        opts.stderr?.(`plan: review pass ${agentFailure.passNumber} failed: ${agentFailure.stderr}\n`);
      }
      return { exitCode };
    }
    return { exitCode: 0 };
  } catch (err) {
    if (err instanceof ReviewTerminalError) {
      return { exitCode: err.exitCode };
    }
    opts.stderr?.(`plan: review error: ${(err as Error).message}\n`);
    return { exitCode: 1 };
  }
}
