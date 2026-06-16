import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import {
  enforceDelimiterPolicy,
  PromptRenderingError,
  renderTemplateWithDeclarations,
} from "../../../../shared/prompts/render.ts";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessQuotaFallbackLenientLine,
} from "../../quota-harness-messages.ts";

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
- Do not create subdirectories.
- Do not edit any files outside \`${opts.stagingDir}\`.
- Do not write spec \`index.md\` files or numbered subspec files.
`;
}

function emitIntentQuotaFallback(
  stderrFn: ((s: string) => void) | undefined,
  agent: AgentName,
  spawnResult: AgentResult,
  classified: AgentResult,
): void {
  if (stderrFn === undefined || classified.kind !== "quota") return;
  if (spawnResult.kind === "quota") {
    stderrFn(`intent: ${agent}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`);
    return;
  }
  if (spawnResult.kind === "error") {
    stderrFn(`intent: ${agent}: ${harnessQuotaFallbackLenientLine(spawnResult.exitCode)}\n`);
  }
}

function readGitPorcelainSnapshot(cwd: string): string | null {
  try {
    return execFileSync("git", ["status", "--porcelain"], {
      cwd,
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

function resetIntentStageDir(worktreePath: string, stagingDir: string): void {
  const stagePath = join(worktreePath, stagingDir);
  rmSync(stagePath, { recursive: true, force: true });
  mkdirSync(stagePath, { recursive: true });
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
  let result: AgentResult | null = null;
  let agentLabel: string | null = null;

  for (const entry of agentOrder) {
    resetIntentStageDir(opts.worktreePath, opts.stagingDir);
    const agent = resolveAgent(entry.agent, entry.model);
    agentLabel = agent.attributionLabel?.() ?? `${entry.agent} (${entry.model})`;

    const porcelainBefore = readGitPorcelainSnapshot(opts.worktreePath);
    const spawnResult = await agent.run(prompt, { cwd: opts.worktreePath });
    const porcelainAfter = readGitPorcelainSnapshot(opts.worktreePath);
    const noDiskChangeDuringInvocation =
      porcelainBefore !== null && porcelainAfter !== null && porcelainBefore === porcelainAfter;
    result = applyQuotaFallbackWhenAllowed(
      entry.agent,
      spawnResult,
      {
        quotaFallback: opts.config.quotaFallback,
        weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
      },
      noDiskChangeDuringInvocation,
    );
    emitIntentQuotaFallback(opts.stderr, entry.agent, spawnResult, result);

    if (result.kind === "ok") {
      return { result, agentLabel };
    }
    if (result.kind === "quota") {
      continue;
    }
    if (result.kind === "model_config") {
      return { result, agentLabel };
    }
  }

  if (result === null) {
    return {
      result: {
        kind: "error",
        exitCode: 2,
        stderr: `${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} (no agent invocations)`,
      },
      agentLabel,
    };
  }
  return { result, agentLabel };
}

export function listStageMarkdownFiles(stagingDir: string): string[] {
  return readdirSync(stagingDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(stagingDir, entry.name))
    .sort();
}
