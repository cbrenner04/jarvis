import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractBlockerBody, hasBlocker } from "../../../src/modes/patch/blocker.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "blocker-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createSpecFile(name: string, content: string): string {
  const dir = join(tempDir, "spec");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const specPath = join(dir, name);
  writeFileSync(specPath, content);
  return specPath;
}

describe("hasBlocker", () => {
  test("returns true when spec has blocker section", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

Waiting for something
`,
    );

    expect(hasBlocker(specPath)).toBe(true);
  });

  test("returns false when spec has no blocker section", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion
`,
    );

    expect(hasBlocker(specPath)).toBe(false);
  });

  test("returns false for empty file", () => {
    const specPath = createSpecFile("01-test-one.md", "");
    expect(hasBlocker(specPath)).toBe(false);
  });
});

describe("extractBlockerBody", () => {
  test("extracts blocker body correctly", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

Waiting for external API
`,
    );

    const body = extractBlockerBody(specPath);
    expect(body).toBe("Waiting for external API");
  });

  test("extracts blocker body with multiple lines", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

This is a blocker because:
- Need external input
- Dependency not ready
`,
    );

    const body = extractBlockerBody(specPath);
    expect(body).toContain("This is a blocker because:");
    expect(body).toContain("Need external input");
    expect(body).toContain("Dependency not ready");
  });

  test("returns null when no blocker section", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion
`,
    );

    expect(extractBlockerBody(specPath)).toBe(null);
  });

  test("extracts blocker when it's followed by another section", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

Blocked reason

## Notes

Some notes
`,
    );

    const body = extractBlockerBody(specPath);
    expect(body).toBe("Blocked reason");
    expect(body).not.toContain("Notes");
  });
});
