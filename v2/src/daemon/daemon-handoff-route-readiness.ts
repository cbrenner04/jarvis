import type { RpcHandler, StreamHandler } from "../ipc/server.ts";
import type { ObservedRunRoute } from "./daemon-drain-observer.ts";

/** Error code returned to a gated public method while route setup is unready or has conclusively failed. */
const RUN_ROUTING_UNAVAILABLE_CODE = "run_routing_unavailable";

const ROUTE_UNAVAILABLE_MESSAGE = "Handoff route setup for this generation has not completed; retry shortly.";

/** Bounds the one-time wait for the predecessor's first route snapshot at startup. */
export const DEFAULT_ROUTE_READINESS_TIMEOUT_MS = 3_000;

type RouteReadinessState = "pending" | "ready" | "unavailable";

type RouteReadinessGate = { current(): RouteReadinessState };

/** Cancels a scheduled readiness deadline. */
type ReadinessDeadlineHandle = { clear(): void };

/**
 * Injectable so a test can fire the deadline itself instead of racing a real timer. Defaults to a
 * real, unref'd `setTimeout`.
 */
export type ScheduleReadinessDeadline = (onTimeout: () => void, timeoutMs: number) => ReadinessDeadlineHandle;

function scheduleRealReadinessDeadline(onTimeout: () => void, timeoutMs: number): ReadinessDeadlineHandle {
  const timer = setTimeout(onTimeout, timeoutMs);
  timer.unref?.();
  return { clear: () => clearTimeout(timer) };
}

/**
 * Establishes a route-readiness gate for one daemon generation. No predecessor at all is
 * trivially ready — there is nothing to route. Otherwise the gate starts `pending` and transitions
 * exactly once: to `ready` the moment the predecessor's drain observer settles its first
 * authoritative live set (see `daemon-drain-observer.ts`'s `firstSettlement`), or to `unavailable`
 * once `timeoutMs` elapses with no settlement — a conclusive failure the gate never recovers from,
 * so a wedged predecessor cannot wedge every future request behind an indefinite wait.
 */
export function createRouteReadinessGate(
  predecessorSocketPath: string | undefined,
  firstSettlement: Promise<void> | undefined,
  timeoutMs: number = DEFAULT_ROUTE_READINESS_TIMEOUT_MS,
  scheduleDeadline: ScheduleReadinessDeadline = scheduleRealReadinessDeadline,
): RouteReadinessGate {
  if (predecessorSocketPath === undefined) {
    return { current: () => "ready" };
  }

  let state: RouteReadinessState = "pending";
  const deadline = scheduleDeadline(() => {
    if (routeReadinessGateIsPending(state)) state = "unavailable";
  }, timeoutMs);
  (firstSettlement ?? Promise.resolve()).then(() => {
    if (routeReadinessGateIsPending(state)) {
      state = "ready";
      deadline.clear();
    }
  });

  return { current: () => state };
}

/** Whether a readiness gate is still open to a transition; extracted so both directions are directly testable. */
export function routeReadinessGateIsPending(state: RouteReadinessState): boolean {
  return state === "pending";
}

/**
 * Wraps a run-control RPC handler so it answers `run_routing_unavailable` instead of running while
 * the daemon's route readiness gate is pending or has conclusively failed.
 */
export function gateRunControlHandler(handler: RpcHandler, gate: RouteReadinessGate): RpcHandler {
  return (frame, signal) => {
    if (gate.current() !== "ready") {
      return { kind: "error", code: RUN_ROUTING_UNAVAILABLE_CODE, message: ROUTE_UNAVAILABLE_MESSAGE };
    }
    return handler(frame, signal);
  };
}

/**
 * Wraps a stream handler (`stream-open`, e.g. log tail) so it refuses to open while the daemon's
 * route readiness gate is pending or has conclusively failed. The IPC server maps a thrown error
 * to an error `stream-end` (see `v2/src/ipc/server.ts`).
 */
export function gateStreamHandler(handler: StreamHandler, gate: RouteReadinessGate): StreamHandler {
  return async (streamId, payload, onData, onClose, signal) => {
    if (gate.current() !== "ready") {
      throw new Error(RUN_ROUTING_UNAVAILABLE_CODE);
    }
    return handler(streamId, payload, onData, onClose, signal);
  };
}

/** How far a routed run id's candidate hop is from the local generation. */
type RouteHopKind = "predecessor" | "legacy";

type RouteHop = { kind: RouteHopKind; socketPath: string };

export type RouteCandidate = RouteHop & { runId: string; route?: ObservedRunRoute };

function routeHopRank(kind: RouteHopKind): number {
  return kind === "predecessor" ? 0 : 1;
}

/**
 * Resolves one owning hop per run id from every candidate a daemon currently observes. The direct
 * handoff predecessor always outranks a legacy-enumerated peer (nearest hop before an older
 * duplicate; see 03-legacy-keyed-daemon-migration.md), and candidates are visited in socket-path
 * order first so a tie within the same hop kind always resolves to the same winner regardless of
 * `enumerateOtherDaemonSockets`'s directory-read order.
 */
export function resolveRunRoutes(candidates: readonly RouteCandidate[]): Map<string, RouteCandidate> {
  const owners = new Map<string, RouteCandidate>();
  const ordered = [...candidates].sort((a, b) => a.socketPath.localeCompare(b.socketPath));
  for (const candidate of ordered) {
    const current = owners.get(candidate.runId);
    if (current === undefined || routeHopRank(candidate.kind) < routeHopRank(current.kind)) {
      owners.set(candidate.runId, candidate);
    }
  }
  return owners;
}

export function resolveRouteOwnership(candidates: readonly RouteCandidate[]): Map<string, RouteHop> {
  return new Map(
    [...resolveRunRoutes(candidates)].map(([runId, route]) => [
      runId,
      { kind: route.kind, socketPath: route.socketPath },
    ]),
  );
}

/**
 * Whether this generation must stay up to keep serving downstream routing: it currently owns at
 * least one routed run (a live predecessor- or legacy-hop route) or has a request in flight it is
 * forwarding on a downstream caller's behalf.
 */
export function hasRoutedResponsibility(routedRunCount: number, forwardedRequestCount: number): boolean {
  return routedRunCount > 0 || forwardedRequestCount > 0;
}
