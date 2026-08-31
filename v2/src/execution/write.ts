import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import type { InvocationBinding, InvocationTelemetryContext } from "../../../shared/invocation/execute.ts";
import type { SessionLog } from "../../../shared/invocation/session-log.ts";
import { normalizePlanDraftSpecDir } from "../../../shared/module-boundary-surfaces.ts";
import {
  buildIntentSplitPrompt,
  INTENT_SPLIT_PROMPT_ID,
  listIntentStageMarkdownFiles,
} from "../../../shared/prompts/intent-split.ts";
import { buildHarnessNormalizerDiagnosticsSection, buildPlanDraftPrompt } from "../../../shared/prompts/plan-draft.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { PromptRenderingError, renderArtifactTemplate } from "../../../shared/prompts/render.ts";
import { readSpecGuidance } from "../../../shared/spec-guidance-path.ts";
import { hasGenuineBlocker, parseSpec } from "../../../shared/spec-parser.ts";
import { dualConstraintRepromptDetail, type SurvivingMutationRepromptContext } from "../persistence/log-stream.ts";
import {
  type ExternalWorktreeInput,
  type LockStatus,
  withExternalWorktree as realWithExternalWorktree,
} from "./external-worktree.ts";
import { type BlockerTextContract, runStep, type StepContract, type StepRunResult } from "./step-runner.ts";
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

const PLAN_DRAFT_SHAPE_REASON = "plan.draft.shape";

function listNestedPlanDraftSpecDirs(stagingDir: string): string[] {
  const specContainer = join(stagingDir, "spec");
  if (!existsSync(specContainer) || !statSync(specContainer).isDirectory()) {
    return [];
  }
  return readdirSync(specContainer).filter((name) => statSync(join(specContainer, name)).isDirectory());
}

type ResolvedPlanDraftStagingRoot = { ok: true; root: string } | { ok: false; reason: string };

function resolvePlanDraftStagingRoot(stagingDir: string): ResolvedPlanDraftStagingRoot {
  if (validatePlanDraftShapeAtRoot(stagingDir).valid) {
    return { ok: true, root: stagingDir };
  }

  const nestedDirs = listNestedPlanDraftSpecDirs(stagingDir);
  if (nestedDirs.length !== 1) {
    return { ok: false, reason: PLAN_DRAFT_SHAPE_REASON };
  }

  return { ok: true, root: join(stagingDir, "spec", nestedDirs[0]!) };
}

function flattenNestedPlanDraftStaging(stagingDir: string, nestedRoot: string): void {
  const specContainer = join(stagingDir, "spec");
  for (const name of readdirSync(nestedRoot)) {
    renameSync(join(nestedRoot, name), join(stagingDir, name));
  }
  rmSync(specContainer, { recursive: true, force: true });
}

function validatePlanDraftShapeAtRoot(specDir: string): { valid: boolean; reason?: string } {
  if (!existsSync(specDir)) {
    return { valid: false, reason: PLAN_DRAFT_SHAPE_REASON };
  }

  const indexPath = join(specDir, "index.md");
  if (!existsSync(indexPath)) {
    return { valid: false, reason: PLAN_DRAFT_SHAPE_REASON };
  }

  const files = readdirSync(specDir);
  const subspecCount = files.filter((f: string) => /^\d{2}-.*\.md$/.test(f)).length;

  if (subspecCount === 0) {
    return { valid: false, reason: PLAN_DRAFT_SHAPE_REASON };
  }

  return { valid: true };
}

function validatePlanDraftShape(specDir: string): { valid: boolean; reason?: string } {
  const resolved = resolvePlanDraftStagingRoot(specDir);
  if (!resolved.ok) {
    return { valid: false, reason: resolved.reason };
  }
  return validatePlanDraftShapeAtRoot(resolved.root);
}

function validatePlanDraft(
  draftDir: string,
  shapeValidator: (specDir: string) => { valid: boolean; reason?: string },
): { ok: true } | { ok: false; reason: string } {
  const resolved = resolvePlanDraftStagingRoot(draftDir);
  if (!resolved.ok) {
    return resolved;
  }

  const shape = shapeValidator(draftDir);
  if (!shape.valid) {
    return { ok: false, reason: shape.reason ?? PLAN_DRAFT_SHAPE_REASON };
  }

  const structural = validatePlanDraftShapeAtRoot(resolved.root);
  if (!structural.valid) {
    return { ok: false, reason: structural.reason ?? PLAN_DRAFT_SHAPE_REASON };
  }

  try {
    if (resolved.root !== draftDir) {
      flattenNestedPlanDraftStaging(draftDir, resolved.root);
    }
    normalizePlanDraftSpecDir(draftDir);
  } catch (err) {
    // Mutation checkpoint: replacing `message` with PLAN_DRAFT_SHAPE_REASON here must turn
    // "plan-draft normalizer contract_miss carries the normalizer message" RED.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message };
  }

  return { ok: true };
}

/**
 * Reused by plan-stage recovery to revalidate staged bytes it did not itself draft: on success,
 * resolves nested staging, flattens it to the staging root, and runs the contract normalizer — the
 * same shape, flatten, and normalizer checks the ordinary plan-draft write step runs against its
 * own output.
 */
export function checkStagedPlanDraft(draftDir: string): { ok: true } | { ok: false; reason: string } {
  return validatePlanDraft(draftDir, validatePlanDraftShape);
}

function composePlanDraftArtifactCheck(
  stagingDir: string,
  durableDir: string,
  shapeValidator: (specDir: string) => { valid: boolean; reason?: string },
): boolean | { ok: false; reason: string } {
  const staging = validatePlanDraft(stagingDir, shapeValidator);
  if (staging.ok) return true;

  if (staging.reason !== PLAN_DRAFT_SHAPE_REASON) {
    return staging;
  }

  const durable = validatePlanDraft(durableDir, shapeValidator);
  return durable.ok ? true : { ok: false, reason: staging.reason };
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
  /** Remaining write-iteration wall budget in milliseconds. */
  remainingIterationWallMs?: () => number;
  invocationTelemetry?: Omit<InvocationTelemetryContext, "worktreePath">;
  withExternalWorktree?: typeof realWithExternalWorktree;
  intentSeed?: string;
  intentBefore?: string;
  completionValidator?: (specDir: string) => { valid: boolean; reason?: string };
  sessionLog?: SessionLog;
  onInvocationOutputProgress?: () => void;
  idleOutputMs?: number;
  joinProcessOnIdleStall?: boolean;
  landingContractReprompt?: { violation: string; offendingFile: string };
  stagedMarkdownLintReprompt?: { ruleId: string; offendingFile: string; message: string };
  survivingMutationReprompt?: SurvivingMutationRepromptContext;
};

type WriteExecuteResult = {
  worktreePath: string;
  worktreeReused: boolean;
  lock: LockStatus;
  result: StepRunResult;
};

function runWriteStep(
  write: WriteExecuteInput,
  worktreePath: string,
  step: {
    prompt: string;
    contracts: readonly StepContract[];
    blockerTextContract?: BlockerTextContract;
  },
): Promise<StepRunResult> {
  return runStep({
    prompt: step.prompt,
    cwd: worktreePath,
    bindings: write.bindings,
    contracts: step.contracts,
    ...(step.blockerTextContract !== undefined ? { blockerTextContract: step.blockerTextContract } : {}),
    ...(write.signal !== undefined ? { signal: write.signal } : {}),
    ...(write.invocationTelemetry !== undefined
      ? {
          telemetry: {
            ...write.invocationTelemetry,
            worktreePath,
          },
        }
      : {}),
    ...(write.sessionLog !== undefined ? { sessionLog: write.sessionLog } : {}),
    ...(write.onInvocationOutputProgress !== undefined
      ? { onInvocationOutputProgress: write.onInvocationOutputProgress }
      : {}),
    ...(write.idleOutputMs !== undefined ? { idleOutputMs: write.idleOutputMs } : {}),
    ...(write.joinProcessOnIdleStall === true ? { joinProcessOnIdleStall: true } : {}),
  });
}

/** Reserved marker `appendBlockerToSpec` writes; identifies a harness-authored `## Blocker`. */
const RESERVED_HARNESS_BLOCKER_MARKER = "Artifact contract check failed:";
const BLOCKER_HEADING = "## Blocker";
const LEVEL_TWO_HEADING_PATTERN = /^##\s/;

type BlockerSection = { start: number; end: number; body: string };

/** Every exact `## Blocker` section (heading through the next level-two heading, or EOF). */
function findBlockerSections(lines: readonly string[]): BlockerSection[] {
  const sections: BlockerSection[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== BLOCKER_HEADING) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (LEVEL_TWO_HEADING_PATTERN.test(lines[j] ?? "")) {
        end = j;
        break;
      }
    }
    sections.push({
      start: i,
      end,
      body: lines
        .slice(i + 1, end)
        .join("\n")
        .trim(),
    });
    i = end - 1;
  }
  return sections;
}

function isReservedHarnessBlockerBody(body: string): boolean {
  return body.startsWith(RESERVED_HARNESS_BLOCKER_MARKER);
}

/**
 * Remove reserved harness-marker `## Blocker` sections from staged plan-draft `intent.md`,
 * collecting their diagnostic payloads (text after the marker, trimmed) in source order.
 * Non-reserved `## Blocker` sections (agent-authored) and all other content are left
 * byte-for-byte intact.
 */
function stripReservedHarnessBlockerSections(content: string): { content: string; diagnostics: string[] } {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const allSections = findBlockerSections(lines);
  const reserved = allSections.filter((section) => isReservedHarnessBlockerBody(section.body));
  if (reserved.length === 0) {
    return { content, diagnostics: [] };
  }

  const remaining = lines.slice();
  for (const section of [...reserved].reverse()) {
    remaining.splice(section.start, section.end - section.start);
  }

  return {
    content: remaining.join("\n"),
    diagnostics: reserved.map((section) => section.body.slice(RESERVED_HARNESS_BLOCKER_MARKER.length).trim()),
  };
}

/**
 * On a preserved plan-draft attempt, clear reserved harness normalizer blockers from staged
 * `intent.md` and return their diagnostic payloads in source order. One-shot: this only reads
 * and rewrites the file immediately before the attempt's prompt renders, so a later attempt
 * never replays diagnostics already forwarded (or dropped) here.
 */
function collectAndClearHarnessDiagnostics(intentPath: string): string[] {
  if (!existsSync(intentPath)) return [];
  const current = readFileSync(intentPath, "utf8");
  const { content, diagnostics } = stripReservedHarnessBlockerSections(current);
  if (diagnostics.length > 0) {
    writeFileSync(intentPath, content, "utf8");
  }
  return diagnostics;
}

/** Appends the canonical harness-diagnostics section to `prompt` when there is any to forward. */
function appendHarnessDiagnosticsSection(prompt: string, diagnostics: readonly string[]): string {
  if (diagnostics.length === 0) return prompt;
  return `${prompt}\n\n${buildHarnessNormalizerDiagnosticsSection(diagnostics)}`;
}

async function executePlanDraftWrite(
  args: WriteExecuteInput,
  worktreePath: string,
  stagingPath: string,
): Promise<StepRunResult> {
  const specDir = stagingPath;
  const reprompt = args.stagedMarkdownLintReprompt;
  const preserveStage =
    reprompt !== undefined ||
    (existsSync(specDir) &&
      (existsSync(join(specDir, "index.md")) || listNestedPlanDraftSpecDirs(specDir).length === 1));
  if (!preserveStage) {
    rmSync(specDir, { recursive: true, force: true });
  }
  mkdirSync(specDir, { recursive: true });
  const intentPath = join(specDir, "intent.md");
  if (!preserveStage || !existsSync(intentPath)) {
    writeFileSync(intentPath, args.intentSeed ?? "", "utf8");
  }

  const harnessDiagnostics = preserveStage ? collectAndClearHarnessDiagnostics(intentPath) : [];

  const name = getSpecDirName(args.specPath);
  const targetDir = getTargetDir(args.specPath);

  let prompt: string;
  try {
    prompt =
      reprompt !== undefined
        ? appendHarnessDiagnosticsSection(
            renderArtifactTemplate(loadPromptRegistry().getById("write.staged-markdown-lint-reprompt"), {
              RULE_ID: reprompt.ruleId,
              OFFENDING_FILE: reprompt.offendingFile,
              STAGING_DIR: args.expectedArtifactPath,
              VIOLATION: reprompt.message,
            }),
            harnessDiagnostics,
          )
        : buildPlanDraftPrompt({
            name,
            intent: args.intentSeed ?? "",
            specGuidance: readSpecGuidance(),
            workDirLabel: args.promptPlaceholders?.WORKDIR ?? worktreePath,
            targetDir,
            specDir,
            stepRules: args.stepRules,
            harnessNormalizerDiagnostics: harnessDiagnostics,
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

  const shapeValidator = args.completionValidator ?? validatePlanDraftShape;
  const durable = resolveInWorktree(worktreePath, args.specPath);
  const intentBefore = args.intentBefore ?? args.intentSeed;
  const contracts: StepContract[] = [];

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
    reason: PLAN_DRAFT_SHAPE_REASON,
    check: () => composePlanDraftArtifactCheck(specDir, durable, shapeValidator),
  });

  const result = await runWriteStep(args, worktreePath, { prompt, contracts });
  if (result.kind === "complete") {
    const staging = validatePlanDraft(specDir, shapeValidator);
    if (!staging.ok && validatePlanDraft(durable, shapeValidator).ok) {
      for (const file of readdirSync(durable)) copyFileSync(join(durable, file), join(specDir, file));
      rmSync(durable, { recursive: true, force: true });
      validatePlanDraft(specDir, shapeValidator);
    }
  }
  return result;
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

  const landingReprompt = args.landingContractReprompt;
  const lintReprompt = args.stagedMarkdownLintReprompt;
  const preserveStage =
    landingReprompt !== undefined ||
    lintReprompt !== undefined ||
    (existsSync(expectedArtifactPath) && listIntentStageMarkdownFiles(expectedArtifactPath).length > 0);
  if (!preserveStage) {
    rmSync(expectedArtifactPath, { recursive: true, force: true });
  }
  mkdirSync(expectedArtifactPath, { recursive: true });
  const prompt =
    landingReprompt !== undefined
      ? renderArtifactTemplate(loadPromptRegistry().getById("write.landing-contract-reprompt"), {
          VIOLATION: landingReprompt.violation,
          OFFENDING_FILE: landingReprompt.offendingFile,
          STAGING_DIR: args.expectedArtifactPath,
        })
      : lintReprompt !== undefined
        ? renderArtifactTemplate(loadPromptRegistry().getById("write.staged-markdown-lint-reprompt"), {
            RULE_ID: lintReprompt.ruleId,
            OFFENDING_FILE: lintReprompt.offendingFile,
            STAGING_DIR: args.expectedArtifactPath,
            VIOLATION: lintReprompt.message,
          })
        : buildIntentSplitPrompt({
            workdir: args.promptPlaceholders?.WORKDIR ?? worktreePath,
            seedLabel,
            seedContent,
            stagingDir: args.expectedArtifactPath,
            stepRules: args.stepRules,
          });

  return runWriteStep(args, worktreePath, {
    prompt,
    contracts: [
      {
        id: "artifact.exists",
        check: () => listIntentStageMarkdownFiles(expectedArtifactPath).length > 0,
      },
    ],
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
    const survivingReprompt = args.survivingMutationReprompt;
    if (promptId === "patch.prompt.body" && survivingReprompt !== undefined) {
      prompt = renderArtifactTemplate(loadPromptRegistry().getById("write.surviving-mutation-reprompt"), {
        SPEC_PATH: expectedArtifactPath,
        STEP_RULES: args.stepRules,
        SURVIVING_MUTATION: survivingReprompt.mutation,
        SOURCE_FILE: survivingReprompt.sourceFile,
        SOURCE_LINE: String(survivingReprompt.sourceLine),
        DUAL_CONSTRAINT_DETAIL: dualConstraintRepromptDetail(survivingReprompt.dualConstraint),
      });
    } else {
      const placeholders = assembleWriteStepPlaceholders(
        promptId,
        { specPath, stepRules: args.stepRules, worktreePath, expectedArtifactPath },
        args.promptPlaceholders,
      );
      prompt = renderStepPrompt(promptId, placeholders);
    }
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

  const contracts: StepContract[] = [
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

  // Blocker-text contract applies to both run path (DEFAULT_PROMPT_ID on specPath)
  // and implement path (patch.prompt.body on expectedArtifactPath, the active subspec).
  const blockerTextTargetPath =
    promptId === DEFAULT_PROMPT_ID
      ? specPath
      : promptId === "patch.prompt.body" && expectedArtifactPath.length > 0
        ? expectedArtifactPath
        : undefined;
  const blockerTextContract: BlockerTextContract | undefined =
    blockerTextTargetPath !== undefined && existsSync(blockerTextTargetPath) && statSync(blockerTextTargetPath).isFile()
      ? {
          id: "write.blocker-text",
          specPath: blockerTextTargetPath,
          specBefore: readFileSync(blockerTextTargetPath, "utf8"),
        }
      : undefined;

  return runWriteStep(args, worktreePath, {
    prompt,
    contracts,
    ...(blockerTextContract !== undefined ? { blockerTextContract } : {}),
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
        return executePlanDraftWrite(args, worktree.path, expectedArtifactPath);
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
