import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcHandler } from "../ipc/server.ts";
import {
  encodeNotificationDeliveryCursor,
  type NotificationDeliveryIncident,
  openStateStore,
  type StateStore,
} from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { captureIo, cliMain as main } from "../testing/cli-test-helpers.ts";
import { makeIpcClient as makeDeferredIpcClient } from "../testing/ipc-client-fake.ts";
import {
  createNotificationListHandler,
  createNotificationWaitHandler,
  NotificationWaitRegistry,
} from "../daemon/daemon-notification-wait.ts";
import { deriveOperatorIncidents, serializeOperatorIncident } from "../daemon/operator-incidents.ts";

const DERIVATION_NOW_MS = 50_000_000;
const DERIVATION_RECENT_MS = 10_000_000;
const ONE_HOUR_MS = 3_600_000;

type DerivedIncident = ReturnType<typeof deriveOperatorIncidents>[number];

let dbPath: string;
let store: StateStore;
let registry: NotificationWaitRegistry;
let wakeNotificationWaiters: () => void;
let handlers: Record<string, RpcHandler>;

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

function derivedIncident(match: (row: DerivedIncident) => boolean): DerivedIncident {
  const incident = deriveOperatorIncidents(store, DERIVATION_NOW_MS).find(match);
  if (incident === undefined) throw new Error("expected incident");
  return incident;
}

function sinkShape(incident: DerivedIncident): NotificationDeliveryIncident {
  return JSON.parse(serializeOperatorIncident(incident)) as NotificationDeliveryIncident;
}

function seedTwoBlockedIncidents(): { first: DerivedIncident; second: DerivedIncident } {
  const firstRunId = seedBlockedRun();
  const secondRunId = seedBlockedRun();
  return {
    first: derivedIncident((row) => row.runId === firstRunId),
    second: derivedIncident((row) => row.runId === secondRunId),
  };
}

function blockedIncident(): DerivedIncident {
  const runId = seedBlockedRun();
  return derivedIncident((row) => row.runId === runId);
}

function seedAwaitingAndBlocked(): { awaiting: DerivedIncident; blocked: DerivedIncident } {
  const pipelineId = seedAwaitingPipeline();
  const blockedRunId = seedBlockedRun();
  return {
    awaiting: derivedIncident((row) => row.pipelineId === pipelineId),
    blocked: derivedIncident((row) => row.runId === blockedRunId),
  };
}

function recordDelivery(incident: DerivedIncident, deliveredAt: number): void {
  store.tryRecordNotificationDelivery({
    incidentId: incident.incidentId,
    transition: incident.transition,
    deliveredAt,
    incidentJson: serializeOperatorIncident(incident),
  });
}

function makeHandlerClient(rpcHandlers: Record<string, RpcHandler>) {
  const client = makeDeferredIpcClient([], { gated: true, deferred: true });
  return {
    ...client,
    send(frame: unknown): void {
      client.send(frame);
      const request = frame as { id?: string; method?: string; params?: unknown };
      if (typeof request.id !== "string" || typeof request.method !== "string") return;
      const requestId = request.id;
      const method = request.method;
      const handler = rpcHandlers[method];
      if (handler === undefined) {
        client.push({ kind: "error", id: requestId, code: "unknown_method", message: "unknown method" });
        return;
      }
      void Promise.resolve(
        handler({ kind: "request", id: requestId, method, params: request.params }, new AbortController().signal),
      )
        .then((response) => {
          client.push({ ...response, id: requestId });
        })
        .catch((error: unknown) => {
          client.push({
            kind: "error",
            id: requestId,
            code: "internal_error",
            message: error instanceof Error ? error.message : String(error),
          });
        });
    },
  };
}

function notificationCliDeps() {
  return {
    now: () => DERIVATION_NOW_MS,
    connectIpcClient: async () => makeHandlerClient(handlers),
  };
}

async function runNotifications(argv: readonly string[]) {
  const cap = captureIo();
  const code = await main(["notifications", ...argv], cap.io, notificationCliDeps());
  const output = cap.read();
  return {
    code,
    stdout: output.stdout,
    stderr: output.stderr,
    stdoutLines: () =>
      output.stdout
        .trimEnd()
        .split("\n")
        .filter((line) => line.length > 0),
  };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-notifications-cli-${process.pid}-${crypto.randomUUID()}.sqlite`);
  removeOrchestrationStore(dbPath);
  store = openStateStore(dbPath);
  registry = new NotificationWaitRegistry();
  wakeNotificationWaiters = () => registry.wakeFromStore(store);
  handlers = {
    notification_wait: createNotificationWaitHandler(store, registry),
    notification_list: createNotificationListHandler(store),
  };
});

afterEach(() => {
  store.close();
  removeOrchestrationStore(dbPath);
});

test("notifications wait blocks until the next owed incident", async () => {
  const priorCursor = encodeNotificationDeliveryCursor({
    deliveredAt: 1,
    incidentId: "run:prior",
    transition: "blocked",
  });
  const incident = blockedIncident();

  const pending = runNotifications(["wait", "--since", priorCursor]);
  recordDelivery(incident, DERIVATION_NOW_MS);
  wakeNotificationWaiters();
  const result = await pending;

  expect(result.code).toBe(0);
  expect(result.stdoutLines()).toHaveLength(1);
});

test("notifications wait stdout is incident and deliveryCursor wrapper", async () => {
  const incident = blockedIncident();
  const deliveredAt = DERIVATION_NOW_MS;
  recordDelivery(incident, deliveredAt);
  const priorCursor = encodeNotificationDeliveryCursor({
    deliveredAt: deliveredAt - 1,
    incidentId: "run:prior",
    transition: "blocked",
  });

  const result = await runNotifications(["wait", "--since", priorCursor]);
  const parsed = JSON.parse(result.stdoutLines()[0] ?? "{}") as {
    incident: NotificationDeliveryIncident;
    deliveryCursor: string;
  };

  expect(result.code).toBe(0);
  expect(parsed.incident).toEqual(sinkShape(incident));
  expect(parsed.deliveryCursor).toBe(
    encodeNotificationDeliveryCursor({
      deliveredAt,
      incidentId: incident.incidentId,
      transition: incident.transition,
    }),
  );
});

test("notifications wait since cursor returns delivery recorded while no waiter was armed", async () => {
  const incident = blockedIncident();
  const deliveredAt = DERIVATION_NOW_MS;
  recordDelivery(incident, deliveredAt);
  const priorCursor = encodeNotificationDeliveryCursor({
    deliveredAt: deliveredAt - 1,
    incidentId: "run:prior",
    transition: "blocked",
  });

  const result = await runNotifications(["wait", "--since", priorCursor]);
  const parsed = JSON.parse(result.stdoutLines()[0] ?? "{}") as { incident: NotificationDeliveryIncident };

  expect(result.code).toBe(0);
  expect(parsed.incident).toEqual(sinkShape(incident));
});

test("notifications wait kind filter ignores non-matching incidents", async () => {
  const { awaiting, blocked } = seedAwaitingAndBlocked();

  const pending = runNotifications(["wait", "--since", "0", "--kind", "run-blocked"]);
  recordDelivery(awaiting, DERIVATION_NOW_MS - 2);
  wakeNotificationWaiters();
  recordDelivery(blocked, DERIVATION_NOW_MS - 1);
  wakeNotificationWaiters();
  const result = await pending;
  const parsed = JSON.parse(result.stdoutLines()[0] ?? "{}") as { incident: NotificationDeliveryIncident };

  expect(result.code).toBe(0);
  expect(parsed.incident).toEqual(sinkShape(blocked));
});

test("notifications list since duration returns prior ledger incidents", async () => {
  const { first, second } = seedTwoBlockedIncidents();
  recordDelivery(first, DERIVATION_NOW_MS - ONE_HOUR_MS - 1);
  recordDelivery(second, DERIVATION_NOW_MS - ONE_HOUR_MS + 1);

  const result = await runNotifications(["list", "--since", "2h"]);

  expect(result.code).toBe(0);
  expect(result.stdoutLines()).toHaveLength(2);
});

test("notifications list stdout is incident-only NDJSON", async () => {
  const incident = blockedIncident();
  recordDelivery(incident, DERIVATION_NOW_MS - 1);

  const result = await runNotifications(["list"]);
  const lines = result.stdoutLines();

  expect(result.code).toBe(0);
  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0] ?? "{}") as NotificationDeliveryIncident;
  expect(parsed).toEqual(sinkShape(incident));
  expect(parsed).not.toHaveProperty("deliveryCursor");
});

test("notifications list omitted since returns ledger from start", async () => {
  const { first, second } = seedTwoBlockedIncidents();
  recordDelivery(first, DERIVATION_NOW_MS - 2);
  recordDelivery(second, DERIVATION_NOW_MS - 1);

  const result = await runNotifications(["list"]);
  const lines = result.stdoutLines().map((line) => JSON.parse(line) as NotificationDeliveryIncident);

  expect(result.code).toBe(0);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toEqual(sinkShape(first));
  expect(lines[1]).toEqual(sinkShape(second));
});

test("notifications list since cursor returns deliveries after cursor", async () => {
  const { first, second } = seedTwoBlockedIncidents();
  const firstDeliveredAt = DERIVATION_NOW_MS - 100;
  const secondDeliveredAt = DERIVATION_NOW_MS - 1;
  recordDelivery(first, firstDeliveredAt);
  recordDelivery(second, secondDeliveredAt);
  const priorCursor = encodeNotificationDeliveryCursor({
    deliveredAt: DERIVATION_NOW_MS - 50,
    incidentId: "run:prior",
    transition: "blocked",
  });

  const result = await runNotifications(["list", "--since", priorCursor]);
  const lines = result.stdoutLines().map((line) => JSON.parse(line) as NotificationDeliveryIncident);

  expect(result.code).toBe(0);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toEqual(sinkShape(second));
});

test("notifications list kind filter excludes non-matching incidents", async () => {
  const { awaiting, blocked } = seedAwaitingAndBlocked();
  recordDelivery(awaiting, DERIVATION_NOW_MS - 2);
  recordDelivery(blocked, DERIVATION_NOW_MS - 1);

  const result = await runNotifications(["list", "--kind", "run-blocked"]);
  const lines = result.stdoutLines().map((line) => JSON.parse(line) as NotificationDeliveryIncident);

  expect(result.code).toBe(0);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toEqual(sinkShape(blocked));
});
