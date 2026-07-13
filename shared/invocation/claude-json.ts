const claudeQuotaEnvelopePatterns = [
  /\byou['’]ve hit your (?:session|weekly|opus) limit\b/i,
  /\byou['’]ve hit your monthly spend limit\b/i,
  /\byou['’]ve hit your org['’]s monthly usage limit\b/i,
  /\bcredit balance is too low\b/i,
  /\brequest rejected \(429\)\b/i,
  /\binsufficient[_ ]quota\b/i,
  /\bquota exceeded\b/i,
  /\b(usages?|requests?) (?:have been )?exhausted\b/i,
] as const;

export type ClaudeParseResult = {
  displayText: string;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  } | null;
  cost_usd: number | null;
  warnings: string[];
};

function isResultEvent(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as Record<string, unknown>).type === "result";
}

function findTerminalResultEvent(stdout: string): { envelope: unknown | null; warnings: string[] } {
  let lastResult: unknown = null;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isResultEvent(parsed)) {
        lastResult = parsed;
      }
    } catch {
      // Skip unparseable NDJSON lines.
    }
  }

  if (lastResult !== null) {
    return { envelope: lastResult, warnings: [] };
  }

  try {
    const parsed: unknown = JSON.parse(stdout);
    if (isResultEvent(parsed)) {
      return { envelope: parsed, warnings: [] };
    }
  } catch {
    // Fall through to no-result fallback.
  }

  return {
    envelope: null,
    warnings: ["no terminal result event found"],
  };
}

export function isClaudeZeroExitQuotaEnvelope(stdout: string): boolean {
  const { envelope } = findTerminalResultEvent(stdout);
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return false;
  }

  const obj = envelope as Record<string, unknown>;
  if (obj.is_error !== true || obj.api_error_status !== 429) {
    return false;
  }

  const result = obj.result;
  return typeof result === "string" && claudeQuotaEnvelopePatterns.some((pattern) => pattern.test(result));
}

export function parseClaudeJsonOutput(stdout: string): ClaudeParseResult {
  const { envelope, warnings } = findTerminalResultEvent(stdout);

  if (envelope === null) {
    return {
      displayText: stdout,
      usage: null,
      cost_usd: null,
      warnings,
    };
  }

  const usage = extractUsage(envelope);
  const cost_usd = extractCost(envelope);
  const displayText = extractDisplayText(envelope, warnings);

  return {
    displayText,
    usage,
    cost_usd,
    warnings,
  };
}

function extractUsage(envelope: unknown): ClaudeParseResult["usage"] {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return null;
  }

  const obj = envelope as Record<string, unknown>;
  const usage = obj.usage;

  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const usageObj = usage as Record<string, unknown>;

  return {
    input_tokens: typeof usageObj.input_tokens === "number" ? usageObj.input_tokens : null,
    output_tokens: typeof usageObj.output_tokens === "number" ? usageObj.output_tokens : null,
    cache_read_input_tokens:
      typeof usageObj.cache_read_input_tokens === "number" ? usageObj.cache_read_input_tokens : null,
    cache_creation_input_tokens:
      typeof usageObj.cache_creation_input_tokens === "number" ? usageObj.cache_creation_input_tokens : null,
  };
}

function extractCost(envelope: unknown): number | null {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return null;
  }

  const obj = envelope as Record<string, unknown>;
  const cost = obj.total_cost_usd;

  if (typeof cost === "number") {
    return cost;
  }

  return null;
}

function extractDisplayText(envelope: unknown, warnings: string[]): string {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return "";
  }

  const obj = envelope as Record<string, unknown>;
  const result = obj.result;
  if (typeof result === "string") {
    return result.trimEnd();
  }

  if (result !== undefined) {
    warnings.push(`unexpected result type: ${typeof result}`);
  }

  return "";
}
