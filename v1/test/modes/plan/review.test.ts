import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasWorkingTreeChanges, snapshotSpecFiles, validateReviewOutput } from "../../../src/modes/plan/review.ts";

describe("snapshotSpecFiles", () => {
  test("returns files in deterministic sorted order regardless of disk order", () => {
    // Create a temporary directory with files in reverse alphabetical order on disk
    const tmpPath = join(tmpdir(), `spec-test-${randomBytes(4).toString("hex")}`);
    const specDir = join(tmpPath, "spec", "test-spec");
    mkdirSync(specDir, { recursive: true });

    // Write files in reverse alphabetical order: z, y, x, ...
    const fileOrder = ["z-last.md", "m-middle.md", "a-first.md"];
    for (const file of fileOrder) {
      writeFileSync(join(specDir, file), `# ${file}\n`);
    }

    const snapshot = snapshotSpecFiles(tmpPath, "test-spec");

    // Extract the file order from the snapshot
    const fileMatches = snapshot.match(/<<<FILE name="([^"]+)" BEGIN>>>/g) || [];
    const extractedFiles = fileMatches.map((match) => match.match(/name="([^"]+)"/)?.[1]);

    // Files should be sorted alphabetically regardless of disk order
    expect(extractedFiles).toEqual(["a-first.md", "m-middle.md", "z-last.md"]);
  });
});

describe("hasWorkingTreeChanges", () => {
  test("returns false when worktree has no changes", () => {
    const tmpPath = join(tmpdir(), `review-test-${randomBytes(4).toString("hex")}`);
    mkdirSync(tmpPath, { recursive: true });

    // Initialize a git repo
    execFileSync("git", ["init", "-b", "main"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // Configure git for commits
    execFileSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tmpPath,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "user.name", "Test"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // Create a file and commit it
    const testFile = join(tmpPath, "test.txt");
    writeFileSync(testFile, "content", "utf8");
    execFileSync("git", ["add", "."], { cwd: tmpPath, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "Initial commit"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // At this point, there should be no working tree changes
    expect(hasWorkingTreeChanges(tmpPath)).toBe(false);
  });

  test("returns true when worktree has uncommitted changes", () => {
    const tmpPath = join(tmpdir(), `review-test-${randomBytes(4).toString("hex")}`);
    mkdirSync(tmpPath, { recursive: true });

    // Initialize a git repo
    execFileSync("git", ["init", "-b", "main"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // Configure git for commits
    execFileSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tmpPath,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "user.name", "Test"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // Create a file and commit it
    const testFile = join(tmpPath, "test.txt");
    writeFileSync(testFile, "content", "utf8");
    execFileSync("git", ["add", "."], { cwd: tmpPath, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "Initial commit"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // Modify the file
    writeFileSync(testFile, "modified content", "utf8");

    // Now there should be working tree changes
    expect(hasWorkingTreeChanges(tmpPath)).toBe(true);
  });
});

describe("validateReviewOutput", () => {
  test("rejects frontmatter edits even when blocker is appended", () => {
    const tmpPath = join(tmpdir(), `review-frontmatter-${randomBytes(4).toString("hex")}`);
    const specDir = join(tmpPath, "spec", "test-spec");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# Index\n", "utf8");

    const intentBefore = "---\nname: alpha\n---\n\n# Intent\nbody\n";
    const intentAfter = "---\nname: beta\n---\n\n# Intent\nbody\n\n## Blocker\n\nNeed input.\n";
    writeFileSync(join(specDir, "intent.md"), intentAfter, "utf8");

    const result = validateReviewOutput(tmpPath, "test-spec", intentBefore);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("frontmatter is immutable");
  });
});
