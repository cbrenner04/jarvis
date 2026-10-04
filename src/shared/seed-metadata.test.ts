import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRatingLevel, parseSeedMetadata, RATING_DIMENSIONS, RATING_LEVELS } from "./seed-metadata.ts";

const seed = (frontmatter: string): string => `---\n${frontmatter}\n---\n\n# Seed\n\n## Problem\n\nx\n`;

describe("parseSeedMetadata", () => {
  test("both ratings parse to typed levels", () => {
    const result = parseSeedMetadata(seed("name: demo\nrisk: high\neffort: low"));
    expect(result).toEqual({ ok: true, metadata: { name: "demo", risk: "high", effort: "low" } });
  });

  test("one rating leaves the other absent; neither substitutes", () => {
    const risk = parseSeedMetadata(seed("name: demo\nrisk: medium"));
    const effort = parseSeedMetadata(seed("name: demo\neffort: medium"));
    expect(risk).toEqual({ ok: true, metadata: { name: "demo", risk: "medium" } });
    expect(effort).toEqual({ ok: true, metadata: { name: "demo", effort: "medium" } });
    if (!risk.ok || !effort.ok) return;
    expect("effort" in risk.metadata).toBe(false);
    expect("risk" in effort.metadata).toBe(false);
  });

  test("no ratings, no frontmatter, and CRLF frontmatter all parse", () => {
    expect(parseSeedMetadata(seed("name: demo"))).toEqual({ ok: true, metadata: { name: "demo" } });
    expect(parseSeedMetadata("# Seed\n\nbody\n")).toEqual({ ok: true, metadata: { name: null } });
    expect(parseSeedMetadata("---\r\nname: demo\r\nrisk: low\r\n---\r\n# Seed\r\n")).toEqual({
      ok: true,
      metadata: { name: "demo", risk: "low" },
    });
  });

  test("an unknown level rejects by field name", () => {
    const result = parseSeedMetadata(seed("name: demo\nrisk: low\neffort: extreme"));
    expect(result).toMatchObject({ ok: false, reason: "invalid-rating", field: "effort", value: "extreme" });
    if (result.ok) return;
    expect(result.message).toBe('seed frontmatter `effort:` must be one of low, medium, high; got "extreme"');
  });

  test("empty and case-variant levels are malformed, not missing", () => {
    expect(parseSeedMetadata(seed("name: demo\nrisk:"))).toMatchObject({ ok: false, field: "risk", value: "" });
    expect(parseSeedMetadata(seed("name: demo\neffort: High"))).toMatchObject({ ok: false, field: "effort" });
  });

  test("ratings are only read from the frontmatter block", () => {
    const result = parseSeedMetadata(`---\nname: demo\n---\n\nrisk: extreme\n`);
    expect(result).toEqual({ ok: true, metadata: { name: "demo" } });
  });

  test("the scale is a closed three-level vocabulary over two dimensions", () => {
    expect(RATING_LEVELS).toEqual(["low", "medium", "high"]);
    expect(RATING_DIMENSIONS).toEqual(["risk", "effort"]);
    expect(RATING_LEVELS.map((level) => parseRatingLevel(` ${level} `))).toEqual([...RATING_LEVELS]);
    expect(parseRatingLevel("critical")).toBeUndefined();
  });

  test("every checked-in seed under spec/seeds/ still parses", () => {
    const seedsDir = join(import.meta.dir, "..", "..", "spec", "seeds");
    const files = existsSync(seedsDir) ? readdirSync(seedsDir).filter((file) => file.endsWith(".md")) : [];
    for (const file of files) {
      const result = parseSeedMetadata(readFileSync(join(seedsDir, file), "utf8"));
      expect({ file, ok: result.ok }).toEqual({ file, ok: true });
    }
  });
});
