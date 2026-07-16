import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { executeWithQuotaFallback } from "../../../../shared/invocation/execute.ts";
import { buildIntentSplitPrompt, listIntentStageMarkdownFiles } from "../../../../shared/prompts/intent-split.ts";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { createPlanInvocationBinding } from "./plan-invocation-binding.ts";

export { buildIntentSplitPrompt } from "../../../../shared/prompts/intent-split.ts";

export async function runIntentSplitTurn(opts: {
  worktreePath: string;
  seedLabel: string;
  seedContent: string;
  stagingDir: string;
  config: Config;
  stderr?: (s: string) => void;
  createAgent?: (agentName: AgentName, model: string | undefined) => Agent;
  onOutboundPrompt?: (prompt: string) => void;
  additionalReadDirs?: string[];
}): Promise<{ result: AgentResult; agentLabel: string | null }> {
  const agentOrder = opts.config.modes.plan.agentOrder;
  if (agentOrder.length === 0) {
    return {
      result: {
        kind: "model_config",
        stderr: "intent: modes.plan.agentOrder is empty",
      },
      agentLabel: null,
    };
  }

  let prompt: string;
  try {
    prompt = buildIntentSplitPrompt({
      workdir: opts.worktreePath,
      seedLabel: opts.seedLabel,
      seedContent: opts.seedContent,
      stagingDir: opts.stagingDir,
    });
  } catch (err) {
    if (err instanceof Error) {
      return {
        result: {
          kind: "model_config",
          stderr: err.message,
        },
        agentLabel: null,
      };
    }
    throw err;
  }

  opts.onOutboundPrompt?.(prompt);

  const resolveAgent = opts.createAgent ?? defaultCreateAgent;

  const preSpinHook = () => {
    const stagePath = isAbsolute(opts.stagingDir) ? opts.stagingDir : join(opts.worktreePath, opts.stagingDir);
    rmSync(stagePath, { recursive: true, force: true });
    mkdirSync(stagePath, { recursive: true });
  };

  const bindings = agentOrder.map((entry) =>
    createPlanInvocationBinding({
      agentName: entry.agent,
      configuredModel: entry.model,
      createAgent: resolveAgent,
      config: opts.config,
      worktreePath: opts.worktreePath,
      preSpinHook,
      spawnOptions: opts.additionalReadDirs ? { additionalReadDirs: opts.additionalReadDirs } : undefined,
      onQuotaFallbackEmit: (agentName, spawnResult, classified) => {
        emitPlanAgentQuotaFallback(opts.stderr, agentName, spawnResult, classified, "intent");
      },
      shouldAdvance: (result) => result.kind === "quota" || result.kind === "error" || result.kind === "model_config",
    }),
  );

  const execution = await executeWithQuotaFallback({
    prompt,
    cwd: opts.worktreePath,
    bindings,
  });

  let agentLabel: string | null = null;
  if (execution.final?.binding) {
    agentLabel = execution.final.binding.id;
  }

  const finalResult = execution.final?.result;
  if (finalResult?.kind === "ok") {
    return { result: finalResult, agentLabel };
  }

  if (finalResult === undefined) {
    return {
      result: {
        kind: "model_config",
        stderr: "intent: modes.plan.agentOrder is empty",
      },
      agentLabel: null,
    };
  }

  return {
    result: finalResult.kind === "stall" ? { kind: "error", exitCode: -1, stderr: finalResult.stderr } : finalResult,
    agentLabel,
  };
}

export function listStageMarkdownFiles(stagingDir: string): string[] {
  return listIntentStageMarkdownFiles(stagingDir);
}
