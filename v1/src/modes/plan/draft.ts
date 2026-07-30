import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { executeWithQuotaFallback } from "../../../../shared/invocation/execute.ts";
import { normalizePlanDraftSpecDir } from "../../../../shared/module-boundary-surfaces.ts";
import { buildPlanDraftPrompt } from "../../../../shared/prompts/plan-draft.ts";
import { PromptRenderingError } from "../../../../shared/prompts/render.ts";
import { detectBlocker, isStructuralAc, parseSpec } from "../../../../shared/spec-parser.ts";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { DEFAULT_IDLE_OUTPUT_TIMEOUT_MS } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { evaluateIdleWatchdog, sampleFileActivityIfNeeded } from "../patch/idle-watchdog.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { createPlanInvocationBinding } from "./plan-invocation-binding.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";
import { hasGenuineBlocker } from "./review-gate.ts";
import { resolvePlanSpecDirPath } from "./spec-dir.ts";
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
  /** Additional read directories passed to agent (for external spec storage). */
  additionalReadDirs?: string[];
  /** Plan worktree directory for idle watchdog file-activity scanning. */
  planWorktreeDir?: string;
  /** Idle output timeout in milliseconds (0 to disable). */
  idleOutputTimeoutMs?: number | undefined;
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
  try {
    return buildPlanDraftPrompt({
      name: opts.name,
      intent: opts.intent,
      specGuidance: opts.specGuidance,
      ...(opts.flatSpecLayout !== undefined ? { flatSpecLayout: opts.flatSpecLayout } : {}),
      ...(opts.workDirLabel !== undefined ? { workDirLabel: opts.workDirLabel } : {}),
      ...(opts.targetDir !== undefined ? { targetDir: opts.targetDir } : {}),
    });
  } catch (err) {
    if (err instanceof PromptRenderingError) {
      throw new Error(`draft prompt configuration error: ${err.details}`);
    }
    throw err;
  }
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

  const agentOrder = opts.config.modes.plan.agentOrder;
  if (agentOrder.length === 0) {
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

  const resolveAgent = opts.createAgent ?? defaultCreateAgent;

  const draftController = new AbortController();
  const draftLastOutputAtMs = { current: null as number | null };
  let draftLastFileActivityAtMs: number | null = null;
  let draftIdleTimeoutHandle: NodeJS.Timeout | null = null;

  // Arm idle watchdog if configured
  const draftArmedAt = Date.now();
  const draftIdleOutputTimeoutMs =
    opts.idleOutputTimeoutMs !== undefined
      ? opts.idleOutputTimeoutMs
      : (opts.config.idleOutputTimeoutMs ?? DEFAULT_IDLE_OUTPUT_TIMEOUT_MS);
  const draftWorktreeDir = opts.planWorktreeDir ?? opts.worktreePath;
  if (draftIdleOutputTimeoutMs > 0) {
    const scheduleDraftIdleCheck = () => {
      draftIdleTimeoutHandle = setTimeout(() => {
        const snapshotAt = Date.now();
        const lastOutputAgeMs = draftLastOutputAtMs.current === null ? null : snapshotAt - draftLastOutputAtMs.current;

        const sampledFileActivityAt = sampleFileActivityIfNeeded({
          lastOutputAgeMs,
          idleOutputTimeoutMs: draftIdleOutputTimeoutMs,
          now: snapshotAt,
          armedAt: draftArmedAt,
          workingDir: draftWorktreeDir,
        });

        if (sampledFileActivityAt !== null) {
          draftLastFileActivityAtMs = sampledFileActivityAt;
        }

        const { shouldFire } = evaluateIdleWatchdog({
          now: snapshotAt,
          lastOutputAt: draftLastOutputAtMs.current,
          lastFileActivityAt: draftLastFileActivityAtMs,
          armedAt: draftArmedAt,
          idleOutputTimeoutMs: draftIdleOutputTimeoutMs,
        });

        if (shouldFire) {
          opts.stderr?.(`[watchdog] idle timeout fired after ${draftIdleOutputTimeoutMs}ms; killing agent\n`);
          draftController.abort("idle-timeout");
        } else {
          scheduleDraftIdleCheck();
        }
      }, 100);
      draftIdleTimeoutHandle?.unref?.();
    };
    scheduleDraftIdleCheck();
  }

  const bindings = agentOrder.map((entry) =>
    createPlanInvocationBinding({
      agentName: entry.agent,
      configuredModel: entry.model,
      createAgent: resolveAgent,
      config: opts.config,
      worktreePath: opts.worktreePath,
      spawnOptions: opts.additionalReadDirs !== undefined ? { additionalReadDirs: opts.additionalReadDirs } : undefined,
      lastOutputAtMs: draftLastOutputAtMs,
      onQuotaFallbackEmit: (agentName, spawnResult, classified) => {
        emitPlanAgentQuotaFallback(opts.stderr, agentName, spawnResult, classified, "draft");
      },
      recordAgentAttempt: (data) => {
        opts.planTelemetry?.recordAgentAttempt({
          phase: "draft",
          agentCli: data.agentCli,
          configuredModel: data.configuredModel,
          durationMs: data.durationMs,
          result: data.result,
        });
      },
      shouldAdvance: (result) => result.kind === "quota" || result.kind === "error" || result.kind === "model_config",
    }),
  );

  try {
    const execution = await executeWithQuotaFallback({
      prompt,
      cwd: agentCwd,
      bindings,
      signal: draftController.signal,
    });

    let agentLabel: string | null = null;
    if (execution.final?.binding) {
      agentLabel = execution.final.binding.id;
    }

    const finalResult = execution.final?.result;
    if (finalResult?.kind === "ok") {
      const subspecCount = countSubspecs(specDirPath);
      return { result: finalResult, subspecCount, agentLabel };
    }

    if (finalResult === undefined) {
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

    return {
      result: finalResult.kind === "stall" ? { kind: "error", exitCode: -1, stderr: finalResult.stderr } : finalResult,
      subspecCount: null,
      agentLabel,
    };
  } finally {
    if (draftIdleTimeoutHandle !== null) {
      clearTimeout(draftIdleTimeoutHandle);
    }
  }
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
 * Performs structural validation of each generated subspec.
 */
export function validateDraftOutput(
  worktreePath: string,
  name: string,
  intentBefore?: string,
  specDirPath?: string,
  targetDir?: string,
): { valid: boolean; error: string | null; warnings: string[]; blocker?: string | undefined } {
  const specDir = resolvePlanSpecDirPath(worktreePath, name, specDirPath, targetDir);
  const structuralWarnings: string[] = [];

  // Check if blocker was added to intent.md (do this before index.md check)
  const intentPath = join(specDir, "intent.md");
  const intentAfter = readFileSync(intentPath, "utf8");

  if (hasGenuineBlocker(intentAfter)) {
    const blockerDetection = detectBlocker(intentAfter);
    return {
      valid: true,
      error: null,
      warnings: [],
      blocker: blockerDetection.body,
    };
  }

  // Check index.md exists
  const indexPath = join(specDir, "index.md");
  if (!existsSync(indexPath)) {
    return { valid: false, error: "index.md was not created", warnings: [] };
  }

  try {
    normalizePlanDraftSpecDir(specDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingAcceptance = message.match(/^Plan subspec (.+) is missing ## Acceptance criteria$/u);
    return {
      valid: false,
      error:
        missingAcceptance?.[1] === undefined
          ? `plan boundary normalization failed: ${message}`
          : `${missingAcceptance[1]}: no acceptance criteria found under \`## Acceptance criteria\``,
      warnings: [],
    };
  }

  // Check at least one NN-*.md exists
  const files = readdirSync(specDir);
  const subspecFiles = files.filter((f: string) => /^\d{2}-.*\.md$/.test(f)).sort();

  if (subspecFiles.length === 0) {
    return {
      valid: false,
      error: "no numbered subspecs (NN-*.md) were created",
      warnings: [],
    };
  }

  // Check intent.md was not modified (unless a blocker was added)
  if (intentBefore !== undefined) {
    if (!isValidIntentModification(intentBefore, intentAfter)) {
      return {
        valid: false,
        error: "intent.md was modified (only allowed modification is appending ## Blocker; frontmatter is immutable)",
        warnings: [],
      };
    }
  }

  // Validate each generated subspec structurally
  for (const subspecFile of subspecFiles) {
    const subspecPath = join(specDir, subspecFile);
    const subspecContent = readFileSync(subspecPath, "utf8");
    const parsed = parseSpec(subspecContent);

    // Check for near-miss headings, duplicate sections, or unsatisfiable ACs (hard failures)
    for (const warning of parsed.warnings) {
      if (
        warning.kind === "near-miss-acceptance-heading" ||
        warning.kind === "near-miss-blocker-heading" ||
        warning.kind === "duplicate-section" ||
        warning.kind === "unsatisfiable-acceptance-criterion"
      ) {
        return {
          valid: false,
          error: `${subspecFile}: ${warning.message}`,
          warnings: [],
        };
      }
      if (warning.kind === "missing-anchor-behavioral-ac") {
        structuralWarnings.push(`${subspecFile}: ${warning.message}`);
      }
    }

    // Check for missing/empty acceptance section
    if (parsed.acceptanceCriteria.length === 0) {
      return {
        valid: false,
        error: `${subspecFile}: no acceptance criteria found under \`## Acceptance criteria\``,
        warnings: [],
      };
    }

    // Collect structural AC warnings
    for (const criterion of parsed.acceptanceCriteria) {
      if (isStructuralAc(criterion)) {
        structuralWarnings.push(`${subspecFile}: structural AC: "${criterion.text}"`);
      }
    }
  }

  return { valid: true, error: null, warnings: structuralWarnings };
}
