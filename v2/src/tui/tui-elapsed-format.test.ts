import { describe, expect, test } from "bun:test";
import { formatAggregateDuration, formatAggregateTiming, formatElapsedWallClock } from "./tui-elapsed-format.ts";

const START_MS = 1_700_000_000_000;

function elapsedSeconds(seconds: number, endMs: number | null = null, nowMs = START_MS + seconds * 1_000) {
  return formatElapsedWallClock(START_MS, endMs, nowMs);
}

describe("formatElapsedWallClock", () => {
  test("formatElapsedWallClock covers sub-minute through multi-day ranges within the 8-column budget", () => {
    expect(elapsedSeconds(5)).toBe("5s");
    expect(elapsedSeconds(59)).toBe("59s");
    // Mutation checkpoint: inverting `< MINUTE_S` boundary (use `<=`) must turn 59s/60s pins RED.
    expect(elapsedSeconds(60)).toBe("1m 0s");
    expect(elapsedSeconds(125)).toBe("2m 5s");
    expect(elapsedSeconds(3_599)).toBe("59m 59s");
    // Mutation checkpoint: inverting `< HOUR_S` boundary (use `<=`) must turn 3599s/3600s pins RED.
    expect(elapsedSeconds(3_600)).toBe("1h 0m");
    expect(elapsedSeconds(3_661)).toBe("1h 1m");
    expect(elapsedSeconds(86_399)).toBe("23h 59m");
    // Mutation checkpoint: inverting `< DAY_S` boundary (use `<=`) must turn 86399s/86400s pins RED.
    expect(elapsedSeconds(86_400)).toBe("1d 0h");
    expect(elapsedSeconds(90_000)).toBe("1d 1h");
  });

  test("formatElapsedWallClock never exceeds the 8-column budget", () => {
    const samples = [
      elapsedSeconds(59),
      elapsedSeconds(3_599),
      elapsedSeconds(86_399),
      elapsedSeconds(100 * 86_400 + 23 * 3_600),
    ];
    for (const sample of samples) {
      expect(sample.length).toBeLessThanOrEqual(8);
    }
    expect(samples[3]).toBe("100d 23h");
    // Mutation checkpoint: removing day-tier width cap loop must turn max-width day-tier pin RED.
    const cappedOverflow = formatElapsedWallClock(START_MS, null, START_MS + 10_000 * 86_400_000);
    expect(cappedOverflow.length).toBeLessThanOrEqual(8);
  });

  test("formatElapsedWallClock returns empty string when startMs is null", () => {
    // Mutation checkpoint: inverting `startMs === null` guard must turn this pin RED.
    expect(formatElapsedWallClock(null, null, START_MS)).toBe("");
    expect(formatElapsedWallClock(null, START_MS + 60_000, START_MS + 120_000)).toBe("");
  });

  test("formatElapsedWallClock freezes terminal elapsed when endMs is set", () => {
    const endMs = START_MS + 125_000;
    const frozen = formatElapsedWallClock(START_MS, endMs, endMs);
    // Mutation checkpoint: using `nowMs` instead of `endMs` when `endMs !== null` must turn freeze pin RED.
    expect(frozen).toBe("2m 5s");
    expect(formatElapsedWallClock(START_MS, endMs, endMs + 3_600_000)).toBe(frozen);
    expect(formatElapsedWallClock(START_MS, endMs, endMs + 86_400_000)).toBe(frozen);
  });
});

test("aggregate duration formatting is labeled nonnegative and width-aware", () => {
  // @mutate v2/src/tui/tui-elapsed-format.ts "if (durationMs <= 0) return \"0s\";" -> "if (durationMs <= 0) return \"\";"
  expect([
    formatAggregateDuration(-1),
    formatAggregateDuration(0),
    formatAggregateDuration(59_999),
    formatAggregateDuration(60_000),
    formatAggregateDuration(3_599_999),
    formatAggregateDuration(3_600_000),
    formatAggregateDuration(86_399_999),
    formatAggregateDuration(86_400_000),
  ]).toEqual(["0s", "0s", "59s", "1m", "59m", "1h", "23h", "1d"]);
  expect(formatAggregateTiming(60_000, 86_400_000, false)).toBe("work 1m · idle 1d");
  expect(formatAggregateTiming(60_000, 86_400_000, true)).toBe("w1m/i1d");
  expect(formatAggregateTiming(0, null, false)).toBe("work 0s");
  expect(formatAggregateTiming(0, null, true)).toBe("w0s");
});
