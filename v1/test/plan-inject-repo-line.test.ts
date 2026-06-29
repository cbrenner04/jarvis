import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectRepoLineIntoIndex } from "../src/commands/plan.ts";
import type { ProjectMatch } from "../src/config.ts";

describe("injectRepoLineIntoIndex", () => {
  test("when project.origin is a GitHub HTTPS URL, emits repo: owner/repo slug", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-inject-repo-1-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      writeFileSync(indexPath, "# My Spec\n\nContent here.\n");

      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);

      const project: ProjectMatch = {
        key: "my-key",
        root: projectRoot,
        origin: "https://github.com/example/repo.git",
      };

      injectRepoLineIntoIndex(specDir, project);

      const content = readFileSync(indexPath, "utf8");
      expect(content).toContain("repo: example/repo");
      expect(content).not.toContain("https://");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("when project.origin is undefined and root has GitHub SSH origin, emits repo: owner/repo slug", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-inject-repo-2-ssh-"));
    try {
      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);
      execSync("git init -b main", { cwd: projectRoot });
      execSync("git config user.email 'test@example.com'", { cwd: projectRoot });
      execSync("git config user.name 'Test User'", { cwd: projectRoot });
      execSync("git remote add origin git@github.com:detected/repo.git", { cwd: projectRoot });

      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      writeFileSync(indexPath, "# My Spec\n\nContent here.\n");

      const project: ProjectMatch = {
        key: "my-key",
        root: projectRoot,
      };

      injectRepoLineIntoIndex(specDir, project);

      const content = readFileSync(indexPath, "utf8");
      expect(content).toContain("repo: detected/repo");
      expect(content).not.toContain("git@");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("when origin is a non-GitHub https URL, emits angle-bracket wrapped repo line", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-inject-repo-bracket-"));
    try {
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      writeFileSync(indexPath, "# My Spec\n\nContent here.\n");

      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);

      const project: ProjectMatch = {
        key: "my-key",
        root: projectRoot,
        origin: "https://gitlab.com/example/repo.git",
      };

      injectRepoLineIntoIndex(specDir, project);

      const content = readFileSync(indexPath, "utf8");
      expect(content).toContain("repo: <https://gitlab.com/example/repo.git>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("when project.origin is undefined and root is not a git checkout, emits repo: <project.key> (fallback preserved)", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-inject-repo-3-fallback-"));
    try {
      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);

      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      writeFileSync(indexPath, "# My Spec\n\nContent here.\n");

      const project: ProjectMatch = {
        key: "my-key-fallback",
        root: projectRoot,
      };

      injectRepoLineIntoIndex(specDir, project);

      const content = readFileSync(indexPath, "utf8");
      expect(content).toContain("repo: my-key-fallback");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("when project.origin is undefined, root is a git checkout with no origin remote, emits repo: <project.key> (fallback preserved)", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-inject-repo-4-no-remote-"));
    try {
      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);
      execSync("git init -b main", { cwd: projectRoot });
      execSync("git config user.email 'test@example.com'", { cwd: projectRoot });
      execSync("git config user.name 'Test User'", { cwd: projectRoot });

      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      writeFileSync(indexPath, "# My Spec\n\nContent here.\n");

      const project: ProjectMatch = {
        key: "my-key-no-remote",
        root: projectRoot,
      };

      injectRepoLineIntoIndex(specDir, project);

      const content = readFileSync(indexPath, "utf8");
      expect(content).toContain("repo: my-key-no-remote");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
