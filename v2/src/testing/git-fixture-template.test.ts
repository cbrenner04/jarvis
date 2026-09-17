import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCommittedGitFixtureTemplate, createUncommittedGitFixtureTemplate } from "./git-fixture-template.ts";

function localConfig(dir: string, key: string): string {
  return execFileSync("git", ["config", "--local", key], { cwd: dir }).toString().trim();
}

function headSha(dir: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
}

test("committed-mode copies are independent repos sharing the template's HEAD commit and content", () => {
  const template = createCommittedGitFixtureTemplate();
  const first = template.copy();
  const second = template.copy();

  expect(first).not.toBe(second);
  expect(headSha(first)).toBe(headSha(second));
  expect(readFileSync(join(first, "seed"), "utf8")).toBe("base\n");
  expect(readFileSync(join(second, "seed"), "utf8")).toBe("base\n");

  const baseSha = headSha(second);
  writeFileSync(join(first, "seed"), "changed\n", "utf8");
  expect(readFileSync(join(second, "seed"), "utf8")).toBe("base\n");
  execFileSync("git", ["commit", "-qam", "changed"], { cwd: first });
  expect(headSha(first)).not.toBe(baseSha);
  expect(headSha(second)).toBe(baseSha);
});

test("committed-mode copy keeps the template's git identity, so a commit in the copy succeeds", () => {
  const template = createCommittedGitFixtureTemplate();
  const copy = template.copy();
  expect(localConfig(copy, "user.email")).toBe("test@example.com");
  expect(localConfig(copy, "user.name")).toBe("Test");

  writeFileSync(join(copy, "extra"), "more\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: copy });
  expect(() => execFileSync("git", ["commit", "-qm", "extra"], { cwd: copy })).not.toThrow();
});

test("uncommitted-mode copy has an initialized .git with identity configured and no commits", () => {
  const template = createUncommittedGitFixtureTemplate();
  const copy = template.copy();

  expect(localConfig(copy, "user.email")).toBe("test@example.com");
  expect(localConfig(copy, "user.name")).toBe("Test");
  expect(() => execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: copy, stdio: "pipe" })).toThrow();
});
