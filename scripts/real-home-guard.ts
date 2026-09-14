// Pure snapshot/diff logic for the test-preload real-home write guard.
//
// The preload isolates JARVIS_HOME for the suite, but nothing catches a test that writes the
// operator's *real* `~/.jarvis` anyway (bypassing JARVIS_HOME via homedir()). This module snapshots
// the real home before the run and diffs after: new entries under sessions/ and specs/, and a
// changed telemetry.jsonl. `setup-fake-agents.ts` wires it; homeDir is always caller-supplied
// (never resolved here) so this stays testable against temp-dir fixtures.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// specs/ nests a few levels deep (specs/<org>/<project>/<timestamp>-<name>/...); bounded recursion
// avoids a full walk of a directory that, like sessions/, can grow very large.
const SPECS_WALK_MAX_DEPTH = 4;

export type RealHomeSnapshot = {
  sessionEntries: string[];
  specEntries: string[];
  telemetry: { size: number; mtimeMs: number } | null;
};

function listBoundedDepthEntries(dir: string, maxDepth: number): string[] {
  const entries: string[] = [];
  const walk = (currentDir: string, relPrefix: string, depth: number): void => {
    let names: string[];
    try {
      names = readdirSync(currentDir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const relPath = relPrefix ? `${relPrefix}/${name}` : name;
      entries.push(relPath);
      if (depth >= maxDepth) {
        continue;
      }
      const absPath = join(currentDir, name);
      let isDirectory = false;
      try {
        isDirectory = statSync(absPath).isDirectory();
      } catch {
        isDirectory = false;
      }
      if (isDirectory) {
        walk(absPath, relPath, depth + 1);
      }
    }
  };
  walk(dir, "", 0);
  return entries;
}

function statTelemetry(homeDir: string): { size: number; mtimeMs: number } | null {
  try {
    const stat = statSync(join(homeDir, "telemetry.jsonl"));
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

/** Snapshot of `homeDir`'s sessions/specs listings and telemetry log stat. */
export function snapshotRealHome(homeDir: string): RealHomeSnapshot {
  return {
    // Top-level only (maxDepth 0): sessions/ can hold ~1.24M files, so no bounded recursion into it.
    sessionEntries: listBoundedDepthEntries(join(homeDir, "sessions"), 0),
    specEntries: listBoundedDepthEntries(join(homeDir, "specs"), SPECS_WALK_MAX_DEPTH),
    telemetry: statTelemetry(homeDir),
  };
}

/** Offending paths present in `after` but not `before` (plus a changed telemetry log); empty means clean. */
export function diffRealHomeSnapshots(before: RealHomeSnapshot, after: RealHomeSnapshot): string[] {
  const violations: string[] = [];

  const beforeSessions = new Set(before.sessionEntries);
  for (const entry of after.sessionEntries) {
    if (!beforeSessions.has(entry)) {
      violations.push(`sessions/${entry}`);
    }
  }

  const beforeSpecs = new Set(before.specEntries);
  for (const entry of after.specEntries) {
    if (!beforeSpecs.has(entry)) {
      violations.push(`specs/${entry}`);
    }
  }

  if (
    after.telemetry !== null &&
    (before.telemetry === null ||
      after.telemetry.size !== before.telemetry.size ||
      after.telemetry.mtimeMs !== before.telemetry.mtimeMs)
  ) {
    violations.push("telemetry.jsonl");
  }

  return violations.sort();
}
