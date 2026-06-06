import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import { type ExternalWorktreeInput, type LockStatus, withExternalWorktree } from "./external-worktree.ts";
import { runStep, type StepRunResult } from "./step-runner.ts";
import { renderWriteExecutePrompt } from "./write-prompt.ts";

/** Input contract for one write behavior execution. */
export type WriteExecuteInput = {
  worktree: ExternalWorktreeInput;
  specPath: string;
  stepRules: string;
  expectedArtifactPath: string;
  bindings: readonly InvocationBinding[];
  signal?: AbortSignal;
};

/** Result surface for one write behavior execution. */
export type WriteExecuteResult = {
  worktreePath: string;
  worktreeReused: boolean;
  lock: LockStatus;
  result: StepRunResult;
};

/** Run one write behavior execution over shared invocation, runner, and worktree seams. */
export async function executeWrite(args: WriteExecuteInput): Promise<WriteExecuteResult> {
  const wrapped = await withExternalWorktree(args.worktree, async (worktree) => {
    const specPath = resolveInWorktree(worktree.path, args.specPath);
    const expectedArtifactPath = resolveInWorktree(worktree.path, args.expectedArtifactPath);
    const prompt = renderWriteExecutePrompt({
      specPath,
      stepRules: args.stepRules,
    });

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
