import type {
  PromptArtifact,
  PromptOptionalSection,
  PromptPlaceholderDeclaration,
  PromptVariantSubstitution,
} from "./types.ts";

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

function coercePlaceholderString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isEmptyPlaceholderValue(value: unknown): boolean {
  return coercePlaceholderString(value).trim() === "";
}

function assertTemplateAnchorPresent(body: string, anchor: string, context: string): void {
  if (!body.includes(anchor)) {
    throw new PromptRenderingError(
      "missing_template_anchor",
      `${context}: template anchor \`${anchor}\` is missing from body`,
    );
  }
}

function applyVariantSubstitutions(
  body: string,
  substitutions: ReadonlyArray<PromptVariantSubstitution>,
  variantId: string,
): string {
  let result = body;
  for (const substitution of substitutions) {
    assertTemplateAnchorPresent(result, substitution.anchor, `Variant \`${variantId}\` substitution`);
    result = substitution.replaceAll
      ? result.replaceAll(substitution.anchor, substitution.replacement)
      : result.replace(substitution.anchor, substitution.replacement);
  }
  return result;
}

function removeOptionalSection(body: string, section: PromptOptionalSection): string {
  const headerIndex = body.indexOf(section.header);
  assertTemplateAnchorPresent(body, section.header, `Optional section for \`${section.placeholder}\``);
  const beginIndex = body.indexOf(section.begin, headerIndex);
  if (beginIndex < 0) {
    throw new PromptRenderingError(
      "missing_template_anchor",
      `Optional section for \`${section.placeholder}\`: template anchor \`${section.begin}\` is missing from body`,
    );
  }
  const endIndex = body.indexOf(section.end, beginIndex);
  if (endIndex < 0) {
    throw new PromptRenderingError(
      "missing_template_anchor",
      `Optional section for \`${section.placeholder}\`: template anchor \`${section.end}\` is missing from body`,
    );
  }
  let removeEnd = endIndex + section.end.length;
  while (body[removeEnd] === "\n") removeEnd += 1;
  return `${body.slice(0, headerIndex)}${body.slice(removeEnd)}`;
}

function resolveOptionalSections(
  body: string,
  sections: ReadonlyArray<PromptOptionalSection>,
  values: Record<string, unknown>,
): string {
  let result = body;
  for (const section of sections) {
    if (isEmptyPlaceholderValue(values[section.placeholder])) {
      result = removeOptionalSection(result, section);
    }
  }
  return result;
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
    body = applyVariantSubstitutions(body, substitutions, variantId);
  }
  body = resolveOptionalSections(body, artifact.metadata.optionalSections, values);
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
