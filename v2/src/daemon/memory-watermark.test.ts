import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTLE_DELAY_MS } from "../config/machine-profile-loader.ts";
import { hasMemoryHeadroom, loadSettleDelayMs } from "./memory-watermark.ts";

const MACHINES_DIR = join(import.meta.dir, "..", "..", "..", "config", "machines");
const writtenProfiles: string[] = [];

function writeProfile(name: string, value: unknown): string {
  mkdirSync(MACHINES_DIR, { recursive: true });
  const filePath = join(MACHINES_DIR, `${name}.json`);
  writeFileSync(filePath, JSON.stringify(value));
  writtenProfiles.push(filePath);
  return name;
}

afterEach(() => {
  for (const filePath of writtenProfiles.splice(0)) {
    if (existsSync(filePath)) rmSync(filePath);
  }
});

const GB = 1024 ** 3;

describe("hasMemoryHeadroom", () => {
  test("returns true when memory.minFreeGb is unset, regardless of reader value", () => {
    const profile = writeProfile("memory-watermark-test-no-memory", { models: {} });
    expect(hasMemoryHeadroom(profile, () => 0)).toBe(true);
  });

  test("returns false when free memory is below the configured floor", () => {
    const profile = writeProfile("memory-watermark-test-below-floor", { models: {}, memory: { minFreeGb: 4 } });
    expect(hasMemoryHeadroom(profile, () => 3 * GB)).toBe(false);
  });

  test("returns true when free memory is at the configured floor", () => {
    const profile = writeProfile("memory-watermark-test-at-floor", { models: {}, memory: { minFreeGb: 4 } });
    expect(hasMemoryHeadroom(profile, () => 4 * GB)).toBe(true);
  });

  test("returns true when free memory is above the configured floor", () => {
    const profile = writeProfile("memory-watermark-test-above-floor", { models: {}, memory: { minFreeGb: 4 } });
    expect(hasMemoryHeadroom(profile, () => 5 * GB)).toBe(true);
  });
});

describe("loadSettleDelayMs", () => {
  test("returns the profile's configured settle delay", () => {
    const profile = writeProfile("memory-watermark-test-settle-delay", {
      models: {},
      memory: { settleDelayMs: 500 },
    });
    expect(loadSettleDelayMs(profile)).toBe(500);
  });

  test("returns the default settle delay when unset", () => {
    const profile = writeProfile("memory-watermark-test-settle-delay-default", { models: {} });
    expect(loadSettleDelayMs(profile)).toBe(DEFAULT_SETTLE_DELAY_MS);
  });
});
