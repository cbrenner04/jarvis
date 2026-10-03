/**
 * Routing-role invocation contract: the named refusal for vendors with no honest tool-free form,
 * the named failures a routing call can settle with, and the pure transcript/output checks the
 * routing binding applies. Catalog validation of the parsed object belongs to the v2 consumer.
 */
import type { Usage } from "../prices/cost.ts";
import type { InvocationError, InvocationResult, InvocationSettlement } from "./execute.ts";

/** Whole-call wall clock for one routing invocation; there is no retry on overrun. */
export const ROUTING_TIMEOUT_MS = 60_000;
/** Longest final assistant text accepted as a routing answer; longer is malformed, not truncated. */
export const ROUTING_MAX_OUTPUT_CHARS = 4096;

export type RoutingFailureReason = "timeout" | "tool_call" | "malformed_output";

/** A routing settlement that names its cause; structurally still an `error` result. */
export type RoutingInvocationError = Extract<InvocationError, { kind: "error" }> & {
  routingFailure: RoutingFailureReason;
};

/** Vendor has no invocation form that disables tools; the routing role refuses it rather than degrading. */
export class RoutingRefusalError extends Error {
  readonly agentId: string;
  constructor(agentId: string, reason: string) {
    super(`agent '${agentId}' refuses the routing role: ${reason}`);
    this.name = "RoutingRefusalError";
    this.agentId = agentId;
  }
}

/** Why `agentId` cannot run tool-free, or `null` when it can. */
export function routingRefusalReason(agentId: string): string | null {
  switch (agentId) {
    case "claude":
    case "codex":
      return null;
    case "cursor":
      return "cursor-agent has no tool-disabling flag; `--mode ask` keeps read tools and needs a workspace grant";
    case "opencode":
      return "opencode has no tool-disabling flag; tool sets live only in project agent config";
    default:
      return "no tool-free invocation form is wired";
  }
}

export function routingFailure(
  reason: RoutingFailureReason,
  stderr: string,
  settlement: InvocationSettlement = {},
): RoutingInvocationError {
  return { kind: "error", exitCode: -1, stderr, routingFailure: reason, ...settlement };
}

/** The named routing failure a result carries, or `null` for ordinary results. */
export function routingFailureOf(result: InvocationResult): RoutingFailureReason | null {
  return result.kind === "error" && "routingFailure" in result
    ? (result as RoutingInvocationError).routingFailure
    : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonLines(stdout: string): Record<string, unknown>[] {
  const frames: Record<string, unknown>[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const frame = asObject(JSON.parse(trimmed));
      if (frame !== null) frames.push(frame);
    } catch {
      // Non-JSON lines carry no tool frames.
    }
  }
  return frames;
}

function claudeToolUseName(frame: Record<string, unknown>): string | null {
  if (frame.type === "tool_use") return typeof frame.name === "string" ? frame.name : "unknown";
  if (frame.type !== "assistant") return null;
  const content = asObject(frame.message)?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    const rec = asObject(block);
    if (rec?.type === "tool_use") return typeof rec.name === "string" ? rec.name : "unknown";
  }
  return null;
}

/** First tool the agent tried to call in a claude `stream-json` transcript, or `null`. */
export function findClaudeRoutingToolCall(stdout: string): string | null {
  for (const frame of jsonLines(stdout)) {
    const name = claudeToolUseName(frame);
    if (name !== null) return name;
  }
  return null;
}

const CODEX_TEXT_ITEM_TYPES = new Set(["agent_message", "reasoning"]);

export type CodexExecJsonOutput = {
  /** First non-text item the agent started (command, patch, MCP call, search…), or `null`. */
  toolCall: string | null;
  /** Text of the last completed `agent_message` item, or `null` when none was emitted. */
  message: string | null;
  usage: Usage | null;
};

function codexUsage(frame: Record<string, unknown>): Usage | null {
  const usage = asObject(frame.usage);
  if (usage === null) return null;
  const num = (value: unknown) => (typeof value === "number" ? value : null);
  const input = num(usage.input_tokens);
  const cached = num(usage.cached_input_tokens);
  return {
    input_tokens: input !== null && cached !== null ? Math.max(0, input - cached) : input,
    output_tokens: num(usage.output_tokens),
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: null,
  };
}

/** Reads a `codex exec --json` event stream for tool attempts, the final message, and usage. */
export function parseCodexExecJsonOutput(stdout: string): CodexExecJsonOutput {
  const out: CodexExecJsonOutput = { toolCall: null, message: null, usage: null };
  for (const frame of jsonLines(stdout)) {
    if (frame.type === "turn.completed") {
      out.usage = codexUsage(frame) ?? out.usage;
      continue;
    }
    const item = asObject(frame.item);
    if (item === null || typeof item.type !== "string") continue;
    if (!CODEX_TEXT_ITEM_TYPES.has(item.type) && item.type !== "error") {
      out.toolCall ??= item.type;
    } else if (frame.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") {
      out.message = item.text;
    }
  }
  return out;
}

const FENCE = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;

/** The agent's final text as one bounded JSON object (a single surrounding code fence is tolerated). */
export function parseRoutingOutput(
  text: string,
): { ok: true; json: string } | { ok: false; reason: "malformed_output"; detail: string } {
  const trimmed = text.trim();
  if (trimmed.length > ROUTING_MAX_OUTPUT_CHARS) {
    return { ok: false, reason: "malformed_output", detail: `output exceeds ${ROUTING_MAX_OUTPUT_CHARS} chars` };
  }
  const body = FENCE.exec(trimmed)?.[1]?.trim() ?? trimmed;
  try {
    if (asObject(JSON.parse(body)) === null) {
      return { ok: false, reason: "malformed_output", detail: "output is not a JSON object" };
    }
  } catch {
    return { ok: false, reason: "malformed_output", detail: "output is not valid JSON" };
  }
  return { ok: true, json: body };
}
