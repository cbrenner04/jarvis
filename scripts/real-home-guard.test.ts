// Co-located with real-home-guard.ts (mutation gate requires an exact-stem test in the same
// directory); the full snapshot/diff behavior is covered by test/real-home-guard.test.ts. This file
// targets the SPECS_WALK_MAX_DEPTH boundary guard specifically.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffRealHomeSnapshots, type RealHomeSnapshot, snapshotRealHome } from "./real-home-guard.ts";

test("sessions/ diff reports the entry new in after, not the entry already present in before", () => {
  // Inverting `!beforeSessions.has(entry)` to `beforeSessions.has(entry)` would flip this: the
  // pre-existing entry would wrongly be reported and the genuinely new one would be missed.
  const before: RealHomeSnapshot = {
    sessionEntries: ["existing.log"],
    specEntries: [],
    telemetry: null,
  };
  const after: RealHomeSnapshot = {
    sessionEntries: ["existing.log", "leaked-session.log"],
    specEntries: [],
    telemetry: null,
  };

  expect(diffRealHomeSnapshots(before, after)).toEqual(["sessions/leaked-session.log"]);
});

test("specs/ diff reports the entry new in after, not the entry already present in before", () => {
  // Inverting `!beforeSpecs.has(entry)` to `beforeSpecs.has(entry)` would flip this: the
  // pre-existing entry would wrongly be reported and the genuinely new one would be missed.
  const before: RealHomeSnapshot = {
    sessionEntries: [],
    specEntries: ["existing-spec"],
    telemetry: null,
  };
  const after: RealHomeSnapshot = {
    sessionEntries: [],
    specEntries: ["existing-spec", "leaked-spec"],
    telemetry: null,
  };

  expect(diffRealHomeSnapshots(before, after)).toEqual(["specs/leaked-spec"]);
});

test("unchanged telemetry.jsonl between snapshots is not reported as a violation", () => {
  // Inverting `before.telemetry === null` to `before.telemetry !== null` would report a violation
  // any time telemetry existed before the run, even with an identical size/mtime after — this
  // isolates that branch from the size/mtime comparisons, which stay false either way here.
  const before: RealHomeSnapshot = {
    sessionEntries: [],
    specEntries: [],
    telemetry: { size: 42, mtimeMs: 1000 },
  };
  const after: RealHomeSnapshot = {
    sessionEntries: [],
    specEntries: [],
    telemetry: { size: 42, mtimeMs: 1000 },
  };

  expect(diffRealHomeSnapshots(before, after)).toEqual([]);
});

test("specs/ walk recurses past the first level: entries below SPECS_WALK_MAX_DEPTH are still listed", () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-real-home-guard-boundary-test-"));
  try {
    // Inverting `depth >= maxDepth` to `depth < maxDepth` stops recursion at depth 0: only the
    // top-level "a" would be listed, not "a/b" or deeper.
    mkdirSync(join(home, "specs", "a", "b", "c"), { recursive: true });

    const snapshot = snapshotRealHome(home);

    expect(snapshot.specEntries).toContain("a/b");
    expect(snapshot.specEntries).toContain("a/b/c");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
