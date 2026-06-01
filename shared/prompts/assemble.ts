import type { PromptRegistry } from "./types.ts";

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
  const orderedIds = [
    ...args.globalFragmentIds,
    ...args.behaviorFragmentIds,
    ...added,
  ].filter((id) => !remove.has(id));
  const fragmentBodies = orderedIds.map((id) =>
    args.registry.getById(id).body.trim(),
  );
  const stepBody = args.registry.getById(args.stepPromptId).body.trim();
  return [...fragmentBodies, stepBody]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export function assemblePromptForStep(args: {
  registry: PromptRegistry;
  stepPromptId: string;
}): string {
  // Fragment ordering is declared per-artifact via the `order` frontmatter field;
  // unranked fragments sort last by id. See v2/docs/prompts.md.
  const sortByContractOrder = (a: string, b: string): number => {
    const ao = args.registry.getById(a).metadata.order;
    const bo = args.registry.getById(b).metadata.order;
    if (ao !== null && bo !== null) return ao - bo || a.localeCompare(b);
    if (ao !== null) return -1;
    if (bo !== null) return 1;
    return a.localeCompare(b);
  };
  const step = args.registry.getById(args.stepPromptId);
  const stepBehavior = step.metadata.behavior;
  const globalFragmentIds = args.registry
    .all()
    .filter(
      (artifact) =>
        artifact.metadata.kind === "fragment" &&
        artifact.metadata.behavior === "global",
    )
    .map((artifact) => artifact.metadata.id)
    .sort(sortByContractOrder);
  const behaviorFragmentIds = args.registry
    .all()
    .filter(
      (artifact) =>
        artifact.metadata.kind === "fragment" &&
        artifact.metadata.behavior === stepBehavior,
    )
    .map((artifact) => artifact.metadata.id)
    .sort(sortByContractOrder);
  return assemblePrompt({
    registry: args.registry,
    globalFragmentIds,
    behaviorFragmentIds,
    stepPromptId: args.stepPromptId,
    addFragmentIds: step.metadata.add,
    removeFragmentIds: step.metadata.remove,
  });
}
