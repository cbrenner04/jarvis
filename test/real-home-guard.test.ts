import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffRealHomeSnapshots, snapshotRealHome } from "../scripts/real-home-guard.ts";

function makeTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "jarvis-real-home-guard-test-"));
  mkdirSync(join(home, "sessions"), { recursive: true });
  mkdirSync(join(home, "specs", "Org-example", "project"), { recursive: true });
  writeFileSync(join(home, "sessions", "existing.log"), "pre-existing\n");
  writeFileSync(join(home, "telemetry.jsonl"), "line-one\n");
  return home;
}

/** Never reports anything: proves the violating-run test isn't vacuously green against a trivial diff. */
function noOpDiff(): string[] {
  return [];
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
    // The real diff must actually detect the violation; a no-op diff would wrongly report clean.
    expect(noOpDiff()).not.toEqual(violations);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a fresh sessions/specs directory with no prior snapshot data still reports new entries", () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-real-home-guard-test-"));
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
