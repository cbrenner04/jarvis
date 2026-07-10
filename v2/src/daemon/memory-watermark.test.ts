import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTLE_DELAY_MS } from "../config/machine-profile-loader.ts";
import { hasMemoryHeadroom, loadSettleDelayMs } from "./memory-watermark.ts";

let machinesDir: string | undefined;

function writeProfile(name: string, value: unknown): string {
  machinesDir ??= mkdtempSync(join(tmpdir(), "memory-watermark-machines-"));
  writeFileSync(join(machinesDir, `${name}.json`), JSON.stringify(value));
  return name;
}

afterEach(() => {
  if (machinesDir !== undefined) {
    rmSync(machinesDir, { recursive: true, force: true });
    machinesDir = undefined;
  }
});

const GB = 1024 ** 3;

describe("hasMemoryHeadroom", () => {
  test("returns true when memory.minFreeGb is unset, regardless of reader value", () => {
    const profile = writeProfile("memory-watermark-test-no-memory", { models: {} });
    expect(hasMemoryHeadroom(profile, () => 0, { machinesDir })).toBe(true);
  });

  test("returns false when free memory is below the configured floor", () => {
    const profile = writeProfile("memory-watermark-test-below-floor", { models: {}, memory: { minFreeGb: 4 } });
    expect(hasMemoryHeadroom(profile, () => 3 * GB, { machinesDir })).toBe(false);
  });

  test("returns true when free memory is at the configured floor", () => {
    const profile = writeProfile("memory-watermark-test-at-floor", { models: {}, memory: { minFreeGb: 4 } });
    expect(hasMemoryHeadroom(profile, () => 4 * GB, { machinesDir })).toBe(true);
  });

  test("returns true when free memory is above the configured floor", () => {
    const profile = writeProfile("memory-watermark-test-above-floor", { models: {}, memory: { minFreeGb: 4 } });
    expect(hasMemoryHeadroom(profile, () => 5 * GB, { machinesDir })).toBe(true);
  });
});

describe("loadSettleDelayMs", () => {
  test("returns the profile's configured settle delay", () => {
    const profile = writeProfile("memory-watermark-test-settle-delay", {
      models: {},
      memory: { settleDelayMs: 500 },
    });
    expect(loadSettleDelayMs(profile, { machinesDir })).toBe(500);
  });

  test("returns the default settle delay when unset", () => {
    const profile = writeProfile("memory-watermark-test-settle-delay-default", { models: {} });
    expect(loadSettleDelayMs(profile, { machinesDir })).toBe(DEFAULT_SETTLE_DELAY_MS);
  });
});
