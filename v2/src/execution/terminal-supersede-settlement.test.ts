import { describe, expect, test } from "bun:test";
import {
  formatTerminalSupersedeSettlementComment,
  parseTerminalSupersedeSettlementSuccessorPrNumber,
} from "./terminal-supersede-settlement.ts";

describe("terminal supersede settlement comment", () => {
  test("format matches pipeline terminal publication body", () => {
    const body = formatTerminalSupersedeSettlementComment({
      terminalPrNumber: 42,
      pipelineId: "pipe-abc",
      stageId: "intent",
    });
    expect(body).toBe("Superseded by #42 (pipeline pipe-abc, stage intent)");
    expect(parseTerminalSupersedeSettlementSuccessorPrNumber(body)).toBe(42);
  });

  test("parse rejects non-exact bodies", () => {
    expect(parseTerminalSupersedeSettlementSuccessorPrNumber("Superseded by #42")).toBeUndefined();
    expect(
      parseTerminalSupersedeSettlementSuccessorPrNumber("Superseded by #42 (pipeline p, stage s) extra"),
    ).toBeUndefined();
  });
});
