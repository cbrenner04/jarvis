// Marked as .sandbox-unrunnable: exercises real cross-process fs.watch notification
// through factory-backed IPC tail (createTailStreamHandler → follow) with a detached
// client and separate writer process on shared log storage.

import { describe, expect, it } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTailStreamHandler } from "../daemon.ts";
import { openLogReader, openLogSink, type PersistedRecord } from "../log-stream.ts";
import { openStateStore } from "../state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { type IpcServer, startIpcServer } from "./server.ts";

describe("ipc tail cross-process wake", () => {
  const socketTest = it.skipIf(!canUseUnixSockets());

  socketTest(
    "detached client receives stream-data frames in seq order when a separate writer appends",
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "ipc-tail-xproc-"));
      const storagePath = join(tempDir, "logs.jsonl");
      const socketPath = join(tempDir, "daemon.sock");
      const clientScriptPath = join(tempDir, "tail-client.ts");
      const writerScriptPath = join(tempDir, "log-writer.ts");

      const stateStore = openStateStore(join(tempDir, "state.db"));
      const runId = stateStore.createRun({
        project: "test-project",
        specRef: "main",
        worktreePath: "/tmp/test-worktree",
        branch: "test-branch",
        specPath: "/tmp/test-project/spec.md",
      });

      const sink = openLogSink(storagePath);
      sink.append(runId, { kind: "iteration_started", attemptId: "a1" });
      sink.append(runId, { kind: "iteration_started", attemptId: "a2" });
      sink.close();

      const tailHandler = createTailStreamHandler({ stateStore, logReader: openLogReader(storagePath) });

      writeFileSync(
        clientScriptPath,
        `import { connectIpcClient } from ${JSON.stringify(join(import.meta.dir, "client.ts"))};
const client = await connectIpcClient(process.argv[2]!);
client.send({ kind: "stream-open", streamId: "tail", payload: { runId: process.argv[3]! } });
for (;;) {
  const frame = await client.nextFrame();
  if (frame.kind === "stream-end") break;
  if (frame.kind === "stream-data") process.stdout.write(frame.payload + "\\n");
}
`,
      );

      writeFileSync(
        writerScriptPath,
        `import { openLogSink } from ${JSON.stringify(join(import.meta.dir, "..", "log-stream.ts"))};
const sink = openLogSink(process.argv[2]!);
const runId = process.argv[3]!;
for (const attemptId of process.argv.slice(4)) {
  sink.append(runId, { kind: "iteration_started", attemptId });
}
sink.close();
`,
      );

      const records: PersistedRecord[] = [];
      let buf = "";
      let server: IpcServer | undefined;
      let child: ChildProcess | undefined;

      try {
        server = await startIpcServer(socketPath, undefined, tailHandler);
        child = spawn("bun", ["run", clientScriptPath, socketPath, runId], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout = child.stdout;
        if (!stdout) throw new Error("child stdout not piped");

        stdout.setEncoding("utf-8");
        stdout.on("data", (chunk: string) => {
          buf += chunk;
          let idx = buf.indexOf("\n");
          while (idx >= 0) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line) records.push(JSON.parse(line) as PersistedRecord);
            idx = buf.indexOf("\n");
          }
        });

        const waitForCount = (n: number): Promise<void> =>
          new Promise<void>((resolve, reject) => {
            if (records.length >= n) return resolve();
            const onData = () => {
              if (records.length >= n) {
                stdout.off("data", onData);
                resolve();
              }
            };
            stdout.on("data", onData);
            child?.on("exit", (code) => {
              if (records.length < n) {
                reject(new Error(`client exited with code ${code}, got ${records.length} records`));
              }
            });
            child?.on("error", reject);
          });

        await waitForCount(2);

        const writer = spawn("bun", ["run", writerScriptPath, storagePath, runId, "a3", "a4"], {
          stdio: "ignore",
        });
        const writerCode = await new Promise<number | null>((resolve, reject) => {
          writer.on("exit", resolve);
          writer.on("error", reject);
        });
        if (writerCode !== 0) throw new Error(`writer exit ${writerCode}`);

        await waitForCount(4);

        expect(records.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
        if (records[2]?.event.kind === "iteration_started") {
          expect(records[2].event.attemptId).toBe("a3");
        }
        if (records[3]?.event.kind === "iteration_started") {
          expect(records[3].event.attemptId).toBe("a4");
        }
      } finally {
        if (child) await killChild(child);
        if (server) await server.close();
        stateStore.close();
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    15_000,
  );
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
