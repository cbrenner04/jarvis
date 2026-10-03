import { describe, expect, test } from "bun:test";
import {
  findClaudeRoutingToolCall,
  parseCodexExecJsonOutput,
  parseRoutingOutput,
  ROUTING_MAX_OUTPUT_CHARS,
  resolveToolFreeVendor,
  routingFailure,
  routingFailureOf,
  routingRefusalReason,
} from "./routing.ts";

const line = (frame: unknown) => JSON.stringify(frame);

describe("resolveToolFreeVendor", () => {
  test.each(["claude", "codex"] as const)("%s narrows to a tool-free vendor", (agent) => {
    expect(resolveToolFreeVendor(agent)).toEqual({ vendor: agent });
    expect(routingRefusalReason(agent)).toBeNull();
  });

  test.each(["cursor", "opencode", "unknown-agent"])("%s is refused by name", (agent) => {
    const resolved = resolveToolFreeVendor(agent);
    expect(resolved).toEqual({ refusal: expect.any(String) });
    expect(routingRefusalReason(agent)).toBe("refusal" in resolved ? resolved.refusal : null);
  });
});

describe("findClaudeRoutingToolCall", () => {
  test("names the first tool_use block in an assistant frame", () => {
    const stdout = [
      line({ type: "system", subtype: "init" }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
      line({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] },
      }),
      line({ type: "result", result: "{}" }),
    ].join("\n");
    expect(findClaudeRoutingToolCall(stdout)).toBe("Bash");
  });

  test("names a bare tool_use frame", () => {
    expect(findClaudeRoutingToolCall(line({ type: "tool_use", name: "Read", input: {} }))).toBe("Read");
  });

  test("is null for a text-only transcript with non-JSON noise", () => {
    const stdout = ["not json", line({ type: "assistant", message: { content: [{ type: "text", text: "{}" }] } })];
    expect(findClaudeRoutingToolCall(stdout.join("\n"))).toBeNull();
  });
});

describe("parseCodexExecJsonOutput", () => {
  test("extracts the last agent message and turn usage", () => {
    const stdout = [
      line({ type: "thread.started", thread_id: "t" }),
      line({ type: "item.completed", item: { type: "reasoning", text: "thinking" } }),
      line({ type: "item.completed", item: { type: "agent_message", text: "draft" } }),
      line({ type: "item.completed", item: { type: "agent_message", text: '{"action":"run.log"}' } }),
      line({ type: "turn.completed", usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 7 } }),
    ].join("\n");
    expect(parseCodexExecJsonOutput(stdout)).toEqual({
      toolCall: null,
      message: '{"action":"run.log"}',
      error: null,
      usage: { input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 20, cache_creation_input_tokens: null },
    });
  });

  test("names the first non-text item as a tool call", () => {
    const stdout = [
      line({ type: "item.started", item: { type: "command_execution", command: "ls" } }),
      line({ type: "item.completed", item: { type: "agent_message", text: "{}" } }),
    ].join("\n");
    expect(parseCodexExecJsonOutput(stdout)).toMatchObject({ toolCall: "command_execution", message: "{}" });
  });

  test.each(["file_change", "mcp_tool_call", "web_search"])("%s items are tool calls", (type) => {
    expect(parseCodexExecJsonOutput(line({ type: "item.started", item: { type } })).toolCall).toBe(type);
  });

  test("todo_list and reasoning items are not tool calls", () => {
    const stdout = [
      line({ type: "item.completed", item: { type: "todo_list", items: [] } }),
      line({ type: "item.completed", item: { type: "reasoning", text: "plan" } }),
    ].join("\n");
    expect(parseCodexExecJsonOutput(stdout).toolCall).toBeNull();
  });

  test("turn.failed surfaces its error text", () => {
    const stdout = line({ type: "turn.failed", error: { message: "model overloaded" } });
    expect(parseCodexExecJsonOutput(stdout).error).toBe("model overloaded");
  });

  test("empty transcript yields no message, error, or usage", () => {
    expect(parseCodexExecJsonOutput("")).toEqual({ toolCall: null, message: null, error: null, usage: null });
  });
});

describe("parseRoutingOutput", () => {
  test("accepts a bare JSON object and a fenced one", () => {
    expect(parseRoutingOutput(' {"action":"run.log","runId":"r1"} ')).toEqual({
      ok: true,
      json: '{"action":"run.log","runId":"r1"}',
    });
    expect(parseRoutingOutput('```json\n{"action":"run.log"}\n```')).toEqual({
      ok: true,
      json: '{"action":"run.log"}',
    });
  });

  test.each([
    ["prose", "I would run run.log"],
    ["array", '["run.log"]'],
    ["scalar", '"run.log"'],
    ["oversize", `{"a":"${"x".repeat(ROUTING_MAX_OUTPUT_CHARS)}"}`],
  ])("%s is malformed_output", (_name, text) => {
    expect(parseRoutingOutput(text)).toMatchObject({ ok: false, reason: "malformed_output" });
  });
});

describe("routingFailureOf", () => {
  test("names a routing failure and ignores ordinary results", () => {
    expect(routingFailureOf(routingFailure("timeout", "routing: no result within 1ms"))).toBe("timeout");
    expect(routingFailureOf({ kind: "error", exitCode: 1, stderr: "x" })).toBeNull();
    expect(routingFailureOf({ kind: "ok", stdout: "{}", stderr: "" })).toBeNull();
  });
});
