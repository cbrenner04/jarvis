import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { InvocationTelemetrySink } from "../../../shared/invocation/execute.ts";

/** JSONL telemetry sink appending to `path`, creating its parent directory as needed. */
export function buildJsonlSink(path: string): InvocationTelemetrySink {
  return {
    append(record) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
    },
  };
}
