import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBranchCommits, renderAttribution } from "./pr-attribution.ts";

let dir: string;

function gitInit(): void {
  execSync("git init -q", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: dir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -q -b base", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -q -m 'seed'", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -q -b feature", { cwd: dir, stdio: "pipe" });
}

function commitWithMessage(filename: string, message: string): void {
  writeFileSync(join(dir, filename), `${filename}\n`);
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-q", "-F", "-"], {
    cwd: dir,
    input: message,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function shortSha(ref: string): string {
  return execFileSync("git", ["rev-parse", "--short", ref], {
    cwd: dir,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "v2-render-attribution-"));
  gitInit();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("renderAttribution", () => {
  test("returns empty string when there are no commits ahead of base", () => {
    expect(renderAttribution({ cwd: dir, base: "base" })).toBe("");
  });

  test("returns empty string when only WIP commits exist (no subspec body line)", () => {
    commitWithMessage("a.txt", "WIP: progress\n\nNo Spec: line here\n\nJarvis-Agent: Claude Opus 4.8");
    expect(renderAttribution({ cwd: dir, base: "base" })).toBe("");
  });

  test("renders one bullet with single label and collapsed summary line", () => {
    commitWithMessage("a.txt", "jarvis: complete run\n\nSpec: spec/foo/index.md\n\nJarvis-Agent: Claude Opus 4.8");
    const sha = shortSha("HEAD");
    expect(renderAttribution({ cwd: dir, base: "base" })).toBe(
      [`- ${sha} jarvis: complete run \u2014 Claude Opus 4.8`, "", "Written by Claude Opus 4.8 through Jarvis."].join(
        "\n",
      ),
    );
  });

  test("collapses summary line when many commits share one label", () => {
    commitWithMessage("a.txt", "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.8");
    commitWithMessage("b.txt", "Second\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Claude Opus 4.8");
    const out = renderAttribution({ cwd: dir, base: "base" });
    expect(out).toContain("Written by Claude Opus 4.8 through Jarvis.");
    expect(out).not.toContain(",");
  });

  test("lists multiple distinct labels in first-appearance order, deduped", () => {
    commitWithMessage("a.txt", "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.8");
    commitWithMessage("b.txt", "Second\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Codex GPT-5.3");
    commitWithMessage("c.txt", "Third\n\nSpec: spec/foo/02-third.md\n\nJarvis-Agent: Claude Opus 4.8");
    commitWithMessage("d.txt", "Fourth\n\nSpec: spec/foo/03-fourth.md\n\nJarvis-Agent: Cursor Composer 2");
    const out = renderAttribution({ cwd: dir, base: "base" });
    expect(out.endsWith("Written by Claude Opus 4.8, Codex GPT-5.3, Cursor Composer 2 through Jarvis.")).toBe(true);
  });

  test("renders 'unknown' for commits missing the trailer", () => {
    commitWithMessage("a.txt", "No-trailer subspec\n\nSpec: spec/foo/00-first.md\n");
    const sha = shortSha("HEAD");
    const out = renderAttribution({ cwd: dir, base: "base" });
    expect(out).toBe(`- ${sha} No-trailer subspec \u2014 unknown`);
    expect(out).not.toContain("Written by");
  });

  test("includes only labelled commits in summary; lists every commit in per-commit list", () => {
    commitWithMessage("a.txt", "Untrailed\n\nSpec: spec/foo/00-first.md\n");
    commitWithMessage("b.txt", "Labelled\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Claude Opus 4.8");
    const out = renderAttribution({ cwd: dir, base: "base" });
    expect(out).toContain("\u2014 unknown");
    expect(out).toContain("\u2014 Claude Opus 4.8");
    expect(out).toContain("Written by Claude Opus 4.8 through Jarvis.");
  });

  test("joins multi-trailer commits with comma-space", () => {
    commitWithMessage(
      "a.txt",
      "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.8\nJarvis-Agent: Codex GPT-5.3",
    );
    const sha = shortSha("HEAD");
    const out = renderAttribution({ cwd: dir, base: "base" });
    expect(out.split("\n")[0]).toBe(`- ${sha} First \u2014 Claude Opus 4.8, Codex GPT-5.3`);
  });
});

describe("readBranchCommits with injected git", () => {
  test("parses synthetic git log output", () => {
    const fieldSep = "\x1f";
    const recordSep = "\x1e";
    const _trailerSep = "\x02";
    const logOutput = [
      `abc1234${fieldSep}jarvis: complete run${fieldSep}Claude Opus 4.8${fieldSep}Spec: v2/spec/test/index.md\n\nJarvis-Agent: Claude Opus 4.8${recordSep}`,
    ].join("");

    const commits = readBranchCommits({
      cwd: "/tmp",
      base: "main",
      git: (_cwd, args) => {
        expect(args[0]).toBe("log");
        return logOutput;
      },
    });

    expect(commits).toHaveLength(1);
    expect(commits[0]?.firstBodyLine).toBe("Spec: v2/spec/test/index.md");
    expect(commits[0]?.jarvisAgentTrailers).toEqual(["Claude Opus 4.8"]);
  });

  test("returns empty array when injected git throws", () => {
    expect(
      readBranchCommits({
        cwd: "/tmp",
        base: "main",
        git: () => {
          throw new Error("git failed");
        },
      }),
    ).toEqual([]);
  });
});
