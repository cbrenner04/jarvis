// This test requires a real, hung `git` subprocess to verify commitSubspec's stall bound.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitSubspec } from "../../../src/modes/patch/subspec.ts";
import { beginHangFixtureTracking, reapActiveHangFixtures, writeIdleHangScript } from "../../idle-hang-fixtures.ts";

const HANG_FIXTURE_TRACKING_ID = import.meta.path;

let tempDir: string;
let gitDir: string;

beforeEach(() => {
  beginHangFixtureTracking(HANG_FIXTURE_TRACKING_ID);
  tempDir = mkdtempSync(join(tmpdir(), "subspec-test-"));
  gitDir = tempDir;

  execSync("git init", { cwd: gitDir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: gitDir, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: gitDir, stdio: "pipe" });
  execSync("git checkout -b test-branch", { cwd: gitDir, stdio: "pipe" });
}, 20_000);

afterEach(() => {
  reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
  rmSync(tempDir, { recursive: true, force: true });
}, 20_000);

function createSpecFile(name: string, content: string): string {
  const specPath = join(gitDir, "spec", name);
  execSync(`mkdir -p ${join(gitDir, "spec")}`, { stdio: "pipe" });
  writeFileSync(specPath, content);
  return specPath;
}

function createIndexFile(): void {
  execSync(`mkdir -p ${join(gitDir, "spec")}`, { stdio: "pipe" });
  writeFileSync(
    join(gitDir, "spec", "index.md"),
    `# Test Spec Group

## Subspecs

- [ ] [01 — Test one](./01-test-one.md)
`,
  );
}

function createAcceptanceSpec(checked: boolean): string {
  return `# Test Spec

## Acceptance criteria

- [${checked ? "x" : " "}] First criterion
`;
}

function commitAll(message: string): void {
  execSync("git add .", { cwd: gitDir, stdio: "pipe" });
  execSync(`git commit -m '${message}'`, { cwd: gitDir, stdio: "pipe" });
}

describe("commitSubspec", () => {
  test("stalled real git subprocess fails within 25s with fixture reaped", () => {
    createIndexFile();
    const specPath = createSpecFile("01-test-one.md", createAcceptanceSpec(true));
    commitAll("initial");

    const binDir = mkdtempSync(join(tmpdir(), "jarvis-subspec-git-stall-bin-"));
    const originalPath = process.env.PATH;
    try {
      writeFileSync(specPath, createAcceptanceSpec(false));
      writeIdleHangScript(join(binDir, "git"));
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const startTime = Date.now();
      expect(() => commitSubspec(specPath, { cwd: gitDir, agentLabel: "" })).toThrow();
      expect(Date.now() - startTime).toBeLessThan(25_000);
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
    }
  }, 35_000);
});
