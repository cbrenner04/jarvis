import { describe, expect, it } from "bun:test";
import type { Io } from "../src/cli.ts";
import { pricesShowCommand } from "../src/commands/prices-show.ts";

function captureIo(): { io: Io; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

describe("prices show", () => {
  it("displays pricing table successfully", () => {
    const cap = captureIo();
    const code = pricesShowCommand({ io: cap.io });
    expect(code).toBe(0);

    const output = cap.out();
    // Should have header row
    expect(output).toContain("MODEL");
    expect(output).toContain("INPUT");
    expect(output).toContain("OUTPUT");
    expect(output).toContain("CACHE_R");
    expect(output).toContain("CACHE_W");
    expect(output).toContain("AS_OF");
    expect(output).toContain("MANUAL");
    expect(output).toContain("SOURCE");
  });

  it("renders rows in alphabetical order by model ID", () => {
    const cap = captureIo();
    const code = pricesShowCommand({ io: cap.io });
    expect(code).toBe(0);

    const output = cap.out();
    const lines = output.trim().split("\n");
    // Skip header row
    const modelIds = lines
      .slice(1)
      .map((line) => line.split(/\s+/)[0])
      .filter((id) => id);

    // Check if sorted
    const sorted = [...modelIds].sort();
    expect(modelIds).toEqual(sorted);
  });

  it("renders null rates as —", () => {
    const cap = captureIo();
    const code = pricesShowCommand({ io: cap.io });
    expect(code).toBe(0);

    const output = cap.out();
    // cursor-default should have null rates displayed as "—"
    const lines = output.trim().split("\n");
    const cursorLine = lines.find((line) => line.includes("cursor-default"));
    expect(cursorLine).toContain("—");
  });

  it("renders manual flag rows with * in MANUAL column", () => {
    const cap = captureIo();
    const code = pricesShowCommand({ io: cap.io });
    expect(code).toBe(0);

    const output = cap.out();
    // cursor-default should have * in MANUAL column
    const lines = output.trim().split("\n");
    const cursorLine = lines.find((line) => line.includes("cursor-default"));
    if (cursorLine) {
      // The MANUAL column should be near the end
      expect(cursorLine).toMatch(/\*\s+https:\/\//);
    }
  });
});
