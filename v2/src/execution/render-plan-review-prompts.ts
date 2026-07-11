import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationOk,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";

export type PlanReviewPromptContext = {
  worktreePath: string;
  specPath: string;
  jarvisRoot?: string;
};

function getSpecDirName(specPath: string): string {
  const parts = specPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || specPath;
}

function getTargetDir(specPath: string): string {
  const normalized = specPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.slice(0, -1).join("/");
}

function getSpecGuidancePath(jarvisRoot?: string): string {
  if (jarvisRoot) {
    return join(jarvisRoot, "..", "..", "v1", "docs", "spec-guidance.md");
  }
  return join(import.meta.dir, "..", "..", "..", "v1", "docs", "spec-guidance.md");
}

function readIntentMd(specPath: string): string {
  const intentPath = join(specPath, "intent.md");
  if (!existsSync(intentPath)) {
    return "";
  }
  return readFileSync(intentPath, "utf8");
}

function readSpecFiles(specPath: string): string {
  if (!existsSync(specPath)) {
    return "";
  }

  const files = readdirSync(specPath);
  const specFiles = files.filter((f) => f.endsWith(".md"));
  const sections: string[] = [];

  for (const file of specFiles) {
    const filePath = join(specPath, file);
    const content = readFileSync(filePath, "utf8");
    sections.push(`<<<FILE name="${file}" BEGIN>>>\n${content}\n<<<FILE END>>>`);
  }

  return sections.join("\n\n");
}

export function renderCriticPrompt(context: PlanReviewPromptContext, reviewPassContext?: string): string {
  const specDirName = getSpecDirName(context.specPath);
  const intent = readIntentMd(context.specPath);
  const specContent = readSpecFiles(context.specPath);
  const specGuidancePath = getSpecGuidancePath(context.jarvisRoot);
  const specGuidance = readFileSync(specGuidancePath, "utf8");

  const placeholders = {
    WORKDIR: context.worktreePath,
    NAME: specDirName,
    INTENT: intent,
    CURRENT_SPEC: specContent,
    SPEC_GUIDANCE: specGuidance,
    REVIEW_PASS_CONTEXT: reviewPassContext ?? "",
  };

  const registry = loadPromptRegistry();
  const artifact = registry.getById("plan.prompt.review.critic");
  return renderArtifactTemplate(artifact, placeholders).trim();
}

export function renderActuatorPrompt(
  context: PlanReviewPromptContext,
  verdict: string,
  reviewPassContext?: string,
): string {
  const specDirName = getSpecDirName(context.specPath);
  const intent = readIntentMd(context.specPath);
  const specContent = readSpecFiles(context.specPath);
  const specGuidancePath = getSpecGuidancePath(context.jarvisRoot);
  const specGuidance = readFileSync(specGuidancePath, "utf8");

  const placeholders = {
    WORKDIR: context.worktreePath,
    NAME: specDirName,
    INTENT: intent,
    CURRENT_SPEC: specContent,
    SPEC_GUIDANCE: specGuidance,
    VERDICT: verdict,
  };

  const registry = loadPromptRegistry();
  const artifact = registry.getById("plan.prompt.review-actuator");
  return renderArtifactTemplate(artifact, placeholders).trim();
}

export type PlanReviewCycleOutcome =
  | { kind: "completed"; verdict: string; actuatorRan: boolean }
  | { kind: "role_failed"; failedRole: "critic" | "actuator"; failureKind: InvocationFailureKind; verdict: string | null };

type PlanReviewCycleResult = { cycles: PlanReviewCycleOutcome[] };

type PlanReviewCycleInput = {
  context: PlanReviewPromptContext;
  cwd: string;
  bindings: { critic: readonly InvocationBinding[]; actuator: readonly InvocationBinding[] };
  verdictPath: string;
  maxCycles: number;
  signal?: AbortSignal | undefined;
  telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds">;
  onRoleStart?: (role: "critic" | "actuator") => void;
};

function failureKind(execution: InvocationExecution): InvocationFailureKind | null {
  if (execution.final === null) return "no_binding";
  return execution.final.result.kind === "ok" ? null : execution.final.result.kind;
}

async function invokePlanReviewRole(
  args: PlanReviewCycleInput,
  role: "critic" | "actuator",
  prompt: string,
  bindings: readonly InvocationBinding[],
): Promise<InvocationExecution> {
  args.onRoleStart?.(role);
  return executeWithQuotaFallback({
    prompt,
    cwd: args.cwd,
    bindings,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.telemetry !== undefined
      ? {
          telemetry: {
            ...args.telemetry,
            role,
            invocationIds: bindings.map(() => crypto.randomUUID()),
          },
        }
      : {}),
  });
}

export async function executePlanReviewCycle(args: PlanReviewCycleInput): Promise<PlanReviewCycleResult> {
  const cycles: PlanReviewCycleOutcome[] = [];

  for (let cycle = 0; cycle < args.maxCycles; cycle += 1) {
    try {
      writeFileSync(args.verdictPath, "", "utf8");
    } catch {
      // Failure to write verdict file - stop
      break;
    }

    // Render critic prompt from template
    const criticPrompt = renderCriticPrompt(args.context);
    const critic = await invokePlanReviewRole(args, "critic", criticPrompt, args.bindings.critic);

    const criticFailure = failureKind(critic);
    if (criticFailure !== null) {
      cycles.push({ kind: "role_failed", failedRole: "critic", failureKind: criticFailure, verdict: null });
      break;
    }

    const verdict = (critic.final?.result as InvocationOk).stdout;
    try {
      writeFileSync(args.verdictPath, verdict, "utf8");
    } catch {
      // Failure to write verdict - stop
      break;
    }

    if (verdict.trim().length === 0) {
      cycles.push({ kind: "completed", verdict, actuatorRan: false });
      break;
    }

    // Render actuator prompt from template with verdict
    const actuatorPrompt = renderActuatorPrompt(args.context, verdict);
    const actuator = await invokePlanReviewRole(args, "actuator", actuatorPrompt, args.bindings.actuator);

    const actuatorFailure = failureKind(actuator);
    if (actuatorFailure !== null) {
      cycles.push({ kind: "role_failed", failedRole: "actuator", failureKind: actuatorFailure, verdict });
      break;
    }

    cycles.push({ kind: "completed", verdict, actuatorRan: true });
  }

  return { cycles };
}
