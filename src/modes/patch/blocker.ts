import { readFileSync } from "node:fs";
import { parsePatchSpec } from "./spec.ts";

export function hasBlocker(subspecPath: string): boolean {
  const content = readFileSync(subspecPath, "utf8");
  return parsePatchSpec(content).blocker !== undefined;
}

export function extractBlockerBody(subspecPath: string): string | null {
  const content = readFileSync(subspecPath, "utf8");
  return parsePatchSpec(content).blocker ?? null;
}
