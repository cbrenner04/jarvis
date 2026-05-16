import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findCodexSessionFile,
  findCodexSessionFilesSince,
  parseCodexSessionUsage,
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
  test("parses usage from fixture", () => {
    const result = parseCodexSessionUsage(
      join(import.meta.dir, "fixtures", "codex", "0.130.0-session.jsonl"),
    );

    expect(result.usage).toBeTruthy();
    expect(result.usage?.input_tokens).toBeGreaterThan(0);
    expect(result.usage?.output_tokens).toBeGreaterThan(0);
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
        input_tokens: 100,
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
        input_tokens: 20,
        output_tokens: 4,
        cache_read_input_tokens: 8,
        cache_creation_input_tokens: null,
      });
    });
  });
});

describe("findCodexSessionFile", () => {
  test("returns the new file when one new file exists", () => {
    withTempDir((dir) => {
      const oldFile = join(dir, "old.jsonl");
      const newFile = join(dir, "new.jsonl");
      writeFileSync(oldFile, "");
      writeFileSync(newFile, "");
      utimesSync(oldFile, 100, 100);
      utimesSync(newFile, 200, 200);

      const found = findCodexSessionFile({
        sessionsDir: dir,
        snapshotMtime: 150_000,
      });
      expect(found).toBe(newFile);
    });
  });

  test("returns newest when multiple new files exist", () => {
    withTempDir((dir) => {
      const fileA = join(dir, "a.jsonl");
      const fileB = join(dir, "b.jsonl");
      writeFileSync(fileA, "");
      writeFileSync(fileB, "");
      utimesSync(fileA, 200, 200);
      utimesSync(fileB, 300, 300);

      const found = findCodexSessionFile({
        sessionsDir: dir,
        snapshotMtime: 150_000,
      });
      expect(found).toBe(fileB);
      const all = findCodexSessionFilesSince({
        sessionsDir: dir,
        snapshotMtime: 150_000,
      });
      expect(all).toEqual([fileB, fileA]);
    });
  });

  test("returns null when no new files exist", () => {
    withTempDir((dir) => {
      const file = join(dir, "only.jsonl");
      writeFileSync(file, "");
      utimesSync(file, 100, 100);
      const found = findCodexSessionFile({
        sessionsDir: dir,
        snapshotMtime: 150_000,
      });
      expect(found).toBeNull();
    });
  });
});
