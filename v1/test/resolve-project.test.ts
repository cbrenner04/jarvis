import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProject } from "../src/config.ts";
import { resolveProject } from "../src/resolve-project.ts";

let dir: string;
let cfgDir: string;
let projectA: string;
let projectB: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-resolve-"));
  cfgDir = join(dir, "cfg");
  projectA = join(dir, "project-a");
  projectB = join(dir, "project-b");
  mkdirSync(projectA);
  mkdirSync(projectB);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveProject", () => {
  test("matches a spec's repo URL against a registered origin", () => {
    registerProject("project-a", projectA, {
      dir: cfgDir,
      origin: "https://github.com/example/project-a.git",
    });
    registerProject("project-b", projectB, {
      dir: cfgDir,
      origin: "https://github.com/example/project-b.git",
    });
    const specPath = join(dir, "specs", "index.md");
    mkdirSync(join(dir, "specs"));
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "example/project-a",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.key).toBe("project-a");
      expect(result.resolved.mode).toBe("registered");
    }
  });

  test("resolves spec without repo by path inside a registered project", () => {
    registerProject("project-a", projectA, { dir: cfgDir });
    const specDir = join(projectA, "specs");
    mkdirSync(specDir);
    const specPath = join(specDir, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.root).toBe(projectA);
      expect(result.resolved.mode).toBe("registered");
    }
  });

  test("resolves spec inside a non-registered git checkout in ad-hoc mode", () => {
    // Make projectB a git checkout, but do NOT register it.
    execSync("git init -b main", { cwd: projectB });
    const specDir = join(projectB, "specs");
    mkdirSync(specDir);
    const specPath = join(specDir, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      // Empty registry.
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.root).toBe(projectB);
      expect(result.resolved.mode).toBe("ad-hoc");
    }
  });

  test("--repo by name overrides spec and location", () => {
    registerProject("project-a", projectA, { dir: cfgDir });
    registerProject("project-b", projectB, { dir: cfgDir });
    const specDir = join(projectA, "specs");
    mkdirSync(specDir);
    const specPath = join(specDir, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      repoFlag: "project-b",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.key).toBe("project-b");
    }
  });

  test("--repo by URL loose-matches a registered origin", () => {
    registerProject("project-a", projectA, {
      dir: cfgDir,
      origin: "git@github.com:Example/Project-A.git",
    });
    const specPath = join(dir, "specs", "index.md");
    mkdirSync(join(dir, "specs"));
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      repoFlag: "https://github.com/example/project-a",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.key).toBe("project-a");
    }
  });

  test("unknown --repo errors with the list of registered projects", () => {
    registerProject("project-a", projectA, { dir: cfgDir });
    registerProject("project-b", projectB, { dir: cfgDir });
    const specPath = join(dir, "spec.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      repoFlag: "missing",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("--repo");
      expect(result.message).toContain("project-a");
      expect(result.message).toContain("project-b");
    }
  });

  test("ambiguous URL match yields ambiguous result", () => {
    registerProject("a1", projectA, {
      dir: cfgDir,
      origin: "https://github.com/example/repo.git",
    });
    registerProject("a2", projectB, {
      dir: cfgDir,
      origin: "https://github.com/example/repo.git",
    });
    const specPath = join(dir, "spec.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "example/repo",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates).toHaveLength(2);
    }
  });

  test("legacy absolute-path `repo:` matching a registered root resolves", () => {
    registerProject("project-a", projectA, {
      dir: cfgDir,
      origin: "https://github.com/example/project-a.git",
    });
    registerProject("project-b", projectB, {
      dir: cfgDir,
      origin: "https://github.com/example/project-b.git",
    });
    const specPath = join(dir, "specs", "index.md");
    mkdirSync(join(dir, "specs"));
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: projectA,
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.key).toBe("project-a");
      expect(result.resolved.mode).toBe("registered");
    }
  });

  test("legacy absolute-path `repo:` with no matching root falls through to location", () => {
    // projectA is registered, but the spec's abs-path points elsewhere.
    registerProject("project-a", projectA, {
      dir: cfgDir,
      origin: "https://github.com/example/project-a.git",
    });
    // Spec lives inside projectA so the location step (3) should win.
    const specDir = join(projectA, "specs");
    mkdirSync(specDir);
    const specPath = join(specDir, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const unmatchedAbs = join(dir, "not-registered");

    const result = resolveProject({
      specPath,
      specRepo: unmatchedAbs,
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.key).toBe("project-a");
      expect(result.resolved.mode).toBe("registered");
    }
  });

  test("legacy absolute-path `repo:` with no matching root and no location falls through to prompt", () => {
    registerProject("project-a", projectA, {
      dir: cfgDir,
      origin: "https://github.com/example/project-a.git",
    });
    const specPath = join(dir, "specs", "index.md");
    mkdirSync(join(dir, "specs"));
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: join(dir, "not-registered"),
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("needs-prompt");
  });

  test("needs-prompt when nothing resolves", () => {
    const specPath = join(dir, "spec.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("needs-prompt");
  });

  test("spec repo key: registered project key resolves", () => {
    // Test case 1: specRepo: "genomics-stream" with a registered project
    // whose key is "genomics-stream" (root set, no origin)
    registerProject("genomics-stream", projectA, { dir: cfgDir });
    const specPath = join(dir, "specs", "index.md");
    mkdirSync(join(dir, "specs"));
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "genomics-stream",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.source).toBe("spec-repo");
      expect(result.resolved.mode).toBe("registered");
      expect(result.resolved.project.key).toBe("genomics-stream");
    }
  });

  test("spec repo key: unknown key errors with registered projects list", () => {
    // Test case 2: specRepo: "not-registered" (no slash; no matching project;
    // URL/slug normalization fails) → error with registered keys list
    registerProject("genomics-stream", projectA, { dir: cfgDir });
    registerProject("project-b", projectB, { dir: cfgDir });
    const specPath = join(dir, "specs", "index.md");
    mkdirSync(join(dir, "specs"));
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "not-registered",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("spec `repo:`:");
      expect(result.message).toContain("not-registered");
      expect(result.message).toContain("genomics-stream");
      expect(result.message).toContain("project-b");
    }
  });

  test("spec repo slug: key that looks like owner/repo slug wins over URL matching", () => {
    // Test case 3: a registered project with key: "owner/repo" and
    // specRepo: "owner/repo" (no other project's origin matches) →
    // resolves to the registered project, mode: "registered", source: "spec-repo"
    registerProject("owner/repo", projectA, { dir: cfgDir });
    registerProject("other-project", projectB, {
      dir: cfgDir,
      origin: "https://github.com/example/other.git",
    });
    const specPath = join(dir, "specs", "index.md");
    mkdirSync(join(dir, "specs"));
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "owner/repo",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.source).toBe("spec-repo");
      expect(result.resolved.mode).toBe("registered");
      expect(result.resolved.project.key).toBe("owner/repo");
    }
  });

  test("--repo parity: registered key by flag resolves", () => {
    // Test case 4: repoFlag: "genomics-stream" against the same config as test 1
    // → kind: "ok", resolved.source === "repo-flag"
    registerProject("genomics-stream", projectA, { dir: cfgDir });
    const specPath = join(dir, "specs", "index.md");
    mkdirSync(join(dir, "specs"));
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      repoFlag: "genomics-stream",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.source).toBe("repo-flag");
    }
  });

  test("spec repo URL fall-through: unmatched URL falls through to location-based resolution", () => {
    // Test case 5: specRepo: "https://github.com/owner/unregistered" (no
    // registered project's origin matches that URL) with a spec path located
    // inside a registered project's root → kind: "ok", resolved.source ===
    // "registered" (Step 3 still wins after Step 2's URL/slug yields zero matches)
    registerProject("project-a", projectA, { dir: cfgDir });
    const specDir = join(projectA, "specs");
    mkdirSync(specDir);
    const specPath = join(specDir, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "https://github.com/owner/unregistered",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.source).toBe("registered");
    }
  });

  test("relative path repo: falls through to location-based resolution when spec inside registered project", () => {
    registerProject("project-a", projectA, { dir: cfgDir });
    const specDir = join(projectA, "specs");
    mkdirSync(specDir);
    const specPath = join(specDir, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "./project",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.key).toBe("project-a");
      expect(result.resolved.source).toBe("registered");
      expect(result.resolved.mode).toBe("registered");
    }
  });

  test("bareword repo: falls through to location-based resolution when spec inside registered project", () => {
    registerProject("project-a", projectA, { dir: cfgDir });
    const specDir = join(projectA, "specs");
    mkdirSync(specDir);
    const specPath = join(specDir, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "jarvis",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.key).toBe("project-a");
      expect(result.resolved.source).toBe("registered");
      expect(result.resolved.mode).toBe("registered");
    }
  });

  test("relative path repo: falls through to ad-hoc resolution when spec inside unregistered git checkout", () => {
    execSync("git init -b main", { cwd: projectB });
    const specDir = join(projectB, "specs");
    mkdirSync(specDir);
    const specPath = join(specDir, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "./other-project",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.root).toBe(projectB);
      expect(result.resolved.source).toBe("ad-hoc");
      expect(result.resolved.mode).toBe("ad-hoc");
    }
  });

  test("bareword repo: falls through to ad-hoc resolution when spec inside unregistered git checkout", () => {
    execSync("git init -b main", { cwd: projectB });
    const specDir = join(projectB, "specs");
    mkdirSync(specDir);
    const specPath = join(specDir, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "some-repo",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.resolved.project.root).toBe(projectB);
      expect(result.resolved.source).toBe("ad-hoc");
      expect(result.resolved.mode).toBe("ad-hoc");
    }
  });

  test("relative path repo: errors with unknown-repo message when no location fallback", () => {
    registerProject("project-a", projectA, { dir: cfgDir });
    registerProject("project-b", projectB, { dir: cfgDir });
    const specPath = join(dir, "specs", "index.md");
    mkdirSync(join(dir, "specs"));
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "./other-project",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("spec `repo:`:");
      expect(result.message).toContain("./other-project");
      expect(result.message).toContain("project-a");
      expect(result.message).toContain("project-b");
    }
  });

  test("bareword repo: errors with unknown-repo message when no location fallback", () => {
    registerProject("project-a", projectA, { dir: cfgDir });
    registerProject("project-b", projectB, { dir: cfgDir });
    const specPath = join(dir, "specs", "index.md");
    mkdirSync(join(dir, "specs"));
    writeFileSync(specPath, "- [ ] todo\n");

    const result = resolveProject({
      specPath,
      specRepo: "missing-repo",
      config: { dir: cfgDir },
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("spec `repo:`:");
      expect(result.message).toContain("missing-repo");
      expect(result.message).toContain("project-a");
      expect(result.message).toContain("project-b");
    }
  });
});
