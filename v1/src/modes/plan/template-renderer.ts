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
  try {
    return renderTemplateWithDeclarations(
      template,
      Array.from(allowedPlaceholders).map((name) => ({
        name,
        type: "string" as const,
        required: true,
      })),
      values,
    );
  } catch (err) {
    if (err instanceof PromptRenderingError) {
      if (
        err.reason === "unknown_placeholder" ||
        err.reason === "missing_value" ||
        err.reason === "invalid_placeholder_pattern"
      ) {
        throw new TemplateRenderingError(err.reason, err.details);
      }
    }
    throw err;
  }
}

import {
  PromptRenderingError,
  renderTemplateWithDeclarations,
} from "../../prompts/renderer.ts";
