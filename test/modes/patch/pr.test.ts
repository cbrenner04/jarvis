import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPrBody,
  extractNarrative,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
} from "../../../src/modes/patch/pr.ts";

let dir: string;
let indexPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-pr-test-"));
  indexPath = join(dir, "index.md");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildPrBody", () => {
  test("renders header with H1, progress, and verbatim subspec checklist", () => {
    writeFileSync(
      indexPath,
      [
        "# Big Feature",
        "",
        "- [x] [00 - first](./00-first.md)",
        "- [ ] [01 - second](./01-second.md)",
        "- [ ] [02 - third](./02-third.md)",
        "",
      ].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toBe(
      [
        "# Big Feature",
        "",
        "## Progress",
        "",
        "1 of 3 subspecs complete",
        "",
        "## Subspecs",
        "",
        "- [x] [00 - first](./00-first.md)",
        "- [ ] [01 - second](./01-second.md)",
        "- [ ] [02 - third](./02-third.md)",
      ].join("\n"),
    );
  });

  test("excludes non-.md linked items from the checklist and progress count", () => {
    writeFileSync(
      indexPath,
      [
        "# Spec",
        "",
        "- [x] [00 - md](./00-md.md)",
        "- [ ] [link](https://example.com)",
        "",
      ].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toContain("1 of 1 subspecs complete");
    expect(body).toContain("- [x] [00 - md](./00-md.md)");
    expect(body).not.toContain("https://example.com");
  });

  test("includes narrative bracketed by markers when narrative is non-null", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const body = buildPrBody({
      indexPath,
      narrative: "Some narrative content.",
    });
    expect(body).toContain(
      `${NARRATIVE_START_MARKER}\nSome narrative content.\n${NARRATIVE_END_MARKER}`,
    );
  });

  test("omits narrative markers when narrative is null", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).not.toContain(NARRATIVE_START_MARKER);
    expect(body).not.toContain(NARRATIVE_END_MARKER);
  });

  test("renders header with no H1 when index has none", () => {
    writeFileSync(indexPath, "- [ ] [00 - one](./00-one.md)\n");
    const body = buildPrBody({ indexPath, narrative: null });
    expect(body.startsWith("## Progress\n")).toBe(true);
    expect(body).toContain("0 of 1 subspecs complete");
  });
});

describe("extractNarrative", () => {
  test("returns trimmed text between markers when both are present", () => {
    const body = [
      "# Header",
      "",
      NARRATIVE_START_MARKER,
      "",
      "  hello world  ",
      "",
      NARRATIVE_END_MARKER,
      "",
      "footer",
    ].join("\n");
    expect(extractNarrative(body)).toBe("hello world");
  });

  test("returns null when start marker is missing", () => {
    const body = `body\n${NARRATIVE_END_MARKER}\n`;
    expect(extractNarrative(body)).toBeNull();
  });

  test("returns null when end marker is missing", () => {
    const body = `${NARRATIVE_START_MARKER}\ncontent\n`;
    expect(extractNarrative(body)).toBeNull();
  });

  test("returns null when both markers are missing", () => {
    expect(extractNarrative("just a body")).toBeNull();
  });

  test("trims surrounding whitespace from extracted content", () => {
    const body = `${NARRATIVE_START_MARKER}\n\n\nbody text\n\n\n${NARRATIVE_END_MARKER}`;
    expect(extractNarrative(body)).toBe("body text");
  });
});
