import { describe, expect, test } from "bun:test";
import { normalizeRepoUrl, repoUrlsEqual } from "../src/repo-url.ts";

describe("normalizeRepoUrl", () => {
  test("treats equivalent forms as equal", () => {
    const forms = [
      "git@github.com:Org/Repo.git",
      "https://github.com/org/repo",
      "https://github.com/org/repo.git",
      "ssh://git@github.com/org/repo.git",
      "Org/Repo",
    ];
    const canonical = "github.com/org/repo";
    for (const f of forms) {
      expect(normalizeRepoUrl(f)).toBe(canonical);
    }
  });

  test("lowercases host and path", () => {
    expect(normalizeRepoUrl("https://GitHub.COM/Org/Repo")).toBe(
      "github.com/org/repo",
    );
  });

  test("strips trailing .git", () => {
    expect(normalizeRepoUrl("https://github.com/org/repo.git")).toBe(
      "github.com/org/repo",
    );
  });

  test("handles ssh scp-like form", () => {
    expect(normalizeRepoUrl("git@github.com:org/repo.git")).toBe(
      "github.com/org/repo",
    );
  });

  test("returns undefined for empty or junk", () => {
    expect(normalizeRepoUrl("")).toBeUndefined();
    expect(normalizeRepoUrl("   ")).toBeUndefined();
    expect(normalizeRepoUrl("not a url")).toBeUndefined();
  });

  test("bare slug maps to github.com", () => {
    expect(normalizeRepoUrl("octocat/hello-world")).toBe(
      "github.com/octocat/hello-world",
    );
  });

  test("repoUrlsEqual loosely compares forms", () => {
    expect(
      repoUrlsEqual(
        "git@github.com:Org/Repo.git",
        "https://github.com/org/repo",
      ),
    ).toBe(true);
    expect(
      repoUrlsEqual("https://github.com/org/repo", "https://github.com/org/x"),
    ).toBe(false);
  });
});
