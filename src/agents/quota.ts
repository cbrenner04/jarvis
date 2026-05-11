import type { AgentName } from "./types.ts";

const claudeQuotaPatterns = [
  /\byou['’]ve hit your (?:session|weekly|opus) limit\b/i,
  /\byou['’]ve hit your org['’]s monthly usage limit\b/i,
  /\bcredit balance is too low\b/i,
  /\brequest rejected \(429\)\b/i,
];

const codexQuotaPatterns = [
  /\byou['’]ve (?:hit|reached) your usage limit\b/i,
  /\busage limit\b.*\b(?:reset|resets|window)\b/i,
  /\brate_limit_exceeded\b/i,
];

const cursorQuotaPatterns = [
  /\byou['’]ve hit your usage limit\b/i,
  /\byou['’]ve hit your free requests limit\b/i,
  /\btotal usage limit reached\b/i,
  /\bmonthly cursor usage limit\b/i,
  /\bon-demand spending limit\b/i,
  /\bspend limit\b/i,
  /\bresource_exhausted\b/i,
];

const opencodeQuotaPatterns = [
  /\brate limit\b/i,
  /\bquota exceeded\b/i,
  /\binsufficient_quota\b/i,
  /(?:^|\n)[^\n]*(?:error|err|failed|failure|http|status)[^\n]*\b429\b/i,
  /(?:^|\n)[^\n]*\b429\b[^\n]*(?:error|err|failed|failure|http|status)\b/i,
  /\byou have exceeded your\b/i,
];

const modelConfigurationPatterns = [
  /\bunknown model\b/i,
  /\bunsupported model\b/i,
  /\binvalid model\b/i,
  /\bmodel not found\b/i,
  /\bmodel is not available\b/i,
  /\bnot available for your account\b/i,
  /\bunrecognized model\b/i,
];

const opencodeModelConfigurationPatterns = [/\bno provider configured for\b/i];

export function isModelConfigurationSignal(stderr: string): boolean;
export function isModelConfigurationSignal(
  name: AgentName,
  stderr: string,
): boolean;
export function isModelConfigurationSignal(
  nameOrStderr: AgentName | string,
  maybeStderr?: string,
): boolean {
  const name =
    maybeStderr === undefined ? undefined : (nameOrStderr as AgentName);
  const stderr = maybeStderr === undefined ? nameOrStderr : maybeStderr;
  const patterns =
    name === "opencode" || name === "airproxy" || name === "copilot"
      ? [...modelConfigurationPatterns, ...opencodeModelConfigurationPatterns]
      : modelConfigurationPatterns;

  return patterns.some((pattern) => pattern.test(stderr));
}

export function isQuotaSignal(
  name: AgentName,
  exitCode: number,
  stderr: string,
): boolean {
  if (exitCode === 0) return false;

  const patterns = (() => {
    switch (name as AgentName | "opencode") {
      case "claude":
        return claudeQuotaPatterns;
      case "codex":
        return codexQuotaPatterns;
      case "cursor":
        return cursorQuotaPatterns;
      case "opencode":
      case "airproxy":
      case "copilot":
        return opencodeQuotaPatterns;
    }
  })();

  return patterns.some((pattern) => pattern.test(stderr));
}
