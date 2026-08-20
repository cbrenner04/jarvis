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
  test("returns empty string when there are no commits ahead of base", async () => {
    expect(await renderAttribution({ cwd: dir, base: "base" })).toBe("");
  });

  test("returns empty string when only WIP commits exist (no subspec body line)", async () => {
    commitWithMessage("a.txt", "WIP: progress\n\nNo Spec: line here\n\nJarvis-Agent: Claude Opus 4.8");
    expect(await renderAttribution({ cwd: dir, base: "base" })).toBe("");
  });

  test("renders one bullet with single label and collapsed summary line", async () => {
    commitWithMessage("a.txt", "jarvis: complete run\n\nSpec: spec/foo/index.md\n\nJarvis-Agent: Claude Opus 4.8");
    const sha = shortSha("HEAD");
    expect(await renderAttribution({ cwd: dir, base: "base" })).toBe(
      [`- ${sha} jarvis: complete run \u2014 Claude Opus 4.8`, "", "Written by Claude Opus 4.8 through Jarvis."].join(
        "\n",
      ),
    );
  });

  test("collapses summary line when many commits share one label", async () => {
    commitWithMessage("a.txt", "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.8");
    commitWithMessage("b.txt", "Second\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Claude Opus 4.8");
    const out = await renderAttribution({ cwd: dir, base: "base" });
    expect(out).toContain("Written by Claude Opus 4.8 through Jarvis.");
    expect(out).not.toContain(",");
  });

  test("lists multiple distinct labels in first-appearance order, deduped", async () => {
    commitWithMessage("a.txt", "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.8");
    commitWithMessage("b.txt", "Second\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Codex GPT-5.3");
    commitWithMessage("c.txt", "Third\n\nSpec: spec/foo/02-third.md\n\nJarvis-Agent: Claude Opus 4.8");
    commitWithMessage("d.txt", "Fourth\n\nSpec: spec/foo/03-fourth.md\n\nJarvis-Agent: Cursor Composer 2");
    const out = await renderAttribution({ cwd: dir, base: "base" });
    expect(out.endsWith("Written by Claude Opus 4.8, Codex GPT-5.3, Cursor Composer 2 through Jarvis.")).toBe(true);
  });

  test("renders 'unknown' for commits missing the trailer", async () => {
    commitWithMessage("a.txt", "No-trailer subspec\n\nSpec: spec/foo/00-first.md\n");
    const sha = shortSha("HEAD");
    const out = await renderAttribution({ cwd: dir, base: "base" });
    expect(out).toBe(`- ${sha} No-trailer subspec \u2014 unknown`);
    expect(out).not.toContain("Written by");
  });

  test("includes only labelled commits in summary; lists every commit in per-commit list", async () => {
    commitWithMessage("a.txt", "Untrailed\n\nSpec: spec/foo/00-first.md\n");
    commitWithMessage("b.txt", "Labelled\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Claude Opus 4.8");
    const out = await renderAttribution({ cwd: dir, base: "base" });
    expect(out).toContain("\u2014 unknown");
    expect(out).toContain("\u2014 Claude Opus 4.8");
    expect(out).toContain("Written by Claude Opus 4.8 through Jarvis.");
  });

  test("joins multi-trailer commits with comma-space", async () => {
    commitWithMessage(
      "a.txt",
      "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.8\nJarvis-Agent: Codex GPT-5.3",
    );
    const sha = shortSha("HEAD");
    const out = await renderAttribution({ cwd: dir, base: "base" });
    expect(out.split("\n")[0]).toBe(`- ${sha} First \u2014 Claude Opus 4.8, Codex GPT-5.3`);
  });

  test("renders ordered mixed step counts per agent", async () => {
    // @mutate v2/src/execution/pr-attribution.ts "agentCounts.set(kind, (agentCounts.get(kind) ?? 0) + 1);" -> "agentCounts.set(kind, 1);"
    commitWithMessage(
      "a.txt",
      "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Claude Opus 4.8\nJarvis-Step: write",
    );
    commitWithMessage(
      "b.txt",
      "Second\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Claude Opus 4.8\nJarvis-Step: mutation-repair",
    );
    commitWithMessage(
      "c.txt",
      "Third\n\nSpec: spec/foo/02-third.md\n\nJarvis-Agent: Claude Opus 4.8\nJarvis-Step: review 1",
    );
    commitWithMessage(
      "d.txt",
      "Fourth\n\nSpec: spec/foo/03-fourth.md\n\nJarvis-Agent: Claude Opus 4.8\nJarvis-Step: review 2",
    );
    const out = await renderAttribution({ cwd: dir, base: "base" });
    const lines = out.split("\n");
    const summaryIndex = lines.indexOf("Written by Claude Opus 4.8 through Jarvis.");
    expect(summaryIndex).toBeGreaterThan(-1);
    expect(lines[summaryIndex + 1]).toBe("Claude Opus 4.8 \u2014 Steps: write 1, review 2, mutation-repair 1");
  });

  test("normalizes review steps and deduplicates trailers per commit", async () => {
    // @mutate v2/src/execution/pr-attribution.ts "const distinctAgents = new Set(commit.jarvisAgentTrailers.filter((agent) => agent !== \"\"));" -> "const distinctAgents = commit.jarvisAgentTrailers.filter((agent) => agent !== \"\");"
    commitWithMessage(
      "a.txt",
      [
        "First",
        "",
        "Spec: spec/foo/00-first.md",
        "",
        "Jarvis-Agent: Claude Opus 4.8",
        "Jarvis-Agent: Claude Opus 4.8",
        "Jarvis-Agent: Codex GPT-5.3",
        "Jarvis-Step: review 1",
        "Jarvis-Step: review 1",
      ].join("\n"),
    );
    commitWithMessage(
      "b.txt",
      "Second\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: Claude Opus 4.8\nJarvis-Step: write",
    );
    const out = await renderAttribution({ cwd: dir, base: "base" });
    expect(out).toContain("Claude Opus 4.8 \u2014 Steps: write 1, review 1");
    expect(out).not.toContain("Codex GPT-5.3 \u2014 Steps");
  });

  test("suppresses invalid and single-kind step counts", async () => {
    // @mutate v2/src/execution/pr-attribution.ts "if (kindsPresent.length <= 1) {" -> "if (kindsPresent.length < 1) {"
    commitWithMessage("a.txt", "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: X");
    commitWithMessage("b.txt", "Second\n\nSpec: spec/foo/01-second.md\n\nJarvis-Agent: X\nJarvis-Step: bogus-step");
    commitWithMessage(
      "c.txt",
      "Third\n\nSpec: spec/foo/02-third.md\n\nJarvis-Agent: X\nJarvis-Step: write\nJarvis-Step: mutation-repair",
    );
    commitWithMessage("d.txt", "Fourth\n\nSpec: spec/foo/03-fourth.md\n\nJarvis-Agent: Y\nJarvis-Step: ready-gate");
    const out = await renderAttribution({ cwd: dir, base: "base" });
    expect(out).not.toContain("Steps:");
  });

  test("excludes non-subspec commits from step counts", async () => {
    // @mutate v2/src/execution/pr-attribution.ts "return commits.filter((c) => c.firstBodyLine.startsWith(SUBSPEC_FIRST_BODY_LINE_PREFIX));" -> "return commits.filter(() => true);"
    commitWithMessage("a.txt", "First\n\nSpec: spec/foo/00-first.md\n\nJarvis-Agent: Z\nJarvis-Step: write");
    commitWithMessage("b.txt", "WIP: progress\n\nNo Spec: line here\n\nJarvis-Agent: Z\nJarvis-Step: review 1");
    const out = await renderAttribution({ cwd: dir, base: "base" });
    expect(out).not.toContain("Steps:");
  });
});

describe("readBranchCommits with injected git", () => {
  test("parses synthetic git log output", async () => {
    const fieldSep = "\x1f";
    const recordSep = "\x1e";
    const _trailerSep = "\x02";
    const logOutput = [
      `abc1234${fieldSep}jarvis: complete run${fieldSep}Claude Opus 4.8${fieldSep}write${fieldSep}Spec: v2/spec/test/index.md\n\nJarvis-Agent: Claude Opus 4.8\nJarvis-Step: write${recordSep}`,
    ].join("");

    const commits = await readBranchCommits({
      cwd: "/tmp",
      base: "main",
      git: async (_cwd, args) => {
        expect(args[0]).toBe("log");
        return logOutput;
      },
    });

    expect(commits).toHaveLength(1);
    expect(commits[0]?.firstBodyLine).toBe("Spec: v2/spec/test/index.md");
    expect(commits[0]?.jarvisAgentTrailers).toEqual(["Claude Opus 4.8"]);
    expect(commits[0]?.jarvisStepTrailers).toEqual(["write"]);
  });

  test("propagates rejected git read", async () => {
    await expect(
      readBranchCommits({
        cwd: "/tmp",
        base: "main",
        git: async () => {
          throw new Error("git failed");
        },
      }),
    ).rejects.toThrow("git failed");
  });
});
