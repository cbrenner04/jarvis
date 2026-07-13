import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSessionLog } from "./session-log.ts";

let scratchDir: string;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "jarvis-session-log-"));
});

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("session log writer", () => {
  test("creates the sessions dir and the namespaced log file", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const log = openSessionLog("write", "2026-07-12T00-00-00Z", { sessionsDir });
    log.append("harness", "hello");
    log.close();

    const content = readFileSync(join(sessionsDir, "write-2026-07-12T00-00-00Z.log"), "utf8");
    expect(content).toContain("[harness] hello");
  });

  test("stamps each line with the injected clock and tag, one line per source line", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const clock = () => new Date("2026-01-02T03:04:05.000Z");
    const log = openSessionLog("write", "ts", { sessionsDir, clock });
    log.append("outbound", "line one\nline two");
    log.close();

    const lines = readFileSync(join(sessionsDir, "write-ts.log"), "utf8").trim().split("\n");
    expect(lines).toEqual([
      "2026-01-02T03:04:05.000Z [outbound] line one",
      "2026-01-02T03:04:05.000Z [outbound] line two",
    ]);
  });

  test("is readable from another handle immediately after append returns", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const log = openSessionLog("write", "readback", { sessionsDir });
    log.append("harness", "line-a");

    const content = readFileSync(join(sessionsDir, "write-readback.log"), "utf8");
    expect(content).toContain("line-a");

    log.close();
  });

  test("drops appends after close and close is idempotent", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const log = openSessionLog("write", "closed", { sessionsDir });
    log.append("harness", "before-close");
    log.close();
    log.append("harness", "after-close");
    log.close();

    const content = readFileSync(join(sessionsDir, "write-closed.log"), "utf8");
    expect(content).toContain("before-close");
    expect(content).not.toContain("after-close");
  });

  test("an unwritable sessions dir yields a no-op writer", () => {
    const blockerPath = join(scratchDir, "blocker");
    writeFileSync(blockerPath, "not a directory");
    const sessionsDir = join(blockerPath, "sessions");

    const log = openSessionLog("write", "unwritable", { sessionsDir });
    expect(() => log.append("harness", "should not throw")).not.toThrow();
    expect(() => log.close()).not.toThrow();
  });
});
