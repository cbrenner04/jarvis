import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCost } from "../src/prices/cost.ts";
import type { Prices } from "../src/prices/load.ts";
import {
  listChangedCodexSessionFiles,
  parseCodexSessionUsage,
  resolveCodexSessionUsage,
  sessionContentHasInvocationMarker,
  sessionFileCwdsCompatible,
  snapshotCodexSessionFiles,
} from "../src/agents/codex-session.ts";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-codex-session-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("parseCodexSessionUsage", () => {
  test("parses usage from fixture with stable totals", () => {
    const result = parseCodexSessionUsage(join(import.meta.dir, "fixtures", "codex", "0.130.0-session.jsonl"));

    expect(result.usage).toEqual({
      input_tokens: 36475,
      output_tokens: 5101,
      cache_read_input_tokens: 606720,
      cache_creation_input_tokens: null,
    });
  });

  test("returns null with warning when file not found", () => {
    const result = parseCodexSessionUsage("/tmp/does-not-exist.jsonl");
    expect(result.usage).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("returns null with warning when file unreadable", () => {
    withTempDir((dir) => {
      const path = join(dir, "session.jsonl");
      writeFileSync(path, "{}\n");
      chmodSync(path, 0o000);
      const result = parseCodexSessionUsage(path);
      expect(result.usage).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  test("recovers from malformed lines and keeps valid usage", () => {
    withTempDir((dir) => {
      const path = join(dir, "session.jsonl");
      writeFileSync(
        path,
        [
          "{",
          JSON.stringify({
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  input_tokens: 100,
                  cached_input_tokens: 50,
                  output_tokens: 10,
                },
              },
            },
          }),
        ].join("\n"),
      );
      const result = parseCodexSessionUsage(path);
      expect(result.usage).toEqual({
        input_tokens: 50,
        output_tokens: 10,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: null,
      });
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  test("takes max/final running total across token_count events", () => {
    withTempDir((dir) => {
      const path = join(dir, "session.jsonl");
      writeFileSync(
        path,
        [
          JSON.stringify({
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  input_tokens: 10,
                  cached_input_tokens: 5,
                  output_tokens: 2,
                },
              },
            },
          }),
          JSON.stringify({
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  input_tokens: 20,
                  cached_input_tokens: 8,
                  output_tokens: 4,
                },
              },
            },
          }),
        ].join("\n"),
      );
      const result = parseCodexSessionUsage(path);
      expect(result.usage).toEqual({
        input_tokens: 12,
        output_tokens: 4,
        cache_read_input_tokens: 8,
        cache_creation_input_tokens: null,
      });
    });
  });
});

function tokenLine(usage: { input: number; out: number; cache: number }): string {
  return JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: usage.input,
          cached_input_tokens: usage.cache,
          output_tokens: usage.out,
        },
      },
    },
  });
}

function userMessageLine(text: string): string {
  return JSON.stringify({
    type: "event_msg",
    payload: { type: "user_message", message: text },
  });
}

describe("listChangedCodexSessionFiles", () => {
  test("lists a new file compared with an empty snapshot", () => {
    withTempDir((dir) => {
      const f = join(dir, "a.jsonl");
      writeFileSync(f, "\n");
      const before = snapshotCodexSessionFiles(dir);
      writeFileSync(join(dir, "b.jsonl"), "x\n");
      const changed = listChangedCodexSessionFiles({
        sessionsDir: dir,
        before,
      });
      expect(changed).toEqual([join(dir, "b.jsonl")]);
    });
  });

  test("lists an existing file when its size or mtime changes", () => {
    withTempDir((dir) => {
      const f = join(dir, "a.jsonl");
      writeFileSync(f, "v1\n");
      const before = snapshotCodexSessionFiles(dir);
      writeFileSync(f, "v1\nmore\n");
      const changed = listChangedCodexSessionFiles({
        sessionsDir: dir,
        before,
      });
      expect(changed).toEqual([f]);
    });
  });

  test("omits unchanged files", () => {
    withTempDir((dir) => {
      const f = join(dir, "a.jsonl");
      writeFileSync(f, "x\n");
      utimesSync(f, 1_000_000, 1_000_000);
      const before = snapshotCodexSessionFiles(dir);
      const changed = listChangedCodexSessionFiles({
        sessionsDir: dir,
        before,
      });
      expect(changed).toEqual([]);
    });
  });
});

describe("sessionContentHasInvocationMarker", () => {
  test("detects marker in structured user_message", () => {
    const m = "<!-- jarvis-codex-invocation: x -->";
    const content = [userMessageLine(`hello ${m}`), tokenLine({ input: 1, out: 1, cache: 0 })].join("\n");
    expect(sessionContentHasInvocationMarker(content, m)).toEqual({
      matched: true,
      usedRawFallback: false,
    });
  });

  test("uses whole-file substring fallback when structured fields omit it", () => {
    const m = "<!-- jarvis-codex-invocation: y -->";
    const weird = JSON.stringify({
      type: "event_msg",
      payload: { type: "custom", note: `prefix ${m} suffix` },
    });
    const content = [weird, tokenLine({ input: 1, out: 1, cache: 0 })].join("\n");
    const r = sessionContentHasInvocationMarker(content, m);
    expect(r.matched).toBe(true);
    expect(r.usedRawFallback).toBe(true);
  });
});

describe("sessionFileCwdsCompatible", () => {
  test("allows files with no cwd metadata", () => {
    const content = `${userMessageLine("hi")}\n${tokenLine({ input: 1, out: 0, cache: 0 })}`;
    expect(sessionFileCwdsCompatible(content, "/any/cwd")).toBe(true);
  });

  test("rejects when cwd metadata does not match jarvis cwd", () => {
    const meta = JSON.stringify({
      type: "session_meta",
      payload: { cwd: "/somewhere/else" },
    });
    const content = [meta, userMessageLine("hi"), tokenLine({ input: 1, out: 0, cache: 0 })].join("\n");
    expect(sessionFileCwdsCompatible(content, "/tmp/jarvis-project")).toBe(false);
  });
});

describe("resolveCodexSessionUsage", () => {
  test("returns no usage when no session files changed", () => {
    withTempDir((dir) => {
      const before = snapshotCodexSessionFiles(dir);
      const r = resolveCodexSessionUsage({
        sessionsDir: dir,
        beforeSnapshot: before,
        invocationMarker: "<!-- jarvis-codex-invocation: a -->",
        cwd: "/tmp/x",
      });
      expect(r.sessionFile).toBeNull();
      expect(r.usage).toBeNull();
      expect(r.warnings.some((w) => w.includes("no session JSONL changed"))).toBe(true);
    });
  });

  test("returns usage for a uniquely correlated changed file", () => {
    withTempDir((dir) => {
      const before = snapshotCodexSessionFiles(dir);
      const m = "<!-- jarvis-codex-invocation: only -->";
      const path = join(dir, "s.jsonl");
      writeFileSync(path, `${[userMessageLine(`task ${m}`), tokenLine({ input: 3, out: 1, cache: 0 })].join("\n")}\n`);
      const r = resolveCodexSessionUsage({
        sessionsDir: dir,
        beforeSnapshot: before,
        invocationMarker: m,
        cwd: dir,
      });
      expect(r.sessionFile).toBe(path);
      expect(r.usage).toEqual({
        input_tokens: 3,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: null,
      });
    });
  });

  test("ignores a concurrently changed file that lacks the invocation marker", () => {
    withTempDir((dir) => {
      const unrelated = join(dir, "other.jsonl");
      writeFileSync(
        unrelated,
        `${[userMessageLine("other session"), tokenLine({ input: 99, out: 99, cache: 0 })].join("\n")}\n`,
      );
      const before = snapshotCodexSessionFiles(dir);
      const m = "<!-- jarvis-codex-invocation: ours -->";
      const ours = join(dir, "ours.jsonl");
      writeFileSync(ours, `${[userMessageLine(`mine ${m}`), tokenLine({ input: 2, out: 0, cache: 0 })].join("\n")}\n`);
      const r = resolveCodexSessionUsage({
        sessionsDir: dir,
        beforeSnapshot: before,
        invocationMarker: m,
        cwd: dir,
      });
      expect(r.sessionFile).toBe(ours);
      expect(r.usage?.input_tokens).toBe(2);
    });
  });

  test("returns unavailable when multiple changed files correlate", () => {
    withTempDir((dir) => {
      const before = snapshotCodexSessionFiles(dir);
      const m = "<!-- jarvis-codex-invocation: dup -->";
      const a = join(dir, "a.jsonl");
      const b = join(dir, "b.jsonl");
      const body = `${[userMessageLine(`x ${m}`), tokenLine({ input: 1, out: 1, cache: 0 })].join("\n")}\n`;
      writeFileSync(a, body);
      writeFileSync(b, body);
      const r = resolveCodexSessionUsage({
        sessionsDir: dir,
        beforeSnapshot: before,
        invocationMarker: m,
        cwd: dir,
      });
      expect(r.sessionFile).toBeNull();
      expect(r.usage).toBeNull();
      expect(r.warnings.some((w) => w.includes("multiple session files matched"))).toBe(true);
      expect(r.warnings.some((w) => w.includes("multiple codex session files detected; using newest"))).toBe(false);
    });
  });

  test("returns unavailable when no changed file matches the marker", () => {
    withTempDir((dir) => {
      const before = snapshotCodexSessionFiles(dir);
      writeFileSync(
        join(dir, "s.jsonl"),
        `${[userMessageLine("no marker here"), tokenLine({ input: 1, out: 0, cache: 0 })].join("\n")}\n`,
      );
      const r = resolveCodexSessionUsage({
        sessionsDir: dir,
        beforeSnapshot: before,
        invocationMarker: "<!-- jarvis-codex-invocation: missing -->",
        cwd: dir,
      });
      expect(r.sessionFile).toBeNull();
      expect(r.warnings.some((w) => w.includes("no changed session file matched"))).toBe(true);
    });
  });
});

describe("codex usage and cost calculation", () => {
  test("codex cached input tokens do not double-bill at input rate", () => {
    const prices: Prices = {
      version: 1,
      models: {
        "gpt-5": {
          input_per_mtok: 1000,
          output_per_mtok: 2000,
          cache_read_per_mtok: 100,
          cache_write_per_mtok: 1000,
          source_url: "test",
          as_of: "2026-01-01",
        },
      },
    };

    const usage = {
      input_tokens: 3203,
      cache_read_input_tokens: 50048,
      output_tokens: 248,
      cache_creation_input_tokens: null,
    };

    const { cost_usd } = computeCost(usage, "gpt-5", prices);

    const expectedCost = (3203 * 1000 + 248 * 2000 + 50048 * 100) / 1_000_000;
    expect(cost_usd).toBeCloseTo(expectedCost, 10);
  });

  test("when cached > input (malformed), input is clamped to 0", () => {
    withTempDir((dir) => {
      const path = join(dir, "session.jsonl");
      writeFileSync(
        path,
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 150,
                output_tokens: 10,
              },
            },
          },
        }),
      );
      const result = parseCodexSessionUsage(path);
      expect(result.usage).toEqual({
        input_tokens: 0,
        output_tokens: 10,
        cache_read_input_tokens: 150,
        cache_creation_input_tokens: null,
      });
    });
  });
});
