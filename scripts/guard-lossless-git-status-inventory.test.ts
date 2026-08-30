import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findLosslessGitStatusInventoryViolations,
  LOSSLESS_GIT_STATUS_CONSUMER_FILES,
  runLosslessGitStatusInventoryGuard,
} from "./guard-lossless-git-status-inventory.ts";

const CLEANUP_FILE = "v2/src/commands/cleanup.ts";
const STATUS_COMMAND =
  'const output = await runner.runAsync("git", ["status", "--porcelain", "--untracked-files=all"], cwd);';

function violations(source: string, file = CLEANUP_FILE) {
  return findLosslessGitStatusInventoryViolations([{ file, source }]);
}

describe("lossless git status inventory guard", () => {
  test("rejects independent git status porcelain path parsing", () => {
    const preMigrationParser = `${STATUS_COMMAND}
const lines = output.split("\\n").filter((line) => line.trim().length > 0);
for (const line of lines) {
  let path = line.slice(3).trim();
  const arrow = path.lastIndexOf(" -> ");
  if (arrow >= 0) path = path.slice(arrow + 4).trim();
}`;
    expect(violations(preMigrationParser).map(({ construct }) => construct)).toEqual(
      expect.arrayContaining([
        "newline path-record splitting",
        "status-prefix slicing",
        "rename-arrow slicing",
        "path trimming",
      ]),
    );
    const snapshotWalk = LOSSLESS_GIT_STATUS_CONSUMER_FILES.map((file) => ({
      file,
      source: file === CLEANUP_FILE ? preMigrationParser : readFileSync(join(process.cwd(), file), "utf8"),
    }));
    expect(findLosslessGitStatusInventoryViolations(snapshotWalk).length).toBeGreaterThan(0);
    expect(runLosslessGitStatusInventoryGuard(process.cwd())).toEqual([]);
  });

  test.each([
    ["newline path-record splitting", 'const paths = output.split("\\n");'],
    ["newline path-record splitting", "const paths = output.split(/\\r?\\n/);"],
    ["status-prefix slicing", "const path = line.slice(3);"],
    ["status-prefix slicing", "const status = line.slice(0, 2);"],
    ["rename-arrow slicing", 'const arrow = path.lastIndexOf(" -> ");'],
    ["rename-arrow slicing", "const renamed = path.slice(arrow + 4);"],
    ["path trimming", "const cleanPath = path.trim();"],
    ["path trimming", "const path = line.trim();"],
  ])("rejects %s", (construct, parser) => {
    expect(violations(`${STATUS_COMMAND}\n${parser}`)).toEqual([
      expect.objectContaining({ file: CLEANUP_FILE, construct }),
    ]);
  });

  test.each([
    ["newline splitting without git status", 'const lines = message.split("\\n");'],
    ["prefix slicing without git status", "const body = message.slice(3);"],
    ["arrow lookup without git status", 'const arrow = message.indexOf(" -> ");'],
    ["path trimming without git status", "const normalizedPath = path.trim();"],
  ])("allows %s", (_case, source) => {
    expect(violations(source)).toEqual([]);
  });

  test("allows getGitStatusInventory consumers after migration", () => {
    const source = `const inventory = await getGitStatusInventory(cwd, runner);
const paths = inventory.map((entry) => entry.currentPath);`;
    expect(
      findLosslessGitStatusInventoryViolations(LOSSLESS_GIT_STATUS_CONSUMER_FILES.map((file) => ({ file, source }))),
    ).toEqual([]);
  });

  test("scans only the four inventoried consumers", () => {
    const parser = `${STATUS_COMMAND}\nconst paths = output.split("\\n");`;
    expect(violations(parser, "v2/src/commands/other.ts")).toEqual([]);
    expect(violations(parser, "shared/git.ts")).toEqual([]);
  });

  test("recognizes reordered porcelain options", () => {
    const command =
      'const output = await runner.runAsync("git", ["status", "--untracked-files=all", "--porcelain"], cwd);';
    expect(violations(`${command}\nconst paths = output.split("\\n");`)).toHaveLength(1);
  });
});
