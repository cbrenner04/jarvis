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
import { connectIpcClient } from "./client.ts";
import { type IpcServer, startIpcServer } from "./server.ts";
import { openLogReader, openLogSink, type PersistedRecord } from "../log-stream.ts";
import { openStateStore } from "../state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";

type StreamDataLine = { kind: "stream-data"; payload: string };

describe("ipc tail cross-process wake", () => {
  const socketTest = it.skipIf(!canUseUnixSockets());

  socketTest(
    "detached client receives stream-data frames in seq order when a separate writer appends",
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "ipc-tail-xproc-"));
      const storagePath = join(tempDir, "logs.jsonl");
      const stateDbPath = join(tempDir, "state.db");
      const socketPath = join(tempDir, "daemon.sock");
      const clientScriptPath = join(tempDir, "tail-client.ts");
      const writerScriptPath = join(tempDir, "log-writer.ts");

      const stateStore = openStateStore(stateDbPath);
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

      const logReader = openLogReader(storagePath);
      const tailHandler = createTailStreamHandler({ stateStore, logReader });
      let server: IpcServer | undefined;

      const clientModule = join(import.meta.dir, "client.ts");
      writeFileSync(
        clientScriptPath,
        `import { connectIpcClient } from ${JSON.stringify(clientModule)};
const client = await connectIpcClient(process.argv[2]!);
client.send({ kind: "stream-open", streamId: "tail", payload: { runId: process.argv[3]! } });
for (;;) {
  const frame = await client.nextFrame();
  if (frame.kind === "stream-end") break;
  if (frame.kind === "stream-data") {
    process.stdout.write(JSON.stringify({ kind: "stream-data", payload: frame.payload }) + "\\n");
  }
}
`,
        "utf-8",
      );

      const logStreamModule = join(import.meta.dir, "..", "log-stream.ts");
      writeFileSync(
        writerScriptPath,
        `import { openLogSink } from ${JSON.stringify(logStreamModule)};
const sink = openLogSink(process.argv[2]!);
sink.append(process.argv[3]!, { kind: "iteration_started", attemptId: process.argv[4]! });
sink.close();
`,
        "utf-8",
      );

      const frames: StreamDataLine[] = [];
      let buf = "";
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
            if (line) {
              frames.push(JSON.parse(line) as StreamDataLine);
            }
            idx = buf.indexOf("\n");
          }
        });

        const waitForCount = (n: number): Promise<void> =>
          new Promise<void>((resolve, reject) => {
            if (frames.length >= n) {
              resolve();
              return;
            }
            const onData = () => {
              if (frames.length >= n) {
                stdout.off("data", onData);
                resolve();
              }
            };
            stdout.on("data", onData);
            child?.on("exit", (code) => {
              if (frames.length < n) {
                reject(new Error(`client exited early with code ${code}, got ${frames.length} frames`));
              }
            });
            child?.on("error", reject);
          });

        await waitForCount(2);

        const writer1 = spawn("bun", ["run", writerScriptPath, storagePath, runId, "a3"], {
          stdio: "ignore",
        });
        await new Promise<void>((resolve, reject) => {
          writer1.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`writer1 exit ${code}`))));
          writer1.on("error", reject);
        });

        await waitForCount(3);

        const writer2 = spawn("bun", ["run", writerScriptPath, storagePath, runId, "a4"], {
          stdio: "ignore",
        });
        await new Promise<void>((resolve, reject) => {
          writer2.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`writer2 exit ${code}`))));
          writer2.on("error", reject);
        });

        await waitForCount(4);

        expect(frames.length).toBe(4);
        const records = frames.map((f) => JSON.parse(f.payload) as PersistedRecord);
        expect(records.map((r) => r.seq)).toEqual([1, 2, 3, 4]);

        if (records[2]?.event.kind === "iteration_started") {
          expect(records[2].event.attemptId).toBe("a3");
        }
        if (records[3]?.event.kind === "iteration_started") {
          expect(records[3].event.attemptId).toBe("a4");
        }
      } finally {
        if (child) {
          await killChild(child);
        }
        if (server) {
          await server.close();
        }
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
