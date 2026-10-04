import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { Io } from "../cli/io.ts";
import { jarvisHome } from "../paths.ts";

export type RoutingAuditOutcome =
  | "routing-rejected"
  | "routing-failed"
  | "validation-rejected"
  | "resolution-rejected"
  | "dispatched";

export type RoutingAuditLine = {
  at: string;
  operatorSessionId: string;
  requestSha256: string;
  requestLength: number;
  outcome: RoutingAuditOutcome;
  action?: string;
  dispatchExitCode?: number;
  reason?: string;
};

export function routingAuditFilePath(homeDir?: string): string {
  return join(homeDir ?? jarvisHome(), "routing-audit.jsonl");
}

export function normalizedRequestDigest(normalizedBody: string): { requestSha256: string; requestLength: number } {
  return {
    requestSha256: createHash("sha256").update(normalizedBody, "utf8").digest("hex"),
    requestLength: normalizedBody.length,
  };
}

export async function appendRoutingAuditLine(line: RoutingAuditLine, io: Io, auditPath?: string): Promise<void> {
  const path = auditPath ?? routingAuditFilePath();
  try {
    await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`warning: could not append routing audit (${path}): ${message}\n`);
  }
}
