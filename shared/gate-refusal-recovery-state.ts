/**
 * Durable trace of a refused gate invocation: closed cause, the gate command, and a non-negative
 * slot re-drive count. Run rows persist this shape; `parseGateRefusalRecoveryState` is the only way
 * stored JSON becomes a record. `legacy_unknown` is a persistence-layer-only cause for rows whose
 * refusal predates this field or is unparseable — the write loop never produces it.
 */

import { isRecord } from "./is-record.ts";

export type GateRefusalRecoveryCause = "slot_contention" | "ceiling_headroom" | "legacy_unknown";

export type GateRefusalRecoveryState = {
  cause: GateRefusalRecoveryCause;
  gateCommand: string;
  slotRedriveCount: number;
};

export type GateRefusalRecoveryStateParseResult =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "valid"; record: GateRefusalRecoveryState };

const GATE_REFUSAL_RECOVERY_CAUSES: ReadonlySet<string> = new Set<GateRefusalRecoveryCause>([
  "slot_contention",
  "ceiling_headroom",
  "legacy_unknown",
]);

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Structural validation of an already-decoded value; `undefined` for anything that is not a complete record. */
export function gateRefusalRecoveryStateFromUnknown(value: unknown): GateRefusalRecoveryState | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.cause !== "string" || !GATE_REFUSAL_RECOVERY_CAUSES.has(value.cause)) return undefined;
  if (typeof value.gateCommand !== "string") return undefined;
  if (!isNonNegativeInteger(value.slotRedriveCount)) return undefined;
  return {
    cause: value.cause as GateRefusalRecoveryCause,
    gateCommand: value.gateCommand,
    slotRedriveCount: value.slotRedriveCount,
  };
}

/** Non-throwing decode of a stored JSON column: `absent` for `null`, `invalid` for malformed syntax or shape. */
export function parseGateRefusalRecoveryState(json: string | null): GateRefusalRecoveryStateParseResult {
  if (json === null) return { kind: "absent" };
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    return { kind: "invalid" };
  }
  const record = gateRefusalRecoveryStateFromUnknown(decoded);
  return record === undefined ? { kind: "invalid" } : { kind: "valid", record };
}
