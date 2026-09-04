import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcHandler } from "../ipc/server.ts";
import {
  encodeNotificationDeliveryCursor,
  openStateStore,
  type NotificationDeliveryIncident,
  type StateStore,
} from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import {
  createNotificationListHandler,
  createNotificationWaitHandler,
  NOTIFICATION_WAIT_ABORTED,
  NotificationWaitRegistry,
  type NotificationWaitResult,
} from "./daemon-notification-wait.ts";
import { deriveOperatorIncidents, serializeOperatorIncident } from "./operator-incidents.ts";
import { runNotificationSweep, type NotificationSweepDeps } from "./operator-notification-sweep.ts";

const DERIVATION_NOW_MS = 50_000_000;
const DERIVATION_RECENT_MS = 10_000_000;

let dbPath: string;
let store: StateStore;
let registry: NotificationWaitRegistry;
let notification_wait: RpcHandler;
let notification_list: RpcHandler;
let wakeNotificationWaiters: () => void;

function patchRunRow(runId: string, patch: { createdAt?: number; finishedAt?: number | null; status?: string }): void {
  const raw = new Database(dbPath);
  try {
    if (patch.createdAt !== undefined) {
      raw.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(patch.createdAt, runId);
    }
    if (patch.finishedAt !== undefined) {
      raw.prepare("UPDATE runs SET finished_at = ? WHERE id = ?").run(patch.finishedAt, runId);
    }
    if (patch.status !== undefined) {
      raw.prepare("UPDATE runs SET status = ? WHERE id = ?").run(patch.status, runId);
    }
  } finally {
    raw.close();
  }
}

function seedBlockedRun(): string {
  const runId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: `feature-${crypto.randomUUID()}`,
    specPath: "spec.md",
  });
  patchRunRow(runId, { status: "blocked", finishedAt: DERIVATION_RECENT_MS, createdAt: DERIVATION_RECENT_MS });
  return runId;
}

function seedAwaitingPipeline(): string {
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
  return pipelineId;
}

function sweepDeps(overrides: Partial<NotificationSweepDeps> = {}): NotificationSweepDeps {
  return {
    store,
    readSinkCommand: () => undefined,
    nowMs: () => DERIVATION_NOW_MS,
    wakeNotificationWaiters,
    ...overrides,
  };
}

function sinkIncident(incident: ReturnType<typeof deriveOperatorIncidents>[number]): NotificationDeliveryIncident {
  return {
    incidentId: incident.incidentId,
    kind: incident.kind,
    transition: incident.transition,
    project: incident.project,
    pipelineId: incident.pipelineId ?? null,
    stageId: incident.stageId ?? null,
    branchKey: incident.branchKey ?? null,
    runId: incident.runId ?? null,
    cause: incident.cause ?? null,
    sinceMs: incident.sinceMs,
  };
}

async function invokeNotificationWait(
  params: Record<string, unknown>,
  signal = new AbortController().signal,
): Promise<NotificationWaitResult> {
  const frame = await notification_wait({ kind: "request", id: "wait", method: "notification_wait", params }, signal);
  if (frame.kind !== "response") {
    throw new Error(`notification_wait failed: ${frame.kind === "error" ? frame.message : "not a response"}`);
  }
  return frame.result as NotificationWaitResult;
}

async function invokeNotificationList(params: Record<string, unknown>): Promise<NotificationWaitResult[]> {
  const frame = await notification_list(
    { kind: "request", id: "list", method: "notification_list", params },
    new AbortController().signal,
  );
  if (frame.kind !== "response") {
    throw new Error(`notification_list failed: ${frame.kind === "error" ? frame.message : "not a response"}`);
  }
  return (frame.result as { entries: NotificationWaitResult[] }).entries;
}

function recordDelivery(incident: ReturnType<typeof deriveOperatorIncidents>[number], deliveredAt: number): void {
  store.tryRecordNotificationDelivery({
    incidentId: incident.incidentId,
    transition: incident.transition,
    deliveredAt,
    incidentJson: serializeOperatorIncident(incident),
  });
}

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-notification-wait-${process.pid}-${crypto.randomUUID()}.sqlite`);
  removeOrchestrationStore(dbPath);
  store = openStateStore(dbPath);
  registry = new NotificationWaitRegistry();
  notification_wait = createNotificationWaitHandler(store, registry);
  notification_list = createNotificationListHandler(store);
  wakeNotificationWaiters = () => registry.wakeFromStore(store);
});

afterEach(() => {
  store.close();
  removeOrchestrationStore(dbPath);
});

test("notification_wait blocks until sweep records the next delivery", async () => {
  const priorCursor = encodeNotificationDeliveryCursor({
    deliveredAt: 1,
    incidentId: "run:prior",
    transition: "blocked",
  });
  const runId = seedBlockedRun();
  const incident = deriveOperatorIncidents(store, DERIVATION_NOW_MS).find((row) => row.runId === runId);
  if (incident === undefined) throw new Error("expected blocked incident");
  const pending = invokeNotificationWait({ sinceCursor: priorCursor });

  runNotificationSweep(sweepDeps());
  const result = await pending;

  expect(result.incident).toEqual(sinkIncident(incident));
  expect(result.deliveryCursor).toBe(
    encodeNotificationDeliveryCursor({
      deliveredAt: DERIVATION_NOW_MS,
      incidentId: incident.incidentId,
      transition: incident.transition,
    }),
  );
});

test("notification_wait returns delivery recorded while no waiter was armed", async () => {
  const runId = seedBlockedRun();
  const incident = deriveOperatorIncidents(store, DERIVATION_NOW_MS).find((row) => row.runId === runId);
  if (incident === undefined) throw new Error("expected blocked incident");
  const deliveredAt = DERIVATION_NOW_MS;
  recordDelivery(incident, deliveredAt);
  const priorCursor = encodeNotificationDeliveryCursor({
    deliveredAt: deliveredAt - 1,
    incidentId: "run:prior",
    transition: "blocked",
  });

  const result = await invokeNotificationWait({ sinceCursor: priorCursor });

  expect(result.incident).toEqual(sinkIncident(incident));
  expect(result.deliveryCursor).toBe(
    encodeNotificationDeliveryCursor({
      deliveredAt,
      incidentId: incident.incidentId,
      transition: incident.transition,
    }),
  );
});

test("notification_wait kind filter ignores non-matching deliveries", async () => {
  const pipelineId = seedAwaitingPipeline();
  const blockedRunId = seedBlockedRun();
  const awaitingIncident = deriveOperatorIncidents(store, DERIVATION_NOW_MS).find(
    (incident) => incident.pipelineId === pipelineId,
  );
  const blockedIncident = deriveOperatorIncidents(store, DERIVATION_NOW_MS).find(
    (incident) => incident.runId === blockedRunId,
  );
  if (awaitingIncident === undefined || blockedIncident === undefined) {
    throw new Error("expected awaiting and blocked incidents");
  }

  const pending = invokeNotificationWait({ sinceMs: 0, kinds: ["run-blocked"] });
  recordDelivery(awaitingIncident, DERIVATION_NOW_MS - 2);
  wakeNotificationWaiters();
  recordDelivery(blockedIncident, DERIVATION_NOW_MS - 1);
  wakeNotificationWaiters();

  const result = await pending;
  expect(result.incident).toEqual(sinkIncident(blockedIncident));
});

test("notification_wait abort drops armed waiter without late resolve", async () => {
  seedBlockedRun();
  const controller = new AbortController();
  const pending = invokeNotificationWait({ sinceMs: DERIVATION_NOW_MS + 1 }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow(NOTIFICATION_WAIT_ABORTED);

  const laterRunId = seedBlockedRun();
  runNotificationSweep(sweepDeps());
  await expect(pending).rejects.toThrow(NOTIFICATION_WAIT_ABORTED);
  expect(
    store.loadDeliveredNotificationIncident({
      incidentId: `run:${laterRunId}`,
      transition: "blocked",
    }),
  ).not.toBeNull();
});

test("notification_wait wakes when another daemon records the delivery", async () => {
  const registryB = new NotificationWaitRegistry();
  const wakeB = (): void => registryB.wakeFromStore(store);

  const pending = invokeNotificationWait({ sinceMs: DERIVATION_NOW_MS - 1 });
  const deliveredRunId = seedBlockedRun();
  const deliveredIncident = deriveOperatorIncidents(store, DERIVATION_NOW_MS).find(
    (incident) => incident.runId === deliveredRunId,
  );
  if (deliveredIncident === undefined) throw new Error("expected delivered incident");

  runNotificationSweep({
    store,
    readSinkCommand: () => undefined,
    nowMs: () => DERIVATION_NOW_MS,
    wakeNotificationWaiters: wakeB,
  });
  runNotificationSweep(sweepDeps());

  const result = await pending;
  expect(result.incident).toEqual(sinkIncident(deliveredIncident));
});

test("notification_list returns seeded ledger rows without blocking", async () => {
  const firstRunId = seedBlockedRun();
  const secondRunId = seedBlockedRun();
  const incidents = deriveOperatorIncidents(store, DERIVATION_NOW_MS);
  const firstIncident = incidents.find((incident) => incident.runId === firstRunId);
  const secondIncident = incidents.find((incident) => incident.runId === secondRunId);
  if (firstIncident === undefined || secondIncident === undefined) {
    throw new Error("expected two blocked incidents");
  }
  const firstDeliveredAt = DERIVATION_NOW_MS - 2;
  const secondDeliveredAt = DERIVATION_NOW_MS - 1;
  recordDelivery(firstIncident, firstDeliveredAt);
  recordDelivery(secondIncident, secondDeliveredAt);
  const priorCursor = encodeNotificationDeliveryCursor({
    deliveredAt: firstDeliveredAt - 1,
    incidentId: "run:prior",
    transition: "blocked",
  });

  const startedAt = performance.now();
  const results = await invokeNotificationList({ sinceCursor: priorCursor });
  const elapsedMs = performance.now() - startedAt;

  expect(elapsedMs).toBeLessThan(100);
  expect(results).toHaveLength(2);
  expect(results[0]?.incident).toEqual(sinkIncident(firstIncident));
  expect(results[0]?.deliveryCursor).toBe(
    encodeNotificationDeliveryCursor({
      deliveredAt: firstDeliveredAt,
      incidentId: firstIncident.incidentId,
      transition: firstIncident.transition,
    }),
  );
  expect(results[1]?.incident).toEqual(sinkIncident(secondIncident));
  expect(results[1]?.deliveryCursor).toBe(
    encodeNotificationDeliveryCursor({
      deliveredAt: secondDeliveredAt,
      incidentId: secondIncident.incidentId,
      transition: secondIncident.transition,
    }),
  );
});

test("notification_list kind filter excludes non-matching deliveries", async () => {
  const pipelineId = seedAwaitingPipeline();
  const blockedRunId = seedBlockedRun();
  const awaitingIncident = deriveOperatorIncidents(store, DERIVATION_NOW_MS).find(
    (incident) => incident.pipelineId === pipelineId,
  );
  const blockedIncident = deriveOperatorIncidents(store, DERIVATION_NOW_MS).find(
    (incident) => incident.runId === blockedRunId,
  );
  if (awaitingIncident === undefined || blockedIncident === undefined) {
    throw new Error("expected awaiting and blocked incidents");
  }

  recordDelivery(awaitingIncident, DERIVATION_NOW_MS - 2);
  recordDelivery(blockedIncident, DERIVATION_NOW_MS - 1);

  const results = await invokeNotificationList({ sinceMs: 0, kinds: ["run-blocked"] });

  expect(results).toHaveLength(1);
  expect(results[0]?.incident).toEqual(sinkIncident(blockedIncident));
});

test("notification_list sinceCursor kind filter excludes non-matching deliveries", async () => {
  const pipelineId = seedAwaitingPipeline();
  const blockedRunId = seedBlockedRun();
  const awaitingIncident = deriveOperatorIncidents(store, DERIVATION_NOW_MS).find(
    (incident) => incident.pipelineId === pipelineId,
  );
  const blockedIncident = deriveOperatorIncidents(store, DERIVATION_NOW_MS).find(
    (incident) => incident.runId === blockedRunId,
  );
  if (awaitingIncident === undefined || blockedIncident === undefined) {
    throw new Error("expected awaiting and blocked incidents");
  }
  const awaitingDeliveredAt = DERIVATION_NOW_MS - 2;
  const blockedDeliveredAt = DERIVATION_NOW_MS - 1;
  recordDelivery(awaitingIncident, awaitingDeliveredAt);
  recordDelivery(blockedIncident, blockedDeliveredAt);
  const priorCursor = encodeNotificationDeliveryCursor({
    deliveredAt: awaitingDeliveredAt - 1,
    incidentId: "run:prior",
    transition: "blocked",
  });

  const results = await invokeNotificationList({ sinceCursor: priorCursor, kinds: ["run-blocked"] });

  expect(results).toHaveLength(1);
  expect(results[0]?.incident).toEqual(sinkIncident(blockedIncident));
});
