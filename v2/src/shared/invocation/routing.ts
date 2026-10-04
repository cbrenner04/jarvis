/**
 * Routing-role invocation contract: which vendors have an honest tool-free form, the named refusal
 * for those that do not, the named failures a routing call can settle with, and the pure
 * transcript/output checks the routing binding applies. Catalog validation of the parsed object
 * belongs to the v2 consumer.
 */
import type { Usage } from "../prices/cost.ts";
import { codexUsageFromTotals } from "./codex-usage.ts";
import type { InvocationError, InvocationResult, InvocationSettlement } from "./execute.ts";
import { asJsonObject, parseJsonObjectLines } from "./json-lines.ts";

/** Whole-call wall clock for one routing invocation; there is no retry on overrun. */
export const ROUTING_TIMEOUT_MS = 60_000;
/** Longest final assistant text accepted as a routing answer; longer is malformed, not truncated. */
export const ROUTING_MAX_OUTPUT_CHARS = 4096;

/** Vendors with an invocation form that disables tools; the single source of truth for routing eligibility. */
export type ToolFreeVendor = "claude" | "codex";

export type ToolFreeVendorResolution = { vendor: ToolFreeVendor } | { refusal: string };

/** The narrowed tool-free vendor for `agentId`, or why it refuses the routing role. */
export function resolveToolFreeVendor(agentId: string): ToolFreeVendorResolution {
  switch (agentId) {
    case "claude":
    case "codex":
      return { vendor: agentId };
    case "cursor":
      return {
        refusal: "cursor-agent has no tool-disabling flag; `--mode ask` keeps read tools and needs a workspace grant",
      };
    case "opencode":
      return { refusal: "opencode has no tool-disabling flag; tool sets live only in project agent config" };
    default:
      return { refusal: "no tool-free invocation form is wired" };
  }
}

/** Why `agentId` cannot run tool-free, or `null` when it can. */
export function routingRefusalReason(agentId: string): string | null {
  const resolved = resolveToolFreeVendor(agentId);
  return "refusal" in resolved ? resolved.refusal : null;
}

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

export function routingFailure(
  reason: RoutingFailureReason,
  stderr: string,
  settlement: InvocationSettlement & { diagnostics?: string } = {},
): RoutingInvocationError {
  return { kind: "error", exitCode: -1, stderr, routingFailure: reason, ...settlement };
}

/** The named routing failure a result carries, or `null` for ordinary results. */
export function routingFailureOf(result: InvocationResult): RoutingFailureReason | null {
  return result.kind === "error" && "routingFailure" in result
    ? (result as RoutingInvocationError).routingFailure
    : null;
}

function claudeToolUseName(frame: Record<string, unknown>): string | null {
  if (frame.type === "tool_use") return typeof frame.name === "string" ? frame.name : "unknown";
  if (frame.type !== "assistant") return null;
  const content = asJsonObject(frame.message)?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    const rec = asJsonObject(block);
    if (rec?.type === "tool_use") return typeof rec.name === "string" ? rec.name : "unknown";
  }
  return null;
}

/** First tool the agent tried to call in a claude `stream-json` transcript, or `null`. */
export function findClaudeRoutingToolCall(stdout: string): string | null {
  for (const frame of parseJsonObjectLines(stdout)) {
    const name = claudeToolUseName(frame);
    if (name !== null) return name;
  }
  return null;
}

/** `codex exec --json` item types that act on the world; text, reasoning, plan, and error items are not tool calls. */
const CODEX_TOOL_ITEM_TYPES = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search"]);

export type CodexExecJsonOutput = {
  /** First tool item the agent started (command, patch, MCP call, search), or `null`. */
  toolCall: string | null;
  /** Text of the last completed `agent_message` item, or `null` when none was emitted. */
  message: string | null;
  /** `turn.failed` / `error` event text, or `null`. */
  error: string | null;
  usage: Usage | null;
};

function codexEventError(frame: Record<string, unknown>): string | null {
  if (frame.type === "turn.failed") {
    const message = asJsonObject(frame.error)?.message;
    return typeof message === "string" ? message : "turn failed";
  }
  if (frame.type === "error") return typeof frame.message === "string" ? frame.message : "error";
  return null;
}

/** Reads a `codex exec --json` event stream for tool attempts, the final message, failures, and usage. */
export function parseCodexExecJsonOutput(stdout: string): CodexExecJsonOutput {
  const out: CodexExecJsonOutput = { toolCall: null, message: null, error: null, usage: null };
  for (const frame of parseJsonObjectLines(stdout)) {
    const usage = frame.type === "turn.completed" ? asJsonObject(frame.usage) : null;
    if (usage !== null) out.usage = codexUsageFromTotals(usage);
    out.error ??= codexEventError(frame);
    const item = asJsonObject(frame.item);
    if (item === null || typeof item.type !== "string") continue;
    if (CODEX_TOOL_ITEM_TYPES.has(item.type)) {
      out.toolCall ??= item.type;
    } else if (frame.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") {
      out.message = item.text;
    }
  }
  return out;
}

const FENCE = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/;

/** The agent's final text as one bounded JSON object (a single surrounding code fence is tolerated). */
export function parseRoutingOutput(
  text: string,
): { ok: true; json: string } | { ok: false; reason: "malformed_output"; detail: string } {
  const trimmed = text.trim();
  if (trimmed.length > ROUTING_MAX_OUTPUT_CHARS) {
    return { ok: false, reason: "malformed_output", detail: `output exceeds ${ROUTING_MAX_OUTPUT_CHARS} chars` };
  }
  const body = FENCE.exec(trimmed)?.[1] ?? trimmed;
  try {
    if (asJsonObject(JSON.parse(body)) === null) {
      return { ok: false, reason: "malformed_output", detail: "output is not a JSON object" };
    }
  } catch {
    return { ok: false, reason: "malformed_output", detail: "output is not valid JSON" };
  }
  return { ok: true, json: body };
}
