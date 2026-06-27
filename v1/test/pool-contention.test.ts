import { describe, expect, test } from "bun:test";
import type { Agent } from "../src/agents/types.ts";
import {
  detectClaudePoolContention,
  type ProcWithCmd,
  warnAboutPoolContentionIfDetected,
} from "../src/modes/patch/pool-contention.ts";

function fakeAgent(name: "claude" | "codex" | "cursor" | "opencode" | "aider"): Agent {
  return {
    name,
    run: async () => ({ kind: "ok" as const, stdout: "", stderr: "" }),
    attributionLabel: () => `fake-${name}`,
  };
}

describe("pool contention detection", () => {
  test("no contention for non-Claude agents", () => {
    const mockListProcesses = (): ProcWithCmd[] => [
      { pid: 100, ppid: 1, comm: "jarvis" },
      { pid: 101, ppid: 100, comm: "claude" },
    ];

    const codexAgent = fakeAgent("codex");
    const result = detectClaudePoolContention(codexAgent, { listProcessesFn: mockListProcesses });
    expect(result).toBe(false);
  });

  test("no contention for Claude agent when no other Claude processes", () => {
    const mockListProcesses = (): ProcWithCmd[] => [
      { pid: 100, ppid: 1, comm: "bash" },
      { pid: 101, ppid: 100, comm: "vim" },
    ];

    const claudeAgent = fakeAgent("claude");
    const result = detectClaudePoolContention(claudeAgent, { listProcessesFn: mockListProcesses });
    expect(result).toBe(false);
  });

  test("no contention when Claude process has no Jarvis ancestor", () => {
    const mockListProcesses = (): ProcWithCmd[] => [
      { pid: 100, ppid: 1, comm: "bash" },
      { pid: 101, ppid: 100, comm: "claude" },
    ];

    const claudeAgent = fakeAgent("claude");
    const result = detectClaudePoolContention(claudeAgent, { listProcessesFn: mockListProcesses });
    expect(result).toBe(false);
  });

  test("detects contention: Claude process with direct jarvis parent", () => {
    const mockListProcesses = (): ProcWithCmd[] => [
      { pid: 100, ppid: 1, comm: "jarvis" },
      { pid: 101, ppid: 100, comm: "claude" },
    ];

    const claudeAgent = fakeAgent("claude");
    const result = detectClaudePoolContention(claudeAgent, { listProcessesFn: mockListProcesses });
    expect(result).toBe(true);
  });

  test("detects contention: Claude process with indirect jarvis ancestor", () => {
    const mockListProcesses = (): ProcWithCmd[] => [
      { pid: 100, ppid: 1, comm: "jarvis" },
      { pid: 101, ppid: 100, comm: "node" },
      { pid: 102, ppid: 101, comm: "claude" },
    ];

    const claudeAgent = fakeAgent("claude");
    const result = detectClaudePoolContention(claudeAgent, { listProcessesFn: mockListProcesses });
    expect(result).toBe(true);
  });

  test("detects contention with jarvis1 binary name", () => {
    const mockListProcesses = (): ProcWithCmd[] => [
      { pid: 100, ppid: 1, comm: "jarvis1" },
      { pid: 101, ppid: 100, comm: "claude" },
    ];

    const claudeAgent = fakeAgent("claude");
    const result = detectClaudePoolContention(claudeAgent, { listProcessesFn: mockListProcesses });
    expect(result).toBe(true);
  });

  test("ignores non-matching process names similar to jarvis", () => {
    const mockListProcesses = (): ProcWithCmd[] => [
      { pid: 100, ppid: 1, comm: "not-jarvis" },
      { pid: 101, ppid: 100, comm: "claude" },
    ];

    const claudeAgent = fakeAgent("claude");
    const result = detectClaudePoolContention(claudeAgent, { listProcessesFn: mockListProcesses });
    expect(result).toBe(false);
  });

  test("silently handles empty process list", () => {
    const mockListProcesses = (): ProcWithCmd[] => [];

    const claudeAgent = fakeAgent("claude");
    const result = detectClaudePoolContention(claudeAgent, { listProcessesFn: mockListProcesses });
    expect(result).toBe(false);
  });

  test("silently handles process list fetch error", () => {
    const mockListProcesses = (): ProcWithCmd[] => {
      throw new Error("process list unavailable");
    };

    const claudeAgent = fakeAgent("claude");
    const result = detectClaudePoolContention(claudeAgent, { listProcessesFn: mockListProcesses });
    expect(result).toBe(false);
  });

  test("warnAboutPoolContentionIfDetected does not warn for non-Claude agent", () => {
    const loggedWarnings: string[] = [];
    const sendLog = (tag: string, text: string) => {
      if (tag === "harness") loggedWarnings.push(text);
    };
    warnAboutPoolContentionIfDetected(fakeAgent("codex"), sendLog);
    expect(loggedWarnings.length).toBe(0);
  });

  test("warnAboutPoolContentionIfDetected does not crash for Claude agent", () => {
    const sendLog = (tag: string, _text: string) => {
      if (tag === "harness") {
        /* no-op */
      }
    };
    // Uses real listProcessesWithCmd; just verifies it doesn't throw.
    expect(() => warnAboutPoolContentionIfDetected(fakeAgent("claude"), sendLog)).not.toThrow();
  });

  test("warnAboutPoolContentionIfDetected emits warning with contention detected", () => {
    const mockListProcesses = (): ProcWithCmd[] => [
      { pid: 100, ppid: 1, comm: "jarvis" },
      { pid: 101, ppid: 100, comm: "claude" },
    ];

    const loggedMessages: Array<{ tag: string; text: string }> = [];
    const sendLog = (tag: string, text: string) => {
      loggedMessages.push({ tag, text });
    };

    const claudeAgent = fakeAgent("claude");
    warnAboutPoolContentionIfDetected(claudeAgent, sendLog, { listProcessesFn: mockListProcesses });

    expect(loggedMessages.length).toBe(1);
    const warning = loggedMessages[0];
    expect(warning).toBeDefined();
    if (warning === undefined) {
      throw new Error("expected contention warning");
    }
    expect(warning.tag).toBe("harness");
    expect(warning.text).toContain("shares Claude pool");
    expect(warning.text).toContain("Pause the competing session");
  });
});
