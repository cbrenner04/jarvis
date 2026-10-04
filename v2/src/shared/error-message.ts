/** The one error-to-text coercion: `Error` instances contribute their message, anything else its string form. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
