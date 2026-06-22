import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type FileActivityScanResult = {
  lastActivityMs: number | null;
};

function scanWorkingTreeFileActivity(cwd: string): FileActivityScanResult {
  let lastActivityMs: number | null = null;

  function walk(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip .git entirely
        if (entry.name === ".git") {
          continue;
        }

        const fullPath = join(dir, entry.name);
        try {
          const stat = statSync(fullPath);
          const mtimeMs = stat.mtime.getTime();
          if (lastActivityMs === null || mtimeMs > lastActivityMs) {
            lastActivityMs = mtimeMs;
          }

          if (entry.isDirectory()) {
            walk(fullPath);
          }
        } catch {
          // Ignore stat failures (e.g., permission denied, symlink issues)
        }
      }
    } catch {
      // Ignore readdir failures
    }
  }

  walk(cwd);
  return { lastActivityMs };
}

export type IdleWatchdogState = {
  lastOutputAgeMs: number | null;
  lastFileActivityAgeMs: number | null;
};

export function evaluateIdleWatchdog(opts: {
  now: number;
  lastOutputAt: number | null;
  lastFileActivityAt: number | null;
  armedAt: number;
  idleOutputTimeoutMs: number;
}): { shouldFire: boolean; lastFileActivityAgeMs: number | null } {
  const effectiveLastActivityAt = Math.max(opts.lastOutputAt ?? opts.armedAt, opts.lastFileActivityAt ?? opts.armedAt);

  const idleAgeMs = opts.now - effectiveLastActivityAt;
  const shouldFire = idleAgeMs >= opts.idleOutputTimeoutMs;

  const lastFileActivityAgeMs = opts.lastFileActivityAt === null ? null : opts.now - opts.lastFileActivityAt;

  return { shouldFire, lastFileActivityAgeMs };
}

export function sampleFileActivityIfNeeded(opts: {
  lastOutputAgeMs: number | null;
  idleOutputTimeoutMs: number;
  now: number;
  armedAt: number;
  workingDir: string;
}): number | null {
  // Sample file activity only on the cheap path — when output is already stale
  // and watchdog is about to fire. Avoid expensive full-tree scan on every poll.
  if (opts.lastOutputAgeMs === null) {
    const timeSinceArmed = opts.now - opts.armedAt;
    if (timeSinceArmed >= opts.idleOutputTimeoutMs) {
      const result = scanWorkingTreeFileActivity(opts.workingDir);
      return result.lastActivityMs;
    }
  }
  return null;
}
