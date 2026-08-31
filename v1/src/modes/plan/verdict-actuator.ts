import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { executeWithQuotaFallback } from "../../../../shared/invocation/execute.ts";
import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { enforceDelimiterPolicy } from "../../../../shared/prompts/render.ts";
import { createAgent } from "../../agents/factory.ts";
import type { Agent, AgentName } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { DEFAULT_IDLE_OUTPUT_TIMEOUT_MS } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { evaluateIdleWatchdog, sampleFileActivityIfNeeded } from "../patch/idle-watchdog.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { createPlanInvocationBinding } from "./plan-invocation-binding.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";
import { resolvePlanSpecDirPath } from "./spec-dir.ts";
import { renderTemplate, TemplateRenderingError } from "./template-renderer.ts";

function snapshotActuatorSpecFiles(specDir: string): string {
  if (!existsSync(specDir)) {
    return "(spec directory does not exist)";
  }

  const files = readdirSync(specDir)
    .filter((file) => file.endsWith(".md") && file !== "intent.md" && file !== "verdict-plan.md")
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    return "(no spec files found)";
  }

  return files
    .map((file) => `<<<FILE name="${file}" BEGIN>>>\n${readFileSync(join(specDir, file), "utf8")}\n<<<FILE END>>>`)
    .join("\n\n");
}

export function buildVerdictActuatorPrompt(opts: {
  name: string;
  intent: string;
  currentSpec: string;
  specGuidance: string;
  verdict: string;
  /** External no-commit layout: files live in the working directory, not `spec/<name>/`. */
  flatSpecLayout?: boolean;
  workDirLabel?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
}): string {
  const registry = loadPromptRegistry();
  let template = assemblePromptForStep({
    registry,
    stepPromptId: "plan.prompt.review-actuator",
  });

  const workDir = opts.workDirLabel ?? opts.name;
  const targetDir = opts.targetDir ?? "spec";
  if (opts.flatSpecLayout) {
    template = template.replace(
      "- **Only write files under `spec/<NAME>/`.**",
      "- **Only write files in the working directory.** Do not create `spec/` subdirectories or other parent paths.",
    );
    template = template.replaceAll("spec/<NAME>/intent.md", "intent.md");
  } else {
    template = template.replaceAll("spec/<NAME>/", `${targetDir}/<NAME>/`);
  }

  enforceDelimiterPolicy({
    value: opts.intent,
    begin: "<<<INTENT_BEGIN>>>",
    end: "<<<INTENT_END>>>",
    placeholderName: "INTENT",
  });
  enforceDelimiterPolicy({
    value: opts.currentSpec,
    begin: "<<<CURRENT_SPEC_BEGIN>>>",
    end: "<<<CURRENT_SPEC_END>>>",
    placeholderName: "CURRENT_SPEC",
  });
  enforceDelimiterPolicy({
    value: opts.specGuidance,
    begin: "<<<SPEC_GUIDANCE_BEGIN>>>",
    end: "<<<SPEC_GUIDANCE_END>>>",
    placeholderName: "SPEC_GUIDANCE",
  });
  enforceDelimiterPolicy({
    value: opts.verdict,
    begin: "<<<VERDICT_BEGIN>>>",
    end: "<<<VERDICT_END>>>",
    placeholderName: "VERDICT",
  });

  try {
    template = renderTemplate(
      template,
      new Set(["WORKDIR", "NAME", "INTENT", "CURRENT_SPEC", "SPEC_GUIDANCE", "VERDICT"]),
      {
        WORKDIR: workDir,
        NAME: opts.name,
        INTENT: opts.intent,
        CURRENT_SPEC: opts.currentSpec,
        SPEC_GUIDANCE: opts.specGuidance,
        VERDICT: opts.verdict,
      },
    );
  } catch (err) {
    if (err instanceof TemplateRenderingError) {
      throw new Error(`review actuator prompt configuration error: ${err.details}`);
    }
    throw err;
  }

  return template.endsWith("\n") ? template : `${template}\n`;
}

export type VerdictActuatorOptions = {
  worktreePath: string;
  name: string;
  config: Config;
  verdict: string;
  stderr?: ((s: string) => void) | undefined;
  planTelemetry?: PlanTelemetryWriter | undefined;
  externalSpecRoot?: string | undefined;
  specDirPath?: string | undefined;
  targetDir?: string | undefined;
  onOutboundPrompt?: ((prompt: string) => void) | undefined;
  createAgent?: ((agentName: AgentName, model: string | undefined) => Agent) | undefined;
  /** Additional read directories passed to agent (for external spec storage). */
  additionalReadDirs?: string[];
  /** Plan worktree directory for idle watchdog file-activity scanning. */
  planWorktreeDir?: string;
  /** Idle output timeout in milliseconds (0 to disable). */
  idleOutputTimeoutMs?: number | undefined;
};

export async function runVerdictActuator(opts: VerdictActuatorOptions): Promise<void> {
  const flatSpecLayout = opts.specDirPath !== undefined;
  const specDir = resolvePlanSpecDirPath(opts.worktreePath, opts.name, opts.specDirPath, opts.targetDir);
  const intentPath = join(specDir, "intent.md");
  const intentBefore = readFileSync(intentPath, "utf8");
  const currentSpec = snapshotActuatorSpecFiles(specDir);

  const docsPath = join(import.meta.dir, "..", "..", "..", "docs", "spec-guidance.md");
  const specGuidance = readFileSync(docsPath, "utf8");

  let prompt: string;
  try {
    prompt = buildVerdictActuatorPrompt({
      name: opts.name,
      intent: intentBefore,
      currentSpec,
      specGuidance,
      verdict: opts.verdict,
      ...(flatSpecLayout ? { flatSpecLayout: true, workDirLabel: specDir } : {}),
      ...(opts.targetDir !== undefined ? { targetDir: opts.targetDir } : {}),
    });
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`verdict actuator prompt error: ${err.message}`);
    }
    throw err;
  }

  opts.onOutboundPrompt?.(prompt);

  const agentOrder = opts.config.modes.plan.agentOrder;
  if (agentOrder.length === 0) {
    throw new Error(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
  }

  const verdictController = new AbortController();
  const verdictLastOutputAtMs = { current: null as number | null };
  let verdictLastFileActivityAtMs: number | null = null;
  let verdictIdleTimeoutHandle: NodeJS.Timeout | null = null;

  // Arm idle watchdog if configured
  const verdictArmedAt = Date.now();
  const verdictIdleOutputTimeoutMs =
    opts.idleOutputTimeoutMs !== undefined
      ? opts.idleOutputTimeoutMs
      : (opts.config.idleOutputTimeoutMs ?? DEFAULT_IDLE_OUTPUT_TIMEOUT_MS);
  const verdictWorktreeDir = opts.planWorktreeDir ?? opts.worktreePath;
  if (verdictIdleOutputTimeoutMs > 0) {
    const scheduleVerdictIdleCheck = () => {
      verdictIdleTimeoutHandle = setTimeout(() => {
        const snapshotAt = Date.now();
        const lastOutputAgeMs =
          verdictLastOutputAtMs.current === null ? null : snapshotAt - verdictLastOutputAtMs.current;

        const sampledFileActivityAt = sampleFileActivityIfNeeded({
          lastOutputAgeMs,
          idleOutputTimeoutMs: verdictIdleOutputTimeoutMs,
          now: snapshotAt,
          armedAt: verdictArmedAt,
          workingDir: verdictWorktreeDir,
        });

        if (sampledFileActivityAt !== null) {
          verdictLastFileActivityAtMs = sampledFileActivityAt;
        }

        const { shouldFire } = evaluateIdleWatchdog({
          now: snapshotAt,
          lastOutputAt: verdictLastOutputAtMs.current,
          lastFileActivityAt: verdictLastFileActivityAtMs,
          armedAt: verdictArmedAt,
          idleOutputTimeoutMs: verdictIdleOutputTimeoutMs,
        });

        if (shouldFire) {
          opts.stderr?.(`[watchdog] idle timeout fired after ${verdictIdleOutputTimeoutMs}ms; killing agent\n`);
          verdictController.abort("idle-timeout");
        } else {
          scheduleVerdictIdleCheck();
        }
      }, 100);
      verdictIdleTimeoutHandle?.unref?.();
    };
    scheduleVerdictIdleCheck();
  }

  const bindings = agentOrder.map((entry) =>
    createPlanInvocationBinding({
      agentName: entry.agent,
      configuredModel: entry.model,
      createAgent: opts.createAgent ?? createAgent,
      config: opts.config,
      worktreePath: opts.worktreePath,
      spawnOptions: opts.additionalReadDirs !== undefined ? { additionalReadDirs: opts.additionalReadDirs } : undefined,
      lastOutputAtMs: verdictLastOutputAtMs,
      onQuotaFallbackEmit: (agentName, spawnResult, classified) => {
        emitPlanAgentQuotaFallback(opts.stderr, agentName, spawnResult, classified);
      },
      recordAgentAttempt: (data) => {
        opts.planTelemetry?.recordAgentAttempt({
          phase: "review",
          agentCli: data.agentCli,
          configuredModel: data.configuredModel,
          durationMs: data.durationMs,
          result: data.result,
        });
      },
    }),
  );

  try {
    const execution = await executeWithQuotaFallback({
      prompt,
      cwd: opts.worktreePath,
      bindings,
      signal: verdictController.signal,
    });

    const finalResult = execution.final?.result;
    if (finalResult?.kind === "ok") {
      opts.stderr?.(`plan: verdict actuator completed\n`);
      return;
    }

    if (finalResult?.kind === "quota") {
      throw new Error(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
    }

    if (finalResult === undefined) {
      throw new Error(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
    }

    throw new Error(`verdict actuator error (${finalResult.kind})`);
  } finally {
    if (verdictIdleTimeoutHandle !== null) {
      clearTimeout(verdictIdleTimeoutHandle);
    }
  }
}
