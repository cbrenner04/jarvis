import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAttribution } from "../src/pr.ts";

let dir: string;

function gitInit(): void {
  execSync("git init -q", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", {
    cwd: dir,
    stdio: "pipe",
  });
  execSync("git config user.name 'Test User'", { cwd: dir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -q -b base", { cwd: dir, stdio: "pipe" });
  // base commit so we have a parent for the diff range
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
  dir = mkdtempSync(join(tmpdir(), "render-attribution-"));
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
    commitWithMessage(
      "a.txt",
      "WIP: progress\n\nNo Spec: line here\n\nJarvis-Agent: Claude Opus 4.7",
    );
    expect(renderAttribution({ cwd: dir, base: "base" })).toBe("");
  });

  test("renders one bullet with single label and collapsed summary line", () => {
    commitWithMessage(
      "a.txt",
      "First subspec\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.7",
    );
    const sha = shortSha("HEAD");
    expect(renderAttribution({ cwd: dir, base: "base" })).toBe(
      [
        `- ${sha} First subspec \u2014 Claude Opus 4.7`,
        "",
        "Written by Claude Opus 4.7 through Jarvis.",
      ].join("\n"),
    );
  });

  test("collapses summary line when many commits share one label", () => {
    commitWithMessage(
      "a.txt",
      "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.7",
    );
    commitWithMessage(
      "b.txt",
      "Second\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Claude Opus 4.7",
    );
    const out = renderAttribution({ cwd: dir, base: "base" });
    expect(out).toContain("Written by Claude Opus 4.7 through Jarvis.");
    expect(out).not.toContain(",");
  });

  test("lists multiple distinct labels in first-appearance order, deduped", () => {
    commitWithMessage(
      "a.txt",
      "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.7",
    );
    commitWithMessage(
      "b.txt",
      "Second\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Codex GPT-5.3",
    );
    commitWithMessage(
      "c.txt",
      "Third\n\nSpec: spec/foo/02-third.md\n\nJarvis-Agent: Claude Opus 4.7",
    );
    commitWithMessage(
      "d.txt",
      "Fourth\n\nSpec: spec/foo/03-fourth.md\n\nJarvis-Agent: Cursor Composer 2",
    );
    const out = renderAttribution({ cwd: dir, base: "base" });
    expect(out.endsWith(
      "Written by Claude Opus 4.7, Codex GPT-5.3, Cursor Composer 2 through Jarvis.",
    )).toBe(true);
  });

  test("renders 'unknown' for commits missing the trailer", () => {
    commitWithMessage(
      "a.txt",
      "No-trailer subspec\n\nSpec: spec/foo/00-first.md\n",
    );
    const sha = shortSha("HEAD");
    const out = renderAttribution({ cwd: dir, base: "base" });
    expect(out).toBe(`- ${sha} No-trailer subspec \u2014 unknown`);
    // Summary line omitted when no labels are present.
    expect(out).not.toContain("Written by");
  });

  test("includes only labelled commits in summary; lists every commit in per-commit list", () => {
    commitWithMessage(
      "a.txt",
      "Untrailed\n\nSpec: spec/foo/00-first.md\n",
    );
    commitWithMessage(
      "b.txt",
      "Labelled\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Claude Opus 4.7",
    );
    const out = renderAttribution({ cwd: dir, base: "base" });
    expect(out).toContain("\u2014 unknown");
    expect(out).toContain("\u2014 Claude Opus 4.7");
    expect(out).toContain("Written by Claude Opus 4.7 through Jarvis.");
  });

  test("filters WIP commits out of per-commit list even when they carry trailers", () => {
    commitWithMessage(
      "a.txt",
      "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.7",
    );
    commitWithMessage(
      "b.txt",
      "WIP: noisy\n\nNot a spec body line\n\nJarvis-Agent: Claude Opus 4.7",
    );
    commitWithMessage(
      "c.txt",
      "Second\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Codex GPT-5.3",
    );
    const out = renderAttribution({ cwd: dir, base: "base" });
    const bullets = out.split("\n").filter((line) => line.startsWith("- "));
    expect(bullets).toHaveLength(2);
    expect(bullets[0]).toContain("First");
    expect(bullets[1]).toContain("Second");
    expect(out).not.toContain("WIP: noisy");
  });

  test("joins multi-trailer commits with comma-space", () => {
    commitWithMessage(
      "a.txt",
      "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.7\nJarvis-Agent: Codex GPT-5.3",
    );
    const sha = shortSha("HEAD");
    const out = renderAttribution({ cwd: dir, base: "base" });
    expect(out.split("\n")[0]).toBe(
      `- ${sha} First \u2014 Claude Opus 4.7, Codex GPT-5.3`,
    );
  });
});
