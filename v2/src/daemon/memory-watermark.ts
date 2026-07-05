import { freemem } from "node:os";
import { loadMachineConfigMemory } from "../config/machine-config-loader.ts";

const BYTES_PER_GB = 1024 ** 3;

export function hasMemoryHeadroom(configPath?: string, freeMemReader: () => number = freemem): boolean {
  const memory = loadMachineConfigMemory(configPath);
  if (memory === undefined) {
    return true;
  }

  return freeMemReader() >= memory.minFreeGb * BYTES_PER_GB;
}
