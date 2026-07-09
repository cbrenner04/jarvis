import { existsSync } from "node:fs";
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
