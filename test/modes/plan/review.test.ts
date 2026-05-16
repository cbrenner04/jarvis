import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotSpecFiles } from "../../../src/modes/plan/review.ts";

describe("snapshotSpecFiles", () => {
  test("returns files in deterministic sorted order regardless of disk order", () => {
    // Create a temporary directory with files in reverse alphabetical order on disk
    const tmpPath = join(
      tmpdir(),
      `spec-test-${randomBytes(4).toString("hex")}`,
    );
    const specDir = join(tmpPath, "spec", "test-spec");
    mkdirSync(specDir, { recursive: true });

    // Write files in reverse alphabetical order: z, y, x, ...
    const fileOrder = ["z-last.md", "m-middle.md", "a-first.md"];
    for (const file of fileOrder) {
      writeFileSync(join(specDir, file), `# ${file}\n`);
    }

    const snapshot = snapshotSpecFiles(tmpPath, "test-spec");

    // Extract the file order from the snapshot
    const fileMatches =
      snapshot.match(/<<<FILE name="([^"]+)" BEGIN>>>/g) || [];
    const extractedFiles = fileMatches.map(
      (match) => match.match(/name="([^"]+)"/)?.[1],
    );

    // Files should be sorted alphabetically regardless of disk order
    expect(extractedFiles).toEqual(["a-first.md", "m-middle.md", "z-last.md"]);
  });
});
