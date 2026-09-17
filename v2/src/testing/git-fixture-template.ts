import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface GitFixtureTemplate {
  /** Copies the template into `destDir` (created if missing) or a fresh temp dir; returns the copy's path. */
  copy(destDir?: string): string;
}

export interface CommittedGitFixtureOptions {
  files?: Record<string, string>;
  commitMessage?: string;
}

function configureIdentity(dir: string): void {
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
}

function lazyGitFixtureTemplate(build: () => string): GitFixtureTemplate {
  let templatePath: string | undefined;
  return {
    copy(destDir?: string): string {
      if (!templatePath) {
        templatePath = build();
      }
      const dest = destDir ?? mkdtempSync(join(tmpdir(), "jarvis-git-fixture-copy-"));
      mkdirSync(dest, { recursive: true });
      cpSync(templatePath, dest, { recursive: true });
      return dest;
    },
  };
}

/** Template repo with an initial commit; `options.files` (default `{ seed: "base\n" }`) become that commit's content. */
export function createCommittedGitFixtureTemplate(options: CommittedGitFixtureOptions = {}): GitFixtureTemplate {
  const files = options.files ?? { seed: "base\n" };
  const commitMessage = options.commitMessage ?? "base";
  return lazyGitFixtureTemplate(() => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-git-fixture-template-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    configureIdentity(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, "utf8");
    }
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-qm", commitMessage], { cwd: dir });
    return dir;
  });
}

/** Template repo with `.git` initialized and identity configured, but no commit. */
export function createUncommittedGitFixtureTemplate(): GitFixtureTemplate {
  return lazyGitFixtureTemplate(() => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-git-fixture-template-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    configureIdentity(dir);
    return dir;
  });
}
