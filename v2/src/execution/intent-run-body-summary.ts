export const DEFAULT_PUBLICATION_TITLE = "jarvis: complete run";

/** Pre-rendered intent-run PR body summary: optional subject line plus one bullet per landed intent file. */
export function deriveIntentRunBodySummary(input: {
  creationTitle?: unknown;
  intentFiles: readonly string[];
}): string | undefined {
  const files = [...input.intentFiles].sort();
  const trimmed = typeof input.creationTitle === "string" ? input.creationTitle.trim() : "";
  const subject = trimmed && trimmed !== DEFAULT_PUBLICATION_TITLE ? trimmed : undefined;
  const bullets = files.map((file) => `- ${file}`);
  if (subject === undefined && bullets.length === 0) {
    return undefined;
  }
  return [...(subject === undefined ? [] : [subject]), ...bullets].join("\n");
}
