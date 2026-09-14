import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffRealHomeSnapshots, snapshotRealHome } from "../scripts/real-home-guard.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "jarvis-real-home-guard-test-"));
}

function makeTempHome(): string {
  const home = makeTempDir();
  mkdirSync(join(home, "sessions"), { recursive: true });
  mkdirSync(join(home, "specs", "Org-example", "project"), { recursive: true });
  writeFileSync(join(home, "sessions", "existing.log"), "pre-existing\n");
  writeFileSync(join(home, "telemetry.jsonl"), "line-one\n");
  return home;
}

test("a clean run (no writes between snapshots) reports no violations", () => {
  const home = makeTempHome();
  try {
    const before = snapshotRealHome(home);
    const after = snapshotRealHome(home);

    expect(diffRealHomeSnapshots(before, after)).toEqual([]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a violating run reports new sessions/ and specs/ entries plus a telemetry.jsonl change", () => {
  const home = makeTempHome();
  try {
    const before = snapshotRealHome(home);

    writeFileSync(join(home, "sessions", "leaked-session.log"), "leaked\n");
    writeFileSync(join(home, "specs", "Org-example", "project", "tmp-leak.md"), "leaked\n");
    writeFileSync(join(home, "telemetry.jsonl"), "line-one\nline-two\n");

    const after = snapshotRealHome(home);
    const violations = diffRealHomeSnapshots(before, after);

    expect(violations).toEqual([
      "sessions/leaked-session.log",
      "specs/Org-example/project/tmp-leak.md",
      "telemetry.jsonl",
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("specs/ walk is bounded to SPECS_WALK_MAX_DEPTH: entries past the limit are not listed", () => {
  const home = makeTempDir();
  try {
    // specs/a/b/c/d/e sits exactly at depth 4 (SPECS_WALK_MAX_DEPTH); e/f.md would be depth 5.
    const deepDir = join(home, "specs", "a", "b", "c", "d", "e");
    mkdirSync(deepDir, { recursive: true });
    writeFileSync(join(deepDir, "f.md"), "too-deep\n");

    const snapshot = snapshotRealHome(home);

    expect(snapshot.specEntries).toContain("a/b/c/d/e");
    expect(snapshot.specEntries).not.toContain("a/b/c/d/e/f.md");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("multiple siblings at the max-depth boundary are all listed, not just the first", () => {
  const home = makeTempDir();
  try {
    // specs/a/b/c/d sits at depth 3; its two children "e" and "e2" are both listed at depth 4
    // (the boundary), then neither is recursed into. A `continue` at the boundary must still let
    // the loop move on to list "e2" after "e" — a `break` there would stop after the first sibling.
    const parentDir = join(home, "specs", "a", "b", "c", "d");
    mkdirSync(join(parentDir, "e"), { recursive: true });
    mkdirSync(join(parentDir, "e2"), { recursive: true });

    const snapshot = snapshotRealHome(home);

    expect(snapshot.specEntries).toContain("a/b/c/d/e");
    expect(snapshot.specEntries).toContain("a/b/c/d/e2");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a fresh sessions/specs directory with no prior snapshot data still reports new entries", () => {
  const home = makeTempDir();
  try {
    const before = snapshotRealHome(home);

    mkdirSync(join(home, "sessions"), { recursive: true });
    writeFileSync(join(home, "sessions", "first-write.log"), "leaked\n");

    const after = snapshotRealHome(home);

    expect(diffRealHomeSnapshots(before, after)).toEqual(["sessions/first-write.log"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
