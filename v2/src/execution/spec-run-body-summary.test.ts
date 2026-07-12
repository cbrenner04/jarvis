import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSpecRunBodySummary, parseSpecIndex } from "./spec-run-body-summary.ts";

describe("parseSpecIndex", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir !== "") {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("returns title and checklist lines verbatim", () => {
    tempDir = mkdtempSync(join(tmpdir(), "spec-index-parse-"));
    const indexPath = join(tempDir, "index.md");
    writeFileSync(
      indexPath,
      "# My plan\n\nIntro prose.\n\n- [ ] [01 - First](./01-first.md)\n- [x] [02 - Second](./02-second.md)\n",
      "utf8",
    );

    expect(parseSpecIndex(indexPath)).toEqual({
      title: "My plan",
      checklistLines: ["- [ ] [01 - First](./01-first.md)", "- [x] [02 - Second](./02-second.md)"],
    });
  });

  test("missing file yields empty parse", () => {
    tempDir = mkdtempSync(join(tmpdir(), "spec-index-missing-"));
    expect(parseSpecIndex(join(tempDir, "index.md"))).toEqual({ title: "", checklistLines: [] });
  });

  test("H1-less index yields empty title", () => {
    tempDir = mkdtempSync(join(tmpdir(), "spec-index-no-h1-"));
    const indexPath = join(tempDir, "index.md");
    writeFileSync(indexPath, "- [ ] [Only](./only.md)\n", "utf8");
    expect(parseSpecIndex(indexPath)).toEqual({ title: "", checklistLines: ["- [ ] [Only](./only.md)"] });
  });
});

describe("deriveSpecRunBodySummary", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir !== "") {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("renders H1 and full checklist", () => {
    tempDir = mkdtempSync(join(tmpdir(), "spec-summary-full-"));
    const specDir = join(tempDir, "v2/spec/demo-spec");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "index.md"),
      "# Demo spec\n\n- [ ] [00 - Alpha](./00-alpha.md)\n- [ ] [01 - Beta](./01-beta.md)\n",
      "utf8",
    );

    expect(
      deriveSpecRunBodySummary({
        worktreePath: tempDir,
        specPath: "v2/spec/demo-spec",
      }),
    ).toBe("# Demo spec\n\n- [ ] [00 - Alpha](./00-alpha.md)\n- [ ] [01 - Beta](./01-beta.md)");
  });

  test("H1 with no checklist items yields H1 only", () => {
    tempDir = mkdtempSync(join(tmpdir(), "spec-summary-h1-only-"));
    const specDir = join(tempDir, "spec/plan");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# Solo title\n\nNo checklist yet.\n", "utf8");

    expect(
      deriveSpecRunBodySummary({
        worktreePath: tempDir,
        specPath: "spec/plan",
      }),
    ).toBe("# Solo title");
  });

  test("missing index yields no summary", () => {
    tempDir = mkdtempSync(join(tmpdir(), "spec-summary-missing-"));
    expect(
      deriveSpecRunBodySummary({
        worktreePath: tempDir,
        specPath: "spec/missing",
      }),
    ).toBeUndefined();
  });
});
