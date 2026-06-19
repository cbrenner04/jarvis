import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_TIMEOUT_MS, parseTimeout, runCommand, TIMEOUT_EXIT_CODE } from "../../scripts/ready.ts";

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

describe("ready script deadline enforcement", () => {
  test("timeout validation: parsing valid JARVIS_READY_TIMEOUT_MS", () => {
    withEnv("JARVIS_READY_TIMEOUT_MS", "5000", () => {
      expect(parseTimeout()).toBe(5000);
    });
  });

  test("timeout validation: invalid JARVIS_READY_TIMEOUT_MS produces warning", () => {
    const writes: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = function (this: typeof process.stderr, chunk, ...args) {
      writes.push(String(chunk));
      return origWrite.apply(this, [chunk, ...args] as Parameters<typeof origWrite>);
    };

    try {
      withEnv("JARVIS_READY_TIMEOUT_MS", "not-a-number", () => {
        expect(parseTimeout()).toBe(DEFAULT_TIMEOUT_MS);
      });
      const stderr = writes.join("");
      expect(stderr).toContain("warning");
      expect(stderr).toContain("not-a-number");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("timeout validation: missing JARVIS_READY_TIMEOUT_MS uses default", () => {
    withEnv("JARVIS_READY_TIMEOUT_MS", undefined, () => {
      expect(parseTimeout()).toBe(DEFAULT_TIMEOUT_MS);
    });
  });

  test("runCommand exits with 124 when the deadline is exceeded", async () => {
    const code = await runCommand("sleep", ["2"], 50, 0);
    expect(code).toBe(TIMEOUT_EXIT_CODE);
  });

  test("runCommand exits normally when commands complete", async () => {
    expect(await runCommand("true", [], 5000, 0)).toBe(0);
  });

  test("bun install runs before check:fix in command sequence", () => {
    const readySource = readFileSync("./scripts/ready.ts", "utf8");
    const checkFixIndex = readySource.indexOf('{ name: "bun", args: ["run", "check:fix"]');
    const installIndex = readySource.indexOf('{ name: "bun", args: ["install",');

    expect(checkFixIndex).toBeGreaterThan(0);
    expect(installIndex).toBeGreaterThan(0);
    expect(installIndex).toBeLessThan(checkFixIndex);
  });

  test("when a command exits non-zero, runCommand returns its exit code", async () => {
    expect(await runCommand("false", [], 5000, 0)).toBe(1);
  });
});
