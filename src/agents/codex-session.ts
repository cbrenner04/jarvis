import {
  type Dirent,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TelemetryUsage } from "../telemetry.ts";

/** Per-path state for all `*.jsonl` files under the Codex sessions tree. */
export type CodexSessionPathState = {
  mtimeMs: number;
  size: number;
};

/** Map of absolute session file path → last observed size and mtime. */
export type CodexSessionsSnapshot = Map<string, CodexSessionPathState>;

type ListedFile = { path: string; mtimeMs: number; size: number };

function listSessionFileStats(dir: string): ListedFile[] {
  const out: ListedFile[] = [];
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
        out.push({ path: filePath, mtimeMs: stats.mtimeMs, size: stats.size });
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

export function snapshotCodexSessionFiles(
  sessionsDir: string,
): CodexSessionsSnapshot {
  const map: CodexSessionsSnapshot = new Map();
  for (const f of listSessionFileStats(sessionsDir)) {
    map.set(f.path, { mtimeMs: f.mtimeMs, size: f.size });
  }
  return map;
}

/**
 * Session files that did not exist in `before` or whose size/mtime changed.
 */
export function listChangedCodexSessionFiles(opts: {
  sessionsDir: string;
  before: CodexSessionsSnapshot;
}): string[] {
  const after = snapshotCodexSessionFiles(opts.sessionsDir);
  const changed: string[] = [];
  for (const [path, state] of after) {
    const prev = opts.before.get(path);
    if (
      prev === undefined ||
      prev.mtimeMs !== state.mtimeMs ||
      prev.size !== state.size
    ) {
      changed.push(path);
    }
  }
  return changed;
}

function cwdEqual(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

/**
 * If any structured cwd field disagrees with `jarvisCwd`, the file cannot be this invocation.
 * When no cwd metadata exists (older Codex), the file is still eligible.
 */
export function sessionFileCwdsCompatible(
  content: string,
  jarvisCwd: string,
): boolean {
  const lines = content.split(/\r?\n/);
  const seenCwds: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      continue;
    }
    const rec = parsed as Record<string, unknown>;
    const typ = rec.type;
    const payload = rec.payload;
    if (
      payload === null ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      continue;
    }
    const p = payload as Record<string, unknown>;
    if (typ === "session_meta" && typeof p.cwd === "string") {
      seenCwds.push(p.cwd);
    }
    if (typ === "turn_context" && typeof p.cwd === "string") {
      seenCwds.push(p.cwd);
    }
  }
  if (seenCwds.length === 0) {
    return true;
  }
  return seenCwds.every((c) => cwdEqual(c, jarvisCwd));
}

/** Structured prompt / input shapes first; whole-file substring is a compatibility fallback. */
export function sessionContentHasInvocationMarker(
  content: string,
  invocationMarker: string,
): { matched: boolean; usedRawFallback: boolean } {
  let structured = false;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (lineIncludesMarkerStructured(parsed, invocationMarker)) {
      structured = true;
      return { matched: true, usedRawFallback: false };
    }
  }
  if (content.includes(invocationMarker)) {
    return { matched: true, usedRawFallback: !structured };
  }
  return { matched: false, usedRawFallback: false };
}

function lineIncludesMarkerStructured(
  event: unknown,
  invocationMarker: string,
): boolean {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    return false;
  }
  const rec = event as Record<string, unknown>;
  const typ = rec.type;
  const payload = rec.payload;
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return false;
  }
  const p = payload as Record<string, unknown>;

  if (
    typ === "event_msg" &&
    p.type === "user_message" &&
    typeof p.message === "string" &&
    p.message.includes(invocationMarker)
  ) {
    return true;
  }

  if (
    typ === "response_item" &&
    p.type === "message" &&
    p.role === "user" &&
    Array.isArray(p.content)
  ) {
    for (const item of p.content) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).type === "input_text" &&
        typeof (item as Record<string, unknown>).text === "string" &&
        String((item as Record<string, unknown>).text).includes(
          invocationMarker,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

export function sessionContentHasTokenCountEvent(content: string): boolean {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (extractTokenUsage(parsed) !== null) {
      return true;
    }
  }
  return false;
}

export function resolveCodexSessionUsage(opts: {
  sessionsDir: string;
  beforeSnapshot: CodexSessionsSnapshot;
  invocationMarker: string;
  cwd: string;
}): {
  usage: TelemetryUsage | null;
  warnings: string[];
  sessionFile: string | null;
} {
  const changed = listChangedCodexSessionFiles({
    sessionsDir: opts.sessionsDir,
    before: opts.beforeSnapshot,
  });

  if (changed.length === 0) {
    return {
      usage: null,
      warnings: [
        "codex usage unavailable: no session JSONL changed after this invocation",
      ],
      sessionFile: null,
    };
  }

  const matched: string[] = [];
  for (const path of changed) {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (!sessionFileCwdsCompatible(content, opts.cwd)) {
      continue;
    }
    const { matched: hasMarker } = sessionContentHasInvocationMarker(
      content,
      opts.invocationMarker,
    );
    if (!hasMarker) {
      continue;
    }
    if (!sessionContentHasTokenCountEvent(content)) {
      continue;
    }
    matched.push(path);
  }

  if (matched.length === 0) {
    return {
      usage: null,
      warnings: [
        "codex usage unavailable: no changed session file matched this invocation marker and cwd",
      ],
      sessionFile: null,
    };
  }

  if (matched.length > 1) {
    return {
      usage: null,
      warnings: [
        `codex usage unavailable: multiple session files matched this invocation; refusing to guess: ${matched.sort().join(", ")}`,
      ],
      sessionFile: null,
    };
  }

  const sessionFile = matched[0];
  if (sessionFile === undefined) {
    return {
      usage: null,
      warnings: [
        "codex usage unavailable: no session file could be correlated to this invocation",
      ],
      sessionFile: null,
    };
  }

  const parsed = parseCodexSessionUsage(sessionFile);
  return {
    usage: parsed.usage,
    warnings: parsed.warnings,
    sessionFile,
  };
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
  let malformedJsonlLines = 0;
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedJsonlLines += 1;
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

  if (malformedJsonlLines > 0) {
    warnings.push(
      `skipped ${malformedJsonlLines} malformed JSONL line(s) in codex session file`,
    );
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
