import type { AgentName, AgentResult } from "./types.ts";

const transportContextWords = ["error", "err", "failed", "failure", "http", "status"] as const;

function guardedStatusPatterns(
  statusCodes: readonly number[],
  contextWords: readonly string[] = transportContextWords,
): RegExp[] {
  const context = contextWords.join("|");
  return statusCodes.flatMap((statusCode) => [
    new RegExp(`(?:^|\\n)[^\\n]*(?:${context})[^\\n]*\\b${statusCode}\\b`, "i"),
    new RegExp(`(?:^|\\n)[^\\n]*\\b${statusCode}\\b[^\\n]*(?:${context})\\b`, "i"),
  ]);
}

const claudeQuotaPatterns = [
  /\byou['’]ve hit your (?:session|weekly|opus) limit\b/i,
  /\byou['’]ve hit your monthly spend limit\b/i,
  /\byou['’]ve hit your org['’]s monthly usage limit\b/i,
  /\bcredit balance is too low\b/i,
  /\brequest rejected \(429\)\b/i,
  /\binsufficient[_ ]quota\b/i,
  /\bquota exceeded\b/i,
  /\b(usages?|requests?) (?:have been )?exhausted\b/i,
];

const codexQuotaPatterns = [
  /\byou['’]ve (?:hit|reached) your usage limit\b/i,
  /\busage limit\b.*\b(?:reset|resets|window)\b/i,
  /\brate_limit_exceeded\b/i,
  /\binsufficient[_ ]quota\b/i,
  /\bquota exceeded\b/i,
];

const cursorQuotaPatterns = [
  /\byou['’]ve hit your usage limit\b/i,
  /\byou['’]ve hit your free requests limit\b/i,
  /\btotal usage limit reached\b/i,
  /\bmonthly cursor usage limit\b/i,
  /\bon-demand spending limit\b/i,
  /\bspend limit\b/i,
  /\bresource_exhausted\b/i,
  /\binsufficient[_ ]quota\b/i,
  /\bquota exceeded\b/i,
];

const opencodeQuotaPatterns = [
  /\brate limit\b/i,
  /\bquota exceeded\b/i,
  /\binsufficient_quota\b/i,
  ...guardedStatusPatterns([429]),
  /\byou have exceeded your\b/i,
];

const aiderQuotaPatterns = [
  /\brate limit\b/i,
  /\bquota exceeded\b/i,
  /\binsufficient_quota\b/i,
  ...guardedStatusPatterns([429]),
];

const modelConfigurationPatterns = [
  /\bunknown model\b/i,
  /\bunsupported model\b/i,
  /\binvalid model\b/i,
  /\bmodel not found\b/i,
  /\bmodel is not available\b/i,
  /\bnot available for your account\b/i,
  /\bunrecognized model\b/i,
  /\bLLM Provider NOT provided\b/i,
];

const opencodeModelConfigurationPatterns = [/\bno provider configured for\b/i];
const aiderModelConfigurationPatterns = [
  /\bcould not connect to ollama\b/i,
  /\bconnection refused\b.*\b(model|host|localhost|127\.0\.0\.1|ollama|llama\.cpp|lm studio)\b/i,
  /\b(model|host|localhost|127\.0\.0\.1|ollama|llama\.cpp|lm studio)\b.*\bconnection refused\b/i,
  /\bmodel is not loaded\b/i,
  /\bno such model\b/i,
];

const codexCredentialAuthPatterns = [
  /\brefresh token was revoked\b/i,
  /\brefresh token revoked\b/i,
  /\blog out and sign in\b/i,
  /\bplease log out and sign in\b/i,
  /\bre-?authenticate/i,
  /\bre-?authentication required\b/i,
];

const weakQuotaPatterns = [/\b429\b/i, /\b503\b/i, /\brate.?limit\b/i, /\btoo many requests\b/i];

const sharedTransportPatterns = [
  /\bconnection closed\b/i,
  /\bconnection reset\b/i,
  /\bconnection refused\b/i,
  /\bsocket hang up\b/i,
  /\bpremature\b.*\b(?:close|end)\b/i,
  /\b(?:close|end)\b.*\bpremature\b/i,
  /\bstream closed\b/i,
  /\beconnreset\b/i,
  /\bepipe\b/i,
  /\bbroken pipe\b/i,
  /\bservice unavailable\b/i,
  /\boverloaded\b/i,
  ...guardedStatusPatterns([502, 503, 504, 529]),
];

const opencodeTransportPatterns = [
  /\bUnknownError\b/i,
  ...guardedStatusPatterns([500], [...transportContextWords, "unknownerror"]),
];

const harnessGitGhTransportPatterns = [
  /\bTLS handshake timeout\b/i,
  /\bcould not resolve host\b/i,
  /\btimed out\b/i,
  /\bSSL_ERROR\b/i,
  /\bSSL error\b/i,
  /\bhandshake failure\b/i,
  /\bthe remote end hung up unexpectedly\b/i,
];

export function isModelConfigurationSignal(stderr: string): boolean;
export function isModelConfigurationSignal(name: AgentName, stderr: string): boolean;
export function isModelConfigurationSignal(nameOrStderr: AgentName | string, maybeStderr?: string): boolean {
  const name = maybeStderr === undefined ? undefined : (nameOrStderr as AgentName);
  const stderr = maybeStderr === undefined ? nameOrStderr : maybeStderr;
  const patterns =
    name === "opencode"
      ? [...modelConfigurationPatterns, ...opencodeModelConfigurationPatterns]
      : name === "aider"
        ? [...modelConfigurationPatterns, ...aiderModelConfigurationPatterns]
        : modelConfigurationPatterns;

  return patterns.some((pattern) => pattern.test(stderr));
}

export function isCredentialAuthSignal(name: AgentName, _exitCode: number, stderr: string): boolean {
  const patterns = name === "codex" ? codexCredentialAuthPatterns : [];
  return patterns.some((pattern) => pattern.test(stderr));
}

/** True when stderr/result text matches Claude quota phrasing. */
export function isClaudeQuotaMessageText(text: string): boolean {
  return claudeQuotaPatterns.some((pattern) => pattern.test(text));
}

export function isQuotaSignal(name: AgentName, exitCode: number, stderr: string): boolean {
  if (exitCode === 0) return false;

  const patterns = (() => {
    switch (name) {
      case "claude":
        return claudeQuotaPatterns;
      case "codex":
        return codexQuotaPatterns;
      case "cursor":
        return cursorQuotaPatterns;
      case "opencode":
        return opencodeQuotaPatterns;
      case "aider":
        return aiderQuotaPatterns;
    }
  })();

  return patterns.some((pattern) => pattern.test(stderr));
}

export function isWeakQuotaSignal(
  _name: AgentName,
  exitCode: number,
  stderr: string,
  weakExitCodes: ReadonlySet<number> | readonly number[] = [],
): boolean {
  if (exitCode === 0) return false;
  const codes = weakExitCodes instanceof Set ? weakExitCodes : new Set(weakExitCodes);
  if (codes.has(exitCode)) return true;
  return weakQuotaPatterns.some((pattern) => pattern.test(stderr));
}

export function isTransientSignal(name: AgentName, exitCode: number, stderr: string): boolean {
  if (exitCode === 0) return false;
  return (
    (name === "opencode" && opencodeTransportPatterns.some((pattern) => pattern.test(stderr))) ||
    sharedTransportPatterns.some((pattern) => pattern.test(stderr))
  );
}

export function isTransientNetworkError(exitCode: number, stderr: string): boolean {
  if (exitCode === 0) return false;
  return (
    sharedTransportPatterns.some((pattern) => pattern.test(stderr)) ||
    harnessGitGhTransportPatterns.some((pattern) => pattern.test(stderr))
  );
}

export type QuotaFallbackConfig = {
  quotaFallback: "strict" | "lenient";
  weakQuotaExitCodes: readonly number[];
};

/**
 * Lenient weak-quota upgrade for `kind: "error"` only. Callers supply guards via
 * {@link applyQuotaFallbackWhenAllowed}.
 */
export function applyQuotaFallbackToAgentResult(
  agentName: AgentName,
  result: AgentResult,
  opts: QuotaFallbackConfig,
): AgentResult {
  if (result.kind !== "error") {
    return result;
  }
  if (opts.quotaFallback === "strict") {
    return result;
  }
  if (isWeakQuotaSignal(agentName, result.exitCode, result.stderr, opts.weakQuotaExitCodes)) {
    return { kind: "quota", stderr: result.stderr };
  }
  return result;
}

/**
 * Applies {@link applyQuotaFallbackToAgentResult} only when `allowLenientWeakQuotaFallback`
 * is true. Patch passes “no iteration progress”; plan passes “git porcelain unchanged
 * for this agent invocation.”
 */
export function applyQuotaFallbackWhenAllowed(
  agentName: AgentName,
  result: AgentResult,
  cfg: QuotaFallbackConfig,
  allowLenientWeakQuotaFallback: boolean,
): AgentResult {
  if (!allowLenientWeakQuotaFallback) {
    return result;
  }
  return applyQuotaFallbackToAgentResult(agentName, result, cfg);
}
