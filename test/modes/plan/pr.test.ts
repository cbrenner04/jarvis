import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPlanPrHeader,
  maybeMarkPlanPrReady,
  renderPlanAttribution,
} from "../../../src/modes/plan/pr.ts";
import {
  extractNarrative,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
} from "../../../src/pr.ts";

describe("buildPlanPrHeader", () => {
  test("builds header with correct name interpolation", () => {
    const header = buildPlanPrHeader({ name: "my-feature" });
    expect(header).toContain("spec/my-feature/");
    expect(header).toContain("spec/my-feature/intent.md");
    expect(header).toContain("spec/my-feature/index.md");
  });

  test("uses capitalized fallback title 'Plan: <name>'", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).toContain("# Plan: test");
  });

  test("includes intent and index file references", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).toContain("- Intent: `spec/test/intent.md`");
    expect(header).toContain("- Index: `spec/test/index.md`");
  });

  test("is deterministic - same input produces same output", () => {
    const header1 = buildPlanPrHeader({ name: "feature-a" });
    const header2 = buildPlanPrHeader({ name: "feature-a" });
    expect(header1).toBe(header2);
  });

  test("renders as markdown text, not HTML", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).not.toContain("<");
    expect(header).not.toContain(">");
  });

  test("never includes Progress line or checklist", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).not.toContain("## Progress");
    expect(header).not.toContain("- [ ]");
    expect(header).not.toContain("- [x]");
  });

  test("does not include prose paragraphs about reviewing and merging", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).not.toContain("This PR was authored by");
    expect(header).not.toContain("Plan mode never marks");
    expect(header).not.toContain("Implementation work begins");
  });
});

describe("extractNarrative - shared utility", () => {
  test("extracts narrative between markers", () => {
    const body = `header
${NARRATIVE_START_MARKER}
This is narrative content.
${NARRATIVE_END_MARKER}
footer`;
    expect(extractNarrative(body)).toBe("This is narrative content.");
  });

  test("returns null when markers are missing", () => {
    const body = "just body text";
    expect(extractNarrative(body)).toBeNull();
  });

  test("trims whitespace around narrative", () => {
    const body = `${NARRATIVE_START_MARKER}

  narrative text

${NARRATIVE_END_MARKER}`;
    expect(extractNarrative(body)).toBe("narrative text");
  });
});

let gitDir: string;

function gitSetup(): void {
  execSync("git init -q", { cwd: gitDir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", {
    cwd: gitDir,
    stdio: "pipe",
  });
  execSync("git config user.name 'Test User'", { cwd: gitDir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: gitDir, stdio: "pipe" });
  execSync("git checkout -q -b base", { cwd: gitDir, stdio: "pipe" });
  writeFileSync(join(gitDir, "seed.txt"), "seed\n");
  execSync("git add -A", { cwd: gitDir, stdio: "pipe" });
  execSync("git commit -q -m 'seed'", { cwd: gitDir, stdio: "pipe" });
  execSync("git checkout -q -b feature", { cwd: gitDir, stdio: "pipe" });
}

function commitWithPlanMeta(
  filename: string,
  subject: string,
  bodyLines: string[],
  agent: string = "",
): void {
  writeFileSync(join(gitDir, filename), `${filename}\n`);
  execSync("git add -A", { cwd: gitDir, stdio: "pipe" });

  const body =
    agent === ""
      ? bodyLines.join("\n")
      : [bodyLines.join("\n"), "", `Jarvis-Agent: ${agent}`].join("\n");
  const message = `${subject}\n\n${body}`;

  execFileSync("git", ["commit", "-q", "-F", "-"], {
    cwd: gitDir,
    input: message,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function shortSha(ref: string): string {
  return execFileSync("git", ["rev-parse", "--short", ref], {
    cwd: gitDir,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), "plan-attribution-"));
  gitSetup();
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
});

describe("maybeMarkPlanPrReady", () => {
  test("skips silently when PR does not exist", () => {
    let checkPrCalled = false;
    let markReadyCalled = false;

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      checkPrExists: (_branch, _cwd) => {
        checkPrCalled = true;
        return null;
      },
      markReady: () => {
        markReadyCalled = true;
      },
    });

    expect(checkPrCalled).toBe(true);
    expect(markReadyCalled).toBe(false);
  });

  test("calls markReady when PR exists", () => {
    let markReadyCalled = false;
    let markReadyBranch = "";
    let markReadyCwd = "";

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      checkPrExists: (_branch, _cwd) => 123,
      markReady: (branch, cwd) => {
        markReadyCalled = true;
        markReadyBranch = branch;
        markReadyCwd = cwd;
      },
    });

    expect(markReadyCalled).toBe(true);
    expect(markReadyBranch).toBe("feature");
    expect(markReadyCwd).toBe(gitDir);
  });

  test("does not throw when markReady throws", () => {
    expect(() => {
      maybeMarkPlanPrReady({
        branch: "feature",
        cwd: gitDir,
        checkPrExists: () => 123,
        markReady: () => {
          throw new Error("gh pr ready failed");
        },
      });
    }).toThrow("gh pr ready failed");
  });

  test("calls markReady with bun run ready before gh pr ready", () => {
    let bunReadyCalled = false;
    let ghReadyCalled = false;
    let bunCalledBeforeGh = false;

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      checkPrExists: () => 123,
      markReady: () => {
        bunReadyCalled = true;
        if (!ghReadyCalled) {
          bunCalledBeforeGh = true;
        }
      },
    });

    expect(bunReadyCalled).toBe(true);
    expect(bunCalledBeforeGh).toBe(true);
  });

  test("propagates error from bun run ready and does not call gh pr ready", () => {
    let ghReadyCalled = false;

    expect(() => {
      maybeMarkPlanPrReady({
        branch: "feature",
        cwd: gitDir,
        checkPrExists: () => 123,
        markReady: () => {
          throw new Error("bun run ready failed");
        },
      });
    }).toThrow("bun run ready failed");

    expect(ghReadyCalled).toBe(false);
  });
});

describe("renderPlanAttribution", () => {
  test("returns empty string when there are no commits", () => {
    expect(renderPlanAttribution({ cwd: gitDir, base: "base" })).toBe("");
  });

  test("collapses only meta-commits into a single summary line", () => {
    commitWithPlanMeta(
      "a.txt",
      "plan: interview",
      ["Spec: spec/my-plan/intent.md", "", "Seeded from inline"],
      "",
    );
    commitWithPlanMeta(
      "b.txt",
      "plan: draft",
      [
        "Spec: spec/my-plan/intent.md",
        "",
        "Drafted by Claude Opus 4.7.",
        "Subspecs: 3",
      ],
      "Claude Opus 4.7",
    );
    const out = renderPlanAttribution({ cwd: gitDir, base: "base" });
    expect(out).toContain(
      "2 spec commits (interview, draft, review) — Claude Opus 4.7",
    );
    expect(out).toContain("Written by Claude Opus 4.7 through Jarvis.");
  });

  test("renders single meta-commit in collapsed form", () => {
    commitWithPlanMeta(
      "a.txt",
      "plan: draft",
      [
        "Spec: spec/my-plan/intent.md",
        "",
        "Drafted by Claude Opus 4.7.",
        "Subspecs: 2",
      ],
      "Claude Opus 4.7",
    );
    const out = renderPlanAttribution({ cwd: gitDir, base: "base" });
    expect(out).toContain("1 spec commits (interview, draft, review)");
    expect(out).toContain("Claude Opus 4.7");
  });

  test("mixes collapsed meta-commits with individual subspec commits", () => {
    commitWithPlanMeta(
      "a.txt",
      "plan: interview",
      ["Spec: spec/my-plan/intent.md", "", "Seeded from inline"],
      "",
    );
    commitWithPlanMeta(
      "b.txt",
      "plan: draft",
      [
        "Spec: spec/my-plan/intent.md",
        "",
        "Drafted by Claude Opus 4.7.",
        "Subspecs: 1",
      ],
      "Claude Opus 4.7",
    );
    commitWithPlanMeta(
      "c.txt",
      "Implement feature",
      ["Spec: spec/my-plan/00-implement.md"],
      "Claude Opus 4.7",
    );
    const out = renderPlanAttribution({ cwd: gitDir, base: "base" });
    expect(out).toContain("2 spec commits (interview, draft, review)");
    const sha = shortSha("HEAD");
    expect(out).toContain(`- ${sha} Implement feature`);
    expect(out).toContain("Written by Claude Opus 4.7 through Jarvis.");
  });

  test("handles multiple agents in meta-commits", () => {
    commitWithPlanMeta(
      "a.txt",
      "plan: interview",
      ["Spec: spec/my-plan/intent.md", "", "Seeded from inline"],
      "",
    );
    commitWithPlanMeta(
      "b.txt",
      "plan: draft",
      [
        "Spec: spec/my-plan/intent.md",
        "",
        "Drafted by Claude Opus 4.7.",
        "Subspecs: 1",
      ],
      "Claude Opus 4.7",
    );
    commitWithPlanMeta(
      "c.txt",
      "plan: review 1",
      ["Spec: spec/my-plan/intent.md", "", "Reviewed by Claude Sonnet 4.6."],
      "Claude Sonnet 4.6",
    );
    const out = renderPlanAttribution({ cwd: gitDir, base: "base" });
    expect(out).toContain("3 spec commits (interview, draft, review)");
    expect(out).toContain("Claude Opus 4.7, Claude Sonnet 4.6");
  });
});
