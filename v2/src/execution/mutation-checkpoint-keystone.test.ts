import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { verifyMutationCheckpoints } from "./mutation-checkpoint-verifier.ts";
import { executeWrite } from "./write.ts";

const { roots } = trackedTempRoots();
const REPO_ROOT = join(import.meta.dir, "../../..");

function runWrite(args: {
  jarvisRoot: string;
  bindings: readonly InvocationBinding[];
  artifactPath?: string;
  promptId?: string;
  mutationCheckpointSeams?: Parameters<typeof executeWrite>[0]["mutationCheckpointSeams"];
}) {
  roots.push(join(args.jarvisRoot, ".."));
  return executeWrite({
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: "write-run",
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: args.artifactPath ?? "proof.txt",
    bindings: args.bindings,
    ...(args.promptId !== undefined ? { promptId: args.promptId } : {}),
    ...(args.mutationCheckpointSeams !== undefined ? { mutationCheckpointSeams: args.mutationCheckpointSeams } : {}),
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
  });
}

function writeImplementSubspec(jarvisRoot: string, criteria: string): string {
  const worktreePath = join(jarvisRoot, "worktrees", "demo", "write-run");
  mkdirSync(worktreePath, { recursive: true });
  const subspec = join(worktreePath, "00-subspec.md");
  writeFileSync(subspec, `## Acceptance criteria\n\n${criteria}`, "utf8");
  return subspec;
}

function copyRepoFile(worktree: string, relPath: string): void {
  const src = join(REPO_ROOT, relPath);
  const dest = join(worktree, relPath);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src, "utf8"), "utf8");
}

function seedKeystoneFixture(args: {
  worktree: string;
  subspecPath: string;
  criterionBody: string;
  testBasename: string;
  pinTitle: string;
}): void {
  writeFileSync(args.subspecPath, `## Acceptance criteria\n\n- [x] ${args.criterionBody}\n`, "utf8");
  writeFileSync(join(args.worktree, "headline.ts"), "export const value = 1;\n", "utf8");
  writeFileSync(
    join(args.worktree, args.testBasename),
    `test("${args.pinTitle}", () => {\n  // @mutate headline.ts "value = 1" -> "value = 2"\n});\n`,
    "utf8",
  );
}

describe("keystone mutation checkpoints at implement completion", () => {
  test("refuses completion when keystone mutation survives", async () => {
    // @mutate v2/src/execution/write.ts "if (report.inertHeadline.length > 0)" -> "if (false && report.inertHeadline.length > 0)"
    const { jarvisRoot } = createJarvisHome();
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    mkdirSync(worktree, { recursive: true });
    const fixtureSubspec = join(worktree, "fixture-inert.md");
    seedKeystoneFixture({
      worktree,
      subspecPath: fixtureSubspec,
      criterionBody:
        "`inert.test.ts` — `keystone pin survives`; Keystone checkpoint: headline revert leaves suite green.",
      testBasename: "inert.test.ts",
      pinTitle: "keystone pin survives",
    });

    const result = await runWrite({
      jarvisRoot,
      artifactPath: fixtureSubspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: { runScopedTests: async () => true },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("spec.criteria-ticked");
      expect(result.result.failureReason).toContain("Inert headline change");
      expect(result.result.failureReason).not.toContain("Hollow mutation checkpoints");
    }
  });

  test("allows completion when keystone mutation turns its pin red", async () => {
    const { jarvisRoot } = createJarvisHome();
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    mkdirSync(worktree, { recursive: true });
    const fixtureSubspec = join(worktree, "fixture-caught.md");
    seedKeystoneFixture({
      worktree,
      subspecPath: fixtureSubspec,
      criterionBody: "`caught.test.ts` — `keystone pin caught`; Keystone checkpoint: headline revert turns pin red.",
      testBasename: "caught.test.ts",
      pinTitle: "keystone pin caught",
    });

    const result = await runWrite({
      jarvisRoot,
      artifactPath: fixtureSubspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: { runScopedTests: async () => false },
    });

    expect(result.result.kind).toBe("complete");
  });

  test("completes when guard checkpoints exist without a keystone criterion (keystones are opt-in)", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `guard.test.ts` — `guard pin`; Mutation checkpoint: flipping the guard turns this RED.\n",
    );
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    writeFileSync(join(worktree, "guard.ts"), "export const ok = (a: number) => a > 0;\n", "utf8");
    writeFileSync(
      join(worktree, "guard.test.ts"),
      'test("guard pin", () => {\n  // @mutate guard.ts "a > 0" -> "a >= 0"\n});\n',
      "utf8",
    );

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: { runScopedTests: async () => false },
    });

    // Keystones are verified when present but not required: a guard-only subspec whose guard
    // mutation reddens completes. (Requiring a keystone on every guard spec would brick the pipeline.)
    expect(result.result.kind).toBe("complete");
  });

  test("refuses when keystone criterion has no linked directive on the pin", async () => {
    const { jarvisRoot } = createJarvisHome();
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    mkdirSync(worktree, { recursive: true });
    const fixtureSubspec = join(worktree, "fixture-unlinked.md");
    writeFileSync(
      fixtureSubspec,
      "## Acceptance criteria\n\n- [x] `unlinked.test.ts` — `keystone pin`; Keystone checkpoint: headline revert turns pin red.\n",
      "utf8",
    );
    writeFileSync(
      join(worktree, "unlinked.test.ts"),
      'test("keystone pin", () => {\n  expect(true).toBe(true);\n});\n',
      "utf8",
    );

    const result = await runWrite({
      jarvisRoot,
      artifactPath: fixtureSubspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: { runScopedTests: async () => false },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failureReason).toContain("Unlinked keystone checkpoints");
      expect(result.result.failureReason).not.toContain("Hollow mutation checkpoints");
    }
  });

  test("refuses when more than one ticked keystone criterion", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `a.test.ts` — `first`; Keystone checkpoint: first keystone.\n- [x] `b.test.ts` — `second`; Keystone checkpoint: second keystone.\n",
    );
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    writeFileSync(join(worktree, "headline.ts"), "export const value = 1;\n", "utf8");
    writeFileSync(
      join(worktree, "a.test.ts"),
      'test("first", () => {\n  // @mutate headline.ts "value = 1" -> "value = 2"\n});\n',
      "utf8",
    );
    writeFileSync(
      join(worktree, "b.test.ts"),
      'test("second", () => {\n  // @mutate headline.ts "value = 1" -> "value = 3"\n});\n',
      "utf8",
    );

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: { runScopedTests: async () => false },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failureReason).toContain("Multiple keystone checkpoints");
      expect(result.result.failureReason).not.toContain("Inert headline change");
      expect(result.result.failureReason).not.toContain("Hollow mutation checkpoints");
    }
  });

  test("keystone on implementing subspec catches headline revert", async () => {
    // @mutate v2/src/execution/write.ts "if (report.inertHeadline.length > 0)" -> "if (false && report.inertHeadline.length > 0)"
    const { jarvisRoot } = createJarvisHome();
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    mkdirSync(worktree, { recursive: true });
    copyRepoFile(worktree, "v2/src/execution/write.ts");
    copyRepoFile(worktree, "v2/src/execution/mutation-checkpoint-verifier.ts");
    copyRepoFile(worktree, "shared/mutation-checkpoint-criteria.ts");
    copyRepoFile(worktree, "v2/src/execution/mutation-checkpoint-keystone.test.ts");
    const subspecPath = join(
      worktree,
      "v2/spec/20260807T042950Z-mutation-checkpoint-keystone/00-keystone-mutation-checkpoint-verification.md",
    );
    mkdirSync(dirname(subspecPath), { recursive: true });
    writeFileSync(
      subspecPath,
      [
        "## Acceptance criteria",
        "",
        "- [x] `v2/src/execution/mutation-checkpoint-keystone.test.ts` — `keystone on implementing subspec catches headline revert`; Keystone checkpoint: reverting inert-headline refusal turns pin red.",
        "",
      ].join("\n"),
      "utf8",
    );

    const report = await verifyMutationCheckpoints(worktree, subspecPath, {
      runScopedTests: async () => false,
    });

    expect(report.inertHeadline).toEqual([]);
    expect(report.hollow).toEqual([]);
    expect(report.caught.length).toBeGreaterThan(0);
  });
});
