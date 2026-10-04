import { describe, expect, test } from "bun:test";
import config from "../.markdownlint-cli2.jsonc";

describe("markdownlint glob configuration", () => {
  test("globs include docs/**/*.md", () => {
    expect(config.globs).toContain("docs/**/*.md");
  });

  test("globs include spec/**/*.md", () => {
    expect(config.globs).toContain("spec/**/*.md");
  });

  test("globs do not include docs/onboarding.md", () => {
    expect(config.globs).not.toContain("docs/onboarding.md");
  });

  test("ignores include **/completed/**", () => {
    expect(config.ignores).toContain("**/completed/**");
  });

  test("ignores include **/verdict-*.md", () => {
    expect(config.ignores).toContain("**/verdict-*.md");
  });
});
