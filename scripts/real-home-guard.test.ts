// Co-located with real-home-guard.ts (mutation gate requires an exact-stem test in the same
// directory); the full snapshot/diff behavior is covered by test/real-home-guard.test.ts. This file
// targets the SPECS_WALK_MAX_DEPTH boundary guard specifically.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotRealHome } from "./real-home-guard.ts";

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
