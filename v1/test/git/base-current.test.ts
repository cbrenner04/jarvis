import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBaseCurrent, checkBaseCurrentForFinalize } from "../../src/git/base-current.ts";

let dir: string;
let ghPath: string;
let gitPath: string;
let logPath: string;
let originalPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-base-current-"));
  ghPath = join(dir, "gh");
  gitPath = join(dir, "git");
  logPath = join(dir, "calls.log");
  originalPath = process.env.PATH;
});

afterEach(() => {
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  rmSync(dir, { recursive: true, force: true });
});

function installShims(opts: {
  ghStdout?: string;
  ghExitCode?: number;
  fetchExitCode?: number;
  mergeBaseExitCode?: number;
}): void {
  writeFileSync(
    ghPath,
    [
      "#!/bin/sh",
      `printf 'gh %s\\n' "$*" >> "${logPath}"`,
      `printf '%s' '${(opts.ghStdout ?? "main").replace(/'/g, "'\\''")}'`,
      `exit ${opts.ghExitCode ?? 0}`,
      "",
    ].join("\n"),
  );
  chmodSync(ghPath, 0o755);

  writeFileSync(
    gitPath,
    [
      "#!/bin/sh",
      `printf 'git %s\\n' "$*" >> "${logPath}"`,
      'if [ "$1" = "fetch" ]; then',
      `  exit ${opts.fetchExitCode ?? 0}`,
      "fi",
      'if [ "$1" = "merge-base" ]; then',
      `  exit ${opts.mergeBaseExitCode ?? 0}`,
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(gitPath, 0o755);

  process.env.PATH = `${dir}:${originalPath ?? ""}`;
}

describe("checkBaseCurrent", () => {
  test("resolves the PR base, fetches origin/base, and treats contained base as current", () => {
    installShims({ ghStdout: "release", mergeBaseExitCode: 0 });

    const result = checkBaseCurrent({ branch: "feature", cwd: dir });

    expect(result).toEqual({ status: "current", baseRefName: "release" });
    const calls = readFileSync(logPath, "utf8");
    expect(calls).toContain("gh pr view feature --json baseRefName -q .baseRefName\n");
  });

  test("fetches origin/base before merge-base against origin/base", () => {
    installShims({ ghStdout: "develop", mergeBaseExitCode: 0 });

    checkBaseCurrent({ branch: "feature", cwd: dir });

    const calls = readFileSync(logPath, "utf8");
    expect(calls).toContain("git fetch origin develop\n");
    expect(calls).toContain("git merge-base --is-ancestor origin/develop HEAD\n");
    expect(calls.indexOf("git fetch origin develop\n")).toBeLessThan(
      calls.indexOf("git merge-base --is-ancestor origin/develop HEAD\n"),
    );
  });

  test("treats merge-base exit 1 as behind or diverged", () => {
    installShims({ ghStdout: "main", mergeBaseExitCode: 1 });

    expect(checkBaseCurrent({ branch: "feature", cwd: dir })).toEqual({
      status: "behind",
      baseRefName: "main",
    });
  });

  test("soft-fails open on base resolution failure", () => {
    installShims({ ghExitCode: 1 });

    expect(checkBaseCurrent({ branch: "feature", cwd: dir })).toEqual({
      status: "current",
      baseRefName: null,
    });
  });

  test("soft-fails open on fetch failure", () => {
    installShims({ ghStdout: "main", fetchExitCode: 1 });

    expect(checkBaseCurrent({ branch: "feature", cwd: dir })).toEqual({
      status: "current",
      baseRefName: "main",
    });
  });
});

describe("checkBaseCurrentForFinalize", () => {
  test("no-PR path uses getBaseBranch and treats merge-base exit 1 as behind", async () => {
    installShims({ mergeBaseExitCode: 1 });

    const result = await checkBaseCurrentForFinalize({
      branch: "feature",
      cwd: dir,
      hasOpenPr: false,
      getBaseBranch: async () => "main",
    });

    expect(result).toEqual({ status: "behind", baseRefName: "main" });
    const calls = readFileSync(logPath, "utf8");
    expect(calls).not.toContain("gh pr view");
    expect(calls).toContain("git fetch origin main\n");
  });

  test("no-PR path soft-fails open on fetch failure", async () => {
    installShims({ fetchExitCode: 1 });

    expect(
      await checkBaseCurrentForFinalize({
        branch: "feature",
        cwd: dir,
        hasOpenPr: false,
        getBaseBranch: async () => "develop",
      }),
    ).toEqual({ status: "current", baseRefName: "develop" });
  });
});
