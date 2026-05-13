import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  execFileSync,
  execSync,
} from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitBlocker, recordBlocker } from "../../../src/modes/patch/blocker.ts";

let tempDir: string;
let gitDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "blocker-test-"));
  gitDir = tempDir;

  // Initialize git repo
  execSync("git init", { cwd: gitDir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: gitDir, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: gitDir, stdio: "pipe" });
  execSync("git checkout -b test-branch", { cwd: gitDir, stdio: "pipe" });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createSpecFile(name: string, content: string): string {
  const dir = join(gitDir, "spec");
  if (!existsSync(dir)) {
    execFileSync("mkdir", ["-p", dir], { stdio: "pipe" });
  }

  const specPath = join(dir, name);
  writeFileSync(specPath, content);
  return specPath;
}

function getLastCommitMessage(): string {
  return execFileSync("git", ["log", "-1", "--pretty=%B"], {
    cwd: gitDir,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

describe("recordBlocker", () => {
  test("adds blocker section to spec", () => {
    const specPath = createSpecFile("01-test-one.md", `# Test Spec

## Acceptance criteria

- [ ] First criterion
`);

    recordBlocker(specPath, "This is blocked");

    const content = readFileSync(specPath, "utf8");
    expect(content).toContain("## Blocker");
    expect(content).toContain("This is blocked");
  });

  test("does not add duplicate blocker sections", () => {
    const specPath = createSpecFile("01-test-one.md", `# Test Spec

## Blocker

Already blocked
`);

    recordBlocker(specPath, "New blocker");

    const content = readFileSync(specPath, "utf8");
    const blockerMatches = content.match(/## Blocker/g) || [];
    expect(blockerMatches.length).toBe(1);
    expect(content).toContain("Already blocked");
    expect(content).not.toContain("New blocker");
  });
});

describe("commitBlocker", () => {
  test("commits successfully with normal blocker reason", () => {
    const specPath = createSpecFile("01-test-one.md", `# Test Spec

## Acceptance criteria

- [ ] First criterion
`);

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    commitBlocker(specPath, "Waiting for API changes", gitDir);

    const message = getLastCommitMessage();
    expect(message).toContain("WIP: Test Spec");
    expect(message).toContain("## Blocker");
    expect(message).toContain("Waiting for API changes");
  });

  test("commits successfully with EOF in blocker reason", () => {
    const specPath = createSpecFile("01-test-one.md", `# Test Spec

## Acceptance criteria

- [ ] First criterion
`);

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    commitBlocker(specPath, "Blocker: see EOF in output", gitDir);

    const message = getLastCommitMessage();
    expect(message).toContain("WIP: Test Spec");
    expect(message).toContain("Blocker: see EOF in output");
  });

  test("updates spec with blocker before committing", () => {
    const specPath = createSpecFile("01-test-one.md", `# Test Spec

## Acceptance criteria

- [ ] First criterion
`);

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    commitBlocker(specPath, "Test blocker", gitDir);

    const specContent = readFileSync(specPath, "utf8");
    expect(specContent).toContain("## Blocker");
    expect(specContent).toContain("Test blocker");
  });

  test("requires cwd parameter", () => {
    const specPath = createSpecFile("01-test-one.md", `# Test Spec

## Acceptance criteria

- [ ] First criterion
`);

    execSync("git add .", { cwd: gitDir, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: gitDir, stdio: "pipe" });

    // This should not throw when cwd is provided
    commitBlocker(specPath, "Test blocker", gitDir);

    const commits = execFileSync("git", ["rev-list", "--all"], {
      cwd: gitDir,
      encoding: "utf8",
      stdio: "pipe",
    }).trim().split("\n");

    expect(commits.length).toBeGreaterThan(1);
  });
});
