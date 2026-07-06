import { freemem } from "node:os";
import { loadMachineProfileMemory } from "../config/machine-profile-loader.ts";

const BYTES_PER_GB = 1024 ** 3;

export function hasMemoryHeadroom(profileName: string, freeMemReader: () => number = freemem): boolean {
  const memory = loadMachineProfileMemory(profileName);
  if (memory.minFreeGb === undefined) {
    return true;
  }

  return freeMemReader() >= memory.minFreeGb * BYTES_PER_GB;
}

/** Delay (ms) after promoting a queued run before the next promotion re-measures headroom. */
export function loadSettleDelayMs(profileName: string): number {
  return loadMachineProfileMemory(profileName).settleDelayMs;
}
