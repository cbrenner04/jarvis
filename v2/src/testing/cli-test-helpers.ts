import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main as runtimeMain } from "../cli.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { WriteLoopResult } from "../execution/write-loop.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../execution/write-loop-input.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { withFixedUuid } from "./fixed-uuid.ts";

/** Shared fixtures for the CLI dispatch tests (`v2/src/cli.test.ts`, `v2/src/commands/*.test.ts`). */

export function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: (s: string) => {
        stderr += s;
      },
    },
    read: () => ({ stdout, stderr }),
  };
}

export const TEST_REVISION = "test-revision";
export const DOCS_MERGE_REVISION = "docs-merge-head";
export const TEST_EXECUTABLE_DIGEST = "test-executable-digest";
export const STALE_EXECUTABLE_DIGEST = "stale-executable-digest";

/** `runtimeMain` with fixed executable identity and a no-op matching-daemon lifecycle seam. */
export function cliMain(
  argv: readonly string[],
  io?: Parameters<typeof runtimeMain>[1],
  deps?: Parameters<typeof runtimeMain>[2],
): Promise<number> {
  return runtimeMain(argv, io, {
    getCurrentRevision: async () => TEST_REVISION,
    getExecutableDigest: async () => TEST_EXECUTABLE_DIGEST,
    startDaemon: async (socketPath) => ({ pid: 1, socketPath }),
    ...deps,
  });
}

/** Supplies the admission preflight used by run-control tests without changing their RPC fixtures. */
export function makeIpcClient(
  frames: unknown[],
  options?: {
    sent?: unknown[];
    loadedRevision?: string;
    loadedExecutableDigest?: string;
    recovery?: { pending: boolean; reconciled: number; resumed: number };
    statusCalls?: Array<{ params: unknown }>;
    statusResponses?: Array<{ loadedRevision: string; loadedExecutableDigest: string }>;
  },
): IpcClient {
  const queue = [...frames] as IpcFrame[];
  const sent = options?.sent ?? [];
  let waiter:
    | { resolve: (frame: Awaited<ReturnType<IpcClient["nextFrame"]>>) => void; reject: (error: Error) => void }
    | undefined;
  let closed = false;
  let drainFrames = false;
  const deliver = (frame: Awaited<ReturnType<IpcClient["nextFrame"]>>): void => {
    if (waiter !== undefined) {
      const pending = waiter;
      waiter = undefined;
      pending.resolve(frame);
      return;
    }
    queue.unshift(frame);
  };
  return {
    send(frame: unknown): void {
      const request = frame as { kind?: string; id?: string; method?: string };
      if (request.kind === "request" && request.method === "status" && typeof request.id === "string") {
        options?.statusCalls?.push({ params: (frame as { params?: unknown }).params });
        const loadedExecutableDigest = options?.loadedExecutableDigest ?? TEST_EXECUTABLE_DIGEST;
        const loadedRevision = options?.loadedRevision ?? TEST_REVISION;
        options?.statusResponses?.push({ loadedRevision, loadedExecutableDigest });
        deliver({
          kind: "response",
          id: request.id,
          result: {
            state: "running",
            loadedRevision,
            loadedExecutableDigest,
            ...(options?.recovery === undefined ? {} : { recovery: options.recovery }),
          },
        });
        return;
      }
      sent.push(frame);
      drainFrames ||= request.kind === "stream-open";
      const response = queue.shift();
      if (response !== undefined) deliver(response);
    },
    async nextFrame() {
      if (closed) throw new Error("connection closed");
      if (drainFrames) {
        const frame = queue.shift();
        if (frame === undefined) throw new Error("connection closed");
        return frame;
      }
      return await new Promise<Awaited<ReturnType<IpcClient["nextFrame"]>>>((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    close(): void {
      closed = true;
      waiter?.reject(new Error("connection closed"));
      waiter = undefined;
    },
  };
}

export function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-test-"));
  return {
    socketPath: join(dir, "daemon.sock"),
    pidPath: join(dir, "daemon.pid"),
  };
}

export function writeRawMachineConfig(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-machine-config-"));
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, text);
  return configPath;
}

export function writeMachineConfig(value: unknown): string {
  return writeRawMachineConfig(JSON.stringify(value));
}

export function absentMachineConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-machine-config-"));
  return join(dir, ".jarvis", "config.json");
}

const TEST_RUNG = { rungs: [{ adapterModel: "m1", priceKey: "p1" }] };

export function stubAgentModelConfig(agents: readonly string[]): AgentModelConfig {
  return Object.fromEntries(agents.map((agent) => [agent, { implement: TEST_RUNG }]));
}

export function completeResult(): WriteLoopResult {
  return {
    kind: "complete",
    runId: "run-123",
    iterationsConsumed: 1,
    resumable: false,
  };
}

export function workflowFrames(
  startRequestId: string,
  waitRequestId: string,
  runId: string,
  waitResult: unknown,
): unknown[] {
  return [
    { kind: "response", id: startRequestId, result: { runId } },
    { kind: "response", id: waitRequestId, result: waitResult },
  ];
}

/** `main()` consumes one UUID for its operator session before workflow `start` and `wait`. */
export const SESSION_UUID = "00000000-0000-4000-8000-0000000000ff";

/** Stubs the session/start/wait UUID sequence for a `run workflow` invocation. */
export function withWorkflowUuids<T>(startId: string, waitId: string, fn: () => Promise<T>): Promise<T> {
  return withFixedUuid([SESSION_UUID, startId, waitId], fn);
}

export const COMPLETED_WAIT_RESULT = {
  runStatus: "completed",
  loopOutcomeKind: "complete",
  iterationsConsumed: 1,
  resumable: false,
} as const;

export const COMPLETED_WAIT_JSON =
  '{"runStatus":"completed","loopOutcomeKind":"complete","iterationsConsumed":1,"resumable":false}';

export interface CliRepoFixture {
  repoRoot: string;
  repoSub: string;
  unregistered: string;
  writeArgs: readonly string[];
  runStartArgs: readonly string[];
  fakeImplementSteps: AnyWorkflowStep[];
  cleanup: () => void;
}

/** On-disk repo fixture shared by write/config/run/workflow command tests; call `cleanup()` in `afterAll`. */
export function makeCliRepoFixture(): CliRepoFixture {
  const tempDir = mkdtempSync(join(tmpdir(), "jarvis-cli-test-"));
  const repoRoot = join(tempDir, "repo");
  const repoSub = join(repoRoot, "sub");
  const repoV2Spec = join(repoRoot, "v2", "spec", "my-spec");
  const unregistered = join(tempDir, "unregistered");

  mkdirSync(repoSub, { recursive: true });
  mkdirSync(repoV2Spec, { recursive: true });
  mkdirSync(unregistered, { recursive: true });
  writeFileSync(join(repoSub, "index.md"), "# Index\n", "utf8");
  writeFileSync(join(repoRoot, "spec.md"), "# Spec\n", "utf8");
  writeFileSync(join(repoV2Spec, "index.md"), "# Index\n", "utf8");
  writeFileSync(join(unregistered, "index.md"), "# Index\n", "utf8");

  const workspaceArgs = [
    "--project-root",
    repoRoot,
    "--project",
    "demo",
    "--branch",
    "write-run",
    "--base",
    "HEAD",
    "--spec",
    "spec.md",
    "--artifact",
    "proof.txt",
  ];

  return {
    repoRoot,
    repoSub,
    unregistered,
    writeArgs: ["write", ...workspaceArgs],
    runStartArgs: ["run", "start", ...workspaceArgs],
    fakeImplementSteps: [
      {
        behavior: "write",
        stepId: "implement",
        role: "implement",
        promptId: "patch.prompt.body",
        stepRules: DEFAULT_WRITE_STEP_RULES,
        agents: ["claude"],
        agentModelConfig: {},
        worktree: {
          projectRoot: realpathSync(repoRoot),
          projectName: "demo",
          branchName: "implement-run",
          baseRef: "HEAD",
        },
        specPath: "spec.md",
        expectedArtifactPath: "proof.txt",
      },
    ],
    cleanup: () => {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
