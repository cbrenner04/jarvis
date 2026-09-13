import { describe, expect, test } from "bun:test";
import { formatLogFollowLine } from "./tui-log-follow-lines.ts";

describe("formatLogFollowLine", () => {
  test("renders producer, reason, and outcomeKind for linked_implement_finalization", () => {
    const line = formatLogFollowLine({
      runId: "run-1",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      event: {
        kind: "linked_implement_finalization",
        producer: "pass_finalization",
        reason: "link_incomplete",
        outcomeKind: "contract_miss",
      },
    });

    expect(line).toContain("kind=linked_implement_finalization");
    expect(line).toContain("producer=pass_finalization");
    expect(line).toContain("reason=link_incomplete");
    expect(line).toContain("outcomeKind=contract_miss");
  });
});
