import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readSpecGuidance(): string {
  return readFileSync(join(import.meta.dir, "..", "..", "docs", "spec-guidance-agent-core.md"), "utf8");
}
