import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { formatPublicationSpecPathForPrBody, normalizePublicationSpecPath } from "./publication-spec-path.ts";

describe("normalizePublicationSpecPath", () => {
  const worktree = "/Users/op/.jarvis/worktrees/jarvis/intent/demo-branch";

  test("returns relative paths unchanged", () => {
    expect(normalizePublicationSpecPath(worktree, "v2/spec/ready-intents")).toBe("v2/spec/ready-intents");
  });

  test("strips worktree prefix from absolute paths", () => {
    expect(normalizePublicationSpecPath(worktree, join(worktree, "v2/spec/ready-intents"))).toBe(
      "v2/spec/ready-intents",
    );
  });

  test("leaves unrelated absolute paths unchanged", () => {
    expect(normalizePublicationSpecPath(worktree, "/tmp/other/spec")).toBe("/tmp/other/spec");
  });
});

describe("formatPublicationSpecPathForPrBody", () => {
  const worktree = "/Users/op/.jarvis/worktrees/jarvis/intent/demo-branch";

  test("keeps in-worktree specs repo-relative, unchanged", () => {
    expect(formatPublicationSpecPathForPrBody(worktree, "v2/spec/ready-intents/index.md")).toBe(
      "v2/spec/ready-intents/index.md",
    );
  });

  test("renders an out-of-worktree directory spec as its own basename, not the absolute path", () => {
    expect(formatPublicationSpecPathForPrBody(worktree, "/tmp/other/20260101T000000Z-my-spec/index.md")).toBe(
      "20260101T000000Z-my-spec",
    );
  });

  test("renders an out-of-worktree single-file spec as its own basename, not its parent directory", () => {
    expect(formatPublicationSpecPathForPrBody(worktree, "/tmp/other/parent-dir-name/foo.md")).toBe("foo.md");
  });
});
