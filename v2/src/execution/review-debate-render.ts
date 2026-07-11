import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationOk,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import { assemblePromptForStep } from "../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderTemplateWithDeclarations } from "../../../shared/prompts/render.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";
import type { ReviewDebateRole, ReviewDebateRoleBindings } from "./review-debate.ts";

/** Registry prompt id for the light patch review critic role. */
export const PATCH_REVIEW_CRITIC_PROMPT_ID = "patch.prompt.review.critic" as const;

/** Registry prompt ids for the three read-only patch review debate roles. */
export const PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS = {
  adversary: "patch.prompt.review.adversary",
  advocate: "patch.prompt.review.advocate",
  adjudicator: "patch.prompt.review.adjudicator",
} as const;

export type ReviewDebateRenderRole = keyof typeof PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS;

export type ReviewDebateRenderContext = {
  specPath: string;
  cwd: string;
  passNumber: number;
  totalPasses: number;
  baseBranch?: string;
  priorCycleVerdict?: string;
};

function stripOptionalPromptSection(
  text: string,
  sectionHeader: string,
  beginMarker: string,
  endMarker: string,
): string {
  const headerIndex = text.indexOf(sectionHeader);
  if (headerIndex === -1) {
    return text;
  }
  const beginIndex = text.indexOf(beginMarker, headerIndex);
  const endIndex = text.indexOf(endMarker, beginIndex);
  if (beginIndex === -1 || endIndex === -1) {
    return text;
  }
  let removeEnd = endIndex + endMarker.length;
  while (text[removeEnd] === "\n") {
    removeEnd += 1;
  }
  return `${text.slice(0, headerIndex)}${text.slice(removeEnd)}`;
}

function buildPatchBodyPrompt(specPath: string): string {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId: "patch.prompt.body",
  });

  let rendered = renderTemplateWithDeclarations(
    template,
    [
      { name: "SPEC_PATH", type: "string", required: true },
      { name: "SIBLINGS_BLOCK", type: "string", required: true },
      { name: "REPO_GUIDANCE", type: "string", required: true },
      { name: "ACTIVE_SUBSPEC_PATH", type: "string", required: true },
      { name: "ACTIVE_SUBSPEC_BODY", type: "string", required: true },
      { name: "PATCH_RULES", type: "string", required: true },
      { name: "TIMEOUT_CHECKPOINT_CONTEXT", type: "string", required: true },
    ],
    {
      SPEC_PATH: specPath,
      SIBLINGS_BLOCK: "",
      REPO_GUIDANCE: "",
      ACTIVE_SUBSPEC_PATH: "",
      ACTIVE_SUBSPEC_BODY: "",
      PATCH_RULES: registry.getById("patch.rules").body.trim(),
      TIMEOUT_CHECKPOINT_CONTEXT: "",
    },
  );

  for (const section of [
    { header: "## Repo Guidance", begin: "<<<REPO_GUIDANCE_BEGIN>>>", end: "<<<REPO_GUIDANCE_END>>>" },
    { header: "## Active Subspec", begin: "<<<ACTIVE_SUBSPEC_BEGIN>>>", end: "<<<ACTIVE_SUBSPEC_END>>>" },
    { header: "## Timeout Checkpoint", begin: "<<<TIMEOUT_CHECKPOINT_BEGIN>>>", end: "<<<TIMEOUT_CHECKPOINT_END>>>" },
  ]) {
    rendered = stripOptionalPromptSection(rendered, section.header, section.begin, section.end);
  }

  return rendered.replace("\n\nFollow these Jarvis rules:", "\nFollow these Jarvis rules:").trim();
}

function reviewPassContext(passNumber: number, totalPasses: number, priorCycleVerdict?: string): string {
  const base =
    totalPasses === 1 ? "This is the only review pass." : `This is review pass ${passNumber} of ${totalPasses}.`;
  if (priorCycleVerdict !== undefined && priorCycleVerdict.trim().length > 0) {
    return `${base}\n\nPrior cycle verdict:\n${priorCycleVerdict.trim()}`;
  }
  return base;
}

function buildSpecTree(specDir: string, cwd: string): string {
  const lines: string[] = [];
  visitSpecFiles(specDir, cwd, lines);
  return lines.join("");
}

function visitSpecFiles(dir: string, cwd: string, lines: string[]): void {
  let entries: Array<{ name: string; isDir: boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
      .map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDir) {
      visitSpecFiles(fullPath, cwd, lines);
    } else if (entry.name.endsWith(".md")) {
      try {
        const content = readFileSync(fullPath, "utf8");
        const relPath = relative(cwd, fullPath);
        lines.push(`<<<FILE name="${relPath}" BEGIN>>>\n`);
        lines.push(content);
        if (!content.endsWith("\n")) {
          lines.push("\n");
        }
        lines.push(`<<<FILE END>>>\n`);
      } catch {
        // skip unreadable files
      }
    }
  }
}

function getBranchDiffSummary(cwd: string, baseBranch: string): string {
  try {
    const mergeBase = execFileSync("git", ["merge-base", baseBranch, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    const stat = execFileSync("git", ["diff", "--stat", mergeBase, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    const paths = execFileSync("git", ["diff", "--name-only", mergeBase, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    })
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    if (paths.length === 0) {
      return stat || "(no changes)";
    }

    return `${stat || "(no changes)"}\n\nChanged paths:\n${paths.join("\n")}`;
  } catch (err) {
    return `(failed to generate diff: ${err instanceof Error ? err.message : String(err)})`;
  }
}

type PatchReviewPlaceholderContract = {
  declarations: Array<{ name: string; type: "string"; required: boolean }>;
  values: Record<string, string>;
};

function buildPatchReviewPlaceholderContract(context: ReviewDebateRenderContext): PatchReviewPlaceholderContract {
  const specPathAbs = context.specPath.startsWith("/") ? context.specPath : join(context.cwd, context.specPath);
  const specTree = buildSpecTree(dirname(specPathAbs), context.cwd);
  const branchDiff = getBranchDiffSummary(context.cwd, context.baseBranch ?? "main");
  return {
    declarations: [
      { name: "SPEC_PATH", type: "string", required: true },
      { name: "SPEC_TREE", type: "string", required: true },
      { name: "BRANCH_DIFF", type: "string", required: true },
      { name: "REVIEW_PASS_NUMBER", type: "string", required: true },
      { name: "REVIEW_PASS_CONTEXT", type: "string", required: true },
    ],
    values: {
      SPEC_PATH: context.specPath,
      SPEC_TREE: specTree,
      BRANCH_DIFF: branchDiff,
      REVIEW_PASS_NUMBER: String(context.passNumber),
      REVIEW_PASS_CONTEXT: reviewPassContext(context.passNumber, context.totalPasses, context.priorCycleVerdict),
    },
  };
}

function renderPatchReviewStepPrompt(
  stepPromptId: string,
  context: ReviewDebateRenderContext,
  extra?: PatchReviewPlaceholderContract,
): string {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId,
  });
  const base = buildPatchReviewPlaceholderContract(context);
  const declarations = [...base.declarations, ...(extra?.declarations ?? [])];
  const values = { ...base.values, ...(extra?.values ?? {}) };
  return renderTemplateWithDeclarations(template, declarations, values).trim();
}

/** Render the light patch review critic prompt from shared patch-review context. */
export function renderPatchReviewCriticPrompt(context: ReviewDebateRenderContext): string {
  return renderPatchReviewStepPrompt(PATCH_REVIEW_CRITIC_PROMPT_ID, context);
}

export function renderReviewDebateRolePrompt(
  role: ReviewDebateRenderRole,
  context: ReviewDebateRenderContext,
  priorRoleOutput?: string,
): string {
  let extra: PatchReviewPlaceholderContract | undefined;
  if (role === "advocate") {
    extra = {
      declarations: [{ name: "ADVERSARY_FINDINGS", type: "string", required: true }],
      values: { ADVERSARY_FINDINGS: priorRoleOutput ?? "(no prior findings)" },
    };
  } else if (role === "adjudicator") {
    extra = {
      declarations: [{ name: "ADVOCATE_RESPONSE", type: "string", required: true }],
      values: { ADVOCATE_RESPONSE: priorRoleOutput ?? "(no advocate response)" },
    };
  }

  return renderPatchReviewStepPrompt(PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS[role], context, extra);
}

export function renderReviewDebateActuatorPrompt(verdict: string, specPath: string): string {
  const basePrompt = buildPatchBodyPrompt(specPath);
  return `${basePrompt}\n\n## Review Actuator Rules\n\n- Apply the review verdict to implementation files only.\n- The completed spec tree is read-only: do not edit spec files, tick criteria, append blockers, or edit verdict-patch.md.\n- Do not expand scope beyond the verdict.\n\n## Review Verdict\n\nBased on a review of your implementation, the following changes are required:\n\n${verdict}`;
}

export type ReviewDebateCyclePrompts = {
  adversary: string;
  advocate: string;
  adjudicator: string;
};

/** Render all three read-only role prompts for one cycle from optional prior-role stdout. */
export function renderReviewDebateCyclePrompts(
  context: ReviewDebateRenderContext,
  priorRoleOutputs: Partial<Record<ReviewDebateRenderRole, string>> = {},
): ReviewDebateCyclePrompts {
  const adversary = renderReviewDebateRolePrompt("adversary", context);
  const advocate = renderReviewDebateRolePrompt("advocate", context, priorRoleOutputs.adversary);
  const adjudicator = renderReviewDebateRolePrompt("adjudicator", context, priorRoleOutputs.advocate);
  return { adversary, advocate, adjudicator };
}

/** Carry an adjudicator verdict into the next cycle's render context. */
export function nextReviewDebateCycleContext(
  context: ReviewDebateRenderContext,
  priorCycleVerdict: string,
): ReviewDebateRenderContext {
  return {
    ...context,
    passNumber: context.passNumber + 1,
    priorCycleVerdict,
  };
}

type PatchReviewDebateCycleOutcome = {
  roleResults: Partial<Record<ReviewDebateRole, InvocationExecution>>;
} & (
  | { kind: "completed"; verdict: string; actuatorRan: boolean }
  | { kind: "role_failed"; failedRole: ReviewDebateRole; failureKind: InvocationFailureKind; verdict: string | null }
);

type PatchReviewDebateResult = {
  cycles: PatchReviewDebateCycleOutcome[];
};

export type PatchReviewDebateInput = {
  cwd: string;
  context: Pick<ReviewDebateRenderContext, "specPath" | "cwd" | "baseBranch">;
  bindings: ReviewDebateRoleBindings;
  verdictPath: string;
  maxCycles: number;
  signal?: AbortSignal;
  telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds">;
  onRoleStart?: (role: ReviewDebateRole) => void;
};

function patchReviewFailureKind(execution: InvocationExecution): InvocationFailureKind | null {
  if (execution.final === null) return "no_binding";
  return execution.final.result.kind === "ok" ? null : execution.final.result.kind;
}

async function invokePatchReviewRole(
  args: PatchReviewDebateInput,
  role: ReviewDebateRole,
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

/** Run patch review-debate cycles with per-cycle template rendering and role chaining. */
export async function executePatchReviewDebate(args: PatchReviewDebateInput): Promise<PatchReviewDebateResult> {
  const cycles: PatchReviewDebateCycleOutcome[] = [];
  let renderContext: ReviewDebateRenderContext = {
    ...args.context,
    passNumber: 1,
    totalPasses: args.maxCycles,
  };

  for (let cycle = 0; cycle < args.maxCycles; cycle += 1) {
    const roleResults: Partial<Record<ReviewDebateRole, InvocationExecution>> = {};

    const adversaryPrompt = renderReviewDebateRolePrompt("adversary", renderContext);
    const adversary = await invokePatchReviewRole(args, "adversary", adversaryPrompt, args.bindings.adversary);
    roleResults.adversary = adversary;
    const adversaryFailure = patchReviewFailureKind(adversary);
    if (adversaryFailure !== null) {
      cycles.push({
        kind: "role_failed",
        failedRole: "adversary",
        failureKind: adversaryFailure,
        verdict: null,
        roleResults,
      });
      break;
    }

    const adversaryStdout = (adversary.final?.result as InvocationOk).stdout;
    const advocatePrompt = renderReviewDebateRolePrompt("advocate", renderContext, adversaryStdout);
    const advocate = await invokePatchReviewRole(args, "advocate", advocatePrompt, args.bindings.advocate);
    roleResults.advocate = advocate;
    const advocateFailure = patchReviewFailureKind(advocate);
    if (advocateFailure !== null) {
      cycles.push({
        kind: "role_failed",
        failedRole: "advocate",
        failureKind: advocateFailure,
        verdict: null,
        roleResults,
      });
      break;
    }

    const advocateStdout = (advocate.final?.result as InvocationOk).stdout;
    const adjudicatorPrompt = renderReviewDebateRolePrompt("adjudicator", renderContext, advocateStdout);
    const adjudicator = await invokePatchReviewRole(args, "adjudicator", adjudicatorPrompt, args.bindings.adjudicator);
    roleResults.adjudicator = adjudicator;
    const adjudicatorFailure = patchReviewFailureKind(adjudicator);
    if (adjudicatorFailure !== null) {
      cycles.push({
        kind: "role_failed",
        failedRole: "adjudicator",
        failureKind: adjudicatorFailure,
        verdict: null,
        roleResults,
      });
      break;
    }

    const verdict = (adjudicator.final?.result as InvocationOk).stdout;
    writeFileSync(args.verdictPath, verdict, "utf8");

    if (verdict.trim().length === 0) {
      cycles.push({ kind: "completed", verdict, actuatorRan: false, roleResults });
      break;
    }

    const actuatorPrompt = renderReviewDebateActuatorPrompt(verdict, args.context.specPath);
    const actuator = await invokePatchReviewRole(args, "actuator", actuatorPrompt, args.bindings.actuator);
    roleResults.actuator = actuator;
    const actuatorFailure = patchReviewFailureKind(actuator);
    if (actuatorFailure !== null) {
      cycles.push({
        kind: "role_failed",
        failedRole: "actuator",
        failureKind: actuatorFailure,
        verdict,
        roleResults,
      });
      break;
    }

    cycles.push({ kind: "completed", verdict, actuatorRan: true, roleResults });

    if (cycle + 1 < args.maxCycles) {
      renderContext = nextReviewDebateCycleContext(renderContext, verdict);
    }
  }

  return { cycles };
}
