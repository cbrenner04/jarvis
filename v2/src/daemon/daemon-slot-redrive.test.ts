import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireGateInvocationLease, type WriteLoopInput } from "../execution/write-loop.ts";
import { type LogEvent, openLogReader } from "../persistence/log-stream.ts";
import { openStateStore, type Run, type StateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk";
import { flushBackgroundRuns, mockWriteLoopInput } from "../testing/run-control.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import type { WriteLoopBindingSourceDeps } from "./daemon.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import {
  compareSlotRedriveOrder,
  createSlotRedriveCoordinator,
  MAX_SLOT_REDRIVES,
  slotRedriveWaiting,
} from "./daemon-slot-redrive.ts";

const GATE_COMMAND = "bun run test:v2";
const ME = "11111:1000000";
const OTHER = "22222:2000000";

let dbPath: string;
let logsDir: string;
let logsPath: string;
let profileHome: string;
let previousJarvisHome: string | undefined;
let bindingDeps: WriteLoopBindingSourceDeps;
let store: StateStore;
const leases: Array<{ release: () => void }> = [];

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-slot-redrive-${process.pid}-${Date.now()}-${Math.random()}.db`);
  logsDir = mkdtempSync(join(tmpdir(), "jarvis-slot-redrive-logs-"));
  logsPath = join(logsDir, "run-log.jsonl");
  store = openStateStore(dbPath, { currentIdentity: ME, isOwnerAlive: async () => true });
  profileHome = mkdtempSync(join(tmpdir(), "jarvis-slot-redrive-profile-"));
  previousJarvisHome = process.env.JARVIS_HOME;
  const machinesDir = join(profileHome, "machines");
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string) => ({ rungs: [{ adapterModel, priceKey: adapterModel }] });
  writeFileSync(
    join(machinesDir, "slot-redrive.json"),
    JSON.stringify({
      models: {
        claude: {
          plan: rung("plan"),
          implement: rung("M1"),
          shrink: rung("S1"),
          adversary: rung("adv"),
          critic: rung("crit"),
          advocate: rung("advoc"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
        },
      },
    }),
  );
  writeFileSync(
    join(profileHome, "config.json"),
    JSON.stringify({ machineProfile: "slot-redrive", agents: ["claude"] }),
  );
  process.env.JARVIS_HOME = profileHome;
  bindingDeps = { machineConfigPath: join(profileHome, "config.json"), machinesDir };
});

afterEach(async () => {
  for (const lease of leases.splice(0)) lease.release();
  await flushBackgroundRuns(2);
  try {
    store.close();
  } catch {
    // already closed
  }
  removeOrchestrationStore(dbPath);
  rmSync(logsDir, { recursive: true, force: true });
  rmSync(profileHome, { recursive: true, force: true });
  if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
  else process.env.JARVIS_HOME = previousJarvisHome;
});

function holdGate(): { release: () => void } {
  const lease = acquireGateInvocationLease();
  if (lease === undefined) throw new Error("gate lease unexpectedly unavailable");
  leases.push(lease);
  return lease;
}

const tick = (): Promise<void> => flushBackgroundRuns(3);

function eventsOf(runId: string): LogEvent[] {
  return openLogReader(logsPath)
    .tail(runId)
    .map((record) => record.event);
}

function eventKinds(runId: string): string[] {
  return eventsOf(runId).map((event) => event.kind);
}

/** Settles `runId` the way the write loop's gate refusal does, preserving the row's existing count. */
function refuseGate(runId: string, cause: "slot_contention" | "ceiling_headroom" = "slot_contention", count?: number) {
  const slotRedriveCount = count ?? store.loadRun(runId)?.gateRefusalRecoveryState?.slotRedriveCount ?? 0;
  const attemptId = store.recordAttemptStart(runId);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "gate_invocation_refused",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: { cause, gateCommand: GATE_COMMAND, slotRedriveCount },
  });
}

function snapshotFor(invocationId: string) {
  return {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "implement rules",
        expectedArtifactPath: "/tmp/artifact",
        agents: ["claude"],
        agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
      },
    ],
  };
}

function bareInput(branch: string): WriteLoopInput {
  return {
    ...mockWriteLoopInput({ branchName: branch, projectName: "redrive" }),
    stepId: "implement",
    workflowSnapshot: snapshotFor(`inv-${branch}`),
  };
}

/** A durable, resumable bare implement row that already settled a gate refusal. */
function seedRefusedRun(
  branch: string,
  options: {
    cause?: "slot_contention" | "ceiling_headroom";
    count?: number;
    via?: StateStore;
    worktreePath?: string;
    snapshot?: ReturnType<typeof snapshotFor>;
  } = {},
): string {
  const target = options.via ?? store;
  const runId = target.createRun({
    project: "redrive",
    specRef: "main",
    worktreePath: options.worktreePath ?? `/tmp/redrive-${branch}`,
    branch,
    specPath: "/tmp/redrive-spec.md",
    stepId: "implement",
    workflowSnapshot: options.snapshot ?? snapshotFor(`inv-${branch}`),
    queuedInput: bareInput(branch),
  });
  const attemptId = target.recordAttemptStart(runId);
  target.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "gate_invocation_refused",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: {
      cause: options.cause ?? "slot_contention",
      gateCommand: GATE_COMMAND,
      slotRedriveCount: options.count ?? 0,
    },
  });
  return runId;
}

type ResumeCall = { runId: string };

/** Coordinator over the shared store with a recording resume that leaves the row untouched. */
function recordingCoordinator(
  options: {
    resumeResult?: { kind: "error"; code: string; message: string };
    resumeThrows?: boolean;
    predecessorOwns?: boolean;
  } = {},
) {
  const calls: ResumeCall[] = [];
  const coordinator = createSlotRedriveCoordinator({
    store,
    logsPath,
    isRetiring: () => false,
    ...(options.predecessorOwns !== undefined ? { predecessorOwns: async () => options.predecessorOwns === true } : {}),
  });
  coordinator.bindResume((runId) => {
    calls.push({ runId });
    if (options.resumeThrows === true) throw new Error("resume blew up");
    return options.resumeResult ?? { kind: "response", result: { ok: true } };
  });
  return { coordinator, calls };
}

/** Real lifecycle handlers whose executor plays the write loop: run 1..n settle a gate refusal via `onRun`. */
function daemonHarness(
  onRun: (input: WriteLoopInput, runId: string, call: number) => void,
  resolvePredecessorOwner?: (runId: string) => Promise<boolean>,
) {
  const runs: string[] = [];
  const ctx = createRunControlHandlerContext({
    stateStore: store,
    logsPath,
    logReader: openLogReader(logsPath),
    writeLoopExecutor: async (input) => {
      const run = store.listRuns().find((candidate) => candidate.branch === input.worktree.branchName);
      if (run === undefined) throw new Error("executor ran without a run row");
      runs.push(run.id);
      onRun(input, run.id, runs.length);
    },
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    writeLoopBindingSourceDeps: bindingDeps,
    ...(resolvePredecessorOwner !== undefined ? { resolvePredecessorOwner } : {}),
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
  });
  const start = (branch: string) =>
    handlers.start(
      { kind: "request", id: `s-${branch}`, method: "start", params: { input: bareInput(branch) } },
      new AbortController().signal,
    );
  return { ctx, handlers, runs, start };
}

test("a slot-refused lane settled while the gate is held is re-driven through resume once the holder releases", async () => {
  const holder = holdGate();
  const { runs, start } = daemonHarness((_input, runId, call) => {
    if (call === 1) refuseGate(runId);
  });

  const started = await start("write-path");
  expect(started.kind).toBe("response");
  await tick();
  expect(runs).toHaveLength(1);
  const runId = runs[0] as string;
  expect(store.loadRun(runId)).toMatchObject({ status: "failed", terminalCause: "gate_invocation_refused" });

  holder.release();
  await tick();

  expect(runs).toEqual([runId, runId]);
  expect(store.loadRun(runId)?.status).toBe("in-progress");
  expect(store.loadRun(runId)?.gateRefusalRecoveryState).toMatchObject({ slotRedriveCount: 1 });
  expect(eventsOf(runId).filter((event) => event.kind === "slot_redrive")).toEqual([
    { kind: "slot_redrive", slotRedriveCount: 1, bound: MAX_SLOT_REDRIVES },
  ]);
});

test("the daemon context wires the predecessor-owner probe into the coordinator, so a draining predecessor's lane is not re-driven", async () => {
  const holder = holdGate();
  const { runs, start } = daemonHarness(
    (_input, runId, call) => {
      if (call === 1) refuseGate(runId);
    },
    async () => true,
  );

  await start("context-predecessor-owns");
  await tick();
  const runId = runs[0] as string;
  holder.release();
  await tick();

  expect(runs).toEqual([runId]);
  expect(store.loadRun(runId)?.gateRefusalRecoveryState).toMatchObject({ slotRedriveCount: 0 });
  expect(eventKinds(runId)).toEqual(["slot_redrive_skipped_owner"]);
});

test("a lease released between the refusal settling and the enqueue still re-drives the lane", async () => {
  const holder = holdGate();
  const { runs, start } = daemonHarness((_input, runId, call) => {
    if (call !== 1) return;
    refuseGate(runId);
    holder.release();
  });

  await start("release-before-enqueue");
  await tick();

  expect(runs).toHaveLength(2);
  expect(runs[1]).toBe(runs[0] as string);
});

test("a freed slot taken by another lane before dispatch keeps the entry waiting with its count unchanged", async () => {
  const runId = seedRefusedRun("slot-taken");
  const holder = holdGate();
  const { coordinator, calls } = recordingCoordinator();
  coordinator.enqueue(runId);
  await tick();
  expect(calls).toHaveLength(0);

  holder.release();
  const taker = holdGate();
  await tick();
  expect(calls).toHaveLength(0);
  expect(store.loadRun(runId)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(0);

  taker.release();
  await tick();
  expect(calls).toEqual([{ runId }]);
  expect(store.loadRun(runId)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(1);
  coordinator.stop();
});

const operatorActions: Array<{ name: string; act: (runId: string) => void }> = [
  { name: "pause", act: (runId) => store.setRunStatus(runId, "paused") },
  { name: "kill", act: (runId) => store.setRunStatus(runId, "killed") },
  { name: "dismiss", act: (runId) => void store.dismissRun(runId) },
  { name: "manual resume", act: (runId) => void store.admitRunForResume(runId) },
];

for (const { name, act } of operatorActions) {
  test(`a waiting lane the operator handled by ${name} is dropped and never resumed`, async () => {
    const runId = seedRefusedRun(`operator-${name.replace(" ", "-")}`);
    const holder = holdGate();
    const { coordinator, calls } = recordingCoordinator();
    coordinator.enqueue(runId);
    act(runId);
    await tick();

    holder.release();
    await tick();
    const second = holdGate();
    second.release();
    await tick();

    expect(calls).toHaveLength(0);
    expect(eventKinds(runId)).not.toContain("slot_redrive");
    coordinator.stop();
  });
}

test("an admission rejection is logged as slot_redrive_refused, consumes the count, drops the entry, and leaves the row resumable", async () => {
  const runId = seedRefusedRun("admission-refused");
  const holder = holdGate();
  const { coordinator, calls } = recordingCoordinator({
    resumeResult: { kind: "error", code: "claim_lost", message: "lost" },
  });
  coordinator.enqueue(runId);
  holder.release();
  await tick();
  const again = holdGate();
  again.release();
  await tick();

  expect(calls).toHaveLength(1);
  expect(eventsOf(runId).filter((event) => event.kind === "slot_redrive_refused")).toEqual([
    { kind: "slot_redrive_refused", code: "claim_lost", slotRedriveCount: 1 },
  ]);
  expect(store.loadRun(runId)).toMatchObject({
    status: "failed",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: { cause: "slot_contention", slotRedriveCount: 1 },
  });
  coordinator.stop();
});

test("a thrown resume is logged as slot_redrive_refused with an exception code, consumes the count, drops the entry, and leaves the row resumable", async () => {
  const runId = seedRefusedRun("resume-throws");
  const holder = holdGate();
  const { coordinator, calls } = recordingCoordinator({ resumeThrows: true });
  coordinator.enqueue(runId);
  holder.release();
  await tick();
  const again = holdGate();
  again.release();
  await tick();

  expect(calls).toHaveLength(1);
  expect(eventsOf(runId).filter((event) => event.kind === "slot_redrive_refused")).toEqual([
    { kind: "slot_redrive_refused", code: "exception", slotRedriveCount: 1 },
  ]);
  expect(eventKinds(runId)).not.toContain("slot_redrive_exhausted");
  expect(store.loadRun(runId)).toMatchObject({
    status: "failed",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: { cause: "slot_contention", slotRedriveCount: 1 },
  });
  coordinator.stop();
});

for (const [name, options] of [
  ["rejected", { resumeResult: { kind: "error", code: "claim_lost", message: "lost" } }],
  ["thrown", { resumeThrows: true }],
] as const) {
  test(`a ${name} re-drive that reaches the bound also logs one slot_redrive_exhausted`, async () => {
    const runId = seedRefusedRun(`bound-${name}`, { count: MAX_SLOT_REDRIVES - 1 });
    const holder = holdGate();
    const { coordinator, calls } = recordingCoordinator(options);
    coordinator.enqueue(runId);
    holder.release();
    await tick();

    expect(calls).toHaveLength(1);
    expect(eventsOf(runId).filter((event) => event.kind === "slot_redrive_exhausted")).toEqual([
      { kind: "slot_redrive_exhausted", slotRedriveCount: MAX_SLOT_REDRIVES, bound: MAX_SLOT_REDRIVES },
    ]);
    expect(eventsOf(runId).filter((event) => event.kind === "slot_redrive_refused")).toHaveLength(1);
    coordinator.stop();
  });
}

test("a waiting lane owned by a different live process is skipped without resume or count, and logged", async () => {
  const otherStore = openStateStore(dbPath, { currentIdentity: OTHER, isOwnerAlive: async () => true });
  try {
    const runId = seedRefusedRun("foreign-owner", { via: otherStore });
    const holder = holdGate();
    const { coordinator, calls } = recordingCoordinator();
    coordinator.enqueue(runId);
    holder.release();
    await tick();

    expect(calls).toHaveLength(0);
    expect(store.loadRun(runId)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(0);
    expect(eventKinds(runId)).toEqual(["slot_redrive_skipped_owner"]);
    coordinator.stop();
  } finally {
    otherStore.close();
  }
});

test("a waiting lane held by a reachable draining predecessor is skipped without resume or count, and logged", async () => {
  const runId = seedRefusedRun("draining-predecessor");
  const holder = holdGate();
  const { coordinator, calls } = recordingCoordinator({ predecessorOwns: true });
  coordinator.enqueue(runId);
  holder.release();
  await tick();

  expect(calls).toHaveLength(0);
  expect(store.loadRun(runId)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(0);
  expect(eventKinds(runId)).toEqual(["slot_redrive_skipped_owner"]);
  coordinator.stop();
});

test("each re-drive persists exactly one more count and a lane at the bound is never dispatched", async () => {
  const runId = seedRefusedRun("count-and-bound", { count: MAX_SLOT_REDRIVES - 1 });
  const atBound = seedRefusedRun("at-bound", { count: MAX_SLOT_REDRIVES });
  const { coordinator, calls } = recordingCoordinator();
  coordinator.enqueue(atBound);
  coordinator.enqueue(runId);
  await tick();

  expect(calls).toEqual([{ runId }]);
  expect(store.loadRun(runId)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(MAX_SLOT_REDRIVES);
  expect(store.loadRun(atBound)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(MAX_SLOT_REDRIVES);
  expect(eventKinds(atBound)).toEqual(["slot_redrive_exhausted"]);
  coordinator.stop();
});

test("one release re-drives only the oldest waiting lane by finishedAt", async () => {
  const older = seedRefusedRun("older");
  await Bun.sleep(5);
  const newer = seedRefusedRun("newer");
  const holder = holdGate();
  const { coordinator, calls } = recordingCoordinator();
  coordinator.enqueue(newer);
  coordinator.enqueue(older);
  holder.release();
  await tick();

  expect(calls).toEqual([{ runId: older }]);
  const next = holdGate();
  next.release();
  await tick();
  expect(calls).toEqual([{ runId: older }, { runId: newer }]);
  coordinator.stop();
});

test("a ceiling_headroom refusal is never auto-re-driven and stays failed and resumable", async () => {
  const runId = seedRefusedRun("headroom", { cause: "ceiling_headroom" });
  const holder = holdGate();
  const { coordinator, calls } = recordingCoordinator();
  coordinator.enqueue(runId);
  holder.release();
  await tick();

  expect(calls).toHaveLength(0);
  expect(eventKinds(runId)).toEqual([]);
  expect(store.loadRun(runId)).toMatchObject({
    status: "failed",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: { cause: "ceiling_headroom" },
  });
  coordinator.stop();
});

test("exhausting the bound settles the lane failed with slot_redrive_exhausted and a slot_redrive event per attempt", async () => {
  const { runs, start } = daemonHarness((_input, runId, call) => {
    // A gate pass between attempts must not reset the durable count.
    if (call === 3)
      store.commitCompletionBoundary({
        attemptId: store.recordAttemptStart(runId),
        runStatus: "in-progress",
        outcomeKind: "progress",
      });
    refuseGate(runId);
  });

  await start("exhaust");
  await tick();
  await tick();

  const runId = runs[0] as string;
  expect(runs).toHaveLength(MAX_SLOT_REDRIVES + 1);
  expect(store.loadRun(runId)).toMatchObject({
    status: "failed",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: { cause: "slot_contention", slotRedriveCount: MAX_SLOT_REDRIVES },
  });
  const events = eventsOf(runId);
  expect(events.filter((event) => event.kind === "slot_redrive")).toEqual(
    Array.from({ length: MAX_SLOT_REDRIVES }, (_, index) => ({
      kind: "slot_redrive",
      slotRedriveCount: index + 1,
      bound: MAX_SLOT_REDRIVES,
    })),
  );
  expect(events.filter((event) => event.kind === "slot_redrive_exhausted")).toEqual([
    { kind: "slot_redrive_exhausted", slotRedriveCount: MAX_SLOT_REDRIVES, bound: MAX_SLOT_REDRIVES },
  ]);
});

test("a row dismissed while the owner probe is in flight is dropped before any count", async () => {
  const runId = seedRefusedRun("dismissed-mid-probe");
  const calls: string[] = [];
  const coordinator = createSlotRedriveCoordinator({
    store,
    logsPath,
    isRetiring: () => false,
    predecessorOwns: async () => {
      store.dismissRun(runId);
      return false;
    },
  });
  coordinator.bindResume((id) => {
    calls.push(id);
    return { kind: "response", result: { ok: true } };
  });
  coordinator.enqueue(runId);
  await tick();

  expect(calls).toHaveLength(0);
  expect(store.loadRun(runId)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(0);
  coordinator.stop();
});

test("a slot taken while the owner probe is in flight keeps the entry waiting without a count", async () => {
  const runId = seedRefusedRun("slot-taken-mid-probe");
  const calls: string[] = [];
  let taker: { release: () => void } | undefined;
  const coordinator = createSlotRedriveCoordinator({
    store,
    logsPath,
    isRetiring: () => false,
    predecessorOwns: async () => {
      taker ??= holdGate();
      return false;
    },
  });
  coordinator.bindResume((id) => {
    calls.push(id);
    return { kind: "response", result: { ok: true } };
  });
  coordinator.enqueue(runId);
  await tick();

  expect(calls).toHaveLength(0);
  expect(store.loadRun(runId)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(0);
  taker?.release();
  await tick();
  expect(calls).toEqual([runId]);
  coordinator.stop();
});

test("a release arriving while a dispatch is in flight re-runs the drain for the next lane", async () => {
  const first = seedRefusedRun("in-flight-first");
  await Bun.sleep(5);
  const second = seedRefusedRun("in-flight-second");
  const holder = holdGate();
  const calls: string[] = [];
  let finishFirst: (() => void) | undefined;
  const coordinator = createSlotRedriveCoordinator({ store, logsPath, isRetiring: () => false });
  coordinator.bindResume((id) => {
    calls.push(id);
    if (id !== first) return { kind: "response", result: { ok: true } };
    return new Promise((resolve) => {
      finishFirst = () => resolve({ kind: "response", result: { ok: true } });
    });
  });
  coordinator.enqueue(first);
  coordinator.enqueue(second);
  holder.release();
  await tick();
  expect(calls).toEqual([first]);

  holdGate().release();
  await tick();
  expect(calls).toEqual([first]);

  finishFirst?.();
  await tick();
  expect(calls).toEqual([first, second]);
  coordinator.stop();
});

test("a retiring daemon keeps waiting lanes without consuming a count", async () => {
  const runId = seedRefusedRun("retiring");
  const calls: string[] = [];
  const coordinator = createSlotRedriveCoordinator({ store, logsPath, isRetiring: () => true });
  coordinator.bindResume((id) => {
    calls.push(id);
    return { kind: "response", result: { ok: true } };
  });
  coordinator.enqueue(runId);
  await tick();

  expect(calls).toHaveLength(0);
  expect(store.loadRun(runId)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(0);
  coordinator.stop();
});

test("slotRedriveWaiting accepts only failed, undismissed slot-contention refusals", () => {
  const base = {
    status: "failed",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: { cause: "slot_contention" },
    dismissedAt: null,
  } as unknown as Run;
  expect(slotRedriveWaiting(base)).toBe(true);
  expect(slotRedriveWaiting({ ...base, status: "in-progress" })).toBe(false);
  expect(slotRedriveWaiting({ ...base, terminalCause: "blocked" } as unknown as Run)).toBe(false);
  expect(
    slotRedriveWaiting({ ...base, gateRefusalRecoveryState: { cause: "ceiling_headroom" } } as unknown as Run),
  ).toBe(false);
  expect(slotRedriveWaiting({ ...base, gateRefusalRecoveryState: null })).toBe(false);
  expect(slotRedriveWaiting({ ...base, dismissedAt: 5 })).toBe(false);
  expect(slotRedriveWaiting(null)).toBe(false);
});

test("compareSlotRedriveOrder sorts by finishedAt then run id", () => {
  const run = (id: string, finishedAt: number | null) => ({ id, finishedAt }) as unknown as Run;
  expect(compareSlotRedriveOrder(run("b", 1), run("a", 2))).toBeLessThan(0);
  expect(compareSlotRedriveOrder(run("a", 2), run("b", 1))).toBeGreaterThan(0);
  expect(compareSlotRedriveOrder(run("a", 1), run("b", 1))).toBeLessThan(0);
  expect(compareSlotRedriveOrder(run("b", 1), run("a", 1))).toBeGreaterThan(0);
  expect(compareSlotRedriveOrder(run("a", 1), run("a", 1))).toBe(0);
});

/** A real git worktree with a commit and one uncommitted file, standing in for a retained lane workspace. */
function retainedWorktree(name: string): { path: string; head: string; dirtyFile: string } {
  const path = join(logsDir, name);
  mkdirSync(path, { recursive: true });
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: path });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
  };
  git("init", "-q");
  writeFileSync(join(path, "tracked.txt"), "tracked");
  git("add", "tracked.txt");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  const dirtyFile = join(path, "retained.txt");
  writeFileSync(dirtyFile, "uncommitted work");
  return { path, head: git("rev-parse", "HEAD"), dirtyFile };
}

/** Simulates a daemon restart: the durable store is reopened and a fresh coordinator starts with no memory. */
function restartStore(): void {
  store.close();
  store = openStateStore(dbPath, { currentIdentity: ME, isOwnerAlive: async () => true });
}

test("after a restart a persisted slot-refused lane re-drives with the count carried forward and its retained worktree intact", async () => {
  const worktree = retainedWorktree("wt-restart");
  const runId = seedRefusedRun("restart-redrive", { count: 1, worktreePath: worktree.path });
  restartStore();
  const { ctx, runs } = daemonHarness(() => {});

  ctx.slotRedrive.rehydrate();
  await tick();

  expect(runs).toEqual([runId]);
  expect(store.loadRun(runId)?.gateRefusalRecoveryState).toMatchObject({ slotRedriveCount: 2 });
  expect(eventsOf(runId).filter((event) => event.kind === "slot_redrive")).toEqual([
    { kind: "slot_redrive", slotRedriveCount: 2, bound: MAX_SLOT_REDRIVES },
  ]);
  expect(Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: worktree.path }).stdout.toString().trim()).toBe(
    worktree.head,
  );
  expect(readFileSync(worktree.dirtyFile, "utf8")).toBe("uncommitted work");
  ctx.slotRedrive.stop();
});

test("after a restart with two persisted lanes only the oldest re-drives, the other waits for a release", async () => {
  const olderTree = retainedWorktree("wt-older");
  const newerTree = retainedWorktree("wt-newer");
  const older = seedRefusedRun("restart-older", { worktreePath: olderTree.path });
  await Bun.sleep(5);
  const newer = seedRefusedRun("restart-newer", { worktreePath: newerTree.path });
  restartStore();
  const { ctx, runs } = daemonHarness(() => {});

  ctx.slotRedrive.rehydrate();
  await tick();
  expect(runs).toEqual([older]);
  expect(store.loadRun(newer)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(0);

  holdGate().release();
  await tick();
  expect(runs).toEqual([older, newer]);
  ctx.slotRedrive.stop();
});

test("after a restart a lane held by a reachable draining predecessor is neither re-driven nor counted", async () => {
  const worktree = retainedWorktree("wt-predecessor");
  const runId = seedRefusedRun("restart-predecessor", { worktreePath: worktree.path });
  restartStore();
  const { ctx, runs } = daemonHarness(
    () => {},
    async () => true,
  );

  ctx.slotRedrive.rehydrate();
  await tick();

  expect(runs).toHaveLength(0);
  expect(store.loadRun(runId)).toMatchObject({
    status: "failed",
    gateRefusalRecoveryState: { slotRedriveCount: 0 },
  });
  expect(eventKinds(runId)).toEqual(["slot_redrive_skipped_owner"]);
  ctx.slotRedrive.stop();
});

test("after a restart a persisted lane at the bound is not re-driven", async () => {
  const worktree = retainedWorktree("wt-bound");
  const runId = seedRefusedRun("restart-bound", { count: MAX_SLOT_REDRIVES, worktreePath: worktree.path });
  restartStore();
  const { ctx, runs } = daemonHarness(() => {});

  ctx.slotRedrive.rehydrate();
  holdGate().release();
  await tick();

  expect(runs).toHaveLength(0);
  expect(store.loadRun(runId)).toMatchObject({
    status: "failed",
    gateRefusalRecoveryState: { slotRedriveCount: MAX_SLOT_REDRIVES },
  });
  ctx.slotRedrive.stop();
});

test("after a restart a lane whose worktree is missing is dropped with slot_redrive_refused and stays failed", async () => {
  const runId = seedRefusedRun("restart-missing-worktree", {
    count: 1,
    worktreePath: join(logsDir, "wt-does-not-exist"),
  });
  restartStore();
  const { ctx, runs } = daemonHarness(() => {});

  ctx.slotRedrive.rehydrate();
  await tick();

  expect(runs).toHaveLength(0);
  expect(store.loadRun(runId)).toMatchObject({
    status: "failed",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: { slotRedriveCount: 1 },
  });
  expect(eventsOf(runId)).toEqual([{ kind: "slot_redrive_refused", code: "worktree_missing", slotRedriveCount: 1 }]);
  ctx.slotRedrive.stop();
});

test("after a restart a lane whose checkpoint cannot be reconstructed is dropped uncounted with slot_redrive_refused", async () => {
  const worktree = retainedWorktree("wt-bad-checkpoint");
  const snapshot = snapshotFor("inv-restart-bad-checkpoint");
  const runId = seedRefusedRun("restart-bad-checkpoint", {
    worktreePath: worktree.path,
    snapshot: { ...snapshot, steps: [{ stepId: "implement", role: "implement" }] } as unknown as typeof snapshot,
  });
  restartStore();
  const { ctx, runs } = daemonHarness(() => {});

  ctx.slotRedrive.rehydrate();
  await tick();

  expect(runs).toHaveLength(0);
  expect(store.loadRun(runId)?.gateRefusalRecoveryState?.slotRedriveCount).toBe(0);
  expect(eventsOf(runId)).toEqual([
    { kind: "slot_redrive_refused", code: "checkpoint_unreconstructable", slotRedriveCount: 0 },
  ]);
  ctx.slotRedrive.stop();
});

test("rehydration skips ceiling_headroom rows", async () => {
  const worktree = retainedWorktree("wt-skipped");
  const headroom = seedRefusedRun("restart-headroom", { cause: "ceiling_headroom", worktreePath: worktree.path });
  restartStore();
  const { ctx, runs } = daemonHarness(() => {});

  ctx.slotRedrive.rehydrate();
  await tick();

  expect(runs).toHaveLength(0);
  expect(eventKinds(headroom)).toEqual([]);
  ctx.slotRedrive.stop();
});
