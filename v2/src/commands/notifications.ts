import { parseArgs } from "node:util";
import { NOTIFICATIONS_PARSE_ARG_OPTIONS } from "../cli/command-help-flags.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatRpcError, request } from "../cli/ipc.ts";
import { withConnectDispatch } from "../cli/stale-dispatch.ts";
import { NOTIFICATIONS_LIST_USAGE, NOTIFICATIONS_USAGE, NOTIFICATIONS_WAIT_USAGE } from "../cli/usage.ts";
import type { NotificationWaitResult } from "../daemon/daemon-notification-wait.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { decodeNotificationDeliveryCursor } from "../persistence/state-store.ts";

const SINCE_UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 } as const;

function parseSinceBound(value: string, nowMs: number): { sinceMs?: number; sinceCursor?: string } | undefined {
  const durationMatch = /^(\d+)([dhms])$/.exec(value);
  if (durationMatch !== null) {
    const amount = Number(durationMatch[1]);
    if (!Number.isInteger(amount) || amount <= 0) return undefined;
    return { sinceMs: nowMs - amount * SINCE_UNIT_MS[durationMatch[2] as keyof typeof SINCE_UNIT_MS] };
  }
  if (/^\d+$/.test(value)) {
    const ms = Number(value);
    return Number.isSafeInteger(ms) ? { sinceMs: ms } : undefined;
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return { sinceMs: parsed };
  try {
    decodeNotificationDeliveryCursor(value);
    return { sinceCursor: value };
  } catch {
    return undefined;
  }
}

type NotificationRpcParams = { sinceMs?: number; sinceCursor?: string; kinds?: string[] };

function parseNotificationArgv(
  rest: readonly string[],
  usage: string,
  io: Io,
  deps: CliDeps,
): { ok: true; params: NotificationRpcParams; project?: string } | { ok: false } {
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    values = parseArgs({
      args: [...rest],
      allowPositionals: false,
      strict: true,
      options: NOTIFICATIONS_PARSE_ARG_OPTIONS,
    }).values;
  } catch {
    io.stderr(usage);
    return { ok: false };
  }

  const params: NotificationRpcParams = {};
  if (typeof values.since === "string") {
    const bound = parseSinceBound(values.since, deps.now?.() ?? Date.now());
    if (bound === undefined) {
      io.stderr("invalid_since: invalid value\n");
      return { ok: false };
    }
    if (bound.sinceCursor !== undefined) params.sinceCursor = bound.sinceCursor;
    else params.sinceMs = bound.sinceMs ?? 0;
  } else {
    params.sinceMs = 0;
  }

  const rawKinds = values.kind;
  if (rawKinds !== undefined) {
    const kinds = (Array.isArray(rawKinds) ? rawKinds : [rawKinds]).filter(
      (kind): kind is string => typeof kind === "string",
    );
    if (kinds.length === 0 || kinds.some((kind) => kind.length === 0)) {
      io.stderr("invalid_params: kinds must not be empty\n");
      return { ok: false };
    }
    params.kinds = kinds;
  }

  let project: string | undefined;
  if (values.project !== undefined) {
    if (typeof values.project !== "string" || values.project.length === 0) {
      io.stderr("invalid_project: invalid value\n");
      return { ok: false };
    }
    project = values.project;
  }

  return project !== undefined ? { ok: true, params, project } : { ok: true, params };
}

function parseNotificationWaitResult(value: unknown): NotificationWaitResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { incident?: unknown; deliveryCursor?: unknown };
  if (record.incident === undefined || typeof record.deliveryCursor !== "string") return undefined;
  return { incident: record.incident as NotificationWaitResult["incident"], deliveryCursor: record.deliveryCursor };
}

function parseNotificationListResult(value: unknown): NotificationWaitResult[] | undefined {
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries) || entries.some((entry) => parseNotificationWaitResult(entry) === undefined)) {
    return undefined;
  }
  return entries as NotificationWaitResult[];
}

async function notificationRpc(
  method: "notification_wait" | "notification_list",
  argv: readonly string[],
  usage: string,
  io: Io,
  deps: CliDeps,
): Promise<number> {
  const parsed = parseNotificationArgv(argv, usage, io, deps);
  if (!parsed.ok) return 1;
  const project = parsed.project;

  return withConnectDispatch(io, deps, async (client) => {
    let params = parsed.params;
    if (method === "notification_wait") {
      for (;;) {
        let response: unknown;
        try {
          response = await request(client, method, params);
        } catch (error) {
          if (error instanceof RpcError) {
            io.stderr(formatRpcError(error));
            return 1;
          }
          throw error;
        }
        const result = parseNotificationWaitResult(response);
        if (result === undefined) {
          io.stderr("invalid daemon response\n");
          return 1;
        }
        if (project !== undefined && result.incident.project !== project) {
          params = { sinceCursor: result.deliveryCursor };
          if (parsed.params.kinds !== undefined) params.kinds = parsed.params.kinds;

          let listResponse: unknown;
          try {
            listResponse = await request(client, "notification_list", params);
          } catch (error) {
            if (error instanceof RpcError) {
              io.stderr(formatRpcError(error));
              return 1;
            }
            throw error;
          }
          const entries = parseNotificationListResult(listResponse);
          if (entries !== undefined) {
            const startIndex = entries.findIndex((entry) => entry.deliveryCursor === result.deliveryCursor);
            const scanFrom = startIndex >= 0 ? startIndex + 1 : 0;
            for (let i = scanFrom; i < entries.length; i++) {
              const entry = entries[i]!;
              if (entry.incident.project === project) {
                io.stdout(`${JSON.stringify(entry)}\n`);
                return 0;
              }
              params = { sinceCursor: entry.deliveryCursor };
              if (parsed.params.kinds !== undefined) params.kinds = parsed.params.kinds;
            }
          }
          continue;
        }
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      }
    }

    let response: unknown;
    try {
      response = await request(client, method, parsed.params);
    } catch (error) {
      if (error instanceof RpcError) {
        io.stderr(formatRpcError(error));
        return 1;
      }
      throw error;
    }
    const entries = parseNotificationListResult(response);
    if (entries === undefined) {
      io.stderr("invalid daemon response\n");
      return 1;
    }
    for (const entry of entries) {
      if (project !== undefined && entry.incident.project !== project) continue;
      io.stdout(`${JSON.stringify(entry.incident)}\n`);
    }
    return 0;
  });
}

export async function runNotificationsCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];
  if (subcommand === "wait") {
    return notificationRpc("notification_wait", argv.slice(1), NOTIFICATIONS_WAIT_USAGE, io, deps);
  }
  if (subcommand === "list") {
    return notificationRpc("notification_list", argv.slice(1), NOTIFICATIONS_LIST_USAGE, io, deps);
  }
  io.stderr(NOTIFICATIONS_USAGE);
  return 1;
}
