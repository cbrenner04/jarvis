import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasMemoryHeadroom } from "./memory-watermark.ts";

function writeConfig(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-memory-watermark-test-"));
  const configPath = join(dir, "v2.json");
  writeFileSync(configPath, JSON.stringify(value));
  return configPath;
}

const GB = 1024 ** 3;

describe("hasMemoryHeadroom", () => {
  test("returns true when memory.minFreeGb is unset, regardless of reader value", () => {
    const configPath = writeConfig({});
    expect(hasMemoryHeadroom(configPath, () => 0)).toBe(true);
  });

  test("returns true when config file does not exist", () => {
    expect(hasMemoryHeadroom("/nonexistent/path/v2.json", () => 0)).toBe(true);
  });

  test("returns false when free memory is below the configured floor", () => {
    const configPath = writeConfig({ memory: { minFreeGb: 4 } });
    expect(hasMemoryHeadroom(configPath, () => 3 * GB)).toBe(false);
  });

  test("returns true when free memory is at the configured floor", () => {
    const configPath = writeConfig({ memory: { minFreeGb: 4 } });
    expect(hasMemoryHeadroom(configPath, () => 4 * GB)).toBe(true);
  });

  test("returns true when free memory is above the configured floor", () => {
    const configPath = writeConfig({ memory: { minFreeGb: 4 } });
    expect(hasMemoryHeadroom(configPath, () => 5 * GB)).toBe(true);
  });
});
