// Marked as .sandbox-unrunnable: exercises real cross-process fs.watch notification
// so a detached reader process receives appends from a separate writer process.

import { describe, expect, it } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLogSink, type PersistedRecord } from "./log-stream.ts";

describe("log-stream cross-process follow", () => {
  it("detached reader receives records appended by a separate writer process in seq order", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "log-stream-xproc-"));
    const storagePath = join(tempDir, "log-stream.jsonl");
    const childScriptPath = join(tempDir, "follow-child.ts");
    const runId = "run-xproc";

    // Seed initial events from the parent process.
    const sink = openLogSink(storagePath);
    sink.append(runId, { kind: "iteration_started", attemptId: "a1" });
    sink.append(runId, { kind: "iteration_started", attemptId: "a2" });
    sink.close();

    // Write the child script that runs follow on the shared storage path.
    const logStreamModule = join(import.meta.dir, "log-stream.ts");
    writeFileSync(
      childScriptPath,
      `import { openLogReader } from ${JSON.stringify(logStreamModule)};
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
const reader = openLogReader(process.argv[2]!);
for await (const record of reader.follow(process.argv[3]!, controller.signal)) {
  process.stdout.write(JSON.stringify(record) + "\\n");
}
`,
      "utf-8",
    );

    const child = spawn("bun", ["run", childScriptPath, storagePath, runId], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const records: PersistedRecord[] = [];
    let buf = "";
    const stdout = child.stdout;
    if (!stdout) throw new Error("child stdout not piped");

    stdout.setEncoding("utf-8");
    stdout.on("data", (chunk: string) => {
      buf += chunk;
      let idx = buf.indexOf("\n");
      while (idx >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line) {
          records.push(JSON.parse(line) as PersistedRecord);
        }
        idx = buf.indexOf("\n");
      }
    });

    const waitForCount = (n: number): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        if (records.length >= n) {
          resolve();
          return;
        }
        const onData = () => {
          if (records.length >= n) {
            stdout.off("data", onData);
            resolve();
          }
        };
        stdout.on("data", onData);
        child.on("exit", (code) => {
          if (records.length < n) {
            reject(new Error(`child exited early with code ${code}, got ${records.length} records`));
          }
        });
        child.on("error", reject);
      });

    try {
      // Wait for child to replay the 2 initial records.
      await waitForCount(2);

      // Append more events from the parent process (separate writer).
      const sink2 = openLogSink(storagePath);
      sink2.append(runId, { kind: "iteration_started", attemptId: "a3" });
      sink2.append(runId, { kind: "iteration_started", attemptId: "a4" });
      sink2.close();

      // Wait for child to receive all 4 records via cross-process wake.
      await waitForCount(4);

      expect(records.length).toBe(4);
      expect(records[0]?.seq).toBe(1);
      expect(records[1]?.seq).toBe(2);
      expect(records[2]?.seq).toBe(3);
      expect(records[3]?.seq).toBe(4);

      if (records[0]?.event.kind === "iteration_started") {
        expect(records[0].event.attemptId).toBe("a1");
      }
      if (records[3]?.event.kind === "iteration_started") {
        expect(records[3].event.attemptId).toBe("a4");
      }
    } finally {
      await killChild(child);
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);
});

async function killChild(child: ChildProcess): Promise<void> {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
