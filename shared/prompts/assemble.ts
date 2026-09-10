import { loadPromptRegistry } from "./registry.ts";
import { renderArtifactTemplate } from "./render.ts";
import type { PromptArtifact, PromptRegistry } from "./types.ts";

export function assemblePrompt(args: {
  registry: PromptRegistry;
  globalFragmentIds: string[];
  behaviorFragmentIds: string[];
  stepPromptId: string;
  addFragmentIds?: string[];
  removeFragmentIds?: string[];
}): string {
  const remove = new Set(args.removeFragmentIds ?? []);
  const added = args.addFragmentIds ?? [];
  const orderedIds = [...args.globalFragmentIds, ...args.behaviorFragmentIds, ...added].filter((id) => !remove.has(id));
  const fragmentBodies = orderedIds.map((id) => args.registry.getById(id).body.trim());
  const stepBody = args.registry.getById(args.stepPromptId).body.trim();
  return [...fragmentBodies, stepBody].filter((part) => part.length > 0).join("\n\n");
}

function rankedFragmentIds(registry: PromptRegistry, behavior: string): string[] {
  // Fragment ordering is declared per-artifact via the `order` frontmatter field;
  // unranked fragments sort last by id. See v2/docs/prompts.md.
  const sortByContractOrder = (a: string, b: string): number => {
    const ao = registry.getById(a).metadata.order;
    const bo = registry.getById(b).metadata.order;
    if (ao !== null && bo !== null) return ao - bo || a.localeCompare(b);
    if (ao !== null) return -1;
    if (bo !== null) return 1;
    return a.localeCompare(b);
  };
  return registry
    .all()
    .filter((artifact) => artifact.metadata.kind === "fragment" && artifact.metadata.behavior === behavior)
    .map((artifact) => artifact.metadata.id)
    .sort(sortByContractOrder);
}

/**
 * The one step-template assembler. Fragment inclusion follows the step's declared `fragmentPolicy`
 * (`global`, `behavior`, or `none`), then its explicit `add`/`remove`; no call site hand-rolls a
 * global-only or bare-body variant.
 */
export function assembleStepTemplate(registry: PromptRegistry, stepPromptId: string): string {
  const step = registry.getById(stepPromptId);
  const policy = step.metadata.fragmentPolicy;
  if (step.metadata.kind !== "step" || policy === null) {
    throw new Error(`prompt \`${stepPromptId}\` is not a step artifact with a fragment policy`);
  }
  const globalFragmentIds = policy === "none" ? [] : rankedFragmentIds(registry, "global");
  const behaviorFragmentIds = policy === "behavior" ? rankedFragmentIds(registry, step.metadata.behavior) : [];
  return assemblePrompt({
    registry,
    globalFragmentIds,
    behaviorFragmentIds,
    stepPromptId,
    addFragmentIds: step.metadata.add,
    removeFragmentIds: step.metadata.remove,
  });
}

/** The assembled step artifact: the registered metadata with the policy-assembled body. */
export function assembledStepArtifact(registry: PromptRegistry, stepPromptId: string): PromptArtifact {
  const artifact = registry.getById(stepPromptId);
  return { ...artifact, body: assembleStepTemplate(registry, stepPromptId) };
}

/**
 * The one step-prompt renderer for every engine: assemble per policy, then apply variants, optional
 * sections, and placeholder substitution. Trims surrounding whitespace.
 */
export function renderPromptForStep(args: {
  stepPromptId: string;
  placeholders: Record<string, unknown>;
  registry?: PromptRegistry;
  variant?: string | undefined;
}): string {
  const registry = args.registry ?? loadPromptRegistry();
  return renderArtifactTemplate(
    assembledStepArtifact(registry, args.stepPromptId),
    args.placeholders,
    args.variant === undefined ? undefined : { variant: args.variant },
  ).trim();
}
