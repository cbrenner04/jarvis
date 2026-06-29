import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerProject } from "../src/config.ts";
import { readRepoPath } from "../src/modes/shared-entry.ts";
import { resolveProject } from "../src/resolve-project.ts";

describe("readRepoPath", () => {
  test("returns slug repo value unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-read-repo-slug-"));
    try {
      const specPath = join(dir, "index.md");
      writeFileSync(specPath, "# Spec\n\nrepo: example/project-a\n\n- [ ] todo\n");
      expect(readRepoPath(specPath)).toBe("example/project-a");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("strips one surrounding angle-bracket pair from repo value", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-read-repo-bracket-"));
    try {
      const specPath = join(dir, "index.md");
      writeFileSync(specPath, "# Spec\n\nrepo: <https://github.com/example/project-a.git>\n\n- [ ] todo\n");
      expect(readRepoPath(specPath)).toBe("https://github.com/example/project-a.git");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readRepoPath + resolveProject", () => {
  test("slug and bracket repo lines resolve against registered origins", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-read-repo-resolve-"));
    const cfgDir = join(dir, "cfg");
    const projectRoot = join(dir, "project");
    mkdirSync(projectRoot);
    registerProject("project-a", projectRoot, {
      dir: cfgDir,
      origin: "https://github.com/example/project-a.git",
    });

    const slugSpec = join(dir, "slug-index.md");
    writeFileSync(slugSpec, "# Spec\n\nrepo: example/project-a\n\n- [ ] todo\n");
    const slugRepo = readRepoPath(slugSpec);
    expect(slugRepo).toBe("example/project-a");
    const slugResult = resolveProject({ specPath: slugSpec, specRepo: slugRepo, config: { dir: cfgDir } });
    expect(slugResult.kind).toBe("ok");
    if (slugResult.kind === "ok") {
      expect(slugResult.resolved.project.key).toBe("project-a");
    }

    const bracketSpec = join(dir, "bracket-index.md");
    writeFileSync(bracketSpec, "# Spec\n\nrepo: <https://github.com/example/project-a.git>\n\n- [ ] todo\n");
    const bracketRepo = readRepoPath(bracketSpec);
    expect(bracketRepo).toBe("https://github.com/example/project-a.git");
    const bracketResult = resolveProject({
      specPath: bracketSpec,
      specRepo: bracketRepo,
      config: { dir: cfgDir },
    });
    expect(bracketResult.kind).toBe("ok");
    if (bracketResult.kind === "ok") {
      expect(bracketResult.resolved.project.key).toBe("project-a");
    }

    rmSync(dir, { recursive: true, force: true });
  });
});
