import { describe, expect, test } from "bun:test";
import config from "../.markdownlint-cli2.jsonc";

describe("markdownlint glob configuration", () => {
  test("globs include v2/docs/**/*.md", () => {
    expect(config.globs).toContain("v2/docs/**/*.md");
  });

  test("globs include v2/spec/**/*.md", () => {
    expect(config.globs).toContain("v2/spec/**/*.md");
  });

  test("globs do not include v2/docs/onboarding.md", () => {
    expect(config.globs).not.toContain("v2/docs/onboarding.md");
  });

  test("ignores include **/completed/**", () => {
    expect(config.ignores).toContain("**/completed/**");
  });

  test("ignores include **/verdict-*.md", () => {
    expect(config.ignores).toContain("**/verdict-*.md");
  });
});
