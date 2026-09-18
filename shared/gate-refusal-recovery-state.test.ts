import { describe, expect, test } from "bun:test";
import { type GateRefusalRecoveryState, parseGateRefusalRecoveryState } from "./gate-refusal-recovery-state.ts";

describe("parseGateRefusalRecoveryState", () => {
  test("parseGateRefusalRecoveryState accepts a slot_contention record", () => {
    const record: GateRefusalRecoveryState = {
      cause: "slot_contention",
      gateCommand: "bun run test:v2",
      slotRedriveCount: 2,
    };
    expect(parseGateRefusalRecoveryState(JSON.stringify(record))).toEqual({ kind: "valid", record });
  });

  test("parseGateRefusalRecoveryState accepts a ceiling_headroom record", () => {
    const record: GateRefusalRecoveryState = {
      cause: "ceiling_headroom",
      gateCommand: "bun run ready",
      slotRedriveCount: 0,
    };
    expect(parseGateRefusalRecoveryState(JSON.stringify(record))).toEqual({ kind: "valid", record });
  });

  test("parseGateRefusalRecoveryState accepts a legacy_unknown record", () => {
    const record: GateRefusalRecoveryState = {
      cause: "legacy_unknown",
      gateCommand: "bun run test:v2",
      slotRedriveCount: 0,
    };
    expect(parseGateRefusalRecoveryState(JSON.stringify(record))).toEqual({ kind: "valid", record });
  });

  test("parseGateRefusalRecoveryState treats null as absent", () => {
    expect(parseGateRefusalRecoveryState(null)).toEqual({ kind: "absent" });
  });

  test("parseGateRefusalRecoveryState rejects malformed JSON and invalid shapes without throwing", () => {
    const base: GateRefusalRecoveryState = {
      cause: "slot_contention",
      gateCommand: "bun run test:v2",
      slotRedriveCount: 1,
    };
    const invalid: unknown[] = [
      "not-json",
      "{not-json",
      "null",
      "[]",
      '"string"',
      JSON.stringify({ ...base, cause: "unknown_cause" }),
      JSON.stringify({ ...base, cause: 7 }),
      JSON.stringify({ ...base, gateCommand: 7 }),
      JSON.stringify({ ...base, slotRedriveCount: -1 }),
      JSON.stringify({ ...base, slotRedriveCount: 1.5 }),
      JSON.stringify({ ...base, slotRedriveCount: "1" }),
      JSON.stringify({ ...base, slotRedriveCount: undefined }),
    ];
    for (const json of invalid) {
      expect(parseGateRefusalRecoveryState(json as string)).toEqual({ kind: "invalid" });
    }
    expect(parseGateRefusalRecoveryState(JSON.stringify(base))).toEqual({ kind: "valid", record: base });
  });
});
