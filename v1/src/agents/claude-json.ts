import type { TelemetryUsage } from "../telemetry.ts";

export type ClaudeParseResult = {
  displayText: string;
  usage: TelemetryUsage | null;
  cost_usd: number | null;
  warnings: string[];
};

// Parses Claude's JSON output envelope and extracts usage, cost, and display text.
export function parseClaudeJsonOutput(stdout: string): ClaudeParseResult {
  const warnings: string[] = [];

  try {
    const envelope = JSON.parse(stdout);

    // Extract usage from the standard location
    const usage = extractUsage(envelope);

    // Extract cost
    const cost_usd = extractCost(envelope);

    // Extract display text (handling tool calls if present)
    const displayText = extractDisplayText(envelope, warnings);

    return {
      displayText,
      usage,
      cost_usd,
      warnings,
    };
  } catch (err) {
    const reason =
      err instanceof SyntaxError
        ? `JSON parse error: ${err.message}`
        : `unexpected error: ${String(err)}`;
    return {
      displayText: stdout,
      usage: null,
      cost_usd: null,
      warnings: [reason],
    };
  }
}

function extractUsage(envelope: unknown): TelemetryUsage | null {
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    Array.isArray(envelope)
  ) {
    return null;
  }

  const obj = envelope as Record<string, unknown>;
  const usage = obj.usage;

  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const usageObj = usage as Record<string, unknown>;

  return {
    input_tokens:
      typeof usageObj.input_tokens === "number" ? usageObj.input_tokens : null,
    output_tokens:
      typeof usageObj.output_tokens === "number"
        ? usageObj.output_tokens
        : null,
    cache_read_input_tokens:
      typeof usageObj.cache_read_input_tokens === "number"
        ? usageObj.cache_read_input_tokens
        : null,
    cache_creation_input_tokens:
      typeof usageObj.cache_creation_input_tokens === "number"
        ? usageObj.cache_creation_input_tokens
        : null,
  };
}

function extractCost(envelope: unknown): number | null {
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    Array.isArray(envelope)
  ) {
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
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    Array.isArray(envelope)
  ) {
    return "";
  }

  const obj = envelope as Record<string, unknown>;

  // The simple case: result is just the display text
  const result = obj.result;
  if (typeof result === "string") {
    return result.trimEnd();
  }

  // If result is not a string or is missing, we have a parse issue
  // This shouldn't happen for a well-formed envelope, but we'll handle it
  if (result !== undefined) {
    warnings.push(`unexpected result type: ${typeof result}`);
  }

  return "";
}
