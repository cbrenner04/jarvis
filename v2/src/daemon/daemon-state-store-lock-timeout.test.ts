import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcHandler } from "../ipc/server.ts";
import { type LogSink, openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, STATE_STORE_BUSY_TIMEOUT_MS, type StateStore } from "../persistence/state-store.ts";
import { createRunControlHandlers, resetWriteLoopBindingSourceDepsForTests, setWriteLoopBindingSourceDepsForTests } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;
type RpcResult = Awaited<ReturnType<RpcHandler>>;

let stateStore: StateStore;
let logSink: LogSink;
let logsPath: string;
let dbPath: string;
let worktreePath = "";
let handlers: Handlers;

const LOCK_TIMEOUT_MACHINE_PROFILE = "lock-timeout-profile";

function installLockTimeoutMachineProfile(): void {
  const profileHome = mkdtempSync(join(tmpdir(), "jarvis-lock-timeout-profile-"));
  const machinesDir = join(profileHome, "machines");
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string, priceKey: string) => ({ rungs: [{ adapterModel, priceKey }] });
  const codexRoles = {
    plan: rung("plan", "plan"),
    implement: rung("M1", "P1"),
    shrink: rung("shrink", "shrink"),
    adversary: rung("adv", "adv"),
    critic: rung("crit", "crit"),
    advocate: rung("advoc", "advoc"),
    adjudicator: rung("adj", "adj"),
    actuator: rung("act", "act"),
  };
  writeFileSync(join(machinesDir, `${LOCK_TIMEOUT_MACHINE_PROFILE}.json`), JSON.stringify({ models: { codex: codexRoles } }));
  writeFileSync(
    join(profileHome, "config.json"),
    JSON.stringify({ machineProfile: LOCK_TIMEOUT_MACHINE_PROFILE, agents: ["codex"] }),
  );
  setWriteLoopBindingSourceDepsForTests({
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  });
}

function createHandlers(store: StateStore, logPath: string): Handlers {
  return createRunControlHandlers({
    stateStore: store,
    logReader: openLogReader(logPath),
    writeLoopExecutor: async () => undefined,
    failureReporter: () => undefined,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
}

async function expectResponse(frame: RpcResult): Promise<Record<string, unknown>> {
  expect(frame.kind).toBe("response");
  if (frame.kind !== "response") throw new Error("not a response");
  return frame.result as Record<string, unknown>;
}

beforeEach(() => {
  installLockTimeoutMachineProfile();
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  dbPath = join(tmpdir(), `jarvis-lock-timeout-state-${unique}.sqlite`);
  logsPath = join(tmpdir(), `jarvis-lock-timeout-logs-${unique}.jsonl`);
  stateStore = openStateStore(dbPath);
  logSink = openLogSink(logsPath);
  handlers = createHandlers(stateStore, logsPath);
});

afterEach(() => {
  resetWriteLoopBindingSourceDepsForTests();
  handlers.close();
  logSink.close();
  stateStore.close();
  rmSync(logsPath, { force: true });
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  if (worktreePath) {
    rmSync(worktreePath, { force: true, recursive: true });
    worktreePath = "";
  }
});

test("list and wait report state_store_lock_timeout after busy_timeout past a committed write boundary", async () => {
  worktreePath = mkdtempSync(join(tmpdir(), "jarvis-lock-timeout-wt-"));
  execSync("git init", { cwd: worktreePath, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', { cwd: worktreePath, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: worktreePath, stdio: "ignore" });
  writeFileSync(join(worktreePath, "artifact.txt"), "done\n");
  execSync("git add artifact.txt", { cwd: worktreePath, stdio: "ignore" });
  execSync('git commit -m "write step completion"', { cwd: worktreePath, stdio: "ignore" });
  const completionCommitSha = execSync("git rev-parse HEAD", { cwd: worktreePath, encoding: "utf8" }).trim();

  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath,
    branch: `lock-timeout-${crypto.randomUUID()}`,
    specPath: join(worktreePath, "spec.md"),
    stepId: "implement",
    workflowSnapshot: {
      invocationId: "inv-store-lock-timeout",
      steps: [
        {
          stepId: "implement",
          role: "implement",
          stepRules: "rules",
          expectedArtifactPath: join(worktreePath, "artifact"),
          agents: ["codex"],
          agentModelConfig: {
            codex: { implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } },
          },
        },
      ],
    },
  });
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "completed", outcomeKind: "done" });
  const boundaryCommittedEvent = {
    kind: "boundary_committed" as const,
    attemptId,
    outcomeKind: "done" as const,
    runStatus: "completed" as const,
  };
  logSink.append(runId, boundaryCommittedEvent);
  logSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: "complete",
    iterationsConsumed: 1,
    resumable: false,
  });
  handlers.close();
  logSink.close();
  stateStore.close();

  const holder = new Database(dbPath);
  holder.exec("PRAGMA journal_mode=WAL");
  holder.exec("PRAGMA busy_timeout=0");
  holder.prepare("BEGIN IMMEDIATE").run();

  let lockMessage = "";
  const contendedStore = openStateStore(dbPath);
  const start = Date.now();
  try {
    contendedStore.setRunStatus(runId, "failed");
  } catch (error) {
    lockMessage = error instanceof Error ? error.message : String(error);
  }
  const elapsed = Date.now() - start;
  contendedStore.close();
  holder.exec("COMMIT");
  holder.close();

  expect(lockMessage.toLowerCase()).toContain("database is locked");
  expect(elapsed).toBeGreaterThanOrEqual(STATE_STORE_BUSY_TIMEOUT_MS - 250);

  stateStore = openStateStore(dbPath);
  logSink = openLogSink(logsPath);
  handlers = createHandlers(stateStore, logsPath);
  logSink.append(runId, { kind: "run_execution_failed", message: lockMessage });

  const expectedError = {
    reason: "state_store_lock_timeout",
    retryable: true,
    nextAction: "resume",
  };

  const boundaryAfter = stateStore.loadRun(runId);
  expect(boundaryAfter?.status).toBe("completed");
  expect(boundaryAfter?.attempts.at(-1)?.outcomeKind).toBe("done");
  expect(execSync("git rev-parse HEAD", { cwd: worktreePath, encoding: "utf8" }).trim()).toBe(completionCommitSha);

  const logReader = openLogReader(logsPath);
  const boundaryLog = logReader.tail(runId).find((record) => record.event.kind === "boundary_committed");
  expect(boundaryLog?.event).toEqual(boundaryCommittedEvent);

  const list = await expectResponse(
    await handlers.list({ kind: "request", id: "list", method: "list" }, new AbortController().signal),
  );
  const row = (list.runs as Array<{ runId: string; error?: unknown }>).find((candidate) => candidate.runId === runId);
  expect(row?.error).toEqual(expectedError);

  expect(
    await expectResponse(
      await handlers.wait(
        { kind: "request", id: "wait", method: "wait", params: { runId } },
        new AbortController().signal,
      ),
    ),
  ).toMatchObject({
    runStatus: "completed",
    error: expectedError,
  });
}, 20_000);
