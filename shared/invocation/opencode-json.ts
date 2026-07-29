export type OpencodeParseResult = {
  displayText: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  cost_usd: number;
  sawStepFinish: boolean;
  sawAnyCostField: boolean;
};

function asFrame(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Parse an `opencode run --format json` NDJSON stream. Token and cost fields are
 * summed **only** from clean `step_finish` frames (all of `part.tokens.input`,
 * `part.tokens.output`, `part.tokens.cache.read`, `part.tokens.cache.write`
 * numeric); `part.cost` is read inside that clean-token branch. `text` frames
 * supply display text, with raw stdout as an empty-found fallback.
 */
export function parseOpencodeJsonOutput(stdout: string): OpencodeParseResult {
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  let cost_usd = 0;
  let sawStepFinish = false;
  let sawAnyCostField = false;
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
    if (frame === null || typeof frame.type !== "string") {
      continue;
    }

    if (frame.type === "step_finish") {
      const part = asFrame(frame.part);
      const tokens = part === null ? null : asFrame(part.tokens);
      const cache = tokens === null ? null : asFrame(tokens.cache);
      if (part === null || tokens === null || cache === null) {
        continue;
      }
      const input = tokens.input;
      const output = tokens.output;
      const cacheRead = cache.read;
      const cacheWrite = cache.write;
      if (
        typeof input !== "number" ||
        typeof output !== "number" ||
        typeof cacheRead !== "number" ||
        typeof cacheWrite !== "number"
      ) {
        continue;
      }
      usage.input_tokens += input;
      usage.output_tokens += output;
      usage.cache_read_input_tokens += cacheRead;
      usage.cache_creation_input_tokens += cacheWrite;
      sawStepFinish = true;
      if (typeof part.cost === "number") {
        cost_usd += part.cost;
        sawAnyCostField = true;
      }
    } else if (frame.type === "text") {
      const part = asFrame(frame.part);
      if (part !== null && typeof part.text === "string") {
        textFrames.push(part.text);
      }
    }
  }

  const displayText = textFrames.length > 0 ? textFrames.join("").trimEnd() : stdout;
  return { displayText, usage, cost_usd, sawStepFinish, sawAnyCostField };
}
