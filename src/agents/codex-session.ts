import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TelemetryUsage } from "../telemetry.ts";

type SessionCandidate = { path: string; mtimeMs: number };

function listSessionFiles(dir: string): SessionCandidate[] {
  const out: SessionCandidate[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fileName = String(entry.name);
      const filePath = join(current, fileName);
      if (entry.isDirectory()) {
        stack.push(filePath);
        continue;
      }
      if (!entry.isFile() || !fileName.endsWith(".jsonl")) {
        continue;
      }
      try {
        const stats = statSync(filePath);
        out.push({ path: filePath, mtimeMs: stats.mtimeMs });
      } catch {
        // best-effort: ignore files we cannot stat
      }
    }
  }

  return out;
}

export function getCodexSessionsDir(): string {
  return join(process.env.HOME ?? homedir(), ".codex", "sessions");
}

export function findCodexSessionFile(opts: {
  sessionsDir: string;
  snapshotMtime: number | null;
}): string | null {
  const candidates = listSessionFiles(opts.sessionsDir)
    .filter((c) =>
      opts.snapshotMtime === null ? true : c.mtimeMs > opts.snapshotMtime,
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path ?? null;
}

export function findCodexSessionFilesSince(opts: {
  sessionsDir: string;
  snapshotMtime: number | null;
}): string[] {
  return listSessionFiles(opts.sessionsDir)
    .filter((c) =>
      opts.snapshotMtime === null ? true : c.mtimeMs > opts.snapshotMtime,
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((c) => c.path);
}

export function latestCodexSessionMtime(sessionsDir: string): number | null {
  const latest = listSessionFiles(sessionsDir).sort(
    (a, b) => b.mtimeMs - a.mtimeMs,
  )[0];
  return latest?.mtimeMs ?? null;
}

export function parseCodexSessionUsage(filePath: string): {
  usage: TelemetryUsage | null;
  warnings: string[];
} {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    return {
      usage: null,
      warnings: [
        `failed to read codex session file ${filePath}: ${(err as Error).message}`,
      ],
    };
  }

  let best: TelemetryUsage | null = null;
  let bestTotal = -1;
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warnings.push("malformed JSONL line in codex session file");
      continue;
    }

    const usage = extractTokenUsage(parsed);
    if (usage === null) {
      continue;
    }
    const total =
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    if (total >= bestTotal) {
      best = usage;
      bestTotal = total;
    }
  }

  if (best === null) {
    warnings.push("no token usage events found in codex session file");
    return { usage: null, warnings };
  }
  return { usage: best, warnings };
}

function extractTokenUsage(event: unknown): TelemetryUsage | null {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const rec = event as Record<string, unknown>;
  if (rec.type !== "event_msg") {
    return null;
  }
  const payload = rec.payload;
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const payloadRec = payload as Record<string, unknown>;
  if (payloadRec.type !== "token_count") {
    return null;
  }
  const info = payloadRec.info;
  if (info === null || typeof info !== "object" || Array.isArray(info)) {
    return null;
  }
  const infoRec = info as Record<string, unknown>;
  const total = infoRec.total_token_usage;
  if (total === null || typeof total !== "object" || Array.isArray(total)) {
    return null;
  }
  const totalRec = total as Record<string, unknown>;

  const input = numberOrNull(totalRec.input_tokens);
  const cachedInput = numberOrNull(totalRec.cached_input_tokens);
  const output = numberOrNull(totalRec.output_tokens);

  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cachedInput,
    cache_creation_input_tokens: null,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
