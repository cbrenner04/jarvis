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

/**
 * True when stdout is a Claude exit-0 JSON envelope reporting semantic 429 quota
 * exhaustion (`is_error`, `api_error_status: 429`, and a quota message in `result`).
 */
export function isClaudeZeroExitQuotaEnvelope(stdout: string): boolean {
  try {
    const envelope: unknown = JSON.parse(stdout);
    if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
      return false;
    }

    const obj = envelope as Record<string, unknown>;
    if (obj.is_error !== true || obj.api_error_status !== 429) {
      return false;
    }

    const result = obj.result;
    return typeof result === "string" && claudeQuotaEnvelopePatterns.some((pattern) => pattern.test(result));
  } catch {
    return false;
  }
}

export function parseClaudeJsonOutput(stdout: string): ClaudeParseResult {
  const warnings: string[] = [];

  try {
    const envelope = JSON.parse(stdout);
    const usage = extractUsage(envelope);
    const cost_usd = extractCost(envelope);
    const displayText = extractDisplayText(envelope, warnings);

    return {
      displayText,
      usage,
      cost_usd,
      warnings,
    };
  } catch (err) {
    const reason =
      err instanceof SyntaxError ? `JSON parse error: ${err.message}` : `unexpected error: ${String(err)}`;
    return {
      displayText: stdout,
      usage: null,
      cost_usd: null,
      warnings: [reason],
    };
  }
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
