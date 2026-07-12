import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { normalizePublicationSpecPath } from "./publication-spec-path.ts";

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
