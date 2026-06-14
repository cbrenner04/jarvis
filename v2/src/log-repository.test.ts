import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAEMON_LOG_RUN_ID, type LogRepository, openLogRepository } from "./log-repository.ts";

const TEST_DB_PATH = join(tmpdir(), "jarvis-test-logs.sqlite");

describe("LogRepository", () => {
  let repository: LogRepository;

  beforeEach(() => {
    rmSync(TEST_DB_PATH, { force: true });
    repository = openLogRepository(TEST_DB_PATH);
  });

  afterEach(() => {
    repository.close();
    rmSync(TEST_DB_PATH, { force: true });
  });

  test("appends records with per-run monotonic sequence numbers", () => {
    const first = repository.append({ runId: "run-a", level: "info", event: "run.started", data: { x: 1 } });
    const second = repository.append({ runId: "run-a", level: "info", event: "run.step", data: null });
    const otherRun = repository.append({ runId: "run-b", level: "warn", event: "run.started" });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(otherRun.seq).toBe(1);
    expect(first.data).toEqual({ x: 1 });
    expect(second.data).toBeNull();
  });

  test("listRecords returns sequence-ordered history after an optional cursor", () => {
    repository.append({ runId: "run-a", level: "info", event: "one" });
    repository.append({ runId: "run-a", level: "info", event: "two" });
    repository.append({ runId: "run-a", level: "info", event: "three" });

    expect(repository.listRecords("run-a").map((record) => record.seq)).toEqual([1, 2, 3]);
    expect(repository.listRecords("run-a", 2).map((record) => record.event)).toEqual(["three"]);
    expect(repository.listRecords("missing")).toEqual([]);
  });

  test("follow delivers live appends for arbitrary run IDs", async () => {
    const seen: string[] = [];
    const handle = repository.follow("future-run", (record) => {
      seen.push(record.event);
    });

    repository.append({ runId: "future-run", level: "info", event: "late" });
    await waitFor(() => seen.length === 1);
    handle.close();
    expect(seen).toEqual(["late"]);
  });

  test("resume from sequence skips earlier replay and live duplicates", async () => {
    repository.append({ runId: "run-a", level: "info", event: "one" });
    repository.append({ runId: "run-a", level: "info", event: "two" });

    const replay = repository.listRecords("run-a", 1);
    expect(replay.map((record) => record.event)).toEqual(["two"]);

    const seen: string[] = [];
    const handle = repository.follow(
      "run-a",
      (record) => {
        seen.push(record.event);
      },
      { fromSeq: 1 },
    );

    repository.append({ runId: "run-a", level: "info", event: "three" });
    await waitFor(() => seen.length === 1);
    handle.close();
    expect(seen).toEqual(["three"]);
  });

  test("drops slow subscribers without blocking append", () => {
    let dropped = false;
    const handle = repository.follow(
      "run-a",
      (record) => {
        if (record.event === "one") {
          repository.append({ runId: "run-a", level: "info", event: "two" });
          repository.append({ runId: "run-a", level: "info", event: "three" });
        }
      },
      {
        maxBuffered: 1,
        onDropped: () => {
          dropped = true;
        },
      },
    );

    repository.append({ runId: "run-a", level: "info", event: "one" });
    expect(dropped).toBe(true);
    handle.close();

    const third = repository.append({ runId: "run-a", level: "info", event: "four" });
    expect(third.seq).toBe(4);
  });

  test("close removes followers", () => {
    const handle = repository.follow("run-a", () => {});
    handle.close();
    repository.append({ runId: "run-a", level: "info", event: "after-close" });
    expect(repository.listRecords("run-a")).toHaveLength(1);
  });

  test("daemon lifecycle run id is a normal key", () => {
    const record = repository.append({
      runId: DAEMON_LOG_RUN_ID,
      level: "info",
      event: "daemon.started",
      data: { pid: 1 },
    });
    expect(repository.listRecords(DAEMON_LOG_RUN_ID)[0]?.id).toBe(record.id);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
