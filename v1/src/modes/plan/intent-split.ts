import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { executeWithQuotaFallback } from "../../../../shared/invocation/execute.ts";
import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import {
  enforceDelimiterPolicy,
  PromptRenderingError,
  renderTemplateWithDeclarations,
} from "../../../../shared/prompts/render.ts";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { HARNESS_QUOTA_FALLBACK_STRICT, harnessQuotaFallbackLenientLine } from "../../quota-harness-messages.ts";
import { createPlanInvocationBinding } from "./plan-invocation-binding.ts";

export function buildIntentSplitPrompt(opts: {
  workdir: string;
  seedLabel: string;
  seedContent: string;
  stagingDir: string;
}): string {
  const registry = loadPromptRegistry();
  const artifact = registry.getById("intent.prompt.split");
  let template = assemblePromptForStep({
    registry,
    stepPromptId: artifact.metadata.id,
  });

  enforceDelimiterPolicy({
    value: opts.seedContent,
    begin: "<<<SEED_BEGIN>>>",
    end: "<<<SEED_END>>>",
    placeholderName: "SEED_CONTENT",
  });

  try {
    template = renderTemplateWithDeclarations(template, artifact.metadata.placeholders, {
      WORKDIR: opts.workdir,
      SEED_LABEL: opts.seedLabel,
      SEED_CONTENT: opts.seedContent,
    });
  } catch (err) {
    if (err instanceof PromptRenderingError) {
      throw new Error(`intent-split prompt configuration error: ${err.details}`);
    }
    throw err;
  }

  return `${template}

## File output

- Write the authored intents as markdown files under \`${opts.stagingDir}\`.
- Write one file per intent.
- Filename must be \`<name>.md\`, where \`name:\` is the frontmatter slug in that file.
- Include a \`## Prerequisites\` section in every emitted intent.
- If there are prerequisites, write one prerequisite behavior per physical line as \`- ...\`; do not use prose, numbered lists, nested bullets, or wrapped continuation lines.
- Leave the \`## Prerequisites\` body empty when there are no prerequisites.
- Do not create subdirectories.
- Do not edit any files outside \`${opts.stagingDir}\`.
- Do not write spec \`index.md\` files or numbered subspec files.
`;
}

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
        if (opts.stderr === undefined || classified.kind !== "quota") return;
        if (spawnResult.kind === "quota") {
          opts.stderr(`intent: ${agentName}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`);
          return;
        }
        if (spawnResult.kind === "error") {
          opts.stderr(`intent: ${agentName}: ${harnessQuotaFallbackLenientLine(spawnResult.exitCode)}\n`);
        }
      },
      shouldAdvance: (result) => result.kind === "quota" || result.kind === "error",
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

  return { result: finalResult, agentLabel };
}

export function listStageMarkdownFiles(stagingDir: string): string[] {
  return readdirSync(stagingDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(stagingDir, entry.name))
    .sort();
}
