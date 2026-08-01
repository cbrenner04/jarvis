export type CursorParseResult = {
  displayText: string;
  usage?: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
};

function asFrame(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractUsage(frame: Record<string, unknown>): CursorParseResult["usage"] {
  const usageObj = asFrame(frame.usage);
  if (usageObj === null) {
    return undefined;
  }

  return {
    input_tokens: typeof usageObj.inputTokens === "number" ? usageObj.inputTokens : null,
    output_tokens: typeof usageObj.outputTokens === "number" ? usageObj.outputTokens : null,
    cache_read_input_tokens:
      typeof usageObj.cacheReadTokens === "number" ? usageObj.cacheReadTokens : null,
    cache_creation_input_tokens:
      typeof usageObj.cacheWriteTokens === "number" ? usageObj.cacheWriteTokens : null,
  };
}

export function parseCursorJsonOutput(stdout: string): CursorParseResult {
  let lastResultText: string | null = null;
  let lastResultUsage: CursorParseResult["usage"];
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
      lastResultUsage = extractUsage(frame);
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
  const displayText =
    lastResultText !== null
      ? lastResultText.trimEnd()
      : textFrames.length > 0
        ? textFrames.join("").trimEnd()
        : stdout;

  return lastResultUsage === undefined ? { displayText } : { displayText, usage: lastResultUsage };
}
