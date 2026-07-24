export type CursorParseResult = {
  displayText: string;
};

function asFrame(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseCursorJsonOutput(stdout: string): CursorParseResult {
  let lastResultText: string | null = null;
  const textFrames: string[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }

    let frame: Record<string, unknown> | null;
    try {
      frame = asFrame(JSON.parse(trimmed));
    } catch {
      continue;
    }
    if (frame === null) {
      continue;
    }

    if (frame.type === "result") {
      lastResultText = typeof frame.result === "string" ? frame.result : null;
    } else if (frame.type === "text_delta" || frame.type === "assistant" || frame.type === "text-delta") {
      if (typeof frame.text === "string") {
        textFrames.push(frame.text);
      } else if (typeof frame.delta === "string") {
        textFrames.push(frame.delta);
      }
    }
  }

  // Fallback is keyed on what was *found*, not on whether the rendered text is
  // non-empty: a run whose terminal result legitimately says nothing must surface
  // as empty, never as the raw NDJSON transcript.
  if (lastResultText !== null) {
    return { displayText: lastResultText.trimEnd() };
  }
  if (textFrames.length > 0) {
    return { displayText: textFrames.join("").trimEnd() };
  }
  return { displayText: stdout };
}
