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

function parseFrame(trimmed: string): Record<string, unknown> | null {
  let frame: Record<string, unknown> | null;
  try {
    frame = asFrame(JSON.parse(trimmed));
  } catch {
    return null;
  }
  if (frame === null || typeof frame.type !== "string") {
    return null;
  }
  return frame;
}

type StepFinishTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
};

/** Extract clean numeric token totals from a `step_finish` frame, or null. */
function readStepFinish(frame: Record<string, unknown>): StepFinishTotals | null {
  const part = asFrame(frame.part);
  const tokens = part === null ? null : asFrame(part.tokens);
  const cache = tokens === null ? null : asFrame(tokens.cache);
  if (part === null || tokens === null || cache === null) {
    return null;
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
    return null;
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    cost: typeof part.cost === "number" ? part.cost : null,
  };
}

/**
 * Parse an `opencode run --format json` NDJSON stream. Token and cost fields are
 * summed **only** from clean `step_finish` frames (all of `part.tokens.input`,
 * `part.tokens.output`, `part.tokens.cache.read`, `part.tokens.cache.write`
 * numeric); `part.cost` is read inside that clean-token branch. `text` frames
 * supply display text; raw stdout is a fallback only when the stream was not
 * structurally recognized (no `step_finish` and no `text` frame).
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

    const frame = parseFrame(trimmed);
    if (frame === null) {
      continue;
    }

    if (frame.type === "step_finish") {
      const totals = readStepFinish(frame);
      if (totals === null) {
        continue;
      }
      usage.input_tokens += totals.input;
      usage.output_tokens += totals.output;
      usage.cache_read_input_tokens += totals.cacheRead;
      usage.cache_creation_input_tokens += totals.cacheWrite;
      sawStepFinish = true;
      if (totals.cost !== null) {
        cost_usd += totals.cost;
        sawAnyCostField = true;
      }
    } else if (frame.type === "text") {
      const part = asFrame(frame.part);
      if (part !== null && typeof part.text === "string") {
        textFrames.push(part.text);
      }
    }
  }

  // Fallback is keyed on structural recognition, not on whether the rendered
  // text is non-empty: once the stream was recognized (a clean `step_finish` or
  // any `text` frame), an empty render must surface as empty — a healthy
  // `step_finish`-only success must never dump the raw NDJSON transcript.
  // Reserve the raw-stdout fallback for genuinely unrecognized output.
  const recognized = sawStepFinish || textFrames.length > 0;
  const displayText = recognized ? textFrames.join("").trimEnd() : stdout;
  return { displayText, usage, cost_usd, sawStepFinish, sawAnyCostField };
}
