import { describe, expect, test } from "bun:test";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import { formatLogFollowLine } from "./tui-log-follow-lines.ts";

function record(event: PersistedRecord["event"]): PersistedRecord {
  return { runId: "run-1", seq: 1, ts: "2026-01-01T00:00:00.000Z", event };
}

describe("formatLogFollowLine", () => {
  test("renders producer, reason, and outcomeKind for linked_implement_finalization", () => {
    const line = formatLogFollowLine(
      record({
        kind: "linked_implement_finalization",
        producer: "pass_finalization",
        reason: "link_incomplete",
        outcomeKind: "contract_miss",
      }),
    );

    expect(line).toContain("kind=linked_implement_finalization");
    expect(line).toContain("producer=pass_finalization");
    expect(line).toContain("reason=link_incomplete");
    expect(line).toContain("outcomeKind=contract_miss");
  });

  test("renders the routing producer's blocked outcome", () => {
    const line = formatLogFollowLine(
      record({
        kind: "linked_implement_finalization",
        producer: "routing",
        reason: "malformed_link",
        outcomeKind: "blocked",
      }),
    );

    expect(line).toContain("producer=routing");
    expect(line).toContain("reason=malformed_link");
    expect(line).toContain("outcomeKind=blocked");
  });
});
