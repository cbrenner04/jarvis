import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
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
  mutationCheckpointSeams?: Parameters<typeof executeWrite>[0]["mutationCheckpointSeams"];
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
    ...(args.mutationCheckpointSeams !== undefined ? { mutationCheckpointSeams: args.mutationCheckpointSeams } : {}),
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

function extractSpecGuidance(prompt: string): string {
  const beginMarker = "<<<SPEC_GUIDANCE_BEGIN>>>";
  const endMarker = "<<<SPEC_GUIDANCE_END>>>";
  const begin = prompt.lastIndexOf(beginMarker);
  const end = prompt.lastIndexOf(endMarker);
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  return prompt.slice(begin + beginMarker.length, end);
}

const HUMAN_ONLY_MARKER_GUIDANCE =
  "marker strings appears anywhere in its full bullet block: `(Manual)`, `visual inspection only`, or `no automated guard`. Matching is case-insensitive substring matching across the first checklist line and any continuation lines; markers need not be trailing or whole phrases";

function extractFinalStepRules(prompt: string): string {
  const marker = "\n\nHuman-only acceptance criteria contain";
  const start = prompt.lastIndexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return prompt.slice(start + 2);
}

const HUMAN_ONLY_STEP_RULES =
  "Human-only acceptance criteria contain `(Manual)`, `visual inspection only`, or `no automated guard` anywhere in the full bullet block (the first checklist line and any continuation lines). Recognition uses case-insensitive substring matching; markers need not be trailing or whole phrases.";

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

  test("ticked mutation-checkpoint criterion with no linked directive is a contract miss", async () => {
    // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "if (linked.length === 0) {" -> "if (false) {"
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `guard.test.ts` — `guard pin`; Mutation checkpoint: flipping the guard turns this RED.\n",
    );
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    writeFileSync(join(worktree, "guard.ts"), "export const ok = (a: number) => a > 0;\n", "utf8");
    // Prose only: the shape that satisfied the contract before directives existed.
    writeFileSync(
      join(worktree, "guard.test.ts"),
      'test("guard pin", () => {\n  // Mutation checkpoint: flipping `a > 0` turns this RED.\n});\n',
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
      expect(result.result.failedContractId).toBe("spec.criteria-ticked");
      expect(result.result.failureReason).toContain("@mutate");
    }
  });

  test("ticked mutation-checkpoint criterion whose directive leaves the suite green is a contract miss", async () => {
    // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "if (survived) {" -> "if (false) {"
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
      mutationCheckpointSeams: { runScopedTests: async () => true },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("spec.criteria-ticked");
      expect(result.result.failureReason).toContain("scoped suite stayed green");
      expect(result.result.failureReason).toContain("guard.test.ts:2");
    }
  });

  test("one hollow directive among several refuses completion", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `guard.test.ts` — `guard pin`; Mutation checkpoint: two guards named on that pin.\n",
    );
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    writeFileSync(
      join(worktree, "guard.ts"),
      "export const ok = (a: number) => a > 0;\nexport const two = 2;\n",
      "utf8",
    );
    writeFileSync(
      join(worktree, "guard.test.ts"),
      [
        'test("guard pin", () => {',
        '  // @mutate guard.ts "a > 0" -> "a >= 0"',
        '  // @mutate guard.ts "two = 2" -> "two = 3"',
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    let call = 0;

    const result = await runWrite({
      jarvisRoot,
      artifactPath: subspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: {
        runScopedTests: async () => {
          call += 1;
          return call === 2; // the second directive survives
        },
      },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failureReason).toContain("two = 2");
    }
  });

  test("ticked mutation-checkpoint criterion completes when its directive turns the suite red", async () => {
    // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "report_.caught.push(directive);" -> "report_.hollow.push({ criterionText, directive, detail: \"forced\" });"
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

    expect(result.result.kind).toBe("complete");
  });

  test("unparseable in a referenced pinning file refuses completion", async () => {
    // @mutate v2/src/execution/write.ts "report.unparseable.length === 0" -> "true"
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `v2/src/execution/write.test.ts` — `unparseable in a referenced pinning file refuses completion`; Mutation checkpoint: flipping the guard turns this RED.\n",
    );
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    mkdirSync(join(worktree, "v2/src/execution"), { recursive: true });
    writeFileSync(join(worktree, "guard.ts"), "export const ok = (a: number) => a > 0;\n", "utf8");
    writeFileSync(
      join(worktree, "v2/src/execution/write.test.ts"),
      'test("unparseable in a referenced pinning file refuses completion", () => {\n  // @mutate nonsense\n});\n',
      "utf8",
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
      expect(result.result.failureReason).toContain("v2/src/execution/write.test.ts");
      expect(result.result.failureReason).toContain("// @mutate nonsense");
      expect(result.result.failureReason).toContain("malformed");
    }
  });

  test("unresolved pinning test blocks completion", async () => {
    // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "if (normalized.includes(\"/\"))" -> "if (false)"
    const { jarvisRoot } = createJarvisHome();
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    mkdirSync(join(worktree, "v2/src/execution"), { recursive: true });
    writeFileSync(
      join(worktree, "v2/src/execution/write.test.ts"),
      [
        'test("unresolved pinning test blocks completion", () => {',
        '  // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "if (normalized.includes(\\"/\\"))" -> "if (false)"',
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    const unresolvedSubspec = join(worktree, "unresolved-pin.md");
    writeFileSync(
      unresolvedSubspec,
      "## Acceptance criteria\n\n- [x] `absent.test.ts` — `missing pin`; Mutation checkpoint: named.\n",
      "utf8",
    );

    const result = await runWrite({
      jarvisRoot,
      artifactPath: unresolvedSubspec,
      promptId: "patch.prompt.body",
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      mutationCheckpointSeams: { runScopedTests: async () => true },
    });

    expect(result.result.kind).toBe("contract_miss");
    if (result.result.kind === "contract_miss") {
      expect(result.result.failedContractId).toBe("spec.criteria-ticked");
      expect(result.result.failureReason).toContain("criterion:");
      expect(result.result.failureReason).toContain("reference: absent.test.ts");
      expect(result.result.failureReason).toContain("reason: unresolved_pinning_test");
    }
  });

  test("ambiguous pinning-test basename blocks completion", async () => {
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [x] `write.test.ts` — `ambiguous pin`; Mutation checkpoint: ambiguous basename.\n",
    );
    const worktree = join(jarvisRoot, "worktrees", "demo", "write-run");
    mkdirSync(join(worktree, "v2/src/a"), { recursive: true });
    mkdirSync(join(worktree, "v2/src/b"), { recursive: true });
    writeFileSync(join(worktree, "v2/src/a/write.test.ts"), 'test("ambiguous pin", () => {});\n', "utf8");
    writeFileSync(join(worktree, "v2/src/b/write.test.ts"), 'test("ambiguous pin", () => {});\n', "utf8");

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
      expect(result.result.failureReason).toContain("criterion:");
      expect(result.result.failureReason).toContain("reference: write.test.ts");
      expect(result.result.failureReason).toContain("reason: unresolved_pinning_test");
    }
  });

  test("done completes when only a wrapped human-only criterion is unchecked", async () => {
    // @mutate v2/src/execution/write.ts ".filter((criterion) => !criterion.humanOnly && !criterion.checked)" -> ".filter((criterion) => criterion.humanOnly && !criterion.checked)"
    const { jarvisRoot } = createJarvisHome();
    const subspec = writeImplementSubspec(
      jarvisRoot,
      "- [ ] the harness records a commit\n- [ ] the banner looks right\n      (Manual)\n",
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
              "## Acceptance criteria\n\n- [x] the harness records a commit\n- [ ] the banner looks right\n      (Manual)\n",
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
    expect(capturedPrompt.trimEnd().endsWith(DEFAULT_WRITE_STEP_RULES)).toBe(true);
    expect(extractFinalStepRules(capturedPrompt)).toContain(HUMAN_ONLY_STEP_RULES);
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

  test.each([
    ["write.ready-repair", { GATE_COMMAND: "bun test", GATE_EXIT_CODE: "1", GATE_OUTPUT: "failure" }],
    [
      "write.mutation-repair",
      {
        SURVIVING_MUTATION: "return true -> return false",
        SOURCE_FILE: "v2/src/example.ts",
        SOURCE_LINE: "1",
        DUAL_CONSTRAINT_DETAIL: "Preserve the passing behavior.",
      },
    ],
  ] as const)("%s renders the shared human-only step rules", async (promptId, promptPlaceholders) => {
    const { jarvisRoot } = createJarvisHome();
    let capturedPrompt = "";

    await runWrite({
      jarvisRoot,
      bindings: [capturingBinding((prompt) => (capturedPrompt = prompt))],
      promptId,
      promptPlaceholders,
      stepRules: DEFAULT_WRITE_STEP_RULES,
    });

    expect(capturedPrompt.trimEnd().endsWith(DEFAULT_WRITE_STEP_RULES)).toBe(true);
    expect(extractFinalStepRules(capturedPrompt)).toContain(HUMAN_ONLY_STEP_RULES);
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

  test("plan preset draft step isolates bundled human-only marker guidance", async () => {
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
      stepRules: "STEP_COMPLETION_SENTINEL",
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

    expect(bindingInvoked).toBe(true);
    expect(result.result.kind).toBe("complete");
    expect(capturedPrompt).toContain("STEP_COMPLETION_SENTINEL");
    const specGuidance = extractSpecGuidance(capturedPrompt);
    expect(specGuidance).not.toContain("STEP_COMPLETION_SENTINEL");
    expect(specGuidance).toContain(HUMAN_ONLY_MARKER_GUIDANCE);
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
});
