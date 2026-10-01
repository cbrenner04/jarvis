import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import {
  MAIN_SYNC_ABSENT_BLOB,
  type MainSyncPathBlobs,
  resolveLaneMergeBase,
  selectMainSyncPaths,
} from "./main-sync-scope.ts";

function entry(overrides: Partial<MainSyncPathBlobs> & Pick<MainSyncPathBlobs, "path">): MainSyncPathBlobs {
  return {
    headBlob: "head-at-fork",
    mergeBaseBlob: "head-at-fork",
    stagedBlob: "main-tip",
    baseRefTipBlob: "main-tip",
    ...overrides,
  };
}

describe("selectMainSyncPaths", () => {
  test("selects when head equals merge base, staged differs, and staged matches baseRef tip", () => {
    expect(selectMainSyncPaths([entry({ path: "synced.txt" })])).toEqual(["synced.txt"]);
  });

  test("excludes when headBlob differs from mergeBaseBlob", () => {
    expect(
      selectMainSyncPaths([
        entry({
          path: "lane-edited.txt",
          headBlob: "lane-blob",
          mergeBaseBlob: "head-at-fork",
          stagedBlob: "main-tip",
        }),
      ]),
    ).toEqual([]);
  });

  test("excludes when stagedBlob equals mergeBaseBlob", () => {
    expect(
      selectMainSyncPaths([
        entry({
          path: "unchanged.txt",
          stagedBlob: "head-at-fork",
          baseRefTipBlob: "main-tip",
        }),
      ]),
    ).toEqual([]);
  });

  test("excludes when stagedBlob matches no resolved tip blob", () => {
    expect(
      selectMainSyncPaths([
        entry({
          path: "orphan-staged.txt",
          stagedBlob: "mystery-blob",
          baseRefTipBlob: "main-tip",
          originBaseRefTipBlob: "origin-tip",
        }),
      ]),
    ).toEqual([]);
  });

  test("matches originBaseRefTipBlob when baseRef tip is absent", () => {
    expect(
      selectMainSyncPaths([
        entry({
          path: "from-origin.txt",
          stagedBlob: "origin-tip",
          baseRefTipBlob: MAIN_SYNC_ABSENT_BLOB,
          originBaseRefTipBlob: "origin-tip",
        }),
      ]),
    ).toEqual(["from-origin.txt"]);
  });

  test("ignores absent tip blobs when matching staged content", () => {
    expect(
      selectMainSyncPaths([
        entry({
          path: "only-main-tip.txt",
          stagedBlob: MAIN_SYNC_ABSENT_BLOB,
          baseRefTipBlob: MAIN_SYNC_ABSENT_BLOB,
          originBaseRefTipBlob: MAIN_SYNC_ABSENT_BLOB,
        }),
      ]),
    ).toEqual([]);
  });
});

describe("resolveLaneMergeBase", () => {
  test("returns undefined for unrelated histories", async () => {
    const root = trackedMkdtempSync(join(tmpdir(), "main-sync-merge-base-"));
    const repoRoot = join(root, "repo");
    mkdirSync(repoRoot, { recursive: true });
    const run = (args: string[]) => realAsyncSubprocessRunner.runAsync("git", args, repoRoot);
    await run(["init", "-q", "-b", "lane"]);
    await run(["config", "user.email", "t@t"]);
    await run(["config", "user.name", "t"]);
    writeFileSync(join(repoRoot, "lane.txt"), "lane\n");
    await run(["add", "lane.txt"]);
    await run(["commit", "-q", "-m", "lane"]);
    await run(["branch", "-m", "lane"]);
    await run(["checkout", "--orphan", "other"]);
    writeFileSync(join(repoRoot, "other.txt"), "other\n");
    await run(["add", "other.txt"]);
    await run(["commit", "-q", "-m", "other"]);
    await expect(resolveLaneMergeBase(repoRoot, "lane", realAsyncSubprocessRunner)).resolves.toBeUndefined();
  });

  test("returns merge base for related histories", async () => {
    const root = trackedMkdtempSync(join(tmpdir(), "main-sync-merge-base-related-"));
    const repoRoot = join(root, "repo");
    mkdirSync(repoRoot, { recursive: true });
    const run = (args: string[]) => realAsyncSubprocessRunner.runAsync("git", args, repoRoot);
    await run(["init", "-q", "-b", "main"]);
    await run(["config", "user.email", "t@t"]);
    await run(["config", "user.name", "t"]);
    writeFileSync(join(repoRoot, "base.txt"), "base\n");
    await run(["add", "base.txt"]);
    await run(["commit", "-q", "-m", "base"]);
    const baseSha = (await run(["rev-parse", "HEAD"])).trim();
    await run(["checkout", "-b", "lane"]);
    writeFileSync(join(repoRoot, "lane.txt"), "lane\n");
    await run(["add", "lane.txt"]);
    await run(["commit", "-q", "-m", "lane"]);
    await expect(resolveLaneMergeBase(repoRoot, "main", realAsyncSubprocessRunner)).resolves.toBe(baseSha);
  });
});
