import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitCheckpointOnTimeout,
  commitSubspec,
  commitWipProgress,
  commitWipProgressWithBlocker,
  type SubspecGitOps,
} from "../../../src/modes/patch/subspec.ts";

let tempDir: string;
let gitDir: string;

function fakeGitOps(
  opts: { staged?: boolean; commitError?: Error } = {},
): SubspecGitOps & { commits: Array<{ cwd: string; message: string }> } {
  const commits: Array<{ cwd: string; message: string }> = [];
  return {
    commits,
    add() {},
    hasStagedChanges() {
      return opts.staged ?? true;
    },
    commit(cwd, message) {
      if (opts.commitError) {
        throw opts.commitError;
      }
      commits.push({ cwd, message });
    },
    showCommitted() {
      throw new Error("not used");
    },
    gitRoot() {
      return gitDir;
    },
  };
}

function setup(): void {
  tempDir = mkdtempSync(join(tmpdir(), "subspec-test-"));
  gitDir = tempDir;
}

function teardown(): void {
  rmSync(tempDir, { recursive: true, force: true });
}

function createSpecFile(name: string, content: string): string {
  const dir = join(gitDir, "spec");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const specPath = join(dir, name);
  writeFileSync(specPath, content);
  return specPath;
}

function createIndexFile(): string {
  const dir = join(gitDir, "spec");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const indexPath = join(dir, "index.md");
  writeFileSync(
    indexPath,
    `# Test Spec Group

## Subspecs

- [ ] [01 — Test one](./01-test-one.md)
`,
  );
  return indexPath;
}

function createAcceptanceSpec(checked: boolean): string {
  return `# Test Spec

## Acceptance criteria

- [${checked ? "x" : " "}] First criterion
`;
}

describe("commitSubspec", () => {
  test("commits successfully with normal content", () => {
    setup();
    try {
      createIndexFile();
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [x] First criterion
- [ ] Second criterion
`,
      );
      const ops = fakeGitOps();

      commitSubspec(specPath, { cwd: gitDir, agentLabel: "" }, ops);

      expect(ops.commits).toHaveLength(1);
      const message = ops.commits[0]?.message ?? "";
      expect(message).toContain("Test Spec");
      expect(message).toContain("## Acceptance criteria");
      expect(message).toContain("- [x] First criterion");
    } finally {
      teardown();
    }
  });

  test("commits successfully with JARVIS_COMMIT_MESSAGE on its own line", () => {
    setup();
    try {
      createIndexFile();
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [x] JARVIS_COMMIT_MESSAGE
- [ ] Second criterion
`,
      );
      const ops = fakeGitOps();

      commitSubspec(specPath, { cwd: gitDir, agentLabel: "" }, ops);

      const message = ops.commits[0]?.message ?? "";
      expect(message).toContain("JARVIS_COMMIT_MESSAGE");
      expect(message).toContain("- [x] JARVIS_COMMIT_MESSAGE");
    } finally {
      teardown();
    }
  });

  test("commits successfully with EOF on its own line", () => {
    setup();
    try {
      createIndexFile();
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [x] First criterion
- [ ] EOF
`,
      );
      const ops = fakeGitOps();

      commitSubspec(specPath, { cwd: gitDir, agentLabel: "" }, ops);

      const message = ops.commits[0]?.message ?? "";
      expect(message).toContain("EOF");
      expect(message).toContain("- [ ] EOF");
    } finally {
      teardown();
    }
  });

  test("updates index checkbox after commit", () => {
    setup();
    try {
      createIndexFile();
      const indexPath = join(gitDir, "spec", "index.md");
      const specPath = createSpecFile("01-test-one.md", createAcceptanceSpec(true));
      const ops = fakeGitOps();

      commitSubspec(specPath, { cwd: gitDir, agentLabel: "" }, ops);

      const indexContent = readFileSync(indexPath, "utf8");
      expect(indexContent).toContain("- [x] [01 — Test one]");
    } finally {
      teardown();
    }
  });

  test("returns without committing when there are no staged changes", () => {
    setup();
    try {
      createIndexFile();
      const indexPath = join(gitDir, "spec", "index.md");
      const specPath = createSpecFile("01-test-one.md", createAcceptanceSpec(true));
      writeFileSync(
        indexPath,
        `# Test Spec Group

## Subspecs

- [x] [01 — Test one](./01-test-one.md)
`,
      );
      const ops = fakeGitOps({ staged: false });

      commitSubspec(specPath, { cwd: gitDir, agentLabel: "" }, ops);

      expect(ops.commits).toHaveLength(0);
      expect(readFileSync(indexPath, "utf8")).toContain("- [x] [01 — Test one]");
    } finally {
      teardown();
    }
  });

  test("rethrows git commit failures when staged changes exist", () => {
    setup();
    try {
      createIndexFile();
      const specPath = createSpecFile("01-test-one.md", createAcceptanceSpec(true));
      const ops = fakeGitOps({ commitError: new Error("git commit failed") });

      expect(() => commitSubspec(specPath, { cwd: gitDir, agentLabel: "" }, ops)).toThrow(/git commit/);
    } finally {
      teardown();
    }
  });
});

describe("commitWipProgress", () => {
  test("commits successfully with normal content", () => {
    setup();
    try {
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [x] First criterion
- [ ] Second criterion
`,
      );
      const ops = fakeGitOps();

      commitWipProgress(specPath, { cwd: gitDir, newlyChecked: [], checkedTotal: 0, total: 2, agentLabel: "" }, ops);

      const message = ops.commits[0]?.message ?? "";
      expect(message).toContain("WIP: Test Spec");
      expect(message).toContain("(0/2 criteria)");
    } finally {
      teardown();
    }
  });

  test("commits successfully with JARVIS_COMMIT_MESSAGE in spec body", () => {
    setup();
    try {
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [x] First criterion containing JARVIS_COMMIT_MESSAGE
- [ ] Second criterion
`,
      );
      const ops = fakeGitOps();

      commitWipProgress(specPath, { cwd: gitDir, newlyChecked: [], checkedTotal: 1, total: 2, agentLabel: "" }, ops);

      const message = ops.commits[0]?.message ?? "";
      expect(message).toContain("WIP: Test Spec");
      expect(message).toContain("(1/2 criteria)");
    } finally {
      teardown();
    }
  });

  test("includes newly checked criteria in commit message", () => {
    setup();
    try {
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [x] First criterion
- [x] Second criterion
`,
      );
      const ops = fakeGitOps();

      commitWipProgress(
        specPath,
        {
          cwd: gitDir,
          newlyChecked: [{ text: "First criterion", checked: true, humanOnly: false }],
          checkedTotal: 1,
          total: 2,
          agentLabel: "",
        },
        ops,
      );

      const message = ops.commits[0]?.message ?? "";
      expect(message).toContain("Newly checked:");
      expect(message).toContain("- First criterion");
    } finally {
      teardown();
    }
  });

  test("returns without committing when there are no staged changes", () => {
    setup();
    try {
      const specPath = createSpecFile("01-test-one.md", createAcceptanceSpec(true));
      const ops = fakeGitOps({ staged: false });

      commitWipProgress(
        specPath,
        {
          cwd: gitDir,
          newlyChecked: [{ text: "First criterion", checked: true, humanOnly: false }],
          checkedTotal: 1,
          total: 1,
          agentLabel: "",
        },
        ops,
      );

      expect(ops.commits).toHaveLength(0);
    } finally {
      teardown();
    }
  });

  test("rethrows git commit failures when staged changes exist", () => {
    setup();
    try {
      const specPath = createSpecFile("01-test-one.md", createAcceptanceSpec(false));
      const ops = fakeGitOps({ commitError: new Error("git commit failed") });

      expect(() =>
        commitWipProgress(
          specPath,
          {
            cwd: gitDir,
            newlyChecked: [{ text: "First criterion", checked: true, humanOnly: false }],
            checkedTotal: 1,
            total: 1,
            agentLabel: "",
          },
          ops,
        ),
      ).toThrow(/git commit/);
    } finally {
      teardown();
    }
  });
});

describe("Jarvis-Agent trailer", () => {
  test("commitSubspec appends Jarvis-Agent trailer when label is non-empty", () => {
    setup();
    try {
      createIndexFile();
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [x] First criterion
`,
      );
      const ops = fakeGitOps();

      commitSubspec(specPath, { cwd: gitDir, agentLabel: "Claude Opus 4.8" }, ops);

      const message = ops.commits[0]?.message ?? "";
      expect(message.endsWith("Jarvis-Agent: Claude Opus 4.8")).toBe(true);
      expect(message).toMatch(/- \[x\] First criterion\n\nJarvis-Agent: Claude Opus 4\.8$/);
    } finally {
      teardown();
    }
  });

  test("commitSubspec omits Jarvis-Agent line when label is empty", () => {
    setup();
    try {
      createIndexFile();
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [x] First criterion
`,
      );
      const ops = fakeGitOps();

      commitSubspec(specPath, { cwd: gitDir, agentLabel: "" }, ops);

      const message = ops.commits[0]?.message ?? "";
      expect(message).not.toContain("Jarvis-Agent:");
    } finally {
      teardown();
    }
  });

  test("commitWipProgress appends Jarvis-Agent trailer when label is non-empty", () => {
    setup();
    try {
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [x] First criterion
`,
      );
      const ops = fakeGitOps();

      commitWipProgress(
        specPath,
        {
          cwd: gitDir,
          newlyChecked: [{ text: "First criterion", checked: true, humanOnly: false }],
          checkedTotal: 1,
          total: 1,
          agentLabel: "codex (default model)",
        },
        ops,
      );

      const message = ops.commits[0]?.message ?? "";
      expect(message.endsWith("Jarvis-Agent: codex (default model)")).toBe(true);
      expect(message).toMatch(/- First criterion\n\nJarvis-Agent: codex \(default model\)$/);
    } finally {
      teardown();
    }
  });

  test("commitWipProgressWithBlocker appends Jarvis-Agent trailer after Blocker body", () => {
    setup();
    try {
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [x] First criterion

## Blocker

External dependency missing
`,
      );
      const ops = fakeGitOps();

      commitWipProgressWithBlocker(
        specPath,
        {
          cwd: gitDir,
          newlyChecked: [{ text: "First criterion", checked: true, humanOnly: false }],
          checkedTotal: 1,
          total: 1,
          blockerBody: "External dependency missing",
          agentLabel: "Cursor Composer 2",
        },
        ops,
      );

      const message = ops.commits[0]?.message ?? "";
      expect(message.endsWith("Jarvis-Agent: Cursor Composer 2")).toBe(true);
      expect(message).toMatch(/External dependency missing\n\nJarvis-Agent: Cursor Composer 2$/);
    } finally {
      teardown();
    }
  });

  test("commitWipProgressWithBlocker omits trailer when label is empty", () => {
    setup();
    try {
      const specPath = createSpecFile(
        "01-test-one.md",
        `# Test Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

Stuck
`,
      );
      const ops = fakeGitOps();

      commitWipProgressWithBlocker(
        specPath,
        {
          cwd: gitDir,
          newlyChecked: [],
          checkedTotal: 0,
          total: 1,
          blockerBody: "Stuck",
          agentLabel: "",
        },
        ops,
      );

      const message = ops.commits[0]?.message ?? "";
      expect(message).not.toContain("Jarvis-Agent:");
    } finally {
      teardown();
    }
  });
});

describe("commitCheckpointOnTimeout", () => {
  test("commits staged changes with a WIP checkpoint message and agent trailer", () => {
    const ops = fakeGitOps();

    commitCheckpointOnTimeout(createSpecFile("01-test-one.md", "# Test\n"), gitDir, "claude", ops);

    expect(ops.commits).toHaveLength(1);
    const message = ops.commits[0]?.message ?? "";
    expect(message).toContain("WIP: checkpoint (iteration-timeout)");
    expect(message).toContain("Spec: spec/01-test-one.md");
    expect(message).toContain("Jarvis-Agent: claude");
  });

  test("is a no-op when there are no staged changes", () => {
    const ops = fakeGitOps({ staged: false });

    commitCheckpointOnTimeout(createSpecFile("01-test-one.md", "# Test\n"), gitDir, "claude", ops);

    expect(ops.commits).toHaveLength(0);
  });

  test("rethrows git commit failures when staged changes exist", () => {
    const ops = fakeGitOps({ commitError: new Error("git commit failed") });

    expect(() => commitCheckpointOnTimeout(createSpecFile("01-test-one.md", "# Test\n"), gitDir, "claude", ops)).toThrow("git commit failed");
  });
});
