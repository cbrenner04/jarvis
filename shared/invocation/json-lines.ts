/** Shared JSON helpers for NDJSON agent transcripts. */

export function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** Every line of `text` that parses as a JSON object, in order; blank and unparseable lines are skipped. */
export function parseJsonObjectLines(text: string): Record<string, unknown>[] {
  const frames: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const frame = asJsonObject(JSON.parse(trimmed));
      if (frame !== null) frames.push(frame);
    } catch {
      // Not a JSON line.
    }
  }
  return frames;
}
