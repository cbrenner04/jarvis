import type { RpcHandler } from "../ipc/server.ts";
import {
  encodeNotificationDeliveryCursor,
  type ListDeliveredNotificationIncidentsArgs,
  type NotificationDeliveryIncident,
  type StateStore,
} from "../persistence/state-store.ts";

export const NOTIFICATION_WAIT_ABORTED = "notification_wait aborted";

export type NotificationWaitResult = {
  incident: NotificationDeliveryIncident;
  deliveryCursor: string;
};

type NotificationWaitFilter = ListDeliveredNotificationIncidentsArgs;

type RegisteredWaiter = {
  filter: NotificationWaitFilter;
  resolve: (result: NotificationWaitResult) => void;
  reject: (error: Error) => void;
  unregister: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseNotificationWaitFilter(
  params: unknown,
): { kind: "ok"; filter: NotificationWaitFilter } | { kind: "error"; code: "invalid_params"; message: string } {
  if (!isRecord(params)) {
    return { kind: "error", code: "invalid_params", message: "params required" };
  }

  const hasCursor = typeof params.sinceCursor === "string" && params.sinceCursor.length > 0;
  const hasSinceMs = typeof params.sinceMs === "number" && Number.isFinite(params.sinceMs);
  if (hasCursor && hasSinceMs) {
    return { kind: "error", code: "invalid_params", message: "sinceCursor and sinceMs are mutually exclusive" };
  }
  if (!hasCursor && !hasSinceMs) {
    return { kind: "error", code: "invalid_params", message: "sinceCursor or sinceMs required" };
  }

  let kinds: readonly string[] | undefined;
  if ("kinds" in params) {
    if (!Array.isArray(params.kinds)) {
      return { kind: "error", code: "invalid_params", message: "kinds must be an array" };
    }
    if (params.kinds.length === 0) {
      return { kind: "error", code: "invalid_params", message: "kinds must not be empty" };
    }
    if (!params.kinds.every((kind) => typeof kind === "string")) {
      return { kind: "error", code: "invalid_params", message: "kinds must contain strings" };
    }
    kinds = params.kinds;
  }

  if (hasCursor) {
    return {
      kind: "ok",
      filter: { sinceCursor: params.sinceCursor as string, ...(kinds !== undefined ? { kinds } : {}) },
    };
  }
  return { kind: "ok", filter: { sinceMs: params.sinceMs as number, ...(kinds !== undefined ? { kinds } : {}) } };
}

function notificationResultFromIncident(
  store: StateStore,
  incident: NotificationDeliveryIncident,
): NotificationWaitResult | null {
  const row = store.loadDeliveredNotificationIncident({
    incidentId: incident.incidentId,
    transition: incident.transition,
  });
  if (row === null) return null;
  return {
    incident: row.incident,
    deliveryCursor: encodeNotificationDeliveryCursor({
      deliveredAt: row.deliveredAt,
      incidentId: row.incident.incidentId,
      transition: row.incident.transition,
    }),
  };
}

export function findNextNotificationWaitResult(
  store: StateStore,
  filter: NotificationWaitFilter,
): NotificationWaitResult | null {
  const incident = store.listDeliveredNotificationIncidents(filter)[0];
  if (incident === undefined) return null;
  return notificationResultFromIncident(store, incident);
}

export function listNotificationResults(store: StateStore, filter: NotificationWaitFilter): NotificationWaitResult[] {
  const results: NotificationWaitResult[] = [];
  for (const incident of store.listDeliveredNotificationIncidents(filter)) {
    const result = notificationResultFromIncident(store, incident);
    if (result !== null) {
      results.push(result);
    }
  }
  return results;
}

export class NotificationWaitRegistry {
  private readonly waiters = new Map<number, RegisteredWaiter>();
  private nextId = 1;

  wakeFromStore(store: StateStore): void {
    for (const [id, waiter] of [...this.waiters.entries()]) {
      const next = findNextNotificationWaitResult(store, waiter.filter);
      if (next === null) continue;
      waiter.unregister();
      this.waiters.delete(id);
      waiter.resolve(next);
    }
  }

  registerWaiter(
    store: StateStore,
    filter: NotificationWaitFilter,
    signal: AbortSignal,
  ): Promise<NotificationWaitResult> {
    return new Promise((resolve, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      const unregister = (): void => {
        signal.removeEventListener("abort", onAbort);
        this.waiters.delete(id);
      };
      const onAbort = (): void => {
        unregister();
        reject(new Error(NOTIFICATION_WAIT_ABORTED));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      this.waiters.set(id, { filter, resolve, reject, unregister });
      const raced = findNextNotificationWaitResult(store, filter);
      if (raced !== null) {
        unregister();
        resolve(raced);
      }
    });
  }
}

export function createNotificationWaitHandler(store: StateStore, registry: NotificationWaitRegistry): RpcHandler {
  return async (frame, signal) => {
    const parsed = parseNotificationWaitFilter(frame.params);
    if (parsed.kind === "error") {
      return { kind: "error", code: parsed.code, message: parsed.message };
    }

    const immediate = findNextNotificationWaitResult(store, parsed.filter);
    if (immediate !== null) {
      return { kind: "response", result: immediate };
    }

    try {
      const result = await registry.registerWaiter(store, parsed.filter, signal);
      return { kind: "response", result };
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.message === NOTIFICATION_WAIT_ABORTED)) {
        throw new Error(NOTIFICATION_WAIT_ABORTED);
      }
      throw error;
    }
  };
}

export function createNotificationListHandler(store: StateStore): RpcHandler {
  return (frame) => {
    const parsed = parseNotificationWaitFilter(frame.params);
    if (parsed.kind === "error") {
      return { kind: "error", code: parsed.code, message: parsed.message };
    }
    return { kind: "response", result: { entries: listNotificationResults(store, parsed.filter) } };
  };
}
