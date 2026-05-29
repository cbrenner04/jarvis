import { loadPromptRegistry } from "../../src/shared/prompts/registry.ts";
import { renderArtifactTemplate } from "../../src/shared/prompts/renderer.ts";

export type WriteStepToken = "done" | "no-work" | "blocked" | "progress";

export type WriteStepResult =
  | { kind: "done"; worktreePath: string }
  | { kind: "no-work"; worktreePath: string }
  | { kind: "blocked"; reason: string; worktreePath: string }
  | { kind: "progress"; worktreePath: string }
  | { kind: "error"; message: string };

export type InvokeResult =
  | { kind: "ok"; stdout: string; stderr: string }
  | { kind: "error"; stderr: string };

export type WriteStepRequest = {
  task: string;
  signal?: AbortSignal;
};

export type WriteStepDeps = {
  acquireWorktree: (signal?: AbortSignal) => Promise<{ path: string; release: () => Promise<void> | void }>;
  invoke: (prompt: string, args: { cwd: string; signal?: AbortSignal }) => Promise<InvokeResult>;
  checkOutputContract: (args: { token: "done" | "no-work"; cwd: string }) => Promise<{ ok: boolean; reason?: string }>;
};

export function createWritePrompt(task: string): string {
  const registry = loadPromptRegistry();
  const artifact = registry.getById("write.step");
  return renderArtifactTemplate(artifact, { TASK: task });
}

function readOutcomeToken(stdout: string): WriteStepToken | null {
  const firstLine = stdout.trim().split(/\n/u)[0]?.trim();
  if (
    firstLine === "done" ||
    firstLine === "no-work" ||
    firstLine === "blocked" ||
    firstLine === "progress"
  ) {
    return firstLine;
  }
  return null;
}

export async function runWriteStep(
  request: WriteStepRequest,
  deps: WriteStepDeps,
): Promise<WriteStepResult> {
  const checkout = await deps.acquireWorktree(request.signal);
  try {
    const prompt = createWritePrompt(request.task);
    const invokeResult = await deps.invoke(prompt, {
      cwd: checkout.path,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });

    if (invokeResult.kind === "error") {
      return { kind: "error", message: invokeResult.stderr };
    }

    const token = readOutcomeToken(invokeResult.stdout);
    if (token === null) {
      return { kind: "error", message: "agent did not return a valid outcome token" };
    }

    if (token === "blocked") {
      return {
        kind: "blocked",
        reason: invokeResult.stderr || "agent reported blocked",
        worktreePath: checkout.path,
      };
    }

    if (token === "progress") {
      return { kind: "progress", worktreePath: checkout.path };
    }

    const contract = await deps.checkOutputContract({ token, cwd: checkout.path });
    if (!contract.ok) {
      return {
        kind: "blocked",
        reason: contract.reason ?? "output contract failed",
        worktreePath: checkout.path,
      };
    }

    return { kind: token, worktreePath: checkout.path };
  } finally {
    await checkout.release();
  }
}
