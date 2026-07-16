import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePublicationTitle } from "./spec-creation-title.ts";

mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });

describe("resolvePublicationTitle", () => {
  test("uses the first non-empty index H1", () => {
    const root = mkdtempSync(join(process.cwd(), ".scratch", "spec-title-"));
    try {
      mkdirSync(join(root, "tree"));
      writeFileSync(join(root, "tree", "index.md"), "#\n\n# Actual title\n", "utf8");
      expect(resolvePublicationTitle(root, "tree/index.md")).toBe("Actual title");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("falls back to the index directory or non-index basename", () => {
    const root = mkdtempSync(join(process.cwd(), ".scratch", "spec-title-"));
    try {
      mkdirSync(join(root, "tree"));
      writeFileSync(join(root, "tree", "index.md"), "## no H1\n", "utf8");
      writeFileSync(join(root, "tree", "01-task.md"), "# sibling\n", "utf8");
      expect(resolvePublicationTitle(root, "tree/index.md")).toBe("tree");
      expect(resolvePublicationTitle(root, "tree/01-task.md")).toBe("01-task.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects an unreadable index with its spec path", () => {
    const root = mkdtempSync(join(process.cwd(), ".scratch", "spec-title-"));
    try {
      expect(() => resolvePublicationTitle(root, "missing/index.md")).toThrow("Title resolution");
      expect(() => resolvePublicationTitle(root, "missing/index.md")).toThrow("missing/index.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps an explicit intent title authoritative", () => {
    expect(resolvePublicationTitle("/missing", "index.md", " intent: seed ")).toBe("intent: seed");
  });
});
