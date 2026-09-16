import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSpecRunBodySummary } from "./spec-run-body-summary.ts";

describe("deriveSpecRunBodySummary", () => {
  let tempDir = "";
  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  test("renders why lines, commits, risk, totals, ordered areas, truncation, and binaries", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "spec-summary-"));
    const specDir = join(tempDir, "v2/spec/demo");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "index.md"),
      "# Demo\n\nDelivers the demo feature.\n\n- [ ] [00 - First](./00-first.md)\n- [x] [01 - Second](./01-second.md)\n",
      "utf8",
    );
    writeFileSync(
      join(specDir, "00-first.md"),
      `# First\n\nThis is a deliberately long explanation that exceeds the fixed renderer bound and must be truncated.\n`,
      "utf8",
    );
    writeFileSync(join(specDir, "01-second.md"), "# Second\n\nSecond why.\n", "utf8");
    const summary = await deriveSpecRunBodySummary({
      worktreePath: tempDir,
      specPath: "v2/spec/demo",
      baseRef: "main",
      git: async (_cwd, args) =>
        args[0] === "log"
          ? "a\x1folder subject\x1fClaude Opus 4.8\x1f\x1f\x1eb\x1fnew subject\x1fCodex GPT-5.3\x1f\x1f\x1e"
          : "10\t2\tv2/src/a.ts\n-\t-\tv2/assets/logo.bin\n3\t1\tv2/docs/a.md\n",
    });
    const overviewIndex = summary.indexOf("## Overview");
    const subspecsIndex = summary.indexOf("## Subspecs");
    expect(overviewIndex).toBe(0);
    expect(subspecsIndex).toBeGreaterThan(overviewIndex);
    expect(summary.slice(overviewIndex, subspecsIndex)).toContain("Delivers the demo feature.");
    expect(summary.slice(overviewIndex, subspecsIndex)).toContain("- First");
    expect(summary.slice(overviewIndex, subspecsIndex)).toContain("- Second");
    expect(summary).toContain(
      "- 00 - First — This is a deliberately long explanation that exceeds the fixed renderer bound an…",
    );
    expect(summary).toContain("- 01 - Second — Second why.");
    expect(summary).toContain("- older subject \u2014 Claude Opus 4.8");
    expect(summary).toContain("- new subject \u2014 Codex GPT-5.3");
    expect(summary).toContain("## Risk cues\n- no test changes");
    expect(summary).toContain("3 files changed (+13/-3)");
    expect(summary).toContain("- v2/src: 1 file (+10/-2)");
    expect(summary).toContain("- v2/docs: 1 file (+3/-1)");
    expect(summary).toContain("- v2/assets: 1 file (+0/-0)");
  });

  test("omits the overview paragraph but keeps subspec-title bullets when the index has no opening paragraph", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "spec-summary-no-paragraph-"));
    const specDir = join(tempDir, "v2/spec/demo");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# Demo\n\n- [ ] [00 - First](./00-first.md)\n", "utf8");
    writeFileSync(join(specDir, "00-first.md"), "# First\n\nWhy.\n", "utf8");
    const summary = await deriveSpecRunBodySummary({
      worktreePath: tempDir,
      specPath: "v2/spec/demo",
      baseRef: "main",
      git: async () => "",
    });
    const overviewIndex = summary.indexOf("## Overview");
    const subspecsIndex = summary.indexOf("## Subspecs");
    expect(overviewIndex).toBe(0);
    expect(summary.slice(overviewIndex, subspecsIndex)).toBe("## Overview\n\n- First\n\n");
  });

  test("omits the Overview section entirely when the index has no opening paragraph and no linked subspecs", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "spec-summary-no-overview-"));
    const specDir = join(tempDir, "v2/spec/demo");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# Demo\n\n- [ ] plain task, not a subspec link\n", "utf8");
    const summary = await deriveSpecRunBodySummary({
      worktreePath: tempDir,
      specPath: "v2/spec/demo",
      baseRef: "main",
      git: async () => "",
    });
    expect(summary).not.toContain("## Overview");
  });

  test("returns empty template when inputs are empty", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "spec-summary-empty-"));
    mkdirSync(join(tempDir, "spec"), { recursive: true });
    writeFileSync(join(tempDir, "spec/index.md"), "# Empty\n", "utf8");
    await expect(
      deriveSpecRunBodySummary({ worktreePath: tempDir, specPath: "spec", baseRef: "main", git: async () => "" }),
    ).resolves.toBe("(no content)");
  });
});
