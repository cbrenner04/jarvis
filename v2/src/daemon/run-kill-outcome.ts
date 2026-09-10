import { isRecord } from "../../../shared/is-record.ts";
import { isRunStatus, type RunStatus } from "../persistence/state-store.ts";

/** Wall-clock bound a plain kill waits for durable settlement; matches the write loop's iteration quiescence bound. */
export const KILL_SETTLEMENT_BOUND_MS = 30_000;
/** Poll interval of the bounded settlement wait. */
export const KILL_SETTLEMENT_POLL_MS = 25;

/** A process observed alive in a recorded verifier group after the termination attempt. */
export type KillSurvivor = { pid: number; ppid: number | null };

/**
 * The `kill` RPC's settlement contract. `ok: true` means the named row is durably terminal —
 * `killed`, or the boundary-terminal status it already held (kill never overwrites `completed`,
 * `blocked`, `failed`, `interrupted`); `unsettled` means the bounded wait expired with the row
 * still live because a child did not unwind.
 */
export type RunKillOutcome =
  | { ok: true; outcome: "settled" | "force-settled"; runId: string; status: RunStatus; survivors: KillSurvivor[] }
  | { ok: false; outcome: "unsettled"; runId: string; status: RunStatus; survivors: KillSurvivor[]; boundMs: number };

function parseSurvivors(value: unknown): KillSurvivor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const survivors: KillSurvivor[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.pid !== "number") return undefined;
    if (entry.ppid !== null && typeof entry.ppid !== "number") return undefined;
    survivors.push({ pid: entry.pid, ppid: entry.ppid });
  }
  return survivors;
}

/** Fail-closed wire parser: any unknown or incomplete shape (including the retired bare `{ ok: true }`) is rejected. */
export function parseRunKillOutcome(value: unknown): RunKillOutcome | undefined {
  if (!isRecord(value) || typeof value.runId !== "string") return undefined;
  const survivors = parseSurvivors(value.survivors);
  if (survivors === undefined) return undefined;
  if (value.ok === true) {
    if ((value.outcome !== "settled" && value.outcome !== "force-settled") || !isRunStatus(value.status))
      return undefined;
    return { ok: true, outcome: value.outcome, runId: value.runId, status: value.status, survivors };
  }
  if (value.ok === false) {
    if (value.outcome !== "unsettled" || !isRunStatus(value.status) || typeof value.boundMs !== "number")
      return undefined;
    return {
      ok: false,
      outcome: "unsettled",
      runId: value.runId,
      status: value.status,
      survivors,
      boundMs: value.boundMs,
    };
  }
  return undefined;
}
