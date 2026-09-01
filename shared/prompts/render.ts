import type { PromptArtifact, PromptOptionalSection, PromptPlaceholderDeclaration } from "./types.ts";

export class PromptRenderingError extends Error {
  constructor(
    public reason:
      | "unknown_placeholder"
      | "missing_value"
      | "type_mismatch"
      | "invalid_placeholder_pattern"
      | "delimiter_violation"
      | "unknown_variant"
      | "missing_template_anchor",
    public details: string,
  ) {
    super(`Prompt rendering error: ${details}`);
    this.name = "PromptRenderingError";
  }
}

function findTemplateAnchor(body: string, anchor: string, context: string, fromIndex = 0): number {
  const index = body.indexOf(anchor, fromIndex);
  if (index < 0) {
    throw new PromptRenderingError(
      "missing_template_anchor",
      `${context}: template anchor \`${anchor}\` is missing from body`,
    );
  }
  return index;
}

function removeOptionalSection(body: string, section: PromptOptionalSection): string {
  const context = `Optional section for \`${section.placeholder}\``;
  const headerIndex = findTemplateAnchor(body, section.header, context);
  const beginIndex = findTemplateAnchor(body, section.begin, context, headerIndex);
  const endIndex = findTemplateAnchor(body, section.end, context, beginIndex);
  let removeEnd = endIndex + section.end.length;
  while (body[removeEnd] === "\n") removeEnd += 1;
  return `${body.slice(0, headerIndex)}${body.slice(removeEnd)}`;
}

export function renderArtifactTemplate(
  artifact: PromptArtifact,
  values: Record<string, unknown>,
  options?: { variant?: string },
): string {
  let body = artifact.body;
  const variantId = options?.variant;
  if (variantId !== undefined) {
    const substitutions = artifact.metadata.variants[variantId];
    if (substitutions === undefined) {
      throw new PromptRenderingError(
        "unknown_variant",
        `Prompt \`${artifact.metadata.id}\`: unknown variant \`${variantId}\``,
      );
    }
    for (const substitution of substitutions) {
      findTemplateAnchor(body, substitution.anchor, `Variant \`${variantId}\` substitution`);
      body = substitution.replaceAll
        ? body.replaceAll(substitution.anchor, substitution.replacement)
        : body.replace(substitution.anchor, substitution.replacement);
    }
  }
  for (const section of artifact.metadata.optionalSections) {
    const bound = values[section.placeholder];
    if ((typeof bound === "string" ? bound : "").trim() === "") {
      body = removeOptionalSection(body, section);
    }
  }
  return renderTemplateWithDeclarations(body, artifact.metadata.placeholders, values, artifact.metadata.id);
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
