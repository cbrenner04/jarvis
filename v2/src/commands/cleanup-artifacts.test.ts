import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  archiveCompletedSpec,
  checkArtifactEligibility,
  completedSpecEligibility,
  type ArtifactSpec,
} from "./cleanup-artifacts.ts";

let sequence = 0;
const roots: string[] = [];

function fixture(index: string, files: Record<string, string> = {}): ArtifactSpec {
  const root = join(process.env.TMPDIR ?? "/tmp", `jarvis-cleanup-artifacts-${sequence++}`);
  roots.push(root);
  const home = join(root, "v2-spec");
  const source = join(home, "feature");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "index.md"), index);
  for (const [path, content] of Object.entries(files)) writeFileSync(join(source, path), content);
  return { home, source, name: "feature", branch: "plan/feature" };
}

const complete = "# Complete\n\n## Acceptance criteria\n\n- [x] Works\n";
const eligibleInspection = { findOpenPrs: async () => 0, hasMaterializedOwner: async () => false };

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("completed v2 artifact archival", () => {
  test("uses linked and single-file non-human-only criteria, not index checkboxes or run state", async () => {
    const linked = fixture("# Index\n\n- [ ] [one](./one.md)\n", { "one.md": complete });
    expect(await checkArtifactEligibility(linked, eligibleInspection)).toEqual({ status: "eligible" });

    const single = fixture(complete);
    rmSync(join(single.source, "index.md"));
    const singleFile = { ...single, source: join(single.home, "single.md"), name: "single" };
    writeFileSync(singleFile.source, complete);
    expect(completedSpecEligibility(singleFile)).toEqual({ status: "eligible" });
  });

  test("returns a specific fail-closed refusal reason", async () => {
    const unchecked = fixture("# Index\n\n- [x] [one](./one.md)\n", { "one.md": complete.replace("[x]", "[ ]") });
    expect(completedSpecEligibility(unchecked)).toMatchObject({ status: "ineligible", reason: expect.stringContaining("unchecked") });

    const empty = fixture("# Empty\n\n## Acceptance criteria\n\n- [x] Visual inspection only\n");
    expect(completedSpecEligibility(empty)).toEqual({ status: "ineligible", reason: "no non-human-only acceptance criteria" });
    expect(await checkArtifactEligibility(empty, { ...eligibleInspection, findOpenPrs: async () => 1 })).toEqual({
      status: "ineligible",
      reason: "no non-human-only acceptance criteria",
    });

    const completeSpec = fixture(complete);
    expect(await checkArtifactEligibility(completeSpec, { ...eligibleInspection, findOpenPrs: async () => 1 })).toMatchObject({ reason: "matching open PR exists for plan/feature" });
    expect(await checkArtifactEligibility(completeSpec, { ...eligibleInspection, hasMaterializedOwner: async () => true })).toMatchObject({ reason: "another materialized worktree owns this spec" });
    expect(await checkArtifactEligibility(completeSpec, { ...eligibleInspection, findOpenPrs: async () => Promise.reject(new Error("offline")) })).toMatchObject({ reason: expect.stringContaining("failed to inspect matching PRs") });
    expect(await checkArtifactEligibility(completeSpec, { ...eligibleInspection, hasMaterializedOwner: async () => Promise.reject(new Error("unreadable")) })).toMatchObject({ reason: expect.stringContaining("failed to inspect worktree ownership") });
  });

  test("archives transactionally, prunes only byte-identical intent, and leaves run data outside its scope", () => {
    const spec = fixture(complete, { "intent.md": "intent\n" });
    const ready = join(spec.home, "ready-intents", "feature.md");
    mkdirSync(join(spec.home, "ready-intents"), { recursive: true });
    writeFileSync(ready, "intent\n");
    const runs = join(spec.home, "runs.jsonl");
    writeFileSync(runs, "durable row\n");

    expect(archiveCompletedSpec(spec)).toEqual({ status: "archived", destination: join(spec.home, "completed", "feature"), intentPruned: true });
    expect(existsSync(spec.source)).toBe(false);
    expect(existsSync(ready)).toBe(false);
    expect(readFileSync(runs, "utf8")).toBe("durable row\n");
  });

  test("retains a differing ready-intent and restores the source when pruning fails", () => {
    const different = fixture(complete, { "intent.md": "original\n" });
    const ready = join(different.home, "ready-intents", "feature.md");
    mkdirSync(join(different.home, "ready-intents"), { recursive: true });
    writeFileSync(ready, "queued\n");
    expect(archiveCompletedSpec(different)).toMatchObject({ status: "archived", intentPruned: false });
    expect(readFileSync(ready, "utf8")).toBe("queued\n");

    const failing = fixture(complete, { "intent.md": "same\n" });
    const failingReady = join(failing.home, "ready-intents", "feature.md");
    mkdirSync(join(failing.home, "ready-intents"), { recursive: true });
    writeFileSync(failingReady, "same\n");
    const result = archiveCompletedSpec(failing, {
      exists: existsSync,
      mkdir: (path) => mkdirSync(path, { recursive: true }),
      read: readFileSync,
      rename: renameSync,
      unlink: () => {
        throw new Error("disk error");
      },
    });
    expect(result).toMatchObject({ status: "skipped", reason: expect.stringContaining("archive restored") });
    expect(existsSync(failing.source)).toBe(true);
    expect(existsSync(failingReady)).toBe(true);
  });
});
