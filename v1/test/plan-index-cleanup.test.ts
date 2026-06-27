import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripNonContractIndexLines } from "../src/modes/plan/index-cleanup.ts";

describe("stripNonContractIndexLines", () => {
  test("removes a stray repo: line from index.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-index-cleanup-repo-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      const original = `# My Spec
repo: https://github.com/cbrenner04/jarvis

- [ ] [01 — Foo](./01-foo.md)
- [ ] [02 — Bar](./02-bar.md)
`;
      writeFileSync(indexPath, original);

      const stderr: string[] = [];
      stripNonContractIndexLines({
        specDirPath: specDir,
        stderr: (s) => stderr.push(s),
      });

      const content = readFileSync(indexPath, "utf8");
      expect(content).toBe(`# My Spec

- [ ] [01 — Foo](./01-foo.md)
- [ ] [02 — Bar](./02-bar.md)
`);
      expect(stderr).toHaveLength(1);
      expect(stderr[0]).toContain("stripped 1 non-contract line");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("removes other stray metadata and prose lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-index-cleanup-metadata-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      const original = `# My Spec
status: wip
This is a free-text sentence.
Another stray line.

- [ ] [01 — Foo](./01-foo.md)
- [x] [02 — Bar](./02-bar.md)
`;
      writeFileSync(indexPath, original);

      const stderr: string[] = [];
      stripNonContractIndexLines({
        specDirPath: specDir,
        stderr: (s) => stderr.push(s),
      });

      const content = readFileSync(indexPath, "utf8");
      expect(content).toBe(`# My Spec

- [ ] [01 — Foo](./01-foo.md)
- [x] [02 — Bar](./02-bar.md)
`);
      expect(stderr).toHaveLength(1);
      expect(stderr[0]).toContain("stripped 3 non-contract line");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves checked [x] checklist items", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-index-cleanup-checked-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      const original = `# My Spec

- [ ] [01 — Foo](./01-foo.md)
- [x] [02 — Bar](./02-bar.md)
- [X] [03 — Baz](./03-baz.md)
`;
      writeFileSync(indexPath, original);

      const stderr: string[] = [];
      stripNonContractIndexLines({
        specDirPath: specDir,
        stderr: (s) => stderr.push(s),
      });

      const content = readFileSync(indexPath, "utf8");
      expect(content).toBe(original); // No changes
      expect(stderr).toHaveLength(0); // No removal notice
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves leading whitespace in checklist items", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-index-cleanup-whitespace-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      const original = `# My Spec

  - [ ] [01 — Foo](./01-foo.md)
    - [ ] [nested](./nested.md)
`;
      writeFileSync(indexPath, original);

      const stderr: string[] = [];
      stripNonContractIndexLines({
        specDirPath: specDir,
        stderr: (s) => stderr.push(s),
      });

      const content = readFileSync(indexPath, "utf8");
      expect(content).toBe(original); // No changes
      expect(stderr).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not remove lines when content matches contract", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-index-cleanup-unchanged-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      const original = `# My Spec

- [ ] [01 — Foo](./01-foo.md)
- [ ] [02 — Bar](./02-bar.md)
`;
      writeFileSync(indexPath, original);

      const stderr: string[] = [];
      stripNonContractIndexLines({
        specDirPath: specDir,
        stderr: (s) => stderr.push(s),
      });

      const content = readFileSync(indexPath, "utf8");
      expect(content).toBe(original);
      expect(stderr).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves trailing newline status", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-index-cleanup-newline-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");

      // Test with trailing newline
      const withNewline = `# My Spec

- [ ] [01 — Foo](./01-foo.md)
`;
      writeFileSync(indexPath, withNewline);

      stripNonContractIndexLines({
        specDirPath: specDir,
      });

      let content = readFileSync(indexPath, "utf8");
      expect(content.endsWith("\n")).toBe(true);

      // Test without trailing newline
      const noNewline = `# My Spec

- [ ] [01 — Foo](./01-foo.md)`;
      writeFileSync(indexPath, noNewline);

      stripNonContractIndexLines({
        specDirPath: specDir,
      });

      content = readFileSync(indexPath, "utf8");
      expect(content.endsWith("\n")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no-ops when index.md is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-index-cleanup-absent-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);

      const stderr: string[] = [];
      stripNonContractIndexLines({
        specDirPath: specDir,
        stderr: (s) => stderr.push(s),
      });

      // No errors, no notices
      expect(stderr).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports correct count of removed lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-index-cleanup-count-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      const original = `# My Spec
stray1
stray2
stray3
stray4
stray5

- [ ] [01 — Foo](./01-foo.md)
`;
      writeFileSync(indexPath, original);

      const stderr: string[] = [];
      stripNonContractIndexLines({
        specDirPath: specDir,
        stderr: (s) => stderr.push(s),
      });

      expect(stderr).toHaveLength(1);
      expect(stderr[0]).toContain("stripped 5 non-contract line");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("collapses multiple blank lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-index-cleanup-blanks-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      const original = `# My Spec


- [ ] [01 — Foo](./01-foo.md)

- [ ] [02 — Bar](./02-bar.md)


`;
      writeFileSync(indexPath, original);

      const stderr: string[] = [];
      stripNonContractIndexLines({
        specDirPath: specDir,
        stderr: (s) => stderr.push(s),
      });

      const content = readFileSync(indexPath, "utf8");
      expect(content).toBe(`# My Spec

- [ ] [01 — Foo](./01-foo.md)

- [ ] [02 — Bar](./02-bar.md)

`);
      expect(stderr).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
