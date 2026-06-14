import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLogRepository } from "../log-repository.ts";
import { openStateStore } from "../state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import type { WriteLoopInput, WriteLoopResult } from "../write-loop.ts";
import { callDaemon, isDaemonReachable, removeStaleSocket, tailDaemon } from "./client.ts";
import { daemonSocketPath } from "./paths.ts";
import { type DaemonResponse, encodeFrame, parseResponseLine } from "./protocol.ts";
import { createDaemonHost, type DaemonHost } from "./server.ts";

describe("daemon server", () => {
  const hosts: DaemonHost[] = [];

  afterEach(async () => {
    while (hosts.length > 0) {
      const host = hosts.pop();
      if (host) {
        host.logRepository.close();
        host.stateStore.close();
        await host.stop();
      }
    }
  });

  async function startHost(root: string, loop?: (input: WriteLoopInput) => Promise<WriteLoopResult>) {
    const socketPath = daemonSocketPath(root);
    const logRepository = openLogRepository(join(root, "state", "logs.sqlite"));
    const stateStore = openStateStore(join(root, "state", "v2.sqlite"));
    const host = createDaemonHost({
      socketPath,
      pid: 99,
      logRepository,
      stateStore,
      createBindings: () => simulatedBindings(["done"]),
      executeWriteLoop:
        loop ??
        (async (input) => {
          const store = input.stateStore;
          const run = store?.findRunByProjectBranch({
            project: input.worktree.projectName,
            branch: input.worktree.branchName,
          });
          const runId = run?.id ?? "missing";
          store?.setRunStatus(runId, "completed");
          return { kind: "complete", runId, iterationsConsumed: 1, resumable: false };
        }),
    });
    await host.start();
    hosts.push(host);
    return { host, socketPath, logRepository, stateStore };
  }

  test("status answers over the unix socket", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath } = await startHost(root);

    const response = await callDaemon({ id: "1", method: "status" }, { socketPath });
    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      pid: 99,
      socketPath,
      activeInvocationRunIds: [],
    });
  });

  test("stop exits and removes the socket", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { host, socketPath } = await startHost(root);

    const response = await callDaemon({ id: "1", method: "stop" }, { socketPath });
    expect(response.ok).toBe(true);
    await host.waitUntilStopped();
    hosts.pop();
    expect(existsSync(socketPath)).toBe(false);
  });

  test("second start against a live socket fails cleanly", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath } = await startHost(root);
    const second = createDaemonHost({
      socketPath,
      pid: 100,
      logRepository: openLogRepository(join(root, "state", "second.sqlite")),
    });
    await expect(second.start()).rejects.toThrow("daemon already running");
    second.logRepository.close();
  });

  test("stale socket is removed before bind", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const socketPath = daemonSocketPath(root);
    writeFileSync(socketPath, "");
    expect(await removeStaleSocket(socketPath)).toBe(true);
    const { host } = await startHost(root);
    expect(await isDaemonReachable(socketPath)).toBe(true);
    await host.stop();
    hosts.pop();
  });

  test("stop refuses active invocations and reports run IDs", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { host, socketPath } = await startHost(root);
    host.registerActiveInvocation("run-active");

    const response = await callDaemon({ id: "1", method: "stop" }, { socketPath });
    expect(response.ok).toBe(false);
    expect(response.error).toEqual({
      code: "active_invocations",
      message: "daemon has active invocations",
      data: { activeRunIds: ["run-active"] },
    });
    expect(await isDaemonReachable(socketPath)).toBe(true);
  });

  test("stop succeeds when no active invocations remain", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { host, socketPath } = await startHost(root);
    host.registerActiveInvocation("run-done");
    host.unregisterActiveInvocation("run-done");

    const response = await callDaemon({ id: "1", method: "stop" }, { socketPath });
    expect(response.ok).toBe(true);
    await host.waitUntilStopped();
    hosts.pop();
  });

  test("malformed JSON, unknown methods, and handler errors keep the daemon alive", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath } = await startHost(root);

    const malformed = await sendRaw(socketPath, "{");
    expect(malformed.ok).toBe(false);
    expect(malformed.error?.code).toBe("invalid_json");

    const unknown = await callDaemon({ id: "2", method: "nope" }, { socketPath });
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe("unknown_method");

    expect(await isDaemonReachable(socketPath)).toBe(true);
  });

  test("log.tail replays history then streams live records", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath, logRepository } = await startHost(root);
    logRepository.append({ runId: "run-a", level: "info", event: "one" });
    logRepository.append({ runId: "run-a", level: "info", event: "two" });

    const seen: string[] = [];
    const tail = tailDaemon(
      { runId: "run-a" },
      {
        socketPath,
        timeoutMs: 2_000,
        onRecord: (record) => {
          if (typeof record === "object" && record !== null && "event" in record) {
            seen.push(String(record.event));
          }
        },
      },
    );

    await waitFor(() => seen.length >= 2);
    logRepository.append({ runId: "run-a", level: "info", event: "three" });
    await waitFor(() => seen.includes("three"));
    tail.close();
    await tail.done;
    expect(seen).toEqual(["one", "two", "three"]);
  });

  test("log.tail accepts unknown run IDs and follows later appends", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath, logRepository } = await startHost(root);

    const seen: string[] = [];
    const tail = tailDaemon(
      { runId: "future-run" },
      {
        socketPath,
        timeoutMs: 2_000,
        onRecord: (record) => {
          if (typeof record === "object" && record !== null && "event" in record) {
            seen.push(String(record.event));
          }
        },
      },
    );

    await waitFor(() => seen.length === 0, 100);
    logRepository.append({ runId: "future-run", level: "info", event: "late" });
    await waitFor(() => seen.includes("late"));
    tail.close();
    expect(seen).toEqual(["late"]);
  });

  test("log.tail resumes from sequence without replaying earlier records", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath, logRepository } = await startHost(root);
    logRepository.append({ runId: "run-a", level: "info", event: "one" });
    logRepository.append({ runId: "run-a", level: "info", event: "two" });

    const seen: string[] = [];
    const tail = tailDaemon(
      { runId: "run-a", fromSeq: 1 },
      {
        socketPath,
        timeoutMs: 2_000,
        onRecord: (record) => {
          if (typeof record === "object" && record !== null && "event" in record) {
            seen.push(String(record.event));
          }
        },
      },
    );

    await waitFor(() => seen.includes("two"));
    logRepository.append({ runId: "run-a", level: "info", event: "three" });
    await waitFor(() => seen.includes("three"));
    tail.close();
    expect(seen).toEqual(["two", "three"]);
  });

  test("disconnect cleans up live tail subscribers without blocking append", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath, logRepository } = await startHost(root);

    const tail = tailDaemon(
      { runId: "run-a" },
      {
        socketPath,
        timeoutMs: 500,
        onRecord: () => {},
      },
    );
    tail.close();
    await tail.done;

    const record = logRepository.append({ runId: "run-a", level: "info", event: "after-disconnect" });
    expect(record.seq).toBe(1);
  });

  test("request/response works while log.tail is open on the same socket", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath, logRepository } = await startHost(root);
    logRepository.append({ runId: "run-a", level: "info", event: "seed" });

    const response = await multiplexStatusDuringTail(socketPath, "run-a");
    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      pid: 99,
      socketPath,
      activeInvocationRunIds: [],
    });
  });

  test("run.start returns immediately and run.list reports durable snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath } = await startHost(root);
    const params = {
      projectRoot: "/tmp/repo",
      project: "demo",
      branch: "ipc-run",
      base: "HEAD",
      spec: "spec.md",
      artifact: "proof.txt",
      agents: ["claude"],
    };

    const started = await callDaemon({ id: "start-1", method: "run.start", params }, { socketPath });
    expect(started.ok).toBe(true);
    expect(started.result).toEqual({ runId: expect.any(String) });

    const listed = await callDaemon({ id: "list-1", method: "run.list" }, { socketPath });
    expect(listed.ok).toBe(true);
    const result = listed.result as { runs: Array<{ id: string; active: boolean; status: string }> };
    expect(result.runs.some((run) => run.id === (started.result as { runId: string }).runId)).toBe(true);
  });

  test("run.start rejects conflicting project and branch ownership", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    let releaseLoop: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseLoop = resolve;
    });
    const { socketPath } = await startHost(root, async (input) => {
      await blocked;
      const store = input.stateStore;
      const run = store?.findRunByProjectBranch({
        project: input.worktree.projectName,
        branch: input.worktree.branchName,
      });
      const runId = run?.id ?? "missing";
      store?.setRunStatus(runId, "completed");
      return { kind: "complete", runId, iterationsConsumed: 1, resumable: false };
    });
    const params = {
      projectRoot: "/tmp/repo",
      project: "demo",
      branch: "conflict",
      base: "HEAD",
      spec: "spec.md",
      artifact: "proof.txt",
    };

    const first = await callDaemon({ id: "start-1", method: "run.start", params }, { socketPath });
    expect(first.ok).toBe(true);

    const second = await callDaemon({ id: "start-2", method: "run.start", params }, { socketPath });
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe("ownership_conflict");
    releaseLoop?.();
  });

  test("daemon startup rebuilds ownership from durable nonterminal runs", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const stateStore = openStateStore(join(root, "state", "v2.sqlite"));
    const runId = stateStore.createRun({
      project: "demo",
      specRef: "HEAD",
      worktreePath: "/tmp/wt",
      branch: "held",
      specPath: "spec.md",
    });
    stateStore.setRunStatus(runId, "budget-soft-stopped");
    stateStore.close();

    const { socketPath } = await startHost(root);
    const conflict = await callDaemon(
      {
        id: "start-1",
        method: "run.start",
        params: {
          projectRoot: "/tmp/repo",
          project: "demo",
          branch: "held",
          base: "HEAD",
          spec: "spec.md",
          artifact: "proof.txt",
        },
      },
      { socketPath },
    );
    expect(conflict.ok).toBe(false);
    expect(conflict.error?.code).toBe("ownership_conflict");
  });

  test("run.pause, run.resume, and run.kill accept steering params over IPC", async () => {
    let releaseIteration: (() => void) | undefined;
    let iterationGate = new Promise<void>((resolve) => {
      releaseIteration = resolve;
    });
    let loopCalls = 0;
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath } = await startHost(root, async (input) => {
      loopCalls += 1;
      await iterationGate;
      const store = input.stateStore;
      const run = store?.findRunByProjectBranch({
        project: input.worktree.projectName,
        branch: input.worktree.branchName,
      });
      const runId = run?.id ?? "missing";
      if (input.shouldPauseAtBoundary?.()) {
        store?.setRunStatus(runId, "paused", "paused-at-boundary");
        return { kind: "paused-at-boundary", runId, iterationsConsumed: 1, resumable: true };
      }
      if (input.signal?.aborted) {
        return { kind: "progress", runId, iterationsConsumed: 1, resumable: true };
      }
      store?.setRunStatus(runId, "completed");
      return { kind: "complete", runId, iterationsConsumed: 1, resumable: false };
    });
    const params = {
      projectRoot: "/tmp/repo",
      project: "demo",
      branch: "steer",
      base: "HEAD",
      spec: "spec.md",
      artifact: "proof.txt",
    };

    const started = await callDaemon({ id: "start-1", method: "run.start", params }, { socketPath });
    const runId = (started.result as { runId: string }).runId;
    await waitForActive(socketPath, runId);

    const pause = await callDaemon({ id: "pause-1", method: "run.pause", params: { runId } }, { socketPath });
    expect(pause.ok).toBe(true);
    expect(pause.result).toEqual({ accepted: true });
    releaseIteration?.();
    await waitForRunStatus(root, runId, "paused");

    iterationGate = new Promise<void>((resolve) => {
      releaseIteration = resolve;
    });
    const resume = await callDaemon({ id: "resume-1", method: "run.resume", params: { runId } }, { socketPath });
    expect(resume.ok).toBe(true);
    await waitForActive(socketPath, runId);
    releaseIteration?.();
    await waitForRunStatus(root, runId, "completed");
    expect(loopCalls).toBe(2);

    iterationGate = new Promise<void>((resolve) => {
      releaseIteration = resolve;
    });
    const startedForKill = await callDaemon(
      { id: "start-2", method: "run.start", params: { ...params, branch: "kill" } },
      { socketPath },
    );
    const killRunId = (startedForKill.result as { runId: string }).runId;
    await waitForActive(socketPath, killRunId);
    const kill = await callDaemon({ id: "kill-1", method: "run.kill", params: { runId: killRunId } }, { socketPath });
    expect(kill.ok).toBe(true);
    releaseIteration?.();
    await waitForRunStatus(root, killRunId, "killed");
  });

  test("steering methods reject invalid params and unknown methods", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath } = await startHost(root);

    const invalid = await callDaemon({ id: "pause-1", method: "run.pause", params: {} }, { socketPath });
    expect(invalid.ok).toBe(false);
    expect(invalid.error?.code).toBe("invalid_params");

    const unknown = await callDaemon({ id: "steer-1", method: "run.steer", params: { runId: "x" } }, { socketPath });
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe("unknown_method");
  });
});

async function sendRaw(socketPath: string, line: string): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      resolve(parseResponseLine(chunk.toString().trim()));
      socket.destroy();
    });
    socket.on("connect", () => socket.write(`${line}\n`));
  });
}

async function multiplexStatusDuringTail(socketPath: string, runId: string): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    const statusId = "status-while-tail";

    socket.on("error", reject);
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = parseResponseLine(line);
          if (response.id === statusId) {
            socket.destroy();
            resolve(response);
            return;
          }
        } catch {
          // Ignore stream frames.
        }
      }
    });

    socket.on("connect", () => {
      socket.write(encodeFrame({ id: "tail-1", method: "log.tail", params: { runId } }));
      socket.write(encodeFrame({ id: statusId, method: "status" }));
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForActive(socketPath: string, runId: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started <= 2_000) {
    const listed = await callDaemon({ id: `active-${runId}`, method: "run.list" }, { socketPath });
    const activeRunIds = (listed.result as { activeRunIds: string[] }).activeRunIds;
    if (activeRunIds.includes(runId)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("run did not become active before timeout");
}

async function waitForRunStatus(root: string, runId: string, status: string): Promise<void> {
  const stateStore = openStateStore(join(root, "state", "v2.sqlite"));
  try {
    await waitFor(() => stateStore.loadRun(runId)?.status === status, 2_000);
  } finally {
    stateStore.close();
  }
}
