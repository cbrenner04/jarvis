import type {
  PromptArtifact,
  PromptPlaceholderDeclaration,
  PromptRegistry,
} from "./registry.ts";

export class PromptRenderingError extends Error {
  constructor(
    public reason:
      | "unknown_placeholder"
      | "missing_value"
      | "type_mismatch"
      | "invalid_placeholder_pattern"
      | "delimiter_violation",
    public details: string,
  ) {
    super(`Prompt rendering error: ${details}`);
    this.name = "PromptRenderingError";
  }
}

export function renderArtifactTemplate(
  artifact: PromptArtifact,
  values: Record<string, unknown>,
): string {
  return renderTemplateWithDeclarations(
    artifact.body,
    artifact.metadata.placeholders,
    values,
  );
}

export function renderTemplateWithDeclarations(
  template: string,
  declarations: ReadonlyArray<PromptPlaceholderDeclaration>,
  values: Record<string, unknown>,
): string {
  const allowed = new Map(declarations.map((d) => [d.name, d]));
  const placeholderPattern = /(?<!<)<([A-Z_][A-Z_0-9]{1,})>(?!>)/g;
  const matches: Array<{
    token: string;
    name: string;
    index: number;
    length: number;
  }> = [];

  let match = placeholderPattern.exec(template);
  while (match !== null) {
    const name = match[1];
    if (name === undefined) {
      throw new PromptRenderingError(
        "invalid_placeholder_pattern",
        "Regex pattern produced undefined placeholder name",
      );
    }
    const token = match[0];
    const declaration = allowed.get(name);
    if (declaration === undefined) {
      throw new PromptRenderingError(
        "unknown_placeholder",
        `Template references unknown placeholder \`${token}\``,
      );
    }
    if (declaration.required && values[name] === undefined) {
      throw new PromptRenderingError(
        "missing_value",
        `Required placeholder \`${token}\` has no value`,
      );
    }
    const value = values[name];
    if (
      value !== undefined &&
      declaration.type === "string" &&
      typeof value !== "string"
    ) {
      throw new PromptRenderingError(
        "type_mismatch",
        `Placeholder \`${token}\` expects string but received ${typeof value}`,
      );
    }
    matches.push({ token, name, index: match.index, length: token.length });
    match = placeholderPattern.exec(template);
  }

  let result = "";
  let lastIndex = 0;
  for (const m of matches) {
    result += template.substring(lastIndex, m.index);
    const value = values[m.name];
    result += typeof value === "string" ? value : "";
    lastIndex = m.index + m.length;
  }
  result += template.substring(lastIndex);
  return result;
}

export function enforceDelimiterPolicy(args: {
  value: string;
  begin: string;
  end: string;
  placeholderName: string;
}): void {
  if (args.value.includes(args.begin) || args.value.includes(args.end)) {
    throw new PromptRenderingError(
      "delimiter_violation",
      `Placeholder <${args.placeholderName}> includes reserved sentinel delimiter`,
    );
  }
}

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
  const ORDER_INDEX: Record<string, number> = {
    "global.documentation": 0,
    "global.naming": 1,
    "global.terse": 2,
    "plan.decisions-ledger": 0,
    "plan.defer-to-consumer": 1,
  };
  const sortByContractOrder = (a: string, b: string): number => {
    const ai = ORDER_INDEX[a];
    const bi = ORDER_INDEX[b];
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
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
