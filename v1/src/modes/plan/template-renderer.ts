/**
 * Non-recursive template rendering for plan-mode prompts.
 *
 * This module scans the original template source for placeholder tokens and
 * substitutes each exactly once. Placeholder-looking text in injected values
 * is treated as literal data, not template syntax.
 */

/**
 * Error thrown when template rendering fails due to unknown placeholders
 * or missing values.
 */
export class TemplateRenderingError extends Error {
  constructor(
    public reason:
      | "unknown_placeholder"
      | "missing_value"
      | "invalid_placeholder_pattern",
    public details: string,
  ) {
    super(`Template rendering error: ${details}`);
    this.name = "TemplateRenderingError";
  }
}

/**
 * Render a template by substituting placeholders with provided values.
 *
 * Scans the original template for placeholder tokens, substitutes each token
 * with the corresponding value, and leaves placeholder-looking strings in
 * inserted values untouched.
 *
 * @param template The template string containing placeholders like `<NAME>`, `<INTENT>`, etc.
 * @param allowedPlaceholders Set of allowed placeholder names (without angle brackets).
 * @param values Map of placeholder names to their values.
 * @returns The rendered template with placeholders substituted.
 * @throws TemplateRenderingError if a template references an unknown placeholder
 *         or a required value is missing.
 */
export function renderTemplate(
  template: string,
  allowedPlaceholders: Set<string>,
  values: Partial<Record<string, string>>,
): string {
  // Match <PLACEHOLDER_NAME> where PLACEHOLDER_NAME is all uppercase/underscore.
  // Use negative lookbehind/lookahead to avoid matching within multi-bracket
  // delimiters like <<<INTENT_BEGIN>>>.
  // Require at least 2 characters to avoid matching documentation like <N>.
  const placeholderPattern = /(?<!<)<([A-Z_][A-Z_0-9]{1,})>(?!>)/g;

  // Collect all matches with their positions
  const matches: Array<{
    token: string;
    name: string;
    index: number;
    length: number;
  }> = [];

  let match = placeholderPattern.exec(template);
  while (match !== null) {
    const placeholderName = match[1];
    if (placeholderName === undefined) {
      throw new TemplateRenderingError(
        "invalid_placeholder_pattern",
        "Regex pattern produced undefined placeholder name",
      );
    }

    const token = match[0]; // e.g., "<NAME>"

    // Check if this is an allowed placeholder
    if (!allowedPlaceholders.has(placeholderName)) {
      throw new TemplateRenderingError(
        "unknown_placeholder",
        `Template references unknown placeholder \`${token}\``,
      );
    }

    // Check if we have a value for this placeholder
    const value = values[placeholderName];
    if (value === undefined) {
      throw new TemplateRenderingError(
        "missing_value",
        `Required placeholder \`${token}\` has no value`,
      );
    }

    matches.push({
      token,
      name: placeholderName,
      index: match.index,
      length: token.length,
    });

    match = placeholderPattern.exec(template);
  }

  // Build result by processing template in order, replacing only original
  // template placeholders, not recursively scanning injected values.
  let result = "";
  let lastIndex = 0;

  for (const m of matches) {
    // Add the template content before this placeholder
    result += template.substring(lastIndex, m.index);
    // Add the substituted value
    const value = values[m.name];
    result += value ?? "";
    // Move past this placeholder
    lastIndex = m.index + m.length;
  }

  // Add any remaining template content after the last placeholder
  result += template.substring(lastIndex);

  return result;
}
