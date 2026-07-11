import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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
import {
  discardSnapshot,
  getChangedPaths,
  restoreWorkingTree,
  snapshotWorkingTree,
} from "./review-intent-enforcement.ts";

export type PlanReviewPromptContext = {
  worktreePath: string;
  specPath: string;
  jarvisRoot?: string;
};

function getSpecDirName(specPath: string): string {
  return basename(specPath.replace(/\\/g, "/"));
}

function getSpecGuidancePath(jarvisRoot?: string): string {
  if (jarvisRoot) {
    return join(jarvisRoot, "..", "..", "v1", "docs", "spec-guidance.md");
  }
  return join(import.meta.dir, "..", "..", "..", "v1", "docs", "spec-guidance.md");
}

function readIntentMd(specPath: string): string {
  const intentPath = join(specPath, "intent.md");
  return existsSync(intentPath) ? readFileSync(intentPath, "utf8") : "";
}

function readSpecFiles(specPath: string): string {
  if (!existsSync(specPath)) {
    return "";
  }

  const entries = readdirSync(specPath, { withFileTypes: true });
  const mdFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((a, b) => {
      if (a.name === "index.md") return -1;
      if (b.name === "index.md") return 1;
      return a.name.localeCompare(b.name);
    });

  const sections: string[] = [];
  for (const file of mdFiles) {
    const content = readFileSync(join(specPath, file.name), "utf8");
    sections.push(`<<<FILE name="${file.name}" BEGIN>>>\n${content}\n<<<FILE END>>>`);
  }
  return sections.join("\n\n");
}

export function renderCriticPrompt(context: PlanReviewPromptContext, reviewPassContext = ""): string {
  const placeholders = {
    WORKDIR: context.worktreePath,
    NAME: getSpecDirName(context.specPath),
    INTENT: readIntentMd(context.specPath),
    CURRENT_SPEC: readSpecFiles(context.specPath),
    SPEC_GUIDANCE: readFileSync(getSpecGuidancePath(context.jarvisRoot), "utf8"),
    REVIEW_PASS_CONTEXT: reviewPassContext,
  };
  const artifact = loadPromptRegistry().getById("plan.prompt.review.critic");
  return renderArtifactTemplate(artifact, placeholders).trim();
}

export function renderActuatorPrompt(context: PlanReviewPromptContext, verdict: string): string {
  const placeholders = {
    WORKDIR: context.worktreePath,
    NAME: getSpecDirName(context.specPath),
    INTENT: readIntentMd(context.specPath),
    CURRENT_SPEC: readSpecFiles(context.specPath),
    SPEC_GUIDANCE: readFileSync(getSpecGuidancePath(context.jarvisRoot), "utf8"),
    VERDICT: verdict,
  };
  const artifact = loadPromptRegistry().getById("plan.prompt.review-actuator");
  return renderArtifactTemplate(artifact, placeholders).trim();
}

export type PlanReviewCycleOutcome =
  | { kind: "completed"; verdict: string; actuatorRan: boolean }
  | {
      kind: "role_failed";
      failedRole: "critic" | "actuator";
      failureKind: InvocationFailureKind;
      verdict: string | null;
    };

export type PlanReviewCycleInput = {
  context: PlanReviewPromptContext;
  cwd: string;
  bindings: { critic: readonly InvocationBinding[]; actuator: readonly InvocationBinding[] };
  verdictPath: string;
  maxCycles: number;
  signal?: AbortSignal;
  telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds">;
  onRoleStart?: (role: "critic" | "actuator") => void;
};

export type PlanReviewCycleResult = { cycles: PlanReviewCycleOutcome[] };

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

function criticWroteFiles(cwd: string, beforeCritic: ReturnType<typeof snapshotWorkingTree>): boolean {
  return getChangedPaths(cwd, beforeCritic).size > 0;
}

export async function executePlanReviewCycle(args: PlanReviewCycleInput): Promise<PlanReviewCycleResult> {
  if (!Number.isFinite(args.maxCycles) || !Number.isInteger(args.maxCycles) || args.maxCycles < 0) {
    throw new RangeError("maxCycles must be a finite non-negative integer");
  }

  const cycles: PlanReviewCycleOutcome[] = [];

  for (let cycle = 0; cycle < args.maxCycles; cycle += 1) {
    try {
      writeFileSync(args.verdictPath, "", "utf8");
    } catch {
      break;
    }

    const beforeCritic = snapshotWorkingTree(args.cwd);
    const criticPrompt = renderCriticPrompt(args.context);
    const critic = await invokePlanReviewRole(args, "critic", criticPrompt, args.bindings.critic);

    const criticFailure = failureKind(critic);
    if (criticFailure !== null) {
      discardSnapshot(beforeCritic);
      cycles.push({ kind: "role_failed", failedRole: "critic", failureKind: criticFailure, verdict: null });
      break;
    }

    if (criticWroteFiles(args.cwd, beforeCritic)) {
      restoreWorkingTree(args.cwd, beforeCritic);
      discardSnapshot(beforeCritic);
      cycles.push({ kind: "role_failed", failedRole: "critic", failureKind: "error", verdict: null });
      break;
    }
    discardSnapshot(beforeCritic);

    const verdict = (critic.final?.result as InvocationOk).stdout;
    try {
      writeFileSync(args.verdictPath, verdict, "utf8");
    } catch {
      break;
    }

    if (verdict.trim().length === 0) {
      cycles.push({ kind: "completed", verdict, actuatorRan: false });
      break;
    }

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
