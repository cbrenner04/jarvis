// This test requires real git commit-message history for subspec attribution / parsing behavior.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitSubspec, commitWipProgress, commitWipProgressWithBlocker } from "../../../src/modes/patch/subspec.ts";

let tempDir: string;
let gitDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "subspec-test-"));
  gitDir = tempDir;

  // Initialize git repo
  execSync("git init", { cwd: gitDir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", {
    cwd: gitDir,
    stdio: "pipe",
  });
  execSync("git config user.name 'Test User'", { cwd: gitDir, stdio: "pipe" });
  execSync("git checkout -b test-branch", { cwd: gitDir, stdio: "pipe" });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createSpecFile(name: string, content: string): string {
  const specPath = join(gitDir, "spec", name);
  const dir = join(gitDir, "spec");

  if (!existsSync(dir)) {
    execFileSync("mkdir", ["-p", dir], { stdio: "pipe" });
  }

  writeFileSync(specPath, content);
  return specPath;
}

function createIndexFile(): string {
  const dir = join(gitDir, "spec");
  if (!existsSync(dir)) {
    execFileSync("mkdir", ["-p", dir], { stdio: "pipe" });
  }
  const indexPath = join(dir, "index.md");
  const content = `# Test Spec Group

## Subspecs

- [ ] [01 — Test one](./01-test-one.md)
`;
  writeFileSync(indexPath, content);
  return indexPath;
}

function getLastCommitMessage(): string {
  return execFileSync("git", ["log", "-1", "--pretty=%B"], {
    cwd: gitDir,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

describe("commitSubspec", () => {
  test("commits successfully with normal content", () => {
    createIndexFile();
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [x] First criterion
- [ ] Second criterion
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    commitSubspec(specPath, { cwd: gitDir, agentLabel: "" });

    const message = getLastCommitMessage();
    expect(message).toContain("Test Spec");
    expect(message).toContain("## Acceptance criteria");
    expect(message).toContain("- [x] First criterion");
  });

  test("commits successfully with JARVIS_COMMIT_MESSAGE on its own line", () => {
    createIndexFile();
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [x] JARVIS_COMMIT_MESSAGE
- [ ] Second criterion
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    commitSubspec(specPath, { cwd: gitDir, agentLabel: "" });

    const message = getLastCommitMessage();
    expect(message).toContain("JARVIS_COMMIT_MESSAGE");
    expect(message).toContain("- [x] JARVIS_COMMIT_MESSAGE");
  });

  test("commits successfully with EOF on its own line", () => {
    createIndexFile();
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [x] First criterion
- [ ] EOF
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    commitSubspec(specPath, { cwd: gitDir, agentLabel: "" });

    const message = getLastCommitMessage();
    expect(message).toContain("EOF");
    expect(message).toContain("- [ ] EOF");
  });

  test("updates index checkbox after commit", () => {
    createIndexFile();
    const indexPath = join(gitDir, "spec", "index.md");
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [x] First criterion
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    commitSubspec(specPath, { cwd: gitDir, agentLabel: "" });

    const indexContent = readFileSync(indexPath, "utf8");
    expect(indexContent).toContain("- [x] [01 — Test one]");
  });
});

describe("commitWipProgress", () => {
  test("commits successfully with normal content", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion
- [ ] Second criterion
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    // Make a change to commit
    writeFileSync(
      specPath,
      `# Test Spec

## Acceptance criteria

- [x] First criterion
- [ ] Second criterion
`,
    );

    commitWipProgress(specPath, {
      cwd: gitDir,
      newlyChecked: [],
      checkedTotal: 0,
      total: 2,
      agentLabel: "",
    });

    const message = getLastCommitMessage();
    expect(message).toContain("WIP: Test Spec");
    expect(message).toContain("(0/2 criteria)");
  });

  test("commits successfully with JARVIS_COMMIT_MESSAGE in spec body", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion containing JARVIS_COMMIT_MESSAGE
- [ ] Second criterion
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    // Make a change to commit
    writeFileSync(
      specPath,
      `# Test Spec

## Acceptance criteria

- [x] First criterion containing JARVIS_COMMIT_MESSAGE
- [ ] Second criterion
`,
    );

    commitWipProgress(specPath, {
      cwd: gitDir,
      newlyChecked: [],
      checkedTotal: 1,
      total: 2,
      agentLabel: "",
    });

    const message = getLastCommitMessage();
    expect(message).toContain("WIP: Test Spec");
    expect(message).toContain("(1/2 criteria)");
  });

  test("includes newly checked criteria in commit message", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [x] First criterion
- [ ] Second criterion
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    // Make a change to commit
    writeFileSync(
      specPath,
      `# Test Spec

## Acceptance criteria

- [x] First criterion
- [x] Second criterion
`,
    );

    commitWipProgress(specPath, {
      cwd: gitDir,
      newlyChecked: [{ text: "First criterion", checked: true, humanOnly: false }],
      checkedTotal: 1,
      total: 2,
      agentLabel: "",
    });

    const message = getLastCommitMessage();
    expect(message).toContain("Newly checked:");
    expect(message).toContain("- First criterion");
  });
});

describe("Jarvis-Agent trailer", () => {
  test("commitSubspec appends Jarvis-Agent trailer when label is non-empty", () => {
    createIndexFile();
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [x] First criterion
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    commitSubspec(specPath, {
      cwd: gitDir,
      agentLabel: "Claude Opus 4.8",
    });

    const message = getLastCommitMessage();
    // Trailer at the end, separated by exactly one blank line.
    expect(message.endsWith("Jarvis-Agent: Claude Opus 4.8")).toBe(true);
    // Verify the body containing the acceptance criteria precedes the
    // trailer, with one blank line between body and trailer.
    expect(message).toMatch(/- \[x\] First criterion\n\nJarvis-Agent: Claude Opus 4\.8$/);
  });

  test("commitSubspec omits Jarvis-Agent line when label is empty", () => {
    createIndexFile();
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [x] First criterion
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    commitSubspec(specPath, { cwd: gitDir, agentLabel: "" });

    const message = getLastCommitMessage();
    expect(message).not.toContain("Jarvis-Agent:");
  });

  test("commitWipProgress appends Jarvis-Agent trailer when label is non-empty", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    writeFileSync(
      specPath,
      `# Test Spec

## Acceptance criteria

- [x] First criterion
`,
    );

    commitWipProgress(specPath, {
      cwd: gitDir,
      newlyChecked: [{ text: "First criterion", checked: true, humanOnly: false }],
      checkedTotal: 1,
      total: 1,
      agentLabel: "codex (default model)",
    });

    const message = getLastCommitMessage();
    expect(message.endsWith("Jarvis-Agent: codex (default model)")).toBe(true);
    expect(message).toMatch(/- First criterion\n\nJarvis-Agent: codex \(default model\)$/);
  });

  test("commitWipProgressWithBlocker appends Jarvis-Agent trailer after Blocker body", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

External dependency missing
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    writeFileSync(
      specPath,
      `# Test Spec

## Acceptance criteria

- [x] First criterion

## Blocker

External dependency missing
`,
    );

    commitWipProgressWithBlocker(specPath, {
      cwd: gitDir,
      newlyChecked: [{ text: "First criterion", checked: true, humanOnly: false }],
      checkedTotal: 1,
      total: 1,
      blockerBody: "External dependency missing",
      agentLabel: "Cursor Composer 2",
    });

    const message = getLastCommitMessage();
    expect(message.endsWith("Jarvis-Agent: Cursor Composer 2")).toBe(true);
    // Body content (blocker) precedes trailer with a blank line.
    expect(message).toMatch(/External dependency missing\n\nJarvis-Agent: Cursor Composer 2$/);
  });

  test("commitWipProgressWithBlocker omits trailer when label is empty", () => {
    const specPath = createSpecFile(
      "01-test-one.md",
      `# Test Spec

## Acceptance criteria

- [ ] First criterion
`,
    );

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    writeFileSync(
      specPath,
      `# Test Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

Stuck
`,
    );

    commitWipProgressWithBlocker(specPath, {
      cwd: gitDir,
      newlyChecked: [],
      checkedTotal: 0,
      total: 1,
      blockerBody: "Stuck",
      agentLabel: "",
    });

    const message = getLastCommitMessage();
    expect(message).not.toContain("Jarvis-Agent:");
  });
});
