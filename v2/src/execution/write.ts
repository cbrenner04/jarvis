import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { InvocationBinding, InvocationTelemetryContext } from "../../../shared/invocation/execute.ts";
import type { SessionLog } from "../../../shared/invocation/session-log.ts";
import {
  buildIntentSplitPrompt,
  INTENT_SPLIT_PROMPT_ID,
  listIntentStageMarkdownFiles,
} from "../../../shared/prompts/intent-split.ts";
import { buildPlanDraftPrompt } from "../../../shared/prompts/plan-draft.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { PromptRenderingError } from "../../../shared/prompts/render.ts";
import { hasGenuineBlocker, parseSpec } from "../../../shared/spec-parser.ts";
import {
  type ExternalWorktreeInput,
  type LockStatus,
  withExternalWorktree as realWithExternalWorktree,
} from "./external-worktree.ts";
import { type BlockerTextContract, runStep, type StepRunResult } from "./step-runner.ts";
import { renderStepPrompt } from "./write-prompt.ts";

const DEFAULT_PROMPT_ID = "write.execute";

function readRepoGuidance(worktreePath: string): string {
  const parts: string[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const path = join(worktreePath, name);
    if (existsSync(path)) {
      parts.push(readFileSync(path, "utf8"));
    }
  }
  return parts.join(parts.length > 1 ? "\n\n" : "");
}

function readActiveSubspecBody(artifactPath: string): string {
  if (!existsSync(artifactPath)) {
    return "";
  }
  return readFileSync(artifactPath, "utf8");
}

type WriteStepPlaceholderContext = {
  specPath: string;
  stepRules: string;
  worktreePath: string;
  expectedArtifactPath: string;
};

function resolveWriteStepPlaceholder(name: string, ctx: WriteStepPlaceholderContext): string | undefined {
  switch (name) {
    case "SPEC_PATH":
      return ctx.specPath;
    case "STEP_RULES":
      return ctx.stepRules;
    case "PRINCIPLES":
      return loadPromptRegistry().getById("write.principles").body;
    case "SIBLINGS_BLOCK":
    case "TIMEOUT_CHECKPOINT_CONTEXT":
      return "";
    case "REPO_GUIDANCE":
      return readRepoGuidance(ctx.worktreePath);
    case "ACTIVE_SUBSPEC_PATH":
      return ctx.expectedArtifactPath.length > 0 ? `${ctx.expectedArtifactPath}\n` : "";
    case "ACTIVE_SUBSPEC_BODY":
      return readActiveSubspecBody(ctx.expectedArtifactPath);
    case "PATCH_RULES":
      return loadPromptRegistry().getById("patch.rules").body.trim();
    default:
      return undefined;
  }
}

function assembleWriteStepPlaceholders(
  promptId: string,
  ctx: WriteStepPlaceholderContext,
  callerPlaceholders: Record<string, string> | undefined,
): Record<string, string> {
  const declarations = loadPromptRegistry().getById(promptId).metadata.placeholders;
  const resolved: Record<string, string> = {};
  for (const decl of declarations) {
    const derived = resolveWriteStepPlaceholder(decl.name, ctx);
    if (derived !== undefined) {
      resolved[decl.name] = derived;
    }
  }
  return { ...resolved, ...(callerPlaceholders ?? {}) };
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
  sessionLog?: SessionLog;
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
  sessionLog?: SessionLog;
};

function runWriteStep(
  args: WriteStepContext & {
    prompt: string;
    contracts: Array<{ id: string; reason?: string; check: () => boolean | Promise<boolean> }>;
    blockerTextContract?: BlockerTextContract;
  },
): Promise<StepRunResult> {
  return runStep({
    prompt: args.prompt,
    cwd: args.worktreePath,
    bindings: args.bindings,
    contracts: args.contracts,
    ...(args.blockerTextContract !== undefined ? { blockerTextContract: args.blockerTextContract } : {}),
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.invocationTelemetry !== undefined
      ? {
          telemetry: {
            ...args.invocationTelemetry,
            worktreePath: args.worktreePath,
          },
        }
      : {}),
    ...(args.sessionLog !== undefined ? { sessionLog: args.sessionLog } : {}),
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
    ...(args.sessionLog !== undefined ? { sessionLog: args.sessionLog } : {}),
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
    ...(args.sessionLog !== undefined ? { sessionLog: args.sessionLog } : {}),
  });
}

function buildCriteriaTickedReason(unticked: string[]): string {
  const lines = unticked.map((text) => `- ${text}`).join("\n");
  return `Unticked non-human-only acceptance criteria:\n${lines}`;
}

function getUntickedNonHumanOnlyCriteria(artifactPath: string): string[] {
  if (!existsSync(artifactPath)) {
    return [];
  }
  const content = readFileSync(artifactPath, "utf8");
  const parsed = parseSpec(content);
  return parsed.acceptanceCriteria
    .filter((criterion) => !criterion.humanOnly && !criterion.checked)
    .map((criterion) => criterion.text);
}

async function executeDefaultWrite(
  args: WriteExecuteInput,
  worktreePath: string,
  specPath: string,
  expectedArtifactPath: string,
  promptId: string,
): Promise<StepRunResult> {
  let prompt: string;
  try {
    const placeholders = assembleWriteStepPlaceholders(
      promptId,
      { specPath, stepRules: args.stepRules, worktreePath, expectedArtifactPath },
      args.promptPlaceholders,
    );
    prompt = renderStepPrompt(promptId, placeholders);
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

  const contracts: Array<{ id: string; reason?: string; check: () => boolean | Promise<boolean> }> = [
    {
      id: "artifact.exists",
      check: () => existsSync(expectedArtifactPath),
    },
  ];

  // Add criteria-ticked contract for implement writes (patch.prompt.body)
  // Check the active subspec for unticked non-human-only acceptance criteria
  if (promptId === "patch.prompt.body" && expectedArtifactPath.length > 0) {
    const unticked = getUntickedNonHumanOnlyCriteria(expectedArtifactPath);
    if (unticked.length > 0) {
      contracts.push({
        id: "spec.criteria-ticked",
        reason: buildCriteriaTickedReason(unticked),
        check: () => {
          const current = getUntickedNonHumanOnlyCriteria(expectedArtifactPath);
          return current.length === 0;
        },
      });
    }
  }

  return runWriteStep({
    worktreePath,
    bindings: args.bindings,
    prompt,
    contracts,
    ...(promptId === DEFAULT_PROMPT_ID && existsSync(specPath) && statSync(specPath).isFile()
      ? {
          blockerTextContract: {
            id: "write.blocker-text",
            specPath,
            specBefore: readFileSync(specPath, "utf8"),
          },
        }
      : {}),
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.invocationTelemetry !== undefined ? { invocationTelemetry: args.invocationTelemetry } : {}),
    ...(args.sessionLog !== undefined ? { sessionLog: args.sessionLog } : {}),
  });
}

/** Run one write behavior execution over shared invocation, runner, and worktree seams. */
export async function executeWrite(args: WriteExecuteInput): Promise<WriteExecuteResult> {
  throwIfAborted(args.signal);
  const withExternalWorktree = args.withExternalWorktree ?? realWithExternalWorktree;
  const wrapped = await withExternalWorktree(
    args.worktree,
    async (worktree) => {
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
    },
    undefined,
    args.signal,
  );

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
