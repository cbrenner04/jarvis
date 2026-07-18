import type { PromptArtifact, PromptPlaceholderDeclaration } from "./types.ts";

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

export function renderArtifactTemplate(artifact: PromptArtifact, values: Record<string, unknown>): string {
  return renderTemplateWithDeclarations(artifact.body, artifact.metadata.placeholders, values, artifact.metadata.id);
}

export function renderTemplateWithDeclarations(
  template: string,
  declarations: ReadonlyArray<PromptPlaceholderDeclaration>,
  values: Record<string, unknown>,
  promptId?: string,
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
      throw new PromptRenderingError("unknown_placeholder", `Template references unknown placeholder \`${token}\``);
    }
    if (declaration.required && values[name] === undefined) {
      throw new PromptRenderingError(
        "missing_value",
        `${promptId ? `Prompt \`${promptId}\`: ` : ""}Required placeholder \`${token}\` has no value`,
      );
    }
    const value = values[name];
    if (value !== undefined && declaration.type === "string" && typeof value !== "string") {
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
