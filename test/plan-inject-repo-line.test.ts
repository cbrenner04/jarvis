import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectRepoLineIntoIndex } from "../src/commands/plan.ts";
import type { ProjectMatch } from "../src/config.ts";

describe("injectRepoLineIntoIndex", () => {
  test("when project.origin is set, emits repo: <origin> (existing behavior preserved)", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-inject-repo-1-"));
    try {
      // Create a spec directory with index.md
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      writeFileSync(indexPath, "# My Spec\n\nContent here.\n");

      // Create a temporary project root (not a git repo)
      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);

      // Create a ProjectMatch with origin set
      const project: ProjectMatch = {
        key: "my-key",
        root: projectRoot,
        origin: "https://github.com/example/repo.git",
      };

      injectRepoLineIntoIndex(specDir, project);

      const content = readFileSync(indexPath, "utf8");
      expect(content).toContain("repo: https://github.com/example/repo.git");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("when project.origin is undefined and root is a git checkout with origin remote, emits repo: <detected-origin>", () => {
    const dir = mkdtempSync(
      join(tmpdir(), "jarvis-inject-repo-2-detected-origin-"),
    );
    try {
      // Create a git repo with a remote origin
      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);
      execSync("git init -b main", { cwd: projectRoot });
      execSync("git config user.email 'test@example.com'", {
        cwd: projectRoot,
      });
      execSync("git config user.name 'Test User'", { cwd: projectRoot });
      execSync("git remote add origin https://github.com/detected/repo.git", {
        cwd: projectRoot,
      });

      // Create a spec directory with index.md
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      writeFileSync(indexPath, "# My Spec\n\nContent here.\n");

      // Create a ProjectMatch without origin
      const project: ProjectMatch = {
        key: "my-key",
        root: projectRoot,
      };

      injectRepoLineIntoIndex(specDir, project);

      const content = readFileSync(indexPath, "utf8");
      expect(content).toContain("repo: https://github.com/detected/repo.git");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("when project.origin is undefined and root is not a git checkout, emits repo: <project.key> (fallback preserved)", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-inject-repo-3-fallback-"));
    try {
      // Create a temporary project root (NOT a git repo)
      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);

      // Create a spec directory with index.md
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      writeFileSync(indexPath, "# My Spec\n\nContent here.\n");

      // Create a ProjectMatch without origin
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
      // Create a git repo WITHOUT a remote origin
      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);
      execSync("git init -b main", { cwd: projectRoot });
      execSync("git config user.email 'test@example.com'", {
        cwd: projectRoot,
      });
      execSync("git config user.name 'Test User'", { cwd: projectRoot });
      // Note: no git remote add origin — just a bare git repo

      // Create a spec directory with index.md
      const specDir = join(dir, "spec");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      writeFileSync(indexPath, "# My Spec\n\nContent here.\n");

      // Create a ProjectMatch without origin
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
