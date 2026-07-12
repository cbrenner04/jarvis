import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { InvocationBinding, InvocationTelemetryContext } from "../../../shared/invocation/execute.ts";
import {
  buildIntentSplitPrompt,
  INTENT_SPLIT_PROMPT_ID,
  listIntentStageMarkdownFiles,
} from "../../../shared/prompts/intent-split.ts";
import { buildPlanDraftPrompt } from "../../../shared/prompts/plan-draft.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { PromptRenderingError } from "../../../shared/prompts/render.ts";
import {
  type ExternalWorktreeInput,
  type LockStatus,
  withExternalWorktree as realWithExternalWorktree,
} from "./external-worktree.ts";
import { runStep, type StepRunResult } from "./step-runner.ts";
import { renderStepPrompt } from "./write-prompt.ts";

const DEFAULT_PROMPT_ID = "write.execute";

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

function extractBlockerSection(text: string): { index: number; body: string | undefined } | undefined {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  let exactBlockerHeaderIndex: number | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line === "## Blocker") {
      exactBlockerHeaderIndex = i;
      break;
    }
  }

  if (exactBlockerHeaderIndex === undefined) {
    return undefined;
  }

  const headingPattern = /^(#{1,6})\s+(.+)$/;
  const bodyLines: string[] = [];
  for (let i = exactBlockerHeaderIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const headingMatch = line.match(headingPattern);
    if (headingMatch?.[1] === "##") {
      break;
    }
    bodyLines.push(line);
  }

  const body = bodyLines.join("\n").trim();
  return {
    index: exactBlockerHeaderIndex,
    body: body.length > 0 ? body : undefined,
  };
}

function hasGenuineBlocker(intentBefore: string, intentAfter: string): boolean {
  const blocker = extractBlockerSection(intentAfter);

  if (blocker === undefined || blocker.body === undefined) {
    return false;
  }

  // Frontmatter must be identical
  if (readFrontmatter(intentBefore) !== readFrontmatter(intentAfter)) {
    return false;
  }

  // Everything before the blocker section must match intentBefore
  const afterLines = intentAfter.replace(/\r\n/g, "\n").split("\n");
  const beforeBlocker = afterLines.slice(0, blocker.index).join("\n").trim();

  return beforeBlocker === intentBefore.trim();
}

function validatePlanDraftShape(specDir: string): { valid: boolean; reason?: string } {
  if (!existsSync(specDir)) {
    return { valid: false, reason: "plan.draft.shape" };
  }

  const indexPath = join(specDir, "index.md");
  if (!existsSync(indexPath)) {
    return { valid: false, reason: "plan.draft.shape" };
  }

  const files = readdirSync(specDir);
  const subspecCount = files.filter((f: string) => /^\d{2}-.*\.md$/.test(f)).length;

  if (subspecCount === 0) {
    return { valid: false, reason: "plan.draft.shape" };
  }

  return { valid: true };
}

export type WriteExecuteInput = {
  worktree: ExternalWorktreeInput;
  specPath: string;
  stepRules: string;
  expectedArtifactPath: string;
  bindings: readonly InvocationBinding[];
  promptId?: string;
  promptPlaceholders?: Record<string, string>;
  signal?: AbortSignal;
  invocationTelemetry?: Omit<InvocationTelemetryContext, "worktreePath">;
  withExternalWorktree?: typeof realWithExternalWorktree;
  intentSeed?: string;
  intentBefore?: string;
  completionValidator?: (specDir: string) => { valid: boolean; reason?: string };
};

type WriteExecuteResult = {
  worktreePath: string;
  worktreeReused: boolean;
  lock: LockStatus;
  result: StepRunResult;
};

type WriteStepContext = {
  worktreePath: string;
  bindings: readonly InvocationBinding[];
  signal?: AbortSignal;
  invocationTelemetry?: Omit<InvocationTelemetryContext, "worktreePath">;
};

function runWriteStep(
  args: WriteStepContext & {
    prompt: string;
    contracts: Array<{ id: string; reason?: string; check: () => boolean | Promise<boolean> }>;
  },
): Promise<StepRunResult> {
  return runStep({
    prompt: args.prompt,
    cwd: args.worktreePath,
    bindings: args.bindings,
    contracts: args.contracts,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.invocationTelemetry !== undefined
      ? {
          telemetry: {
            ...args.invocationTelemetry,
            worktreePath: args.worktreePath,
          },
        }
      : {}),
  });
}

async function executePlanDraftWrite(
  args: WriteExecuteInput,
  worktreePath: string,
  specPath: string,
): Promise<StepRunResult> {
  const specDir = specPath;
  mkdirSync(specDir, { recursive: true });
  const intentPath = join(specDir, "intent.md");
  writeFileSync(intentPath, args.intentSeed ?? "", "utf8");

  const name = getSpecDirName(specPath);
  const targetDir = getTargetDir(specPath);
  const specGuidance = readFileSync(getSpecGuidancePath(), "utf8");

  let prompt: string;
  try {
    prompt = buildPlanDraftPrompt({
      name,
      intent: args.intentSeed ?? "",
      specGuidance,
      workDirLabel: args.promptPlaceholders?.WORKDIR ?? worktreePath,
      targetDir,
      specDir,
      stepRules: args.stepRules,
    });
  } catch (err) {
    if (err instanceof PromptRenderingError) {
      return {
        kind: "invocation_failure",
        failureKind: "model_config",
        invocation: { attempts: [], final: null, telemetryFailures: [] },
      };
    }
    throw err;
  }

  const validator = args.completionValidator ?? validatePlanDraftShape;
  const intentBefore = args.intentBefore ?? args.intentSeed;
  const contracts: Array<{ id: string; reason?: string; check: () => boolean | Promise<boolean> }> = [];

  if (intentBefore !== undefined) {
    contracts.push({
      id: "plan.draft.blocker",
      reason: "plan.draft.blocker",
      check: async () => {
        if (!existsSync(intentPath)) {
          return true;
        }
        const intentAfter = readFileSync(intentPath, "utf8");
        return !hasGenuineBlocker(intentBefore, intentAfter);
      },
    });
  }

  contracts.push({
    id: "artifact.exists",
    reason: "plan.draft.shape",
    check: () => validator(specDir).valid,
  });

  return runWriteStep({
    worktreePath,
    bindings: args.bindings,
    prompt,
    contracts,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.invocationTelemetry !== undefined ? { invocationTelemetry: args.invocationTelemetry } : {}),
  });
}

async function executeIntentSplitWrite(
  args: WriteExecuteInput,
  worktreePath: string,
  expectedArtifactPath: string,
): Promise<StepRunResult> {
  const seedLabel = args.promptPlaceholders?.SEED_LABEL;
  const seedContent = args.promptPlaceholders?.SEED_CONTENT;
  if (seedLabel === undefined || seedContent === undefined) {
    throw new Error("intent split write requires SEED_LABEL and SEED_CONTENT placeholders");
  }

  rmSync(expectedArtifactPath, { recursive: true, force: true });
  mkdirSync(expectedArtifactPath, { recursive: true });

  const prompt = buildIntentSplitPrompt({
    workdir: args.promptPlaceholders?.WORKDIR ?? worktreePath,
    seedLabel,
    seedContent,
    stagingDir: args.expectedArtifactPath,
    stepRules: args.stepRules,
  });

  return runWriteStep({
    worktreePath,
    bindings: args.bindings,
    prompt,
    contracts: [
      {
        id: "artifact.exists",
        check: () => listIntentStageMarkdownFiles(expectedArtifactPath).length > 0,
      },
    ],
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.invocationTelemetry !== undefined ? { invocationTelemetry: args.invocationTelemetry } : {}),
  });
}

async function executeDefaultWrite(
  args: WriteExecuteInput,
  worktreePath: string,
  specPath: string,
  expectedArtifactPath: string,
  promptId: string,
): Promise<StepRunResult> {
  const placeholders =
    promptId === DEFAULT_PROMPT_ID
      ? {
          SPEC_PATH: specPath,
          STEP_RULES: args.stepRules,
          PRINCIPLES: loadPromptRegistry().getById("write.principles").body,
        }
      : (args.promptPlaceholders ?? {});
  const prompt = renderStepPrompt(promptId, placeholders);

  return runWriteStep({
    worktreePath,
    bindings: args.bindings,
    prompt,
    contracts: [
      {
        id: "artifact.exists",
        check: () => existsSync(expectedArtifactPath),
      },
    ],
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.invocationTelemetry !== undefined ? { invocationTelemetry: args.invocationTelemetry } : {}),
  });
}

/** Run one write behavior execution over shared invocation, runner, and worktree seams. */
export async function executeWrite(args: WriteExecuteInput): Promise<WriteExecuteResult> {
  throwIfAborted(args.signal);
  const withExternalWorktree = args.withExternalWorktree ?? realWithExternalWorktree;
  const wrapped = await withExternalWorktree(args.worktree, async (worktree) => {
    throwIfAborted(args.signal);
    const specPath = resolveInWorktree(worktree.path, args.specPath);
    const expectedArtifactPath = resolveInWorktree(worktree.path, args.expectedArtifactPath);
    const promptId = args.promptId ?? DEFAULT_PROMPT_ID;

    if (promptId === "plan.prompt.draft" && args.intentSeed !== undefined) {
      return executePlanDraftWrite(args, worktree.path, specPath);
    }
    if (promptId === INTENT_SPLIT_PROMPT_ID) {
      return executeIntentSplitWrite(args, worktree.path, expectedArtifactPath);
    }
    return executeDefaultWrite(args, worktree.path, specPath, expectedArtifactPath, promptId);
  }, undefined, args.signal);

  return {
    worktreePath: wrapped.worktree.path,
    worktreeReused: wrapped.worktree.reused,
    lock: wrapped.lock,
    result: wrapped.value,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("write execution aborted");
}

function resolveInWorktree(worktreePath: string, path: string): string {
  return isAbsolute(path) ? path : join(worktreePath, path);
}

function getSpecDirName(specPath: string): string {
  // Extract the basename of the spec directory (e.g., "2026-07-11T09-47-44Z-plan-workflow-draft")
  const parts = specPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || specPath;
}

function getTargetDir(specPath: string): string {
  // Extract the target directory from specPath
  // E.g., "spec/2026-07-11T09-47-44Z-plan-workflow-draft" -> "spec"
  // or "v2/spec/2026-07-11T09-47-44Z-plan-workflow-draft" -> "v2/spec"
  const normalized = specPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.slice(0, -1).join("/");
}

function getSpecGuidancePath(): string {
  // Resolve spec-guidance.md from the jarvis installation
  // write.ts is at v2/src/execution/, so we need to go up to the repo root
  return join(import.meta.dir, "..", "..", "..", "v1", "docs", "spec-guidance.md");
}
