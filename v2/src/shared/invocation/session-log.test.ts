import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../tracked-temp-dir.test-support.ts";
import { openSessionLog } from "./session-log.ts";

let scratchDir: string;

beforeEach(() => {
  scratchDir = trackedMkdtempSync(join(tmpdir(), "jarvis-session-log-"));
});

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("session log writer", () => {
  test("creates the sessions dir and the namespaced log file under the UTC month shard", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const clock = () => new Date("2026-07-12T00:00:00.000Z");
    const log = openSessionLog("write", "2026-07-12T00-00-00Z", { sessionsDir, clock });
    log.append("harness", "hello");
    log.close();

    const content = readFileSync(join(sessionsDir, "2026-07", "write-2026-07-12T00-00-00Z.log"), "utf8");
    expect(content).toContain("[harness] hello");
    expect(readdirSync(sessionsDir).every((name) => !name.endsWith(".log"))).toBe(true);
  });

  test("log basename stays namespace-timestamp.log", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const clock = () => new Date("2026-01-02T03:04:05.000Z");
    const log = openSessionLog("write", "ts", { sessionsDir, clock });
    log.append("harness", "x");
    log.close();

    const shardDir = join(sessionsDir, "2026-01");
    expect(readdirSync(shardDir)).toEqual(["write-ts.log"]);
  });

  test("sequential opens with the same namespace, timestamp, and clock month append to one file", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const clock = () => new Date("2026-03-15T12:00:00.000Z");
    const opts = { sessionsDir, clock };
    const first = openSessionLog("write", "same", opts);
    first.append("harness", "first");
    first.close();
    const second = openSessionLog("write", "same", opts);
    second.append("harness", "second");
    second.close();

    const content = readFileSync(join(sessionsDir, "2026-03", "write-same.log"), "utf8");
    expect(content).toContain("first");
    expect(content).toContain("second");
    expect(readdirSync(join(sessionsDir, "2026-03")).filter((n) => n.endsWith(".log"))).toHaveLength(1);
  });

  test("stamps each line with the injected clock and tag, one line per source line", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const clock = () => new Date("2026-01-02T03:04:05.000Z");
    const log = openSessionLog("write", "ts", { sessionsDir, clock });
    log.append("outbound", "line one\nline two");
    log.close();

    const lines = readFileSync(join(sessionsDir, "2026-01", "write-ts.log"), "utf8")
      .trim()
      .split("\n");
    expect(lines).toEqual([
      "2026-01-02T03:04:05.000Z [outbound] line one",
      "2026-01-02T03:04:05.000Z [outbound] line two",
    ]);
  });

  test("is readable from another handle immediately after append returns", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const clock = () => new Date("2026-05-01T00:00:00.000Z");
    const log = openSessionLog("write", "readback", { sessionsDir, clock });
    log.append("harness", "line-a");

    const content = readFileSync(join(sessionsDir, "2026-05", "write-readback.log"), "utf8");
    expect(content).toContain("line-a");

    log.close();
  });

  test("drops appends after close and close is idempotent", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const clock = () => new Date("2026-05-01T00:00:00.000Z");
    const log = openSessionLog("write", "closed", { sessionsDir, clock });
    log.append("harness", "before-close");
    log.close();
    log.append("harness", "after-close");
    log.close();

    const content = readFileSync(join(sessionsDir, "2026-05", "write-closed.log"), "utf8");
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

  test("an unwritable month shard path yields a no-op writer", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const clock = () => new Date("2026-08-10T00:00:00.000Z");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "2026-08"), "not a directory");

    const log = openSessionLog("write", "shard-blocked", { sessionsDir, clock });
    expect(() => log.append("harness", "should not throw")).not.toThrow();
    expect(() => log.close()).not.toThrow();
  });

  test("creates sessions dir and month shard when neither exists at open time", () => {
    const sessionsDir = join(scratchDir, "sessions");
    const clock = () => new Date("2026-09-20T00:00:00.000Z");
    expect(existsSync(sessionsDir)).toBe(false);

    const log = openSessionLog("write", "fresh", { sessionsDir, clock });
    log.append("harness", "hello");
    log.close();

    expect(readFileSync(join(sessionsDir, "2026-09", "write-fresh.log"), "utf8")).toContain("hello");
  });

  test("shards by UTC month, not local month, under a non-UTC TZ", () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const sessionsDir = join(scratchDir, "sessions");
      const clock = () => new Date("2024-02-01T03:00:00.000Z");
      const log = openSessionLog("write", "tz", { sessionsDir, clock });
      log.append("harness", "hello");
      log.close();

      expect(existsSync(join(sessionsDir, "2024-02", "write-tz.log"))).toBe(true);
      expect(existsSync(join(sessionsDir, "2024-01"))).toBe(false);
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  test("without sessionsDir, writes under <JARVIS_HOME>/sessions/<YYYY-MM>/", () => {
    const previousJarvisHome = process.env.JARVIS_HOME;
    process.env.JARVIS_HOME = scratchDir;
    const clock = () => new Date("2026-11-01T00:00:00.000Z");
    try {
      const log = openSessionLog("write", "jarvis-home", { clock });
      log.append("harness", "hello");
      log.close();

      const content = readFileSync(join(scratchDir, "sessions", "2026-11", "write-jarvis-home.log"), "utf8");
      expect(content).toContain("[harness] hello");
    } finally {
      if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
      else process.env.JARVIS_HOME = previousJarvisHome;
    }
  });
});
