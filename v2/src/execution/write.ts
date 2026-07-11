import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { InvocationBinding, InvocationTelemetryContext } from "../../../shared/invocation/execute.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";
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
  jarvisRoot?: string;
  completionValidator?: (specDir: string) => { valid: boolean; reason?: string };
};

type WriteExecuteResult = {
  worktreePath: string;
  worktreeReused: boolean;
  lock: LockStatus;
  result: StepRunResult;
};

/** Run one write behavior execution over shared invocation, runner, and worktree seams. */
export async function executeWrite(args: WriteExecuteInput): Promise<WriteExecuteResult> {
  const withExternalWorktree = args.withExternalWorktree ?? realWithExternalWorktree;
  const wrapped = await withExternalWorktree(args.worktree, async (worktree) => {
    const specPath = resolveInWorktree(worktree.path, args.specPath);
    const expectedArtifactPath = resolveInWorktree(worktree.path, args.expectedArtifactPath);
    const promptId = args.promptId ?? DEFAULT_PROMPT_ID;

    if (promptId === "plan.prompt.draft" && args.intentSeed !== undefined) {
      // Plan preset: seed intent.md and supply all four required placeholders
      const specDir = specPath;
      mkdirSync(specDir, { recursive: true });
      const intentPath = join(specDir, "intent.md");
      writeFileSync(intentPath, args.intentSeed, "utf8");

      // Extract NAME (basename of spec directory) and targetDir from specPath
      const name = getSpecDirName(specPath);
      const targetDir = getTargetDir(specPath);

      // Read spec guidance from jarvis root
      const specGuidancePath = getSpecGuidancePath(args.jarvisRoot);
      const specGuidance = readFileSync(specGuidancePath, "utf8");

      // Supply all four required placeholders
      const placeholders = {
        WORKDIR: args.promptPlaceholders?.WORKDIR ?? worktree.path,
        NAME: name,
        INTENT: args.intentSeed,
        SPEC_GUIDANCE: specGuidance,
      };

      // Rewrite spec/<NAME>/ to <targetDir>/<NAME>/ in the template source, before
      // <NAME> is substituted, so the literal token still matches at render time.
      const registry = loadPromptRegistry();
      const artifact = registry.getById("plan.prompt.draft");
      const rewrittenArtifact = {
        ...artifact,
        body: artifact.body.replaceAll("spec/<NAME>/", `${targetDir}/<NAME>/`),
      };
      const prompt = renderArtifactTemplate(rewrittenArtifact, placeholders).trim();

      const validator = args.completionValidator ?? validatePlanDraftShape;
      const intentBefore = args.intentBefore ?? args.intentSeed;

      const contracts: Array<{ id: string; reason?: string; check: () => boolean | Promise<boolean> }> = [];

      // Blocker detection runs before shape check (if intentBefore is available)
      if (intentBefore !== undefined) {
        contracts.push({
          id: "plan.draft.blocker",
          reason: "plan.draft.blocker",
          check: async () => {
            const intentPath = join(specDir, "intent.md");
            if (!existsSync(intentPath)) {
              return true; // No blocker if intent.md doesn't exist
            }
            const intentAfter = readFileSync(intentPath, "utf8");
            return !hasGenuineBlocker(intentBefore, intentAfter);
          },
        });
      }

      // Shape validation contract
      contracts.push({
        id: "artifact.exists",
        reason: "plan.draft.shape",
        check: () => {
          const validation = validator(specDir);
          return validation.valid;
        },
      });

      return runStep({
        prompt,
        cwd: worktree.path,
        bindings: args.bindings,
        contracts,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
        ...(args.invocationTelemetry !== undefined
          ? {
              telemetry: {
                ...args.invocationTelemetry,
                worktreePath: worktree.path,
              },
            }
          : {}),
      });
    }

    const placeholders =
      promptId === DEFAULT_PROMPT_ID
        ? {
            SPEC_PATH: specPath,
            STEP_RULES: args.stepRules,
            PRINCIPLES: loadPromptRegistry().getById("write.principles").body,
          }
        : (args.promptPlaceholders ?? {});
    const prompt = renderStepPrompt(promptId, placeholders);

    return runStep({
      prompt,
      cwd: worktree.path,
      bindings: args.bindings,
      contracts: [
        {
          id: "artifact.exists",
          check: () => existsSync(expectedArtifactPath),
        },
      ],
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
      ...(args.invocationTelemetry !== undefined
        ? {
            telemetry: {
              ...args.invocationTelemetry,
              worktreePath: worktree.path,
            },
          }
        : {}),
    });
  });

  return {
    worktreePath: wrapped.worktree.path,
    worktreeReused: wrapped.worktree.reused,
    lock: wrapped.lock,
    result: wrapped.value,
  };
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

function getSpecGuidancePath(jarvisRoot?: string): string {
  // Resolve spec-guidance.md from the jarvis installation
  // It's located at v1/docs/spec-guidance.md relative to the jarvis root
  if (jarvisRoot) {
    return join(jarvisRoot, "..", "..", "v1", "docs", "spec-guidance.md");
  }
  // Fallback: use import.meta.dir to find the current location
  // write.ts is at v2/src/execution/, so we need to go up to the repo root
  return join(import.meta.dir, "..", "..", "..", "v1", "docs", "spec-guidance.md");
}
