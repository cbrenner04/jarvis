import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { InvocationBinding, InvocationTelemetryContext } from "../../../shared/invocation/execute.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import {
  type ExternalWorktreeInput,
  type LockStatus,
  withExternalWorktree as realWithExternalWorktree,
} from "./external-worktree.ts";
import { runStep, type StepRunResult } from "./step-runner.ts";
import { renderStepPrompt } from "./write-prompt.ts";

const DEFAULT_PROMPT_ID = "write.execute";

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
  /** Intent seed content to write to spec/<name>/intent.md before invoking agent. */
  intentSeed?: string;
  /** Name for plan preset: used to construct spec/<NAME>/ output path rewrite. */
  presetName?: string;
  /** Target directory for plan preset: used in spec/<NAME>/ to <targetDir>/<NAME>/ rewrite. */
  targetDir?: string;
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

    // Seed intent.md before invoking agent if intentSeed is provided
    if (args.intentSeed !== undefined) {
      const specDir = resolveInWorktree(worktree.path, args.specPath);
      mkdirSync(specDir, { recursive: true });
      const intentPath = join(specDir, "intent.md");
      writeFileSync(intentPath, args.intentSeed, "utf8");
    }

    const placeholders =
      promptId === DEFAULT_PROMPT_ID
        ? {
            SPEC_PATH: specPath,
            STEP_RULES: args.stepRules,
            PRINCIPLES: loadPromptRegistry().getById("write.principles").body,
          }
        : (args.promptPlaceholders ?? {});

    // Apply spec/<NAME>/ rewrite for plan preset
    let prompt = renderStepPrompt(promptId, placeholders);
    if (args.presetName === "plan" && args.targetDir !== undefined && args.promptPlaceholders?.NAME !== undefined) {
      const name = args.promptPlaceholders.NAME;
      prompt = prompt.replaceAll(`spec/${name}/`, `${args.targetDir}/${name}/`);
    }

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
