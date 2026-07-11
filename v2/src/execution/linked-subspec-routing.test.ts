import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveActiveLinkedSubspec,
  findModifiedLinkedCheckbox,
  advanceLinkedSubspecCheckbox,
} from "./linked-subspec-routing.ts";

let tempDir: string | undefined;

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "linked-subspec-routing-test-"));
}

function cleanup(): void {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
}

afterEach(() => {
  cleanup();
});

describe("resolveActiveLinkedSubspec", () => {
  test("returns active linked subspec for first unchecked link", () => {
    tempDir = createTempDir();

    const indexContent = `# Index

- [ ] [First subspec](./first.md)
- [ ] [Second subspec](./second.md)
`;
    const firstSubspecContent = `# First Subspec

## Acceptance criteria

- [ ] First criterion
`;

    writeFileSync(join(tempDir, "index.md"), indexContent);
    writeFileSync(join(tempDir, "first.md"), firstSubspecContent);

    const result = resolveActiveLinkedSubspec(join(tempDir, "index.md"), tempDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.active.index).toBe(0);
    expect(result.active.subspec.text).toBe("First subspec");
    expect(result.active.body).toBe(firstSubspecContent);
    expect(result.isTerminal).toBe(false);
  });

  test("returns active linked subspec for last unchecked link with isTerminal=true", () => {
    tempDir = createTempDir();

    const indexContent = `# Index

- [x] [First subspec](./first.md)
- [ ] [Second subspec](./second.md)
`;
    const secondSubspecContent = `# Second Subspec

## Acceptance criteria

- [ ] Second criterion
`;

    writeFileSync(join(tempDir, "index.md"), indexContent);
    writeFileSync(join(tempDir, "first.md"), "# First\n");
    writeFileSync(join(tempDir, "second.md"), secondSubspecContent);

    const result = resolveActiveLinkedSubspec(join(tempDir, "index.md"), tempDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.active.index).toBe(1);
    expect(result.isTerminal).toBe(true);
  });

  test("returns already_complete error when all linked subspecs are checked", () => {
    tempDir = createTempDir();

    const indexContent = `# Index

- [x] [First subspec](./first.md)
- [x] [Second subspec](./second.md)
`;

    writeFileSync(join(tempDir, "index.md"), indexContent);

    const result = resolveActiveLinkedSubspec(join(tempDir, "index.md"), tempDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKind).toBe("already_complete");
  });

  test("returns requires_index error when spec is a direct subspec, not index", () => {
    tempDir = createTempDir();

    const subspecContent = `# Direct Subspec

- [ ] Task
`;

    writeFileSync(join(tempDir, "spec.md"), subspecContent);

    const result = resolveActiveLinkedSubspec(join(tempDir, "spec.md"), tempDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKind).toBe("requires_index");
  });

  test("returns empty_index error when index has no linked subspecs", () => {
    tempDir = createTempDir();

    const indexContent = `# Index

No linked subspecs here.
`;

    writeFileSync(join(tempDir, "index.md"), indexContent);

    const result = resolveActiveLinkedSubspec(join(tempDir, "index.md"), tempDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKind).toBe("empty_index");
  });

  test("returns link_missing error when linked file doesn't exist", () => {
    tempDir = createTempDir();

    const indexContent = `# Index

- [ ] [Missing subspec](./missing.md)
`;

    writeFileSync(join(tempDir, "index.md"), indexContent);

    const result = resolveActiveLinkedSubspec(join(tempDir, "index.md"), tempDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKind).toBe("link_unreadable");
  });

  test("returns link_out_of_tree error when linked path is outside project", () => {
    tempDir = createTempDir();
    const otherDir = createTempDir();

    const indexContent = `# Index

- [ ] [Outside subspec](../other/spec.md)
`;

    writeFileSync(join(tempDir, "index.md"), indexContent);
    writeFileSync(join(otherDir, "spec.md"), "# Outside\n");

    const result = resolveActiveLinkedSubspec(join(tempDir, "index.md"), tempDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKind).toBe("link_out_of_tree");
  });

  test("resolves relative linked paths correctly", () => {
    tempDir = createTempDir();
    const specDir = join(tempDir, "specs");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [Sub](./sub.md)\n");
    writeFileSync(join(specDir, "sub.md"), "# Sub\n");

    const result = resolveActiveLinkedSubspec(join(specDir, "index.md"), tempDir);

    expect(result.ok).toBe(true);
  });
});

describe("findModifiedLinkedCheckbox", () => {
  test("detects when a linked checkbox is modified", () => {
    const before = `# Index

- [ ] [First](./first.md)
- [ ] [Second](./second.md)
`;

    const after = `# Index

- [x] [First](./first.md)
- [ ] [Second](./second.md)
`;

    const result = findModifiedLinkedCheckbox(before, after);

    expect(result).toBeDefined();
    if (!result) return;
    expect(result.modifiedIndex).toBe(0);
    expect(result.modifiedSubspec.text).toBe("First");
  });

  test("returns undefined when no checkboxes are modified", () => {
    const before = `# Index

- [ ] [First](./first.md)
- [x] [Second](./second.md)
`;

    const after = `# Index

- [ ] [First](./first.md)
- [x] [Second](./second.md)
`;

    const result = findModifiedLinkedCheckbox(before, after);

    expect(result).toBeUndefined();
  });
});

describe("advanceLinkedSubspecCheckbox", () => {
  test("checks the checkbox at the specified index", () => {
    const content = `# Index

- [ ] [First](./first.md)
- [ ] [Second](./second.md)
`;

    const result = advanceLinkedSubspecCheckbox(content, 0);

    expect(result).toBeDefined();
    if (!result) return;
    expect(result).toContain("- [x] [First](./first.md)");
    expect(result).toContain("- [ ] [Second](./second.md)");
  });

  test("returns content unchanged if checkbox is already checked", () => {
    const content = `# Index

- [x] [First](./first.md)
`;

    const result = advanceLinkedSubspecCheckbox(content, 0);

    expect(result).toBe(content);
  });

  test("returns undefined for out-of-range index", () => {
    const content = `# Index

- [ ] [First](./first.md)
`;

    const result = advanceLinkedSubspecCheckbox(content, 1);

    expect(result).toBeUndefined();
  });
});
