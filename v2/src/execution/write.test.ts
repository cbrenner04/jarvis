import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import type { MutationCheckpointVerifierSeams } from "./criteria-ticked-mutation-checkpoint-verifier.ts";
import { executeWrite } from "./write.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

const { roots } = trackedTempRoots();

const MULTI_SURFACE_BULLET =
  "The state-store persists completed runs atomically, and the CLI validates run flags before dispatch.";

function runWrite(args: {
  jarvisRoot: string;
  bindings: readonly InvocationBinding[];
  artifactPath?: string;
  stepRules?: string;
  invocationTelemetry?: Parameters<typeof executeWrite>[0]["invocationTelemetry"];
  promptId?: string;
  promptPlaceholders?: Record<string, string>;
  idleOutputMs?: number;
  mutationCheckpointSeams?: MutationCheckpointVerifierSeams;
}) {
  // Track the parent directory of jarvisRoot for cleanup
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
    ...(args.stepRules !== undefined ? { stepRules: args.stepRules } : {}),
    ...(args.invocationTelemetry !== undefined ? { invocationTelemetry: args.invocationTelemetry } : {}),
    ...(args.promptId !== undefined ? { promptId: args.promptId } : {}),
    ...(args.promptPlaceholders !== undefined ? { promptPlaceholders: args.promptPlaceholders } : {}),
    ...(args.idleOutputMs !== undefined ? { idleOutputMs: args.idleOutputMs } : {}),
    ...(args.mutationCheckpointSeams !== undefined
      ? { mutationCheckpointSeams: args.mutationCheckpointSeams }
      : {}),
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
  });
}

/** Writes a subspec into the fake worktree runWrite resolves, returning its absolute path. */
function writeImplementSubspec(jarvisRoot: string, criteria: string): string {
  const worktreePath = join(jarvisRoot, "worktrees", "demo", "write-run");
  mkdirSync(worktreePath, { recursive: true });
  const subspec = join(worktreePath, "00-subspec.md");
  writeFileSync(subspec, `## Acceptance criteria\n\n${criteria}`, "utf8");
  return subspec;
}

function capturingBinding(onPrompt: (prompt: string) => void): InvocationBinding {
  return {
    id: "agent",
    invoke: async ({ prompt, cwd }) => {
      onPrompt(prompt);
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    },
  };
}

export function stageMutationCheckpointFixtures(worktreePath: string): void {
  const fixtureDir = join(import.meta.dir, "testing", "mutation-checkpoint");
  const targetDir = join(worktreePath, "v2/src/execution/testing/mutation-checkpoint");
  mkdirSync(targetDir, { recursive: true });
  for (const file of readdirSync(fixtureDir)) {
    cpSync(join(fixtureDir, file), join(targetDir, file));
  }
}

function copyMutationCheckpointFixtures(jarvisRoot: string): string {
  const worktreePath = join(jarvisRoot, "worktrees", "demo", "write-run");
  stageMutationCheckpointFixtures(worktreePath);
  return worktreePath;
}

function expectGuardInversionWriteStepRules(prompt: string): void {
  expect(prompt).toContain("require a source mutation on the real guard");
  expect(prompt).toContain("comment checkpoint on the pinning test");
  expect(prompt).toContain("production invert hooks are forbidden");
  expect(prompt).toContain("Do not add");
  expect(prompt).toContain("`setInvert*ForTest` exports");
  expect(prompt).toContain("`invert*ForTest` module variables");
  expect(prompt).toContain("`invert*` function parameters");
  expect(prompt).toContain("`invert*ForTest` type members");
}

async function runPlanDraftWrite(args: {
  jarvisRoot: string;
  branchName: string;
  agentSetup: (cwd: string, stagePath: string) => void | Promise<void>;
}) {
  roots.push(join(args.jarvisRoot, ".."));
  const specPath = "v2/spec/2099-01-01T00-00-00Z-plan-draft";
  return executeWrite({
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: args.branchName,
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath,
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: ".jarvis-plan-stage",
    promptId: "plan.prompt.draft",
    intentSeed: "---\nname: test\n---\n\n## Prerequisites\n\nnone\n",
    bindings: [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          const stagePath = join(cwd, ".jarvis-plan-stage");
          await args.agentSetup(cwd, stagePath);
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ],
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
  });
}

describe("write behavior", () => {
  afterEach(() => {});
  test("happy path: done plus artifact contract pass returns complete", async () => {
    const { jarvisRoot } = createJarvisHome();
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runWrite({ jarvisRoot, bindings });
    expect(result.result.kind).toBe("complete");
  });

  test("quota fallback success: second binding completes", async () => {
    const { jarvisRoot } = createJarvisHome();
    const calls: string[] = [];
    const bindings: InvocationBinding[] = [
      {
        id: "first",
        invoke: async () => {
          calls.push("first");
          return { kind: "quota", stderr: "quota" };
        },
      },
      {
        id: "second",
        invoke: async ({ cwd }) => {
          calls.push("second");
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runWrite({ jarvisRoot, bindings });
    expect(result.result.kind).toBe("complete");
    expect(calls).toEqual(["first", "second"]);
  });

  test("terminal contract miss returns non-success result", async () => {
    const { jarvisRoot } = createJarvisHome();
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }),
        },
      ],
    });

    expect(result.result.kind).toBe("contract_miss");
  });

  test("done token on a subspec with unticked criteria is a contract miss", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(jarvisRoot, "- [ ] the harness records a commit\n");

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("spec.criteria-ticked");
      expect(result.result.failureReason).toContain("the harness records a commit");
    }
  });

  test("done token completes once every non-human-only criterion is ticked", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [ ] the harness records a commit\n- [ ] the banner looks right (manual)\n",
    );

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            writeFileSync(
              subspec,
              "## Acceptance criteria\n\n- [x] the harness records a commit\n- [ ] the banner looks right (manual)\n",
              "utf8",
            );
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    expect(result.result.kind).toBe("complete");
  });

  test("blocked token with blocker text returns blocked", async () => {
    const { jarvisRoot } = createJarvisHome();
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            appendFileSync(join(cwd, "spec.md"), "\n## Blocker\n\nstuck\n", "utf8");
            return { kind: "ok", stdout: "blocked", stderr: "" };
          },
        },
      ],
    });

    expect(result.result.kind).toBe("blocked");
  });

  test("progress token returns non-success without retry", async () => {
    const { jarvisRoot } = createJarvisHome();
    let calls = 0;
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            calls += 1;
            return { kind: "ok", stdout: "progress", stderr: "" };
          },
        },
      ],
    });

    expect(result.result.kind).toBe("progress");
    expect(calls).toBe(1);
  });

  test("default prompt id renders write.execute with restraint principles", async () => {
    const { jarvisRoot } = createJarvisHome();
    let capturedPrompt = "";
    await runWrite({ jarvisRoot, bindings: [capturingBinding((prompt) => (capturedPrompt = prompt))] });

    expect(capturedPrompt).toContain("Read the spec at ");
    expect(capturedPrompt).toContain("spec.md.");
    expect(capturedPrompt).toContain("# Restraint principles");
    expect(capturedPrompt).toContain("Return exactly one terminal token.");
  });

  test("non-default prompt id renders the caller-supplied placeholder map", async () => {
    const { jarvisRoot } = createJarvisHome();
    let capturedPrompt = "";
    await runWrite({
      jarvisRoot,
      bindings: [capturingBinding((prompt) => (capturedPrompt = prompt))],
      promptId: "plan.prompt.draft",
      promptPlaceholders: {
        WORKDIR: "/tmp/work",
        NAME: "example-spec",
        INTENT: "Do the thing.",
        SPEC_GUIDANCE: "Follow the guidance.",
      },
    });

    expect(capturedPrompt).toContain("`/tmp/work`");
    expect(capturedPrompt).toContain("`example-spec`");
    expect(capturedPrompt).not.toContain("Read the spec at");
  });

  // Inversion target: DEFAULT_WRITE_STEP_RULES — removing, gutting, or inverting polarity in the guard-inversion paragraph turns this test RED.
  test("patch.prompt.body resolves step placeholders and invokes binding", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const specPath = "v2/spec/demo/index.md";
    const subspecPath = "v2/spec/demo/00-task.md";
    const repoGuidance = "# Repo rules\n";
    const subspecBody = "## Acceptance criteria\n\n- [x] task\n";
    let capturedPrompt = "";
    let bindingInvoked = false;

    const result = await executeWrite({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "implement-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath,
      stepRules: DEFAULT_WRITE_STEP_RULES,
      expectedArtifactPath: subspecPath,
      promptId: "patch.prompt.body",
      bindings: [
        {
          id: "agent",
          invoke: async ({ prompt }) => {
            bindingInvoked = true;
            capturedPrompt = prompt;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: async (args, run) => {
        const worktreePath = join(jarvisRoot, "worktrees", args.projectName, args.branchName);
        mkdirSync(join(worktreePath, "v2/spec/demo"), { recursive: true });
        writeFileSync(join(worktreePath, "AGENTS.md"), repoGuidance, "utf8");
        writeFileSync(join(worktreePath, specPath), "# Index\n", "utf8");
        writeFileSync(join(worktreePath, subspecPath), subspecBody, "utf8");
        const value = await run({ path: worktreePath, reused: false });
        return { worktree: { path: worktreePath, reused: false }, lock: { kind: "acquired" }, value };
      },
    });

    const resolvedSubspecPath = join(result.worktreePath, subspecPath);
    expect(bindingInvoked).toBe(true);
    expect(result.result.kind).toBe("complete");
    expect(capturedPrompt).toContain(join(result.worktreePath, specPath));
    expect(capturedPrompt).toContain(resolvedSubspecPath);
    expect(capturedPrompt).toContain(subspecBody);
    expect(capturedPrompt).toContain(repoGuidance);
    expect(capturedPrompt).toContain(DEFAULT_WRITE_STEP_RULES);
    expect(capturedPrompt.trimEnd().endsWith(DEFAULT_WRITE_STEP_RULES)).toBe(true);
    expectGuardInversionWriteStepRules(capturedPrompt);
    expect(capturedPrompt).toContain(
      "When a guard sits inside a `setTimeout` or `setInterval` callback, extract it into a pure exported predicate and test both truth directions directly without a real-timer wait.",
    );
  });

  test("patch.prompt.shrink renders DEFAULT_WRITE_STEP_RULES as final block", async () => {
    const { jarvisRoot } = createJarvisHome();
    let capturedPrompt = "";

    await executeWrite({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "shrink-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath: "spec.md",
      stepRules: DEFAULT_WRITE_STEP_RULES,
      expectedArtifactPath: "proof.txt",
      promptId: "patch.prompt.shrink",
      promptPlaceholders: {
        SPEC_TREE: "# Spec\n",
        ALLOWLIST: "- proof.txt",
        BRANCH_DIFF: "(no changes)",
        RUN_SCOPED_DIFF: "(no changes)",
      },
      bindings: [
        {
          id: "agent",
          invoke: async ({ prompt }) => {
            capturedPrompt = prompt;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(capturedPrompt).toContain("Post-completion Shrink");
    expect(capturedPrompt).toContain(DEFAULT_WRITE_STEP_RULES);
    expect(capturedPrompt.trimEnd().endsWith(DEFAULT_WRITE_STEP_RULES)).toBe(true);
  });

  test("unresolved required placeholders fail as model_config without invoking binding", async () => {
    const { jarvisRoot } = createJarvisHome();
    let bindingInvoked = false;

    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            bindingInvoked = true;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      promptId: "plan.prompt.draft",
    });

    expect(bindingInvoked).toBe(false);
    expect(result.result.kind).toBe("invocation_failure");
    if (result.result.kind === "invocation_failure") {
      expect(result.result.failureKind).toBe("model_config");
    }
  });

  test("intent split prompt wires staging output and step rules", async () => {
    const { jarvisRoot } = createJarvisHome();
    let capturedPrompt = "";
    const result = await runWrite({
      jarvisRoot,
      artifactPath: ".jarvis-intent-stage",
      promptId: "intent.prompt.split",
      stepRules: DEFAULT_WRITE_STEP_RULES,
      promptPlaceholders: {
        WORKDIR: "/tmp/worktree",
        SEED_LABEL: "inline",
        SEED_CONTENT: "Rename the plan flag",
      },
      bindings: [
        {
          id: "agent",
          invoke: async ({ prompt, cwd }) => {
            capturedPrompt = prompt;
            const stageDir = join(cwd, ".jarvis-intent-stage");
            mkdirSync(stageDir, { recursive: true });
            writeFileSync(
              join(stageDir, "plan-intent-flag.md"),
              "---\nname: plan-intent-flag\n---\n\n# Title\n\n## Prerequisites\n\n",
              "utf8",
            );
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    expect(capturedPrompt).toContain("Write the authored intents as markdown files under `.jarvis-intent-stage`");
    expect(capturedPrompt).toContain(DEFAULT_WRITE_STEP_RULES);
    expect(result.result.kind).toBe("complete");
    expect(existsSync(join(result.worktreePath, ".jarvis-intent-stage", "plan-intent-flag.md"))).toBe(true);
  });

  // Inversion target: DEFAULT_WRITE_STEP_RULES — removing, gutting, or inverting polarity in the guard-inversion paragraph turns this test RED.
  test("intentSeed branch: agent-instructed write path matches the seeded/validated spec directory", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const specPath = "v2/spec/2099-01-01T00-00-00Z-demo";
    const intentSeed = "---\nname: demo\n---\n\n## Prerequisites\n\nnone\n";
    let capturedPrompt = "";

    const result = await executeWrite({
      worktree: { projectRoot: "/fake", projectName: "demo", branchName: "plan-run", baseRef: "HEAD", jarvisRoot },
      specPath,
      stepRules: DEFAULT_WRITE_STEP_RULES,
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed,
      bindings: [
        {
          id: "agent",
          invoke: async ({ prompt, cwd }) => {
            capturedPrompt = prompt;
            const specDir = join(cwd, specPath);
            mkdirSync(specDir, { recursive: true });
            writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00 - First](./00-first.md)\n", "utf8");
            writeFileSync(join(specDir, "00-first.md"), "## Acceptance criteria\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(result.result.kind).toBe("complete");
    const _expectedSpecDir = join(result.worktreePath, specPath);
    expect(capturedPrompt).toContain("Before editing code, read the relevant durable docs/specs");
    expect(capturedPrompt).toContain("Record decisions, constraints, and assumptions as a ledger");
    expect(capturedPrompt).toContain(intentSeed);
    expect(capturedPrompt).toContain("## File output");
    expect(capturedPrompt).toContain(`under \`${join(result.worktreePath, ".jarvis-plan-stage")}\`.`);
    expect(capturedPrompt).toContain("Do not emit spec content to stdout");
    expect(capturedPrompt).toContain("## Step completion");
    expect(capturedPrompt).toContain(DEFAULT_WRITE_STEP_RULES);
    expectGuardInversionWriteStepRules(capturedPrompt);

    const intentPath = join(result.worktreePath, ".jarvis-plan-stage", "intent.md");
    expect(existsSync(intentPath)).toBe(true);
    expect(readFileSync(intentPath, "utf8")).toBe(intentSeed);
  });

  test("plan-draft completion normalizes the k=2 staged fixture before shape validation", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const fixtureDir = join(import.meta.dir, "../../../shared/fixtures/module-boundary-surfaces/k2");
    const specPath = "v2/spec/2099-01-01T00-00-01Z-normalized";
    const branchName = "plan-normalization";
    const stagePath = join(jarvisRoot, "worktrees", "demo", branchName, ".jarvis-plan-stage");
    let validationCalls = 0;

    const result = await executeWrite({
      worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
      specPath,
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed: readFileSync(join(fixtureDir, "intent.md"), "utf8"),
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            cpSync(fixtureDir, stagePath, { recursive: true });
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      completionValidator: (stagingDir) => {
        validationCalls += 1;
        expect(stagingDir).toBe(stagePath);
        if (validationCalls === 1) {
          expect(readdirSync(stagingDir).sort()).toEqual(["00-phase-1-state-cli.md", "index.md", "intent.md"]);
        }
        return { valid: true };
      },
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(result.result.kind).toBe("complete");
    expect(validationCalls).toBeGreaterThan(0);
    expect(readdirSync(stagePath).sort()).toEqual(["00-persistence.md", "01-cli.md", "index.md", "intent.md"]);
    // Shape validation now runs before normalization, so these assert the normalized output
    // after the call rather than inside completionValidator.
    expect(readFileSync(join(stagePath, "index.md"), "utf8")).toBe(
      "# Staged plan\n\n- [ ] [00 - Persistence](./00-persistence.md)\n- [ ] [01 - CLI](./01-cli.md)\n",
    );
    const criteriaOf = (file: string): string[] =>
      readFileSync(join(stagePath, file), "utf8")
        .split("\n")
        .filter((line) => /^-\s\[[ xX]\]\s+/u.test(line));
    expect(criteriaOf("00-persistence.md")).toEqual(["- [ ] The state-store persists completed runs atomically."]);
    expect(criteriaOf("01-cli.md")).toEqual(["- [ ] The CLI validates run flags before dispatch."]);
  });

  test("plan-draft completion normalizes durable output before recovery", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const fixtureDir = join(import.meta.dir, "../../../shared/fixtures/module-boundary-surfaces/k2");
    const specPath = "v2/spec/2099-01-01T00-00-02Z-recovered";
    const branchName = "plan-recovery-normalization";
    const stagePath = join(jarvisRoot, "worktrees", "demo", branchName, ".jarvis-plan-stage");

    const result = await executeWrite({
      worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
      specPath,
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed: readFileSync(join(fixtureDir, "intent.md"), "utf8"),
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            cpSync(fixtureDir, join(cwd, specPath), { recursive: true });
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(result.result.kind).toBe("complete");
    expect(readdirSync(stagePath).sort()).toEqual(["00-persistence.md", "01-cli.md", "index.md", "intent.md"]);
  });

  test("plan-draft completion rejects an inconsistent staged index", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));

    const result = await executeWrite({
      worktree: { projectRoot: "/fake", projectName: "demo", branchName: "bad-index", baseRef: "HEAD", jarvisRoot },
      specPath: "v2/spec/2099-01-01T00-00-03Z-bad-index",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed: "---\nname: bad-index\n---\n",
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            const stagingDir = join(cwd, ".jarvis-plan-stage");
            mkdirSync(stagingDir, { recursive: true });
            writeFileSync(join(stagingDir, "intent.md"), "---\nname: bad-index\n---\n", "utf8");
            writeFileSync(join(stagingDir, "index.md"), "# Index\n\n- [ ] [Wrong](./01-wrong.md)\n", "utf8");
            writeFileSync(join(stagingDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(result.result.kind).toBe("contract_miss");
  });

  test("plan-draft contract_miss on staging normalizer failure does not pass via durable fallback", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspecFile = "00-one.md";
    const durableSpecPath = "v2/spec/2099-01-01T00-00-00Z-plan-draft";

    const result = await runPlanDraftWrite({
      jarvisRoot,
      branchName: "plan-staging-normalizer-durable-pass",
      agentSetup: (cwd, stagePath) => {
        const durablePath = join(cwd, durableSpecPath);
        mkdirSync(durablePath, { recursive: true });
        writeFileSync(join(durablePath, "index.md"), `# Index\n\n- [ ] [00 - One](./${subspecFile})\n`, "utf8");
        writeFileSync(
          join(durablePath, subspecFile),
          `# One\n\n## Acceptance criteria\n\n- [ ] Single-surface criterion.\n`,
          "utf8",
        );

        mkdirSync(stagePath, { recursive: true });
        writeFileSync(join(stagePath, "intent.md"), "---\nname: test\n---\n", "utf8");
        writeFileSync(join(stagePath, "index.md"), `# Index\n\n- [ ] [00 - One](./${subspecFile})\n`, "utf8");
        writeFileSync(
          join(stagePath, subspecFile),
          `# One\n\n## Acceptance criteria\n\n- [ ] ${MULTI_SURFACE_BULLET}\n`,
          "utf8",
        );
      },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("artifact.exists");
      expect(result.result.failureReason).toContain("multi-surface ## Acceptance criteria bullet");
      expect(result.result.failureReason).toContain(subspecFile);
      expect(result.result.failureReason).toContain(MULTI_SURFACE_BULLET);
      expect(result.result.failureReason).not.toBe("plan.draft.shape");
    }
  });

  test("plan-draft contract_miss on multi-surface acceptance bullet carries normalizer message", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspecFile = "00-one.md";

    const result = await runPlanDraftWrite({
      jarvisRoot,
      branchName: "plan-multi-surface",
      agentSetup: (_cwd, stagePath) => {
        mkdirSync(stagePath, { recursive: true });
        writeFileSync(join(stagePath, "intent.md"), "---\nname: test\n---\n", "utf8");
        writeFileSync(join(stagePath, "index.md"), `# Index\n\n- [ ] [00 - One](./${subspecFile})\n`, "utf8");
        writeFileSync(
          join(stagePath, subspecFile),
          `# One\n\n## Acceptance criteria\n\n- [ ] ${MULTI_SURFACE_BULLET}\n`,
          "utf8",
        );
      },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("artifact.exists");
      expect(result.result.failureReason).toContain("multi-surface ## Acceptance criteria bullet");
      expect(result.result.failureReason).toContain(subspecFile);
      expect(result.result.failureReason).toContain(MULTI_SURFACE_BULLET);
    }
  });

  test("plan-draft contract_miss on missing index link carries normalizer message", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspecFile = "00-one.md";

    const result = await runPlanDraftWrite({
      jarvisRoot,
      branchName: "plan-missing-index-link",
      agentSetup: (_cwd, stagePath) => {
        mkdirSync(stagePath, { recursive: true });
        writeFileSync(join(stagePath, "intent.md"), "---\nname: test\n---\n", "utf8");
        writeFileSync(join(stagePath, "index.md"), "# Index\n\n- [ ] [Wrong](./01-wrong.md)\n", "utf8");
        writeFileSync(join(stagePath, subspecFile), "# One\n\n## Acceptance criteria\n\n- [ ] x\n", "utf8");
      },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("artifact.exists");
      expect(result.result.failureReason).toContain("Plan index links unknown subspec 01-wrong.md");
    }
  });

  test("plan-draft contract_miss on stage without index.md settles plan.draft.shape", async () => {
    const { jarvisRoot } = createJarvisHome();

    const result = await runPlanDraftWrite({
      jarvisRoot,
      branchName: "plan-missing-index",
      agentSetup: (_cwd, stagePath) => {
        mkdirSync(stagePath, { recursive: true });
        writeFileSync(join(stagePath, "intent.md"), "---\nname: test\n---\n", "utf8");
        writeFileSync(join(stagePath, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n", "utf8");
      },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("artifact.exists");
      expect(result.result.failureReason).toBe("plan.draft.shape");
      expect(result.result.failureReason).not.toContain("Plan index");
      expect(result.result.failureReason).not.toContain("multi-surface");
    }
  });

  test("plan-draft contract_miss on stage with index but zero subspecs settles plan.draft.shape", async () => {
    const { jarvisRoot } = createJarvisHome();

    const result = await runPlanDraftWrite({
      jarvisRoot,
      branchName: "plan-zero-subspecs",
      agentSetup: (_cwd, stagePath) => {
        mkdirSync(stagePath, { recursive: true });
        writeFileSync(join(stagePath, "intent.md"), "---\nname: test\n---\n", "utf8");
        writeFileSync(join(stagePath, "index.md"), "# Index\n\n", "utf8");
      },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("artifact.exists");
      expect(result.result.failureReason).toBe("plan.draft.shape");
      expect(result.result.failureReason).not.toContain("Plan index");
      expect(result.result.failureReason).not.toContain("multi-surface");
    }
  });

  test("intentSeed branch: delimiter-violating intent seed fails as model_config", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const specPath = "v2/spec/2099-01-01T00-00-02Z-delimiter";
    const intentSeed = "---\nname: bad\n---\n\ncontains <<<INTENT_BEGIN>>>\n";
    let bindingInvoked = false;

    const result = await executeWrite({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "plan-run-delimiter",
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath,
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            bindingInvoked = true;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(bindingInvoked).toBe(false);
    expect(result.result.kind).toBe("invocation_failure");
    if (result.result.kind === "invocation_failure") {
      expect(result.result.failureKind).toBe("model_config");
    }
  });

  test("plan-draft blocked token without blocker text stays blocked", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const specPath = "v2/spec/2099-01-01T00-00-02Z-plan-blocked";

    const result = await executeWrite({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "plan-blocked-token",
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath,
      stepRules: "unused",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed: "---\nname: blocked\n---\n\n## Prerequisites\n\nnone\n",
      bindings: [
        {
          id: "agent",
          invoke: async () => ({ kind: "ok", stdout: "blocked", stderr: "" }),
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(result.result.kind).toBe("blocked");
  });

  test("intentSeed branch: a genuine blocker in intent.md short-circuits completion", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const specPath = "v2/spec/2099-01-01T00-00-01Z-blocked";
    const intentSeed = "---\nname: blocked\n---\n\n## Prerequisites\n\nnone\n";

    const result = await executeWrite({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "plan-run-blocked",
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath,
      stepRules: "unused",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            const specDir = join(cwd, specPath);
            mkdirSync(specDir, { recursive: true });
            writeFileSync(join(specDir, "intent.md"), `${intentSeed}\n## Blocker\n\nMissing prerequisite X.\n`, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(result.result.kind).not.toBe("complete");
  });

  test("telemetry append failure is surfaced separately without changing the settled step result", async () => {
    const { jarvisRoot } = createJarvisHome();
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          metadata: { agent: "claude", model: "m1" },
          invoke: async ({ cwd }) => {
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      invocationTelemetry: {
        sink: {
          append() {
            throw new Error("disk full");
          },
        },
        operatorSessionId: "session-1",
        runId: "run-1",
        attemptId: "attempt-1",
        project: "demo",
        workflow: "write",
        stepId: null,
        role: "implement",
        branch: "write-run",
        specRef: "HEAD",
        invocationIds: ["inv-1"],
      },
    });

    expect(result.result.kind).toBe("complete");
    expect(result.result.invocation.telemetryFailures).toEqual([
      { invocationId: "inv-1", bindingId: "agent", message: "disk full" },
    ]);
  });

  test("plan preset draft step invokes binding and renders spec-guidance", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const specPath = "v2/spec/2099-01-01T00-00-00Z-example";
    const intentSeed = "---\nname: example\n---\n\n## Prerequisites\n\nnone\n";
    let capturedPrompt = "";
    let bindingInvoked = false;

    const result = await executeWrite({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "plan-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath,
      stepRules: "unused",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed,
      bindings: [
        {
          id: "agent",
          invoke: async ({ prompt, cwd }) => {
            bindingInvoked = true;
            capturedPrompt = prompt;
            const specDir = join(cwd, specPath);
            mkdirSync(specDir, { recursive: true });
            writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00 - First](./00-first.md)\n", "utf8");
            writeFileSync(join(specDir, "00-first.md"), "## Acceptance criteria\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    const specGuidance = readFileSync(
      join(import.meta.dir, "..", "..", "..", "v1", "docs", "spec-guidance.md"),
      "utf8",
    );
    expect(bindingInvoked).toBe(true);
    expect(result.result.kind).toBe("complete");
    expect(capturedPrompt).toContain(specGuidance.slice(0, 80));
  });

  test("plan-reviewed preset draft step invokes binding", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const specPath = "v2/spec/2099-01-01T00-00-01Z-reviewed";
    const intentSeed = "---\nname: reviewed\n---\n\n## Prerequisites\n\nnone\n";
    let bindingInvoked = false;

    const result = await executeWrite({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "plan-reviewed-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath,
      stepRules: "unused",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            bindingInvoked = true;
            const specDir = join(cwd, specPath);
            mkdirSync(specDir, { recursive: true });
            writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00 - First](./00-first.md)\n", "utf8");
            writeFileSync(join(specDir, "00-first.md"), "## Acceptance criteria\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(bindingInvoked).toBe(true);
    expect(result.result.kind).toBe("complete");
  });

  test("plan-reviewed-light preset draft step invokes binding", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const specPath = "v2/spec/2099-01-01T00-00-02Z-light";
    const intentSeed = "---\nname: light\n---\n\n## Prerequisites\n\nnone\n";
    let bindingInvoked = false;

    const result = await executeWrite({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "plan-light-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath,
      stepRules: "unused",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            bindingInvoked = true;
            const specDir = join(cwd, specPath);
            mkdirSync(specDir, { recursive: true });
            writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00 - First](./00-first.md)\n", "utf8");
            writeFileSync(join(specDir, "00-first.md"), "## Acceptance criteria\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(bindingInvoked).toBe(true);
    expect(result.result.kind).toBe("complete");
  });
});

// Pins the implement-path arm of executeDefaultWrite's blocker-text-contract path selection:
// the contract must attach for promptId "patch.prompt.body", keyed on the active subspec
// (expectedArtifactPath), not on specPath. The fake worktree always seeds a spec.md WITHOUT
// a `## Blocker`, so a subspec-keyed contract and a specPath-keyed one diverge observably.
describe("write behavior: implement-path blocker-text contract", () => {
  test("blocked with no blocker on the active subspec resolves to missing_blocker", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(jarvisRoot, "- [ ] work\n");
    let invocations = 0;

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            invocations += 1;
            if (invocations === 1) {
              return { kind: "ok", stdout: "blocked", stderr: "" };
            }
            return { kind: "ok", stdout: "still stuck", stderr: "" };
          },
        },
      ],
    });

    expect(invocations).toBe(2);
    expect(result.result.kind).toBe("missing_blocker");
  });

  test("blocked with a genuine blocker on the active subspec resolves to blocked", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(jarvisRoot, "- [ ] work\n");

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            appendFileSync(subspec, "\n## Blocker\n\nimplement path blocker\n", "utf8");
            return { kind: "ok", stdout: "blocked", stderr: "" };
          },
        },
      ],
    });

    // Contract keys on the subspec: the blocker appended there (not to the seeded, blocker-free
    // spec.md) is what makes this blocked. A specPath-keyed contract would reprompt to missing_blocker.
    expect(result.result.kind).toBe("blocked");
    if (result.result.kind === "blocked") {
      expect(result.result.blockerText).toBe("implement path blocker");
    }
  });

  test("blocked with a missing target subspec attaches no contract and stays blocked without throwing", async () => {
    const { jarvisRoot } = createJarvisHome();

    const result = await runWrite({
      jarvisRoot,
      artifactPath: "missing-subspec.md",
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "blocked", stderr: "" }) }],
    });

    expect(result.result.kind).toBe("blocked");
  });

  test("ticked mutation-checkpoint criterion with hollow checkpoint refuses done", async () => {
    const { jarvisRoot } = createJarvisHome();
    copyMutationCheckpointFixtures(jarvisRoot);
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `hollow-guard.test.ts` — keepPositive accepts one; Mutation checkpoint: negating `!value` guard must turn pin RED.\n",
    );

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: { runScopedTests: async () => true },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("spec.criteria-ticked");
      expect(result.result.failureReason).toContain("Hollow mutation checkpoint");
      expect(result.result.failureReason).toContain("hollow-guard.test.ts:");
      expect(result.result.failureReason).toContain("negating `!value` guard");
    }
  });

  test("ticked mutation-checkpoint criterion with hollow checkpoint refuses no-work", async () => {
    const { jarvisRoot } = createJarvisHome();
    copyMutationCheckpointFixtures(jarvisRoot);
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `hollow-guard.test.ts` — keepPositive accepts one; Mutation checkpoint: negating `!value` guard must turn pin RED.\n",
    );

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "no-work", stderr: "" }) }],
      mutationCheckpointSeams: { runScopedTests: async () => true },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("spec.criteria-ticked");
      expect(result.result.failureReason).toContain("Hollow mutation checkpoint");
      expect(result.result.failureReason).toContain("hollow-guard.test.ts:");
    }
  });

  test("ticked mutation-checkpoint criterion with caught checkpoint allows done", async () => {
    const { jarvisRoot } = createJarvisHome();
    copyMutationCheckpointFixtures(jarvisRoot);
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `caught-guard.test.ts` — keepPositive rejects zero; Mutation checkpoint: negating `!value` guard must turn pin RED.\n",
    );

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: { runScopedTests: async () => false },
    });

    expect(result.result.kind).toBe("complete");
  });

  test("unparseable mutation-checkpoint linkage is reported without contract_miss", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `missing-pin.test.ts` — no such pin; Mutation checkpoint: cannot link.\n",
    );
    const reported: { path: string; line: number }[] = [];

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: {
        reportSink: {
          reportUnparseable: (entry) => reported.push({ path: entry.path, line: entry.line }),
        },
      },
    });

    expect(result.result.kind).toBe("complete");
    expect(reported.length).toBeGreaterThan(0);
  });

  test("multi-pin criterion refuses done when one checkpoint is hollow and one is caught", async () => {
    const { jarvisRoot } = createJarvisHome();
    copyMutationCheckpointFixtures(jarvisRoot);
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `mixed-guards.test.ts` — mixed hollow and caught checkpoints; Mutation checkpoint: negating gate A `!value` guard must turn pin RED.\n",
    );
    let runs = 0;

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: {
        runScopedTests: async () => {
          runs += 1;
          return runs === 1;
        },
      },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("spec.criteria-ticked");
      expect(result.result.failureReason).toContain("gate A");
    }
  });

  test("pre-ticked hollow mutation-checkpoint criterion refuses done when all rows are ticked", async () => {
    const { jarvisRoot } = createJarvisHome();
    copyMutationCheckpointFixtures(jarvisRoot);
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `hollow-guard.test.ts` — keepPositive accepts one; Mutation checkpoint: negating `!value` guard must turn pin RED.\n- [x] unrelated criterion\n",
    );

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: { runScopedTests: async () => true },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("spec.criteria-ticked");
    }
  });

  for (const testFile of ["hollow-guard.test.ts", "caught-guard.test.ts"] as const) {
    test(`inverting guard for ${testFile} turns pin RED`, async () => {
      const guardPath = join(import.meta.dir, "testing/mutation-checkpoint/hollow-guard.ts");
      const testPath = join(import.meta.dir, "testing/mutation-checkpoint", testFile);
      const original = readFileSync(guardPath, "utf8");
      writeFileSync(guardPath, original.replace("if (!value)", "if (value)"), "utf8");
      try {
        const exit = await Bun.spawn({ cmd: ["bun", "test", testPath], stdout: "pipe", stderr: "pipe" }).exited;
        expect(exit).not.toBe(0);
      } finally {
        writeFileSync(guardPath, original, "utf8");
      }
    });
  }
});
